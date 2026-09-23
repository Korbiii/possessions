import type { Item, NasSettings } from '../types';
import { getBlob } from './db';
import { manifestJson } from './manifest';
import { photoRelativePath } from './naming';

/**
 * WebDAV sync to a NAS (plan section 7, phase 4).
 *
 * Nextcloud, Synology DSM and QNAP all speak WebDAV natively, so a few PUT /
 * MKCOL requests are enough. The `syncedToNas` flag prevents duplicate uploads.
 *
 * Note: the NAS must send CORS headers for this to work from a browser.
 */

/* ------------------------------------------------------------------- pure */

/** Adds a scheme when missing and removes trailing slashes. */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Joins URL path segments without mangling the `://` of the scheme. */
export function joinUrlPath(...parts: string[]): string {
  const [first = '', ...rest] = parts;
  const base = first.trim().replace(/\/+$/, '');
  const tail = rest
    .map((part) => part.trim().replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter((part) => part.length > 0)
    .join('/');
  if (!base) return tail;
  return tail ? `${base}/${tail}` : base;
}

/** Full URL for a file inside the configured remote folder. */
export function buildRemoteUrl(url: string, remotePath: string, relativePath?: string): string {
  return joinUrlPath(normalizeBaseUrl(url), remotePath, relativePath ?? '');
}

/** Splits `/inventory/photos` into `['inventory', 'photos']`. */
export function remoteFolderSegments(remotePath: string): string[] {
  return remotePath
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/** Basic-auth header value, UTF-8 safe. */
export function encodeBasicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `Basic ${btoa(binary)}`;
}

/* -------------------------------------------------------------- transport */

export interface WebDavClientOptions {
  config: NasSettings;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

function authHeaders(config: NasSettings): Record<string, string> {
  return { Authorization: encodeBasicAuth(config.username, config.password) };
}

function corsHint(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TypeError) {
    return `${message} — the NAS likely does not allow cross-origin requests (CORS). Enable WebDAV CORS or serve the app from the NAS itself.`;
  }
  return message;
}

async function davRequest(
  options: WebDavClientOptions,
  method: string,
  url: string,
  body?: BodyInit,
  contentType?: string,
): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers = authHeaders(options.config);
  if (contentType) headers['Content-Type'] = contentType;
  try {
    return await doFetch(url, { method, headers, body, signal: options.signal });
  } catch (error) {
    throw new Error(corsHint(error));
  }
}

/** Creates a collection (folder). 201 = created, 405 = already there. */
export async function ensureCollection(options: WebDavClientOptions, url: string): Promise<void> {
  const response = await davRequest(options, 'MKCOL', url);
  if (response.ok || response.status === 405 || response.status === 301 || response.status === 302) {
    return;
  }
  throw new Error(`Could not create ${url} (HTTP ${response.status})`);
}

/** Creates the remote folder and every parent folder below the base URL. */
export async function ensureRemoteFolders(
  options: WebDavClientOptions,
  extraSegments: string[] = [],
): Promise<void> {
  const segments = [...remoteFolderSegments(options.config.remotePath), ...extraSegments];
  let current = normalizeBaseUrl(options.config.url);
  if (!current) throw new Error('No NAS URL configured');
  for (const segment of segments) {
    current = joinUrlPath(current, segment);
    await ensureCollection(options, current);
  }
}

export async function putFile(
  options: WebDavClientOptions,
  relativePath: string,
  data: Blob | string,
  contentType?: string,
): Promise<void> {
  const url = buildRemoteUrl(options.config.url, options.config.remotePath, relativePath);
  const response = await davRequest(
    options,
    'PUT',
    url,
    data,
    contentType ?? (typeof data === 'string' ? 'application/json' : 'application/octet-stream'),
  );
  if (!response.ok) {
    throw new Error(`Upload of ${relativePath} failed (HTTP ${response.status})`);
  }
}

/** Quick connectivity/auth check used by the settings page. */
export async function testConnection(
  options: WebDavClientOptions,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (!normalizeBaseUrl(options.config.url)) {
      return { ok: false, message: 'No NAS URL configured.' };
    }
    await ensureRemoteFolders(options);
    const probe = joinUrlPath(
      buildRemoteUrl(options.config.url, options.config.remotePath),
      'possessions-tracker-test.txt',
    );
    const response = await davRequest(options, 'PUT', probe, 'ok', 'text/plain');
    if (!response.ok) {
      return { ok: false, message: `NAS answered HTTP ${response.status}.` };
    }
    await davRequest(options, 'DELETE', probe);
    return { ok: true, message: `NAS reachable and writable (${options.config.remotePath}).` };
  } catch (error) {
    return { ok: false, message: corsHint(error) };
  }
}

/* ------------------------------------------------------------------- sync */

export interface NasSyncResult {
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
  /** Ids of items whose photo is now on the NAS. */
  syncedItemIds: string[];
  manifestUploaded: boolean;
}

export interface NasSyncOptions extends WebDavClientOptions {
  items: Item[];
  onProgress?: (done: number, total: number, label: string) => void;
}

/** Uploads every not-yet-synced photo plus a fresh `items.json`. */
export async function syncLibraryToNas(options: NasSyncOptions): Promise<NasSyncResult> {
  const { items } = options;
  const result: NasSyncResult = {
    uploaded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    syncedItemIds: [],
    manifestUploaded: false,
  };

  // A folder that cannot be created is worth reporting, but it must not stop
  // the uploads: some WebDAV servers answer MKCOL oddly for existing folders,
  // and the per-file errors are far more useful to the user.
  try {
    await ensureRemoteFolders(options, ['photos']);
  } catch (error) {
    result.failed += 1;
    result.errors.push(
      `folders: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const pending = items.filter((item) => !item.syncedToNas);
  result.skipped = items.length - pending.length;
  const total = pending.length + 1;

  for (const [index, item] of pending.entries()) {
    options.onProgress?.(index, total, item.description || item.id);
    try {
      const record = await getBlob(item.photoBlobId);
      if (!record) {
        result.failed += 1;
        result.errors.push(`${item.id}: photo is missing from local storage`);
        continue;
      }
      await putFile(
        options,
        photoRelativePath(item),
        record.blob,
        record.mime || 'application/octet-stream',
      );
      result.uploaded += 1;
      result.syncedItemIds.push(item.id);
    } catch (error) {
      result.failed += 1;
      result.errors.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    options.onProgress?.(pending.length, total, 'items.json');
    await putFile(options, 'items.json', manifestJson(items), 'application/json');
    result.manifestUploaded = true;
  } catch (error) {
    result.failed += 1;
    result.errors.push(`items.json: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}
