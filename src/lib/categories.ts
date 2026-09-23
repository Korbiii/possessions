import type { Item } from '../types';
import { FALLBACK_CATEGORY } from './constants';

/**
 * Helpers that turn the flat item list into the category browser's tiles and
 * filter options (plan section 8).
 */

export interface CategoryTile {
  category: string;
  count: number;
  needsReview: number;
  /** Thumbnail of the most recent item, used as the tile image. */
  thumbnailBlobId: string | undefined;
  latestAt: number;
}

function isReviewWorthy(item: Item): boolean {
  return item.status === 'needs_review' || item.status === 'failed';
}

/** Groups items by category, newest category first. */
export function buildCategoryTiles(items: Item[]): CategoryTile[] {
  const tiles = new Map<string, CategoryTile>();
  for (const item of items) {
    const category = item.category || FALLBACK_CATEGORY;
    const existing = tiles.get(category);
    if (!existing) {
      tiles.set(category, {
        category,
        count: 1,
        needsReview: isReviewWorthy(item) ? 1 : 0,
        thumbnailBlobId: item.thumbnailBlobId,
        latestAt: item.createdAt,
      });
      continue;
    }
    existing.count += 1;
    if (isReviewWorthy(item)) existing.needsReview += 1;
    if (item.createdAt > existing.latestAt) {
      existing.latestAt = item.createdAt;
      existing.thumbnailBlobId = item.thumbnailBlobId;
    }
  }
  return [...tiles.values()].sort((a, b) => b.latestAt - a.latestAt);
}

function uniqueValues(items: Item[], pick: (item: Item) => string | undefined): string[] {
  const values = new Set<string>();
  for (const item of items) {
    const value = pick(item)?.trim();
    if (value) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function subcategoryOptions(items: Item[]): string[] {
  return uniqueValues(items, (item) => item.subcategory);
}

export function colorOptions(items: Item[]): string[] {
  return uniqueValues(items, (item) => item.attributes.color);
}

export function categoryOptions(items: Item[]): string[] {
  return uniqueValues(items, (item) => item.category || FALLBACK_CATEGORY);
}

/** Items that still need a human look: needs_review, failed or in-flight. */
export function reviewQueue(items: Item[]): Item[] {
  return items
    .filter(
      (item) =>
        item.status === 'needs_review' ||
        item.status === 'failed' ||
        item.status === 'queued' ||
        item.status === 'analyzing',
    )
    .sort((a, b) => {
      const rank = (item: Item) => (item.status === 'needs_review' ? 0 : item.status === 'failed' ? 1 : 2);
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return a.createdAt - b.createdAt;
    });
}

export function countByStatus(items: Item[], status: Item['status']): number {
  return items.reduce((total, item) => (item.status === status ? total + 1 : total), 0);
}
