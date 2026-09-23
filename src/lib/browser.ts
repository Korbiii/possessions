/** Browser-only helpers for handing files to the user. */

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  persisted: boolean;
}

/** Reports how much space the originals/thumbnails take up. */
export async function estimateStorage(): Promise<StorageEstimate> {
  if (!navigator.storage?.estimate) {
    return { usage: 0, quota: 0, persisted: false };
  }
  const estimate = await navigator.storage.estimate();
  let persisted = false;
  if (navigator.storage.persisted) {
    try {
      persisted = await navigator.storage.persisted();
    } catch {
      persisted = false;
    }
  }
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted };
}

/** Asks the browser not to evict our IndexedDB data. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function isOnline(): boolean {
  return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
}
