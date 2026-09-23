import type { Item } from '../types';
import type { AnalysisWorkerConfig, WorkerInMessage, WorkerOutMessage } from './analysis.worker';

/**
 * Main-thread handle for the analysis worker.
 *
 * The worker is created lazily and reused; `start` hands it a batch of item ids
 * and every persisted change is streamed back through `onItems`.
 */

export interface AnalysisHandlers {
  onStarted?: (itemIds: string[]) => void;
  onItems?: (items: Item[]) => void;
  onItemError?: (itemId: string, message: string) => void;
  onFinished?: (result: { processed: number; failed: number; cancelled: boolean }) => void;
}

export interface AnalysisSession {
  start: (config: AnalysisWorkerConfig, itemIds: string[]) => void;
  cancel: () => void;
  terminate: () => void;
}

export function createAnalysisSession(handlers: AnalysisHandlers): AnalysisSession {
  let worker: Worker | null = null;

  const ensureWorker = (): Worker => {
    if (!worker) {
      worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
        const message = event.data;
        switch (message.type) {
          case 'started':
            handlers.onStarted?.(message.itemIds);
            break;
          case 'items':
            handlers.onItems?.(message.items);
            break;
          case 'item-error':
            handlers.onItemError?.(message.itemId, message.message);
            break;
          case 'finished':
            handlers.onFinished?.({
              processed: message.processed,
              failed: message.failed,
              cancelled: message.cancelled,
            });
            break;
        }
      };
    }
    return worker;
  };

  const send = (message: WorkerInMessage): void => {
    ensureWorker().postMessage(message);
  };

  return {
    start(config, itemIds) {
      if (itemIds.length === 0) {
        handlers.onFinished?.({ processed: 0, failed: 0, cancelled: false });
        return;
      }
      send({ type: 'process', config, itemIds });
    },
    cancel() {
      send({ type: 'cancel' });
    },
    terminate() {
      worker?.terminate();
      worker = null;
    },
  };
}
