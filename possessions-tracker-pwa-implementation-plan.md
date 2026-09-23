# Implementation Plan: Possessions-Tracking PWA

## 1. Architecture Overview

```
[Camera] --> [Local photo queue (IndexedDB)] --> [Click "Analyze"]
                                                        |
                                              [Background job queue]
                                                        |
                                         [Vision call via OpenRouter API]
                                                        |
                                    [Structured item data written to IndexedDB]
                                                        |
                                [UI: category browser + export + delete]
                                                        |
                                    [Later: WebDAV sync to NAS]
```

Core principle: **offline-first, local-first.** Photos and metadata live primarily in the browser (IndexedDB), the AI analysis is an async background job, and NAS sync is an optional export layer on top. This keeps the app usable without internet and keeps you independent of any single cloud vendor.

## 2. Tech Stack

| Layer | Choice | Reasoning |
|---|---|---|
| Frontend | React or Svelte + Vite, `vite-plugin-pwa` | Generates manifest/service worker boilerplate automatically |
| Local DB | IndexedDB via the `idb` wrapper | Structured queries, indexes on category, survives reloads |
| Photo storage | Blobs stored directly in IndexedDB (or Cache Storage) | No server needed for phase 1 |
| Background analysis | Web Worker + fetch, do NOT rely solely on the Background Sync API | Background Sync API is not supported on iOS Safari, so you need a resume-on-open fallback [web:26][web:29] |
| Vision AI | OpenRouter unified API, routed to a cheap vision model | One API key, one SDK, easy to swap models later [web:43] |
| NAS sync | WebDAV client in-browser against Nextcloud/Synology/QNAP | Standard protocol, natively supported by most NAS systems [web:18] |

## 3. OpenRouter Integration

OpenRouter gives you one unified API for many vision-capable models, so you can start cheap and swap models without rewriting your app logic [web:43].

### Recommended model choice

For classifying household items from a photo, you don't need a frontier model — go for the cheapest capable Gemini Flash-Lite tier available on OpenRouter at the time:

| Model (OpenRouter slug) | Input | Output | Notes |
|---|---|---|---|
| `google/gemini-2.5-flash-lite` | $0.10/M tokens | $0.40/M tokens | Cheapest solid option, supports structured outputs and function calling [web:34] |
| `google/gemini-3.1-flash-lite` | $0.25/M tokens | $1.50/M tokens | Newer, GA, higher context ceiling if you ever batch multiple photos per call [web:31] |

Realistically, at low personal-use volume, either model will cost you fractions of a cent per photo. Start with `gemini-2.5-flash-lite` and only upgrade if classification quality disappoints you.

### Structured output setup

OpenRouter supports strict JSON-schema-constrained outputs via the `response_format` parameter [web:40][web:43]:

```json
{
  "model": "google/gemini-2.5-flash-lite",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Identify every distinct household item in this photo. Return one entry per item, even if multiple items are visible." },
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
      ]
    }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "item_classification",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "items_detected": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "category": { "type": "string" },
                "subcategory": { "type": "string" },
                "color": { "type": "string" },
                "material": { "type": "string" },
                "description": { "type": "string" },
                "confidence": { "type": "number" }
              },
              "required": ["category", "subcategory", "description", "confidence"]
            }
          }
        },
        "required": ["items_detected"]
      }
    }
  }
}
```

Important detail: structured-output support is per-provider-endpoint, not just per-model. If OpenRouter routes your request to a provider that doesn't support `json_schema` strict mode, you'll get inconsistent results. Set `require_parameters: true` in your provider routing preferences so OpenRouter only routes to endpoints that actually support structured outputs [web:40].

### Practical prompting tips

From real-world reports of nearly identical use cases (classifying household/removal items via Gemini): explicitly instruct the model to enumerate every object separately rather than summarizing the scene, and give it a fallback category to use when uncertain, so nothing silently gets dropped [web:27].

## 4. Data Model (IndexedDB)

```
Item {
  id: string (uuid)
  photoBlobId: string
  thumbnailBlobId: string
  category: string
  subcategory: string
  attributes: {
    color?: string
    material?: string
    size?: string
    brand?: string
  }
  description: string
  confidence: number
  status: "queued" | "analyzing" | "done" | "failed" | "needs_review"
  createdAt: timestamp
  updatedAt: timestamp
  syncedToNas: boolean
}
```

The status flag matters because clicking "Analyze" after a photo batch will queue many items at once — the UI needs to reflect which are still processing.

## 5. Workflow in Detail

### Step 1 – Take photos
Camera input via `<input type="file" accept="image/*" capture="environment">` or the MediaDevices API. Each photo is immediately stored as an `Item` with status `queued` in IndexedDB, along with an auto-generated thumbnail (canvas resize to ~300px, to keep the later browsing UI fast).

### Step 2 – Click "Analyze"
A button gathers all `queued` items and hands them to a job queue. Since your workflow is "shoot everything first, then click once," rate-limit the queue (e.g., 3 parallel requests) so you don't hit OpenRouter/provider rate limits on a large batch.

### Step 3 – Background processing
Realistic approach instead of relying purely on the Background Sync API:

- **While the app/tab is open:** a Web Worker processes the queue in the background while you keep using the app or taking more photos.
- **If the app is closed before the queue finishes:** on next open, check for unfinished `queued`/`analyzing` items and resume processing automatically. This is more robust than depending on the Background Sync API, which effectively doesn't exist on iOS Safari [web:26][web:29].
- Each photo triggers an OpenRouter call with the fixed JSON schema above.

### Step 4 – Review
Items with low `confidence` scores automatically land in `needs_review` status, so you can quickly confirm or correct them instead of letting misclassifications slip in unnoticed.

## 6. Export and Delete

- **Export:** a button generates a ZIP export (`jszip`, runs entirely client-side) containing an `items.json` (all metadata) plus a `photos/` folder with the original images. Fully portable, independent of NAS sync.
- **Delete:** per-item deletion plus a "delete entire category" action. Since everything lives locally in IndexedDB, deletion is immediate and permanent — add a confirmation dialog to avoid accidents.

## 7. NAS Sync (Phase 2, Later)

WebDAV is the most pragmatic route since Nextcloud, Synology (DSM), and QNAP all support it natively [web:18][web:19]:

1. In app settings, store the NAS URL, username, and an app-specific password (not your main account password).
2. A sync job uploads photos plus a metadata JSON via WebDAV `PUT` requests whenever you're on the same network or the NAS is reachable externally.
3. The `syncedToNas` flag prevents duplicate uploads.

Simpler alternative if custom WebDAV code feels like overkill: install Syncthing on both the NAS and your phone, and let it sync the app's export folder — less code, slightly less "in-app" integrated.

## 8. UI: Category Browser

- Home screen: grid of category tiles (clothing, stuffed animals, electronics, ...) showing item count and a representative thumbnail.
- Tap a category → grid of all thumbnails in that category, filterable by subcategory/color/status.
- Tap a photo → detail view with full image, editable attributes, delete button.
- Search bar filtering across `description` and `attributes` (IndexedDB index on those fields, or client-side Fuse.js search at modest item counts).

## 9. Rough Roadmap

| Phase | Scope |
|---|---|
| 1 | PWA skeleton, photo capture, local storage, category browser (manual categorization, no AI yet) |
| 2 | OpenRouter integration, batch analysis queue, review flow |
| 3 | Export/delete functionality |
| 4 | NAS sync via WebDAV or Syncthing |
