/**
 * Core domain types.
 *
 * The data model mirrors section 4 of the implementation plan. Everything the
 * app knows about an item is stored locally in IndexedDB, so these types are
 * the single source of truth for both the UI and the analysis worker.
 */

/** Lifecycle of an item's AI analysis. */
export type ItemStatus = 'queued' | 'analyzing' | 'done' | 'failed' | 'needs_review';

export const ITEM_STATUSES: readonly ItemStatus[] = [
  'queued',
  'analyzing',
  'done',
  'failed',
  'needs_review',
] as const;

export const STATUS_LABELS: Record<ItemStatus, string> = {
  queued: 'Queued',
  analyzing: 'Analyzing',
  done: 'Done',
  failed: 'Failed',
  needs_review: 'Needs review',
};

/** Free-form attributes extracted from the photo (or edited by hand). */
export interface ItemAttributes {
  color?: string;
  material?: string;
  size?: string;
  brand?: string;
}

export interface Item {
  /** uuid */
  id: string;
  /** key of the original photo blob in the `blobs` store */
  photoBlobId: string;
  /** key of the ~300px thumbnail blob in the `blobs` store */
  thumbnailBlobId: string;
  category: string;
  subcategory: string;
  attributes: ItemAttributes;
  description: string;
  /** 0..1 confidence reported by the vision model */
  confidence: number;
  status: ItemStatus;
  createdAt: number;
  updatedAt: number;
  syncedToNas: boolean;
  /** Original file name, kept for export fidelity. */
  fileName?: string;
  /** Original mime type, kept for export fidelity. */
  mimeType?: string;
  /** Last analysis error, only set while status === 'failed'. */
  error?: string;
}

/** A binary payload (photo or thumbnail) stored in IndexedDB. */
export interface BlobRecord {
  id: string;
  blob: Blob;
  mime: string;
  size: number;
  name: string;
}

export interface NasSettings {
  url: string;
  username: string;
  password: string;
  /** Folder on the NAS, e.g. `/inventory`. */
  remotePath: string;
}

export interface AppSettings {
  /** OpenRouter API key. Never leaves the device except to openrouter.ai. */
  apiKey: string;
  /** OpenRouter model slug. */
  model: string;
  /** Items below this confidence land in `needs_review`. */
  confidenceThreshold: number;
  /** How many photos are analyzed in parallel. */
  parallelRequests: number;
  /** Resume unfinished analysis automatically when the app is opened. */
  autoResumeAnalysis: boolean;
  nas: NasSettings;
}

/** A single detected object as returned by the vision model. */
export interface DetectedItem {
  category: string;
  subcategory: string;
  color?: string;
  material?: string;
  description: string;
  confidence: number;
}
