import type { AppSettings } from '../types';

/** Model used when the user has not picked anything else (plan section 3). */
export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

/** Cheaper/newer vision models that are worth offering in the settings UI. */
export const SUGGESTED_MODELS = [
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'google/gemini-3.1-flash-lite',
  'openai/gpt-4o-mini',
  'anthropic/claude-haiku-4.5',
] as const;

/** Items below this confidence are flagged for manual review. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** Rate limit for the batch queue: 3 parallel OpenRouter calls (plan section 5). */
export const DEFAULT_PARALLEL_REQUESTS = 3;

/** Fallback bucket used when the model cannot classify something. */
export const FALLBACK_CATEGORY = 'Uncategorized';

export const CATEGORY_SUGGESTIONS = [
  'Clothing',
  'Stuffed animals',
  'Electronics',
  'Books',
  'Kitchen',
  'Furniture',
  'Tools',
  'Toys',
  'Sports',
  'Decor',
  'Documents',
  'Other',
] as const;

/** Longest edge of generated thumbnails, in pixels (plan section 5, step 1). */
export const THUMBNAIL_MAX_EDGE = 320;

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
  parallelRequests: DEFAULT_PARALLEL_REQUESTS,
  autoResumeAnalysis: true,
  nas: {
    url: '',
    username: '',
    password: '',
    remotePath: '/inventory',
  },
};

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
