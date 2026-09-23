import { describe, expect, it } from 'vitest';
import { buildCategoryTiles, categoryOptions, colorOptions, countByStatus, reviewQueue, subcategoryOptions } from './categories';
import { makeItem } from './testing/fixtures';

describe('buildCategoryTiles', () => {
  const items = [
    makeItem({ id: 'a', category: 'Clothing', createdAt: 100 }),
    makeItem({ id: 'b', category: 'Clothing', createdAt: 200, status: 'needs_review' }),
    makeItem({ id: 'c', category: 'Toys', createdAt: 150 }),
    makeItem({ id: 'd', category: '', createdAt: 50 }),
  ];

  it('counts items per category, newest category first', () => {
    const tiles = buildCategoryTiles(items);
    expect(tiles.map((tile) => tile.category)).toEqual(['Clothing', 'Toys', 'Uncategorized']);
    expect(tiles[0].count).toBe(2);
  });

  it('counts items that need review', () => {
    const tiles = buildCategoryTiles(items);
    expect(tiles[0].needsReview).toBe(1);
    expect(tiles[1].needsReview).toBe(0);
  });

  it('uses the newest thumbnail as the tile image', () => {
    const tiles = buildCategoryTiles(items);
    expect(tiles[0].thumbnailBlobId).toBe('b:thumb');
  });

  it('groups failed items under the review counter too', () => {
    const tiles = buildCategoryTiles([makeItem({ category: 'Tools', status: 'failed' })]);
    expect(tiles[0].needsReview).toBe(1);
  });
});

describe('option helpers', () => {
  const items = [
    makeItem({ id: 'a', subcategory: 'Shirts', attributes: { color: 'Blue' } }),
    makeItem({ id: 'b', subcategory: 'Shoes', attributes: { color: 'Blue' } }),
    makeItem({ id: 'c', subcategory: '', attributes: {} }),
    makeItem({ id: 'd', category: 'Toys', subcategory: 'Cars' }),
  ];

  it('returns sorted unique subcategories', () => {
    expect(subcategoryOptions(items)).toEqual(['Cars', 'Shirts', 'Shoes']);
  });

  it('returns sorted unique colours and skips blanks', () => {
    expect(colorOptions(items)).toEqual(['Blue']);
  });

  it('falls back to Uncategorized for empty categories', () => {
    expect(categoryOptions(items)).toEqual(['Clothing', 'Toys']);
  });
});

describe('reviewQueue', () => {
  it('orders needs_review first, then failed, then in-flight items', () => {
    const items = [
      makeItem({ id: 'done', status: 'done' }),
      makeItem({ id: 'queued', status: 'queued', createdAt: 3 }),
      makeItem({ id: 'failed', status: 'failed' }),
      makeItem({ id: 'review', status: 'needs_review' }),
      makeItem({ id: 'analyzing', status: 'analyzing' }),
    ];
    expect(reviewQueue(items).map((item) => item.id)).toEqual([
      'review',
      'failed',
      'queued',
      'analyzing',
    ]);
  });

  it('ignores finished items', () => {
    expect(reviewQueue([makeItem({ status: 'done' })])).toHaveLength(0);
  });
});

describe('countByStatus', () => {
  it('counts matching statuses', () => {
    const items = [makeItem({ status: 'queued' }), makeItem({ status: 'done' }), makeItem({ status: 'queued' })];
    expect(countByStatus(items, 'queued')).toBe(2);
    expect(countByStatus(items, 'failed')).toBe(0);
  });
});
