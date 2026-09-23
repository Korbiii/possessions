import JSZip from 'jszip';
import type { Item } from '../types';
import { getBlob, listItems } from './db';
import { exportFileName, manifestJson } from './manifest';
import { photoRelativePath } from './naming';

/**
 * Client-side ZIP export (plan section 6): `items.json` with all metadata plus
 * a `photos/` folder containing the originals. Runs entirely in the browser,
 * so the export is portable and independent of any NAS sync.
 */

export interface ExportResult {
  blob: Blob;
  itemCount: number;
  photoCount: number;
  missingPhotos: number;
  fileName: string;
}

/** Builds the export archive. Photos are read straight out of IndexedDB. */
export async function buildExportZip(items?: Item[]): Promise<ExportResult> {
  const source = items ?? (await listItems());
  const zip = new JSZip();
  zip.file('items.json', manifestJson(source));

  let photoCount = 0;
  let missingPhotos = 0;
  for (const item of source) {
    const record = await getBlob(item.photoBlobId);
    if (!record) {
      missingPhotos += 1;
      continue;
    }
    zip.file(photoRelativePath(item), record.blob);
    photoCount += 1;
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    blob,
    itemCount: source.length,
    photoCount,
    missingPhotos,
    fileName: exportFileName(),
  };
}
