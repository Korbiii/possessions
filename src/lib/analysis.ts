import type { DetectedItem, Item, ItemAttributes, ItemStatus } from '../types';

/**
 * Pure logic that turns raw model detections into item records.
 *
 * Kept free of I/O so the behaviour is unit-testable (see analysis.test.ts) and
 * reusable from the worker.
 */

/** Guard against a runaway model returning hundreds of "items". */
export const MAX_ITEMS_PER_PHOTO = 12;

export interface PlannedItem {
  category: string;
  subcategory: string;
  attributes: ItemAttributes;
  description: string;
  confidence: number;
  status: ItemStatus;
}

/**
 * Low-confidence results automatically land in `needs_review` so misclassified
 * items do not slip in unnoticed (plan section 5, step 4).
 */
export function statusForConfidence(confidence: number, threshold: number): ItemStatus {
  return confidence >= threshold ? 'done' : 'needs_review';
}

/** Builds the per-item plans for one photo, best detection first. */
export function planFromDetections(
  detections: DetectedItem[],
  threshold: number,
): PlannedItem[] {
  return detections
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_ITEMS_PER_PHOTO)
    .map((detection) => {
      const attributes: ItemAttributes = {};
      if (detection.color) attributes.color = detection.color;
      if (detection.material) attributes.material = detection.material;
      return {
        category: detection.category,
        subcategory: detection.subcategory ?? '',
        attributes,
        description: detection.description,
        confidence: detection.confidence,
        status: statusForConfidence(detection.confidence, threshold),
      };
    });
}

/** Applies the best detection to the item that owns the photo. */
export function applyPlan(item: Item, plan: PlannedItem): Item {
  const next: Item = {
    ...item,
    category: plan.category,
    subcategory: plan.subcategory,
    attributes: { ...item.attributes, ...plan.attributes },
    description: plan.description,
    confidence: plan.confidence,
    status: plan.status,
    updatedAt: Date.now(),
  };
  delete next.error;
  return next;
}

/**
 * A single photo can contain several distinct items. The first detection stays
 * on the original record, the remaining ones become sibling items that share
 * the same photo and thumbnail blobs.
 */
export function buildExtraItems(
  source: Item,
  plans: PlannedItem[],
  createId: () => string,
  now: number = Date.now(),
): Item[] {
  return plans.map((plan) => {
    const item: Item = {
      id: createId(),
      photoBlobId: source.photoBlobId,
      thumbnailBlobId: source.thumbnailBlobId,
      category: plan.category,
      subcategory: plan.subcategory,
      attributes: { ...plan.attributes },
      description: plan.description,
      confidence: plan.confidence,
      status: plan.status,
      createdAt: now,
      updatedAt: now,
      syncedToNas: false,
    };
    if (source.fileName) item.fileName = source.fileName;
    if (source.mimeType) item.mimeType = source.mimeType;
    return item;
  });
}

/** Marks an item as failed with a readable message. */
export function markFailed(item: Item, message: string): Item {
  return { ...item, status: 'failed', error: message, updatedAt: Date.now() };
}
