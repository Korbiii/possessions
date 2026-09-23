import { useEffect, useState } from 'react';
import { getBlob } from '../lib/db';

/**
 * Resolves an IndexedDB blob to an object URL.
 *
 * URLs are cached per blob id (and trimmed) so scrolling a large grid does not
 * re-create object URLs for every render.
 */

const MAX_CACHED_URLS = 400;
const cache = new Map<string, string>();

function remember(blobId: string, url: string): void {
  cache.set(blobId, url);
  while (cache.size > MAX_CACHED_URLS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const value = cache.get(oldest.value);
    cache.delete(oldest.value);
    if (value) URL.revokeObjectURL(value);
  }
}

/** Drops cached URLs, e.g. after the library was cleared. */
export function clearBlobUrlCache(): void {
  cache.forEach((url) => URL.revokeObjectURL(url));
  cache.clear();
}

export function useBlobUrl(blobId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (blobId ? cache.get(blobId) ?? null : null));

  useEffect(() => {
    if (!blobId) {
      setUrl(null);
      return;
    }
    const cached = cache.get(blobId);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      const record = await getBlob(blobId);
      if (!record || cancelled) return;
      const objectUrl = URL.createObjectURL(record.blob);
      remember(blobId, objectUrl);
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [blobId]);

  return url;
}
