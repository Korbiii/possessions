// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteCategories,
  deleteEverything,
  deleteItem,
  getBlob,
  getQueuedItemIds,
  listItems,
  loadSettings,
  putBlob,
  putItem,
  resetInterruptedAnalysis,
  saveSettings,
} from './db';
import { makeItem } from './testing/fixtures';

/**
 * Exercises the IndexedDB layer against a real (in-memory) IndexedDB
 * implementation, including blob reference counting for shared photos.
 */

beforeEach(async () => {
  await deleteEverything();
});

describe('items', () => {
  it('stores and lists items newest first', async () => {
    await putItem(makeItem({ id: 'old', createdAt: 1 }));
    await putItem(makeItem({ id: 'new', createdAt: 2 }));
    const items = await listItems();
    expect(items.map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('stamps updatedAt on every write', async () => {
    const saved = await putItem(makeItem({ id: 'a', updatedAt: 1 }));
    expect(saved.updatedAt).toBeGreaterThan(1);
  });

  it('deletes the photo and thumbnail with the last referencing item', async () => {
    await putBlob({ id: 'a:photo', blob: new Blob(['p']), mime: 'image/jpeg', size: 1, name: 'p.jpg' });
    await putBlob({ id: 'a:thumb', blob: new Blob(['t']), mime: 'image/jpeg', size: 1, name: 't.jpg' });
    await putItem(makeItem({ id: 'a' }));

    await deleteItem('a');

    expect(await getBlob('a:photo')).toBeUndefined();
    expect(await getBlob('a:thumb')).toBeUndefined();
    expect(await listItems()).toHaveLength(0);
  });

  it('keeps shared blobs alive while another item still uses them', async () => {
    // A photo with two detected objects: both items point at the same blobs.
    await putBlob({ id: 'shared:photo', blob: new Blob(['p']), mime: 'image/jpeg', size: 1, name: 'p.jpg' });
    await putItem(makeItem({ id: 'first', photoBlobId: 'shared:photo', thumbnailBlobId: 'shared:thumb' }));
    await putItem(makeItem({ id: 'second', photoBlobId: 'shared:photo', thumbnailBlobId: 'shared:thumb' }));

    await deleteItem('first');

    expect(await getBlob('shared:photo')).toBeDefined();
    expect((await listItems()).map((item) => item.id)).toEqual(['second']);
  });

  it('deletes whole categories, including the Uncategorized variants', async () => {
    await putItem(makeItem({ id: 'a', category: 'Toys' }));
    await putItem(makeItem({ id: 'b', category: '' }));
    await putItem(makeItem({ id: 'c', category: 'Uncategorized' }));
    await putItem(makeItem({ id: 'd', category: 'Clothing' }));

    const removed = await deleteCategories(['', 'Uncategorized']);

    expect(removed).toBe(2);
    expect((await listItems()).map((item) => item.id).sort()).toEqual(['a', 'd']);
  });
});

describe('queue recovery', () => {
  it('reports queued and analyzing items as pending work', async () => {
    await putItem(makeItem({ id: 'q', status: 'queued' }));
    await putItem(makeItem({ id: 'a', status: 'analyzing' }));
    await putItem(makeItem({ id: 'd', status: 'done' }));
    expect((await getQueuedItemIds()).sort()).toEqual(['a', 'q']);
  });

  it('resets interrupted analyses back to queued', async () => {
    await putItem(makeItem({ id: 'a', status: 'analyzing' }));
    await putItem(makeItem({ id: 'b', status: 'done' }));

    const reset = await resetInterruptedAnalysis();

    expect(reset).toBe(1);
    const items = await listItems();
    expect(items.find((item) => item.id === 'a')?.status).toBe('queued');
    expect(items.find((item) => item.id === 'b')?.status).toBe('done');
  });
});

describe('settings', () => {
  it('returns defaults when nothing was stored', async () => {
    const settings = await loadSettings();
    expect(settings.model).toBe('google/gemini-2.5-flash-lite');
    expect(settings.parallelRequests).toBe(3);
    expect(settings.nas.remotePath).toBe('/inventory');
  });

  it('merges partial patches, including nested NAS fields', async () => {
    await saveSettings({ apiKey: 'sk-1' });
    await saveSettings({ nas: { url: 'https://nas.local', username: 'anna' } });

    const settings = await loadSettings();
    expect(settings.apiKey).toBe('sk-1');
    expect(settings.nas.url).toBe('https://nas.local');
    expect(settings.nas.username).toBe('anna');
    expect(settings.nas.remotePath).toBe('/inventory');
  });
});
