import type { DetectedItem } from '../types';
import { FALLBACK_CATEGORY, OPENROUTER_CHAT_URL, OPENROUTER_KEY_URL } from './constants';

/**
 * OpenRouter integration (plan section 3).
 *
 * One API key, one endpoint, a strict JSON schema — so the model can be
 * swapped in the settings UI without touching any app logic.
 */

/** Strict JSON schema for the structured output. */
export const ITEM_CLASSIFICATION_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'item_classification',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        items_detected: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              subcategory: { type: 'string' },
              color: { type: 'string' },
              material: { type: 'string' },
              description: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['category', 'subcategory', 'description', 'confidence'],
            additionalProperties: false,
          },
        },
      },
      required: ['items_detected'],
      additionalProperties: false,
    },
  },
} as const;

/** Prompt tuned per the practical tips in plan section 3. */
export const ANALYSIS_PROMPT = [
  'You are cataloguing household possessions from a single photo.',
  'Identify every distinct household item in this photo.',
  'Return one entry per item, even if multiple items are visible: never summarise the scene and never merge two objects into one entry.',
  'Describe each object concretely (what it is, its colour and material) in a short English sentence.',
  `If you are unsure what an object is, still return an entry and use the category "${FALLBACK_CATEGORY}" rather than dropping it.`,
  'confidence is a number between 0 and 1 describing how certain you are about the category.',
].join(' ');

export interface AnalyzePhotoOptions {
  apiKey: string;
  model: string;
  /** `data:image/jpeg;base64,...` */
  dataUrl: string;
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export class OpenRouterError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
  }
}

/* ------------------------------------------------------------ pure parsing */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((part) => asText(asRecord(part)?.text))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return '';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Normalises one raw detection coming from the model. */
export function normalizeDetectedItem(raw: unknown): DetectedItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const description = asText(record.description);
  const category = asText(record.category) || FALLBACK_CATEGORY;
  const subcategory = asText(record.subcategory);
  if (!description && category === FALLBACK_CATEGORY) return null;
  const confidenceRaw =
    typeof record.confidence === 'number' ? record.confidence : Number(record.confidence);
  const color = asText(record.color);
  const material = asText(record.material);
  return {
    category,
    subcategory,
    description: description || category,
    confidence: clamp01(confidenceRaw),
    ...(color ? { color } : {}),
    ...(material ? { material } : {}),
  };
}

/** Pulls the JSON object out of a chat-completion response body. */
function extractJsonPayload(payload: Record<string, unknown>): unknown {
  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = asRecord(asRecord(choices[0])?.message);
    // OpenRouter returns `parsed` when the provider supports structured outputs.
    if (message && message.parsed !== undefined && message.parsed !== null) {
      return message.parsed;
    }
    const content = asText(message?.content);
    if (content) return parseJsonLoosely(content);
  }
  if (payload.items_detected !== undefined) return payload;
  return null;
}

/** Parses JSON that may be wrapped in markdown code fences. */
export function parseJsonLoosely(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('The model did not return valid JSON');
  }
}

/** Turns a raw OpenRouter response body into a list of detections. */
export function parseClassificationResponse(payload: unknown): DetectedItem[] {
  const body = asRecord(payload);
  if (!body) throw new Error('Empty response from OpenRouter');
  const json = extractJsonPayload(body);
  if (json === null) throw new Error('The model response contained no item data');
  const record = asRecord(json);
  const list = record?.items_detected;
  if (!Array.isArray(list)) throw new Error('The model response was missing "items_detected"');
  return list.map(normalizeDetectedItem).filter((item): item is DetectedItem => item !== null);
}

/** Human readable message for a failed OpenRouter call. */
export function describeOpenRouterError(status: number, body: unknown): string {
  const record = asRecord(body);
  const detail = asText(asRecord(record?.error)?.message) || asText(record?.message);
  switch (status) {
    case 401:
      return 'OpenRouter rejected the API key (401). Check the key in Settings.';
    case 402:
      return 'OpenRouter reports insufficient credits (402). Top up or pick a cheaper model.';
    case 403:
      return 'OpenRouter denied the request (403). The key may be restricted to other models.';
    case 404:
      return `OpenRouter does not know that model (404).${detail ? ` ${detail}` : ''}`;
    case 429:
      return 'OpenRouter rate limit hit (429). Lower "parallel requests" and try again.';
    default:
      return detail || `OpenRouter request failed with status ${status}`;
  }
}

/* ------------------------------------------------------------- API clients */

/** Sends one photo to OpenRouter and returns the structured detections. */
export async function analyzePhoto(options: AnalyzePhotoOptions): Promise<DetectedItem[]> {
  const { apiKey, model, dataUrl, signal, fetchImpl } = options;
  const doFetch = fetchImpl ?? fetch;
  const response = await doFetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Possessions Tracker',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: ANALYSIS_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: ITEM_CLASSIFICATION_SCHEMA,
      // Only route to endpoints that really support strict structured outputs
      // (plan section 3, "Important detail").
      provider: { require_parameters: true },
      temperature: 0,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw new OpenRouterError(describeOpenRouterError(response.status, body), response.status);
  }

  return parseClassificationResponse(await response.json());
}

export interface ApiKeyCheck {
  valid: boolean;
  message: string;
}

/** Verifies an API key against OpenRouter's `/key` endpoint. */
export async function checkApiKey(apiKey: string, fetchImpl?: typeof fetch): Promise<ApiKeyCheck> {
  if (!apiKey.trim()) return { valid: false, message: 'No API key stored yet.' };
  const doFetch = fetchImpl ?? fetch;
  try {
    const response = await doFetch(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      return { valid: false, message: describeOpenRouterError(response.status, null) };
    }
    const body = asRecord(await response.json());
    const data = asRecord(body?.data);
    const label = asText(data?.label) || 'key';
    const usage = typeof data?.usage === 'number' ? data.usage : null;
    const limit = typeof data?.limit === 'number' ? data.limit : null;
    const usageText =
      usage === null
        ? ''
        : ` Used $${usage.toFixed(4)}${limit === null ? '' : ` of $${limit.toFixed(2)}`}.`;
    return { valid: true, message: `OpenRouter accepted the key (${label}).${usageText}` };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : 'Could not reach OpenRouter',
    };
  }
}
