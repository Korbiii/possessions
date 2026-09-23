import type { Item } from '../types';

/**
 * Pure naming helpers shared by the ZIP export (plan section 6) and the
 * WebDAV/NAS sync (plan section 7). Keeping them free of I/O makes them easy
 * to unit test.
 */

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

/** Maps a mime type to a file extension, falling back to the file name. */
export function extensionForMime(mime: string | undefined, fileName?: string): string {
  const normalized = (mime ?? '').toLowerCase().split(';')[0].trim();
  if (normalized && MIME_EXTENSIONS[normalized]) return MIME_EXTENSIONS[normalized];
  const fromName = fileName?.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  return 'bin';
}

/** Relative path of an item's original photo inside an export/sync payload. */
export function photoPathFor(id: string, mime: string | undefined, fileName?: string): string {
  return `photos/${id}.${extensionForMime(mime, fileName)}`;
}

/** Relative path of an item's original photo inside an export/sync payload. */
export function photoRelativePath(item: Item): string {
  return photoPathFor(item.id, item.mimeType, item.fileName);
}

/** Relative path of an item's thumbnail inside an export/sync payload. */
export function thumbnailRelativePath(item: Item): string {
  return `thumbnails/${item.id}.jpg`;
}

/** Turns a category name into a filesystem friendly folder name. */
export function slugifyCategory(category: string): string {
  const slug = category
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
  return slug || 'uncategorized';
}
