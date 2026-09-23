import { describe, expect, it } from 'vitest';
import { extensionForMime, photoRelativePath, slugifyCategory, thumbnailRelativePath } from './naming';
import { formatBytes, formatConfidence, formatRelativeTime, pluralize, truncate } from './format';
import { parseHash } from './routes';
import { makeItem } from './testing/fixtures';

describe('extensionForMime', () => {
  it('maps common image mime types', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/webp')).toBe('webp');
  });

  it('handles mime parameters and casing', () => {
    expect(extensionForMime('IMAGE/JPEG; charset=binary')).toBe('jpg');
  });

  it('falls back to the file name, then to bin', () => {
    expect(extensionForMime('application/octet-stream', 'IMG_0042.HEIC')).toBe('heic');
    expect(extensionForMime(undefined, undefined)).toBe('bin');
  });
});

describe('relative paths', () => {
  it('derives photo and thumbnail paths from the item', () => {
    const item = makeItem({ id: 'abc', mimeType: 'image/png', fileName: 'x.png' });
    expect(photoRelativePath(item)).toBe('photos/abc.png');
    expect(thumbnailRelativePath(item)).toBe('thumbnails/abc.jpg');
  });
});

describe('slugifyCategory', () => {
  it('creates filesystem safe folder names', () => {
    expect(slugifyCategory('Stuffed animals')).toBe('stuffed-animals');
    expect(slugifyCategory('  Toys & Games! ')).toBe('toys-games');
    expect(slugifyCategory('')).toBe('uncategorized');
  });
});

describe('format helpers', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats confidence as a percentage', () => {
    expect(formatConfidence(0.873)).toBe('87%');
    expect(formatConfidence(0)).toBe('—');
  });

  it('pluralises counts', () => {
    expect(pluralize(1, 'item')).toBe('1 item');
    expect(pluralize(2, 'item')).toBe('2 items');
    expect(pluralize(3, 'analysis', 'analyses')).toBe('3 analyses');
  });

  it('truncates long text with an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('abcdefghijklmnop', 10)).toHaveLength(10);
  });

  it('describes relative timestamps', () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(now - 5_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
  });
});

describe('parseHash', () => {
  it('parses the home route', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/nonsense')).toEqual({ name: 'home' });
  });

  it('parses category and item routes with encoded values', () => {
    expect(parseHash('#/category/Stuffed%20animals')).toEqual({
      name: 'category',
      category: 'Stuffed animals',
    });
    expect(parseHash('#/item/abc-123')).toEqual({ name: 'item', id: 'abc-123' });
  });

  it('parses the static routes', () => {
    expect(parseHash('#/review')).toEqual({ name: 'review' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
  });
});
