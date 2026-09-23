import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlobRecord } from '../types';
import { makeItem } from './testing/fixtures';

const getBlob = vi.fn<(id: string) => Promise<BlobRecord | undefined>>();

vi.mock('./db', () => ({
  getBlob: (id: string) => getBlob(id),
}));

const {
  buildRemoteUrl,
  encodeBasicAuth,
  joinUrlPath,
  normalizeBaseUrl,
  remoteFolderSegments,
  syncLibraryToNas,
  testConnection,
} = await import('./webdav');

const config = {
  url: 'nas.local:5006',
  username: 'anna',
  password: 'secret',
  remotePath: '/inventory',
};

interface Call {
  url: string;
  method: string;
}

function fakeFetch(status = 200, methodStatus: Record<string, number> = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method });
    return new Response('', { status: methodStatus[method] ?? status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

beforeEach(() => {
  getBlob.mockReset();
  getBlob.mockImplementation(async (id) => ({
    id,
    blob: new Blob(['photo-bytes'], { type: 'image/jpeg' }),
    mime: 'image/jpeg',
    size: 11,
    name: 'photo.jpg',
  }));
});

describe('URL helpers', () => {
  it('adds a scheme and trims trailing slashes', () => {
    expect(normalizeBaseUrl('nas.local:5006/')).toBe('https://nas.local:5006');
    expect(normalizeBaseUrl('http://nas/')).toBe('http://nas');
    expect(normalizeBaseUrl('   ')).toBe('');
  });

  it('joins paths without breaking the scheme', () => {
    expect(joinUrlPath('https://nas.local:5006', '/inventory/', 'photos/x.jpg')).toBe(
      'https://nas.local:5006/inventory/photos/x.jpg',
    );
  });

  it('builds a full remote URL', () => {
    expect(buildRemoteUrl('nas.local', '/inventory', 'items.json')).toBe(
      'https://nas.local/inventory/items.json',
    );
    expect(buildRemoteUrl('nas.local', '/inventory')).toBe('https://nas.local/inventory');
  });

  it('splits remote folders into segments', () => {
    expect(remoteFolderSegments('/inventory/photos')).toEqual(['inventory', 'photos']);
    expect(remoteFolderSegments('')).toEqual([]);
  });

  it('encodes basic auth as UTF-8 safe base64', () => {
    expect(encodeBasicAuth('anna', 'secret')).toBe(`Basic ${btoa('anna:secret')}`);
    expect(() => atob(encodeBasicAuth('ä', 'ö').replace('Basic ', ''))).not.toThrow();
  });
});

describe('testConnection', () => {
  it('creates the remote folder, writes a probe and deletes it', async () => {
    const { fetchImpl, calls } = fakeFetch(200, { MKCOL: 201 });
    const result = await testConnection({ config, fetchImpl });

    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(['MKCOL', 'PUT', 'DELETE']);
    expect(calls[0].url).toBe('https://nas.local:5006/inventory');
    expect(calls[1].url).toBe('https://nas.local:5006/inventory/possessions-tracker-test.txt');
  });

  it('reports a failure when no URL is configured', async () => {
    const { fetchImpl } = fakeFetch();
    const result = await testConnection({ config: { ...config, url: '' }, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/No NAS URL/);
  });
});

describe('syncLibraryToNas', () => {
  it('uploads pending photos and the manifest, skipping synced items', async () => {
    const { fetchImpl, calls } = fakeFetch(200, { MKCOL: 201 });
    const items = [
      makeItem({ id: 'pending', syncedToNas: false }),
      makeItem({ id: 'already', syncedToNas: true }),
    ];

    const result = await syncLibraryToNas({ config, items, fetchImpl });

    expect(result.uploaded).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.syncedItemIds).toEqual(['pending']);
    expect(result.manifestUploaded).toBe(true);

    const puts = calls.filter((call) => call.method === 'PUT').map((call) => call.url);
    expect(puts).toContain('https://nas.local:5006/inventory/photos/pending.jpg');
    expect(puts).toContain('https://nas.local:5006/inventory/items.json');
    expect(puts).not.toContain('https://nas.local:5006/inventory/photos/already.jpg');
  });

  it('collects per-item errors without aborting the whole sync', async () => {
    const { fetchImpl } = fakeFetch(500);
    const result = await syncLibraryToNas({
      config,
      items: [makeItem({ id: 'one' })],
      fetchImpl,
    });

    expect(result.uploaded).toBe(0);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain('HTTP 500');
  });

  it('reports photos that vanished from local storage', async () => {
    getBlob.mockImplementation(async () => undefined);
    const { fetchImpl } = fakeFetch(200, { MKCOL: 201 });
    const result = await syncLibraryToNas({ config, items: [makeItem({ id: 'gone' })], fetchImpl });

    expect(result.uploaded).toBe(0);
    expect(result.errors[0]).toMatch(/missing from local storage/);
  });
});
