// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteEverything, getBlob, listItems } from './db';
import { buildExportManifest } from './manifest';
import { photoRelativePath } from './naming';
import {
  buildItemFromEntry,
  normalizeAttributes,
  normalizeManifestEntry,
  normalizeStatus,
  parseManifest,
  restoreFromZip,
} from './importZip';
import { makeItem } from './testing/fixtures';

/**
 * Exercises the ZIP restore against a real (in-memory) IndexedDB. The archives
 * are produced with the very same manifest builder the exporter uses, so this
 * doubles as an export → import round-trip test.
 */

const NOW = Date.UTC(2024, 5, 1, 12, 0, 0);

/** Builds a ZIP the way `buildExportZip` does. */
async function makeArchive(
  options: { items?: ReturnType<typeof makeItem>[]; skipPhoto?: boolean } = {},
): Promise<Blob> {
  const items = options.items ?? [makeItem({ id: 'a', createdAt: NOW, updatedAt: NOW })];
  const zip = new JSZip();
  zip.file('items.json', `${JSON.stringify(buildExportManifest(items, NOW), null, 2)}\n`);
  if (!options.skipPhoto) {
    for (const item of items) zip.file(photoRelativePath(item), 'fake-jpeg-bytes');
  }
  return zip.generateAsync({ type: 'blob' });
}

const thumbnailer = async () => new Blob(['thumbnail'], { type: 'image/jpeg' });

beforeEach(async () => {
  await deleteEverything();
});

describe('parseManifest', () => {
  it('accepts an exported manifest and keeps the item metadata', () => {
    const [entry] = parseManifest(
      buildExportManifest(
        [
          makeItem({
            id: 'x',
            category: 'Toys',
            subcategory: 'Cars',
            description: 'Red toy car',
            confidence: 0.83,
            status: 'needs_review',
            createdAt: NOW,
            updatedAt: NOW,
            attributes: { color: 'Red', material: 'Plastic' },
          }),
        ],
        NOW,
      ),
      NOW,
    );

    expect(entry.sourceId).toBe('x');
    expect(entry.category).toBe('Toys');
    expect(entry.attributes).toEqual({ color: 'Red', material: 'Plastic' });
    expect(entry.confidence).toBeCloseTo(0.83);
    expect(entry.status).toBe('needs_review');
    expect(entry.createdAt).toBe(NOW);
    expect(entry.photoFile).toBe('photos/x.jpg');
  });

  it('rejects payloads that are not ours', () => {
    expect(() => parseManifest(null)).toThrow(/JSON object/);
    expect(() => parseManifest({ app: 'something-else', items: [] })).toThrow(/different app/);
    expect(() => parseManifest({ app: 'possessions-tracker' })).toThrow(/"items" array/);
    expect(() => parseManifest({ items: [1, 2, 3] })).toThrow(/no usable item records/);
  });

  it('tolerates an empty library export', () => {
    expect(parseManifest({ app: 'possessions-tracker', items: [] })).toEqual([]);
  });

  it('drops unusable entries but keeps the rest', () => {
    const entries = parseManifest({
      items: [null, { category: '', description: '' }, { description: 'Okay item' }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('Okay item');
  });
});

describe('normalisation helpers', () => {
  it('keeps only the four known attributes, trimmed', () => {
    expect(normalizeAttributes({ color: '  Blue ', weight: '2kg', size: '' })).toEqual({
      color: 'Blue',
    });
    expect(normalizeAttributes('nope')).toEqual({});
  });

  it('falls back to needs_review for unknown statuses', () => {
    expect(normalizeStatus('done')).toBe('done');
    expect(normalizeStatus('analyzing')).toBe('analyzing');
    expect(normalizeStatus('exploded')).toBe('needs_review');
    expect(normalizeStatus(undefined)).toBe('needs_review');
  });

  it('clamps confidence and back-fills timestamps', () => {
    const entry = normalizeManifestEntry({ description: 'Thing', confidence: 5 }, NOW);
    expect(entry?.confidence).toBe(1);
    expect(entry?.createdAt).toBe(NOW);
    expect(entry?.updatedAt).toBe(NOW);
  });

  it('derives a photo path when the manifest has none', () => {
    const entry = normalizeManifestEntry(
      { id: 'zz', description: 'Thing', mimeType: 'image/png' },
      NOW,
    );
    expect(entry?.photoFile).toBe('photos/zz.png');
  });
});

describe('buildItemFromEntry', () => {
  it('resets the NAS flag and takes the freshly minted blob ids', () => {
    const entry = normalizeManifestEntry(
      { id: 'a', description: 'Thing', category: 'Toys', syncedToNas: true, status: 'done' },
      NOW,
    );
    const item = buildItemFromEntry(
      entry!,
      { id: 'a', photoBlobId: 'a:photo', thumbnailBlobId: 'a:thumb' },
      NOW,
    );
    expect(item.syncedToNas).toBe(false);
    expect(item.photoBlobId).toBe('a:photo');
    expect(item.thumbnailBlobId).toBe('a:thumb');
    expect(item.description).toBe('Thing');
  });
});

describe('restoreFromZip', () => {
  it('round-trips an export back into the library', async () => {
    const archive = await makeArchive();

    const result = await restoreFromZip(archive, { now: NOW, makeThumbnail: thumbnailer });

    expect(result).toMatchObject({ items: 1, photos: 1, duplicates: 0, skipped: 0 });
    expect(result.errors).toEqual([]);

    const items = await listItems();
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.id).toBe('a');
    expect(item.category).toBe('Clothing');
    expect(item.description).toBe('Blue cotton shirt');
    expect(item.status).toBe('done');
    expect(item.confidence).toBeCloseTo(0.9);
    // Timestamps survive the restore (putItems is used, not putItem).
    expect(item.createdAt).toBe(NOW);
    expect(item.updatedAt).toBe(NOW);

    const photo = await getBlob(item.photoBlobId);
    expect(photo).toBeDefined();
    expect(photo?.mime).toBe('image/jpeg');
    const thumb = await getBlob(item.thumbnailBlobId);
    expect(thumb?.mime).toBe('image/jpeg');
  });

  it('is idempotent: a second restore skips what is already present', async () => {
    const archive = await makeArchive();
    await restoreFromZip(archive, { now: NOW, makeThumbnail: thumbnailer });

    const second = await restoreFromZip(archive, { now: NOW, makeThumbnail: thumbnailer });

    expect(second).toMatchObject({ items: 0, duplicates: 1 });
    expect(await listItems()).toHaveLength(1);
  });

  it('adds alongside existing, unrelated items', async () => {
    await restoreFromZip(await makeArchive({ items: [makeItem({ id: 'restored' })] }), {
      now: NOW,
      makeThumbnail: thumbnailer,
    });

    const result = await restoreFromZip(
      await makeArchive({ items: [makeItem({ id: 'another', category: 'Toys' })] }),
      { now: NOW, makeThumbnail: thumbnailer },
    );

    expect(result.items).toBe(1);
    expect((await listItems()).map((item) => item.id).sort()).toEqual(['another', 'restored']);
  });

  it('reports entries whose photo is missing instead of creating a broken item', async () => {
    const archive = await makeArchive({ skipPhoto: true });

    const result = await restoreFromZip(archive, { now: NOW, makeThumbnail: thumbnailer });

    expect(result.items).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/missing from the archive/);
    expect(await listItems()).toHaveLength(0);
  });

  it('falls back to the original when a thumbnail cannot be generated', async () => {
    const archive = await makeArchive();
    const failing = async (): Promise<Blob> => {
      throw new Error('cannot decode');
    };

    const result = await restoreFromZip(archive, { now: NOW, makeThumbnail: failing });

    expect(result.items).toBe(1);
    expect(result.errors[0]).toMatch(/thumbnail could not be generated/);
    const [item] = await listItems();
    expect(await getBlob(item.thumbnailBlobId)).toBeDefined();
  });

  it('rejects files that are not readable archives', async () => {
    await expect(restoreFromZip(new Blob(['not a zip']))).rejects.toThrow(/not a readable ZIP/);
  });

  it('rejects an archive without items.json', async () => {
    const zip = new JSZip();
    zip.file('photos/a.jpg', 'bytes');
    const archive = await zip.generateAsync({ type: 'blob' });

    await expect(restoreFromZip(archive)).rejects.toThrow(/items.json is missing/);
  });

  it('reports invalid JSON inside the archive', async () => {
    const zip = new JSZip();
    zip.file('items.json', '{not json');
    const archive = await zip.generateAsync({ type: 'blob' });

    await expect(restoreFromZip(archive)).rejects.toThrow(/not valid JSON/);
  });
});
