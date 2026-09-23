import type { Item } from '../types';

/**
 * Client-side search across `description` and `attributes` (plan section 8).
 *
 * At the item counts this app targets, a tokenised in-memory search is faster
 * and simpler than a full text index in IndexedDB, and it needs no extra
 * dependency.
 */

/** Lower-cases and strips diacritics so "café" matches "cafe". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Everything about an item that should be searchable. */
export function itemSearchText(item: Item): string {
  return [
    item.description,
    item.category,
    item.subcategory,
    item.attributes.color,
    item.attributes.material,
    item.attributes.size,
    item.attributes.brand,
    item.fileName,
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}

/** True when every whitespace separated token of the query appears in the item. */
export function matchesQuery(item: Item, query: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeText(itemSearchText(item));
  return normalizedQuery.split(/\s+/).every((token) => haystack.includes(token));
}

export function searchItems(items: Item[], query: string): Item[] {
  if (!normalizeText(query)) return items;
  return items.filter((item) => matchesQuery(item, query));
}

export interface ItemFilters {
  category?: string;
  subcategory?: string;
  color?: string;
  status?: string;
}

/** Applies the category-page filter chips (plan section 8). */
export function filterItems(items: Item[], filters: ItemFilters): Item[] {
  return items.filter((item) => {
    if (filters.category && item.category !== filters.category) return false;
    if (filters.subcategory && item.subcategory !== filters.subcategory) return false;
    if (filters.color && item.attributes.color !== filters.color) return false;
    if (filters.status && item.status !== filters.status) return false;
    return true;
  });
}
