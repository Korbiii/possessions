import type { Item } from '../types';
import { applyPlan, buildExtraItems, markFailed, planFromDetections } from './analysis';
import { getBlob, getItem, putItem, putItems } from './db';
import { newId } from './ids';
import { blobToDataUrl } from './image';
import { analyzePhoto } from './openrouter';

/**
 * Background analysis queue (plan section 5, step 3).
 *
 * Runs inside a Web Worker so the UI stays responsive while a whole batch of
 * photos is sent to OpenRouter. A small pool of concurrent fetches keeps us
 * under provider rate limits.
 */

export interface AnalysisWorkerConfig {
  apiKey: string;
  model: string;
  confidenceThreshold: number;
  parallelRequests: number;
}

export type WorkerInMessage =
  | { type: 'process'; config: AnalysisWorkerConfig; itemIds: string[] }
  | { type: 'cancel' };

export type WorkerOutMessage =
  | { type: 'started'; itemIds: string[] }
  | { type: 'items'; items: Item[] }
  | { type: 'item-error'; itemId: string; message: string }
  | { type: 'finished'; processed: number; failed: number; cancelled: boolean };

const post = (message: WorkerOutMessage): void => {
  (self as unknown as Worker).postMessage(message);
};

let running = false;
let cancelled = false;
let abortController: AbortController | null = null;

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'cancel') {
    cancelled = true;
    abortController?.abort();
    return;
  }
  if (message.type === 'process') {
    void runQueue(message.itemIds, message.config);
  }
};

function clampParallel(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(6, Math.max(1, Math.round(value)));
}

async function runQueue(itemIds: string[], config: AnalysisWorkerConfig): Promise<void> {
  if (running) {
    post({ type: 'finished', processed: 0, failed: 0, cancelled: true });
    return;
  }
  running = true;
  cancelled = false;
  abortController = new AbortController();
  const signal = abortController.signal;

  post({ type: 'started', itemIds });

  const queue = [...itemIds];
  let processed = 0;
  let failed = 0;

  const workerLoop = async (): Promise<void> => {
    while (!cancelled && queue.length > 0) {
      const id = queue.shift();
      if (!id) break;
      try {
        const result = await processOne(id, config, signal);
        if (result) {
          processed += 1;
          post({ type: 'items', items: result });
        }
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
          // Put the item back into the queue so a later run picks it up.
          const item = await getItem(id);
          if (item && item.status === 'analyzing') {
            const requeued = await putItem({ ...item, status: 'queued' });
            post({ type: 'items', items: [requeued] });
          }
          continue;
        }
        failed += 1;
        const message = error instanceof Error ? error.message : 'Unknown analysis error';
        const item = await getItem(id);
        if (item) {
          const failedItem = await putItem(markFailed(item, message));
          post({ type: 'items', items: [failedItem] });
        }
        post({ type: 'item-error', itemId: id, message });
      }
    }
  };

  try {
    const parallel = clampParallel(config.parallelRequests);
    await Promise.all(Array.from({ length: parallel }, () => workerLoop()));
  } finally {
    running = false;
    abortController = null;
    post({ type: 'finished', processed, failed, cancelled });
  }
}

/** Analyzes one photo and persists the resulting item(s). */
async function processOne(
  id: string,
  config: AnalysisWorkerConfig,
  signal: AbortSignal,
): Promise<Item[] | null> {
  const item = await getItem(id);
  if (!item) return null;

  const analyzing = await putItem({ ...item, status: 'analyzing' });
  post({ type: 'items', items: [analyzing] });

  const photo = await getBlob(item.photoBlobId);
  if (!photo) {
    throw new Error('The photo for this item is missing from local storage');
  }

  const dataUrl = await blobToDataUrl(photo.blob);
  const detections = await analyzePhoto({
    apiKey: config.apiKey,
    model: config.model,
    dataUrl,
    signal,
  });
  if (detections.length === 0) {
    throw new Error('The model did not find any item in this photo');
  }

  const plans = planFromDetections(detections, config.confidenceThreshold);
  const updated = applyPlan(analyzing, plans[0]);
  const extras = buildExtraItems(analyzing, plans.slice(1), newId);
  await putItems([updated, ...extras]);
  return [updated, ...extras];
}
