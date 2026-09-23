import { describe, expect, it } from 'vitest';
import { filterItems, matchesQuery, searchItems } from './search';
import { makeItem } from './testing/fixtures';

describe('matchesQuery', () => {
  const item = makeItem({
    description: 'Grey wool scarf',
    category: 'Clothing',
    subcategory: 'Accessories',
    attributes: { color: 'Grey', material: 'Wool', brand: 'Café Crème' },
  });

  it('matches every token anywhere in the searchable text', () => {
    expect(matchesQuery(item, 'wool')).toBe(true);
    expect(matchesQuery(item, 'wool scarf')).toBe(true);
    expect(matchesQuery(item, 'clothing grey')).toBe(true);
    expect(matchesQuery(item, 'wool leather')).toBe(false);
  });

  it('is case and diacritic insensitive', () => {
    expect(matchesQuery(item, 'CAFE')).toBe(true);
    expect(matchesQuery(item, 'café')).toBe(true);
  });

  it('treats an empty query as a match', () => {
    expect(matchesQuery(item, '   ')).toBe(true);
  });

  it('searches the original file name too', () => {
    expect(matchesQuery(makeItem({ fileName: 'IMG_2024_kids.jpg' }), 'kids')).toBe(true);
  });
});

describe('searchItems', () => {
  const items = [
    makeItem({ id: 'a', description: 'Blue cotton shirt' }),
    makeItem({ id: 'b', description: 'Red leather boot' }),
    makeItem({ id: 'c', description: 'Plastic toy car' }),
  ];

  it('returns everything for an empty query', () => {
    expect(searchItems(items, '')).toHaveLength(3);
  });

  it('narrows the list by description', () => {
    expect(searchItems(items, 'boot').map((item) => item.id)).toEqual(['b']);
  });
});

describe('filterItems', () => {
  const items = [
    makeItem({ id: 'a', category: 'Clothing', subcategory: 'Shirts', status: 'done' }),
    makeItem({
      id: 'b',
      category: 'Clothing',
      subcategory: 'Shoes',
      status: 'needs_review',
      attributes: { color: 'Red' },
    }),
    makeItem({ id: 'c', category: 'Toys', subcategory: 'Cars', status: 'done' }),
  ];

  it('filters by category', () => {
    expect(filterItems(items, { category: 'Clothing' }).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('combines filters with AND semantics', () => {
    expect(
      filterItems(items, { category: 'Clothing', status: 'needs_review' }).map((item) => item.id),
    ).toEqual(['b']);
  });

  it('ignores empty filters', () => {
    expect(filterItems(items, {})).toHaveLength(3);
  });

  it('filters by colour attribute', () => {
    expect(filterItems(items, { color: 'Red' }).map((item) => item.id)).toEqual(['b']);
  });
});
