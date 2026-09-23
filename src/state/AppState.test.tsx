// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Item } from '../types';
import * as db from '../lib/db';
import { AppProvider, useApp, type AppContextValue } from './AppState';

// The canvas-based thumbnail generation is not available in jsdom.
vi.mock('../lib/image', () => ({
  createThumbnail: async () => new Blob(['thumbnail'], { type: 'image/jpeg' }),
  isImageFile: () => true,
  blobToDataUrl: async () => 'data:image/jpeg;base64,AAAA',
}));

/** Latest context value, used to invoke actions. */
let api: AppContextValue | null = null;

type SnapshotItem = Pick<
  Item,
  | 'id'
  | 'category'
  | 'subcategory'
  | 'description'
  | 'status'
  | 'photoBlobId'
  | 'thumbnailBlobId'
  | 'fileName'
>;

interface Snapshot {
  ready: boolean;
  items: SnapshotItem[];
  settings: { model: string; threshold: number };
  toasts: string[];
  running: boolean;
}

/**
 * The component mirrors the store into the DOM so assertions always read the
 * committed state instead of a possibly stale closure.
 */
function Probe(): ReactNode {
  api = useApp();
  const snapshot: Snapshot = {
    ready: api.ready,
    items: api.items.map((item) => ({
      id: item.id,
      category: item.category,
      subcategory: item.subcategory,
      description: item.description,
      status: item.status,
      photoBlobId: item.photoBlobId,
      thumbnailBlobId: item.thumbnailBlobId,
      fileName: item.fileName,
    })),
    settings: { model: api.settings.model, threshold: api.settings.confidenceThreshold },
    toasts: api.toasts.map((toast) => toast.message),
    running: api.analysis.running,
  };
  return <pre data-testid="state">{JSON.stringify(snapshot)}</pre>;
}

function readState(): Snapshot {
  return JSON.parse(screen.getByTestId('state').textContent ?? '{}') as Snapshot;
}

async function stateWith(predicate: (state: Snapshot) => boolean): Promise<Snapshot> {
  await waitFor(() => {
    expect(predicate(readState())).toBe(true);
  });
  return readState();
}

function renderApp() {
  return render(
    <AppProvider>
      <Probe />
    </AppProvider>,
  );
}

async function waitForReady(): Promise<void> {
  await stateWith((state) => state.ready);
}

function photo(name = 'photo.jpg'): File {
  return new File(['bytes'], name, { type: 'image/jpeg' });
}

beforeEach(async () => {
  api = null;
  await db.deleteEverything();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
});

describe('AppProvider', () => {
  it('opens the local library and reports readiness', async () => {
    renderApp();
    await waitForReady();
    expect(readState().items).toEqual([]);
    expect(readState().running).toBe(false);
  });

  it('adds photos to the queue with a stored photo and thumbnail blob', async () => {
    renderApp();
    await waitForReady();

    await act(async () => {
      await api?.addPhotos([photo('one.jpg'), photo('two.jpg')]);
    });

    const state = await stateWith((snapshot) => snapshot.items.length === 2);
    expect(state.items.map((entry) => entry.fileName).sort()).toEqual(['one.jpg', 'two.jpg']);
    expect(state.items.every((entry) => entry.status === 'queued')).toBe(true);
    expect(state.toasts.join(' ')).toMatch(/2 photos added/);

    // The list is ordered newest first, so pick the item by name.
    const item = state.items.find((entry) => entry.fileName === 'one.jpg');
    expect(item).toBeDefined();
    const stored = await db.getItem(item!.id);
    expect(stored).toBeDefined();
    expect(await db.getBlob(item!.photoBlobId)).toBeDefined();
    expect(await db.getBlob(item!.thumbnailBlobId)).toBeDefined();
    expect(await db.getQueuedItemIds()).toHaveLength(2);
  });

  it('persists manual edits', async () => {
    renderApp();
    await waitForReady();

    await act(async () => {
      await api?.addPhotos([photo()]);
    });
    const [item] = (await stateWith((snapshot) => snapshot.items.length === 1)).items;

    await act(async () => {
      await api?.updateItem(item.id, {
        category: 'Toys',
        subcategory: 'Cars',
        description: 'Red toy car',
        status: 'done',
        syncedToNas: false,
      });
    });

    const state = await stateWith((snapshot) => snapshot.items[0]?.category === 'Toys');
    expect(state.items[0].subcategory).toBe('Cars');
    expect(state.items[0].status).toBe('done');
    expect((await db.getItem(item.id))?.description).toBe('Red toy car');
  });

  it('refuses to start analysis without an API key', async () => {
    renderApp();
    await waitForReady();

    await act(async () => {
      await api?.addPhotos([photo()]);
    });
    await stateWith((snapshot) => snapshot.items.length === 1);

    await act(async () => {
      await api?.analyzeQueue();
    });

    const state = await stateWith((snapshot) => snapshot.toasts.length > 0);
    expect(state.running).toBe(false);
    expect(state.toasts.some((toast) => /API key/.test(toast))).toBe(true);
  });

  it('removes an item and its blobs', async () => {
    renderApp();
    await waitForReady();

    await act(async () => {
      await api?.addPhotos([photo()]);
    });
    const [item] = (await stateWith((snapshot) => snapshot.items.length === 1)).items;

    await act(async () => {
      await api?.removeItem(item.id);
    });

    await stateWith((snapshot) => snapshot.items.length === 0);
    expect(await db.getBlob(item.photoBlobId)).toBeUndefined();
    expect(await db.listItems()).toHaveLength(0);
  });

  it('deletes a whole category and keeps the rest', async () => {
    renderApp();
    await waitForReady();

    await act(async () => {
      await api?.addPhotos([photo(), photo()]);
    });
    const items = (await stateWith((snapshot) => snapshot.items.length === 2)).items;

    await act(async () => {
      await api?.updateItem(items[0].id, { category: 'Toys', status: 'done' });
      await api?.updateItem(items[1].id, { category: 'Books', status: 'done' });
    });
    await stateWith((snapshot) => snapshot.items.every((entry) => entry.status === 'done'));

    let removed = 0;
    await act(async () => {
      removed = (await api?.removeCategory('Toys')) ?? 0;
    });

    expect(removed).toBe(1);
    const state = await stateWith((snapshot) => snapshot.items.length === 1);
    expect(state.items[0].category).toBe('Books');
  });

  it('recovers interrupted analyses and requeues them', async () => {
    await db.putItem({
      id: 'stuck',
      photoBlobId: 'stuck:photo',
      thumbnailBlobId: 'stuck:thumb',
      category: '',
      subcategory: '',
      attributes: {},
      description: '',
      confidence: 0,
      status: 'analyzing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncedToNas: false,
    });

    renderApp();
    const state = await stateWith((snapshot) => snapshot.items.length === 1);

    expect(state.items[0].status).toBe('queued');
    expect(state.toasts.some((toast) => /Recovered/.test(toast))).toBe(true);
  });

  it('saves settings and exposes them to the UI', async () => {
    renderApp();
    await waitForReady();

    await act(async () => {
      await api?.saveAppSettings({ model: 'google/gemini-2.5-flash', confidenceThreshold: 0.5 });
    });

    const state = await stateWith(
      (snapshot) => snapshot.settings.model === 'google/gemini-2.5-flash',
    );
    expect(state.settings.threshold).toBe(0.5);
    expect((await db.loadSettings()).model).toBe('google/gemini-2.5-flash');
  });

  it('reports a NAS sync failure instead of throwing when unconfigured', async () => {
    renderApp();
    await waitForReady();

    let result: unknown = 'unset';
    await act(async () => {
      result = await api?.syncNas();
    });

    expect(result).toBeNull();
    const state = await stateWith((snapshot) => snapshot.toasts.length > 0);
    expect(state.toasts.some((toast) => /NAS/.test(toast))).toBe(true);
  });
});
