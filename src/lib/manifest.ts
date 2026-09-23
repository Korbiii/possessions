import type { Item } from '../types';
import { photoRelativePath } from './naming';

/**
 * The portable metadata document shared by the ZIP export (plan section 6) and
 * the WebDAV/NAS sync (plan section 7). Kept free of I/O so both can reuse it.
 */

export interface ExportManifestItem extends Omit<Item, 'photoBlobId' | 'thumbnailBlobId'> {
  /** Path of the original photo inside the archive / on the NAS. */
  photoFile: string;
}

export interface ExportManifest {
  app: 'possessions-tracker';
  version: 1;
  exportedAt: string;
  itemCount: number;
  items: ExportManifestItem[];
}

/** Pure manifest builder (unit-tested). */
export function buildExportManifest(
  items: Item[],
  exportedAt: number = Date.now(),
): ExportManifest {
  return {
    app: 'possessions-tracker',
    version: 1,
    exportedAt: new Date(exportedAt).toISOString(),
    itemCount: items.length,
    items: items.map((item) => {
      const { photoBlobId: _photoBlobId, thumbnailBlobId: _thumbnailBlobId, ...rest } = item;
      return { ...rest, photoFile: photoRelativePath(item) };
    }),
  };
}

export function manifestJson(items: Item[], exportedAt?: number): string {
  return `${JSON.stringify(buildExportManifest(items, exportedAt), null, 2)}\n`;
}

export function exportFileName(now: number = Date.now()): string {
  const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `possessions-export-${stamp}.zip`;
}
