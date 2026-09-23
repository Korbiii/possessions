# Possessions Tracker

An **offline-first, local-first PWA** for cataloguing household possessions from photos, with
optional AI classification through OpenRouter and optional WebDAV sync to a NAS.

This is the implementation of `possessions-tracker-pwa-implementation-plan.md`.

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
                                    [Optional: WebDAV sync to NAS]
```

## Quick start

Requires **Node.js ≥ 22.12** (the pinned version lives in `.nvmrc`).

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type check (`tsc --noEmit`) + production build into `dist/` |
| `npm run preview` | Serve the production build (the service worker only runs here, not in dev) |
| `npm test` | Vitest unit tests for all pure logic |
| `npm run typecheck` | Type check only |

The generated `dist/` folder is a static site — host it anywhere (or on the NAS itself).

## Features by phase

### Phase 1 — PWA skeleton, capture, local storage, category browser
- Installable PWA (`vite-plugin-pwa`, auto-updating service worker, offline app shell).
- Photos are taken via `<input type="file" accept="image/*" capture="environment">` or picked from
  the gallery, then stored straight into IndexedDB together with a ~320 px JPEG thumbnail.
- Home screen: category tiles with item count, a representative thumbnail and a "needs review"
  counter. Search filters across description, category, subcategory, colour, material, size, brand
  and file name.
- Category screen: thumbnail grid with subcategory / colour / status filter chips.
- Item detail: full photo, editable category, subcategory, colour, material, size, brand,
  description and status.
- Everything works offline; an online/offline dot in the header shows the current state.

### Phase 2 — OpenRouter analysis, batch queue, review flow
- One "Analyze" button hands every `queued` photo to a **Web Worker** which processes the batch with
  1–6 parallel requests (default 3) so provider rate limits are respected.
- Requests use OpenRouter's `response_format: json_schema` (strict) plus
  `provider.require_parameters: true`, so only endpoints that truly support structured outputs are
  used. The default model is `google/gemini-2.5-flash-lite`; the model slug is editable in Settings.
- The model is instructed to enumerate every distinct object separately and to use the
  `Uncategorized` fallback instead of silently dropping things. Several objects in one photo become
  sibling items that share the same photo and thumbnail blobs.
- Results below the confidence threshold (default 70 %) automatically land in **needs review**
  instead of being accepted silently; failed photos keep their error message and can be retried.
- Resume-on-open: items left in `analyzing` when the app closed are reset to `queued`, and pending
  work restarts automatically when the app is opened (or brought back to the foreground). This is
  the iOS-Safari-friendly alternative to the Background Sync API.

### Phase 3 — Export and delete
- **Export ZIP** (`jszip`, 100 % client-side): `items.json` with all metadata plus a `photos/`
  folder with the originals.
- **Restore from ZIP**: reads an export back in (originals + regenerated thumbnails). Additive —
  existing items are never overwritten and entries already present are skipped, so it is safe to
  re-run. This is how a library moves to another device or origin.
- **Delete** per item or per whole category, both behind a confirmation dialog. Blobs are
  reference-counted, so deleting one of several items that share a photo keeps the photo alive.
- Storage panel shows usage/quota and can request persistent storage from the browser.

### Phase 4 — NAS sync (WebDAV)
- Settings stores NAS URL, username and an app-specific password (kept locally in IndexedDB).
- Sync creates the remote folder tree (`MKCOL`), uploads every photo that is not yet on the NAS
  (`PUT photos/<id>.<ext>`) and finally writes `items.json`. The `syncedToNas` flag prevents
  duplicate uploads; a "Test connection" button verifies reachability and write access.
- Works with Nextcloud, Synology DSM and QNAP. The NAS must send CORS headers for browser requests;
  alternatively serve the app from the NAS itself. Syncthing on the exported folder is the
  no-code fallback described in the plan.

## Configuration

Everything is configured in the app's **Settings** screen:

| Setting | Default | Notes |
|---|---|---|
| OpenRouter API key | empty | Stored only in this browser, sent only to `openrouter.ai`. |
| Model | `google/gemini-2.5-flash-lite` | Any OpenRouter vision model slug. |
| Confidence threshold | 70 % | Below this, items go to `needs review`. |
| Parallel requests | 3 | Lower it if you see HTTP 429s. |
| Auto-resume analysis | on | Resumes unfinished batches on open. |
| NAS URL / folder / user / app password | empty / `/inventory` | Used for WebDAV sync. |

## Deploying to GitHub Pages (installable PWA on your phone)

The app is a static site with **hash-based routing**, so GitHub Pages needs no rewrite rules, no
`.htaccess` and no 404 fallback.

### 1. Push the project to a repository

```bash
cd ~/Desktop/Inventory
git init -b main
git add -A
git commit -m "Possessions Tracker PWA"
git remote add origin https://github.com/<you>/possessions.git
git push -u origin main
```

### 2. Let GitHub Pages deploy it

The workflow at `.github/workflows/deploy.yml` builds, type-checks, tests and publishes on every
push to `main`. Enable it once under **Settings → Pages → Build and deployment → Source: GitHub
Actions**.

The base path is derived from the repository name automatically:

| Repository | Published at | Base path |
|---|---|---|
| `possessions` (project site) | `https://<you>.github.io/possessions/` | `/possessions/` |
| `<you>.github.io` (user site) | `https://<you>.github.io/` | `/` |

`.nojekyll` is created during the build, so Jekyll never touches the artifact.

### 3. Install it on Android

Open the published URL in Chrome → **⋮ → Add to Home screen / Install app**. It launches standalone,
works offline, and the camera button opens the camera directly. Do the same on any desktop browser
with the install icon in the address bar.

> GitHub Pages serves HTML with `Cache-Control: max-age=600`, so a fresh deploy can take up to
> ~10 minutes to appear. The auto-updating service worker then picks up new versions on its own.

### 4. Rehearse a sub-path build locally

`BASE_PATH` drives the asset URLs, the service-worker scope and the PWA `start_url`/`scope`:

```bash
BASE_PATH=/possessions/ npm run build
npm run preview     # → http://localhost:4173/possessions/
```

Unset, `BASE_PATH` defaults to `/`, so `npm run dev` and `npm run preview` behave exactly as before.
The same mechanism works for a NAS sub-folder (e.g. Nextcloud Web Station at `/possessions/`).

### Notes on data when you switch origins

`localhost` and the GitHub Pages URL are different origins, so each keeps its own IndexedDB library.
To move a library across (or to restore a backup after clearing browser data), use
**Settings → Local storage → ⬇️ Export ZIP / ⬆️ Restore from ZIP**. A restore adds the archive's
items (originals plus freshly generated thumbnails) and skips anything already present, so it is
safe to run repeatedly. The API key and NAS credentials are stored per origin too, so enter them
once on the new device.

A note on repo visibility: GitHub Pages for *private* repositories requires GitHub Pro/Team/
Enterprise; on a Free account the repository has to be public. Nothing secret lives in the repo
(the API key is entered in the browser and stored in IndexedDB), but the *app* itself would be
publicly reachable — your *data* never leaves your devices.

## Data model (IndexedDB `possessions-tracker`)

```
Item {
  id, photoBlobId, thumbnailBlobId,
  category, subcategory,
  attributes: { color?, material?, size?, brand? },
  description, confidence,
  status: "queued" | "analyzing" | "done" | "failed" | "needs_review",
  createdAt, updatedAt, syncedToNas,
  fileName?, mimeType?, error?
}
```

Object stores: `items` (indexes on category, status, createdAt, updatedAt), `blobs`
(photo + thumbnail payloads) and `settings`.

## Project layout

```
src/
  App.tsx                  app shell, tab bar, hash routing, PWA update prompt
  state/AppState.tsx       single app store: library CRUD, analysis, export, NAS sync
  pages/                   HomePage, CategoryPage, ItemPage, ReviewPage, SettingsPage
  components/              ItemGrid, Thumbnail, AnalysisBar, PhotoCapture, FilterBar, dialogs…
  hooks/                   useHashRoute, useBlobUrl
  lib/
    db.ts                  IndexedDB (idb) — worker-safe, no DOM usage
    analysis.worker.ts     background batch queue (Web Worker)
    analysisClient.ts      main-thread handle for the worker
    analysis.ts            pure detection → item mapping
    openrouter.ts          strict-JSON vision client + response parsing
    search.ts              client-side search and filters
    categories.ts          category tiles, filter options, review queue
    exportZip.ts           JSZip export
    importZip.ts           ZIP restore (manifest parsing + blob/thumbnail rebuild)
    manifest.ts            shared items.json manifest
    webdav.ts              WebDAV MKCOL/PUT client and NAS sync
    image.ts, naming.ts, format.ts, ids.ts, routes.ts, browser.ts
scripts/generate-icons.py  regenerates public/icons/*.png (needs Pillow)
.nvmrc                     pinned Node version (also used by CI)
.github/workflows/deploy.yml  GitHub Pages build + deploy
```

## Tests

`npm test` runs Vitest over the pure logic: detection mapping and confidence thresholds, OpenRouter
response parsing/error mapping, search and filters, category tiles and review queue, ZIP manifest
and **ZIP restore**, naming/formatting helpers and hash routing, plus the WebDAV URL builders and
sync bookkeeping (with a stubbed `fetch` and a mocked blob store) and an IndexedDB/React-store
integration suite backed by `fake-indexeddb`.

## Known limitations

- **HEIC/HEIF** photos (default iPhone format) cannot always be decoded by browsers, so their
  thumbnails fall back to the original file. Convert to JPEG, or enable "Most Compatible" on iOS.
- The OpenRouter API key lives in IndexedDB in plain text — anyone with access to the device
  profile can read it. Use a dedicated, spending-limited key.
- WebDAV from a browser is subject to CORS; some NAS setups require a reverse proxy that adds the
  headers.
- Clearing browser data deletes the library. Export a ZIP regularly, or grant persistent storage.
- No merge/conflict resolution on NAS sync: the local library is the source of truth and only files
  that are not flagged as synced yet are uploaded.
