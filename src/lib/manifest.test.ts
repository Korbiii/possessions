import { describe, expect, it } from 'vitest';
import { buildExportManifest, exportFileName, manifestJson } from './manifest';
import { makeItem } from './testing/fixtures';

describe('buildExportManifest', () => {
  const items = [
    makeItem({ id: 'one', mimeType: 'image/jpeg', fileName: 'IMG_1.jpg' }),
    makeItem({ id: 'two', mimeType: 'image/png', fileName: 'shot.png' }),
  ];

  it('lists every item with a stable photo path', () => {
    const manifest = buildExportManifest(items, Date.UTC(2024, 0, 2, 3, 4, 5));
    expect(manifest.itemCount).toBe(2);
    expect(manifest.exportedAt).toBe('2024-01-02T03:04:05.000Z');
    expect(manifest.items.map((item) => item.photoFile)).toEqual([
      'photos/one.jpg',
      'photos/two.png',
    ]);
  });

  it('never leaks internal blob ids into the export', () => {
    const manifest = buildExportManifest(items);
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('photoBlobId');
    expect(serialized).not.toContain('thumbnailBlobId');
  });

  it('keeps the metadata a re-import would need', () => {
    const [entry] = buildExportManifest(items).items;
    expect(entry.category).toBe('Clothing');
    expect(entry.attributes.color).toBe('Blue');
    expect(entry.status).toBe('done');
    expect(entry.confidence).toBe(0.9);
  });

  it('serialises to pretty JSON with a trailing newline', () => {
    const json = manifestJson([makeItem()], 0);
    expect(json.endsWith('\n')).toBe(true);
    expect(JSON.parse(json).items).toHaveLength(1);
  });
});

describe('exportFileName', () => {
  it('embeds a filesystem friendly timestamp', () => {
    const name = exportFileName(Date.UTC(2024, 4, 6, 7, 8, 9));
    expect(name).toBe('possessions-export-2024-05-06-07-08-09.zip');
  });
});
