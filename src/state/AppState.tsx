import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppSettings, Item } from '../types';
import {
  createAnalysisSession,
  type AnalysisHandlers,
  type AnalysisSession,
} from '../lib/analysisClient';
import {
  downloadBlob,
  estimateStorage,
  requestPersistentStorage,
  type StorageEstimate,
} from '../lib/browser';
import { DEFAULT_SETTINGS, FALLBACK_CATEGORY } from '../lib/constants';
import * as db from '../lib/db';
import type { SettingsPatch } from '../lib/db';
import { buildExportZip } from '../lib/exportZip';
import { pluralize } from '../lib/format';
import { newId } from '../lib/ids';
import { createThumbnail, isImageFile } from '../lib/image';
import { restoreFromZip, type RestoreResult } from '../lib/importZip';
import { syncLibraryToNas, type NasSyncResult } from '../lib/webdav';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export interface AnalysisState {
  running: boolean;
  activeIds: string[];
  total: number;
  processed: number;
  failed: number;
}

const IDLE_ANALYSIS: AnalysisState = {
  running: false,
  activeIds: [],
  total: 0,
  processed: 0,
  failed: 0,
};

export interface AppContextValue {
  ready: boolean;
  items: Item[];
  settings: AppSettings;
  online: boolean;
  storage: StorageEstimate | null;
  analysis: AnalysisState;
  syncing: boolean;
  syncProgress: string | null;
  toasts: Toast[];
  notify: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: string) => void;
  addPhotos: (files: FileList | File[]) => Promise<number>;
  updateItem: (id: string, patch: Partial<Item>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  removeCategory: (category: string) => Promise<number>;
  analyzeQueue: (ids?: string[]) => Promise<void>;
  cancelAnalysis: () => void;
  retryItem: (id: string) => Promise<void>;
  saveAppSettings: (patch: SettingsPatch) => Promise<void>;
  exportZip: () => Promise<void>;
  importZip: (file: File) => Promise<RestoreResult | null>;
  syncNas: () => Promise<NasSyncResult | null>;
  clearLibrary: () => Promise<void>;
  requestPersistence: () => Promise<void>;
  refreshStorage: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

function sortItems(items: Item[]): Item[] {
  return items.slice().sort((a, b) => b.createdAt - a.createdAt);
}

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [online, setOnline] = useState(true);
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>(IDLE_ANALYSIS);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const sessionRef = useRef<AnalysisSession | null>(null);
  const resumeAttempted = useRef(false);

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const toast: Toast = { id: newId(), kind, message };
    setToasts((prev) => [...prev.slice(-3), toast]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((entry) => entry.id !== toast.id));
    }, kind === 'error' ? 9000 : 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const refreshStorage = useCallback(async () => {
    try {
      setStorage(await estimateStorage());
    } catch {
      setStorage(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    setItems(sortItems(await db.listItems()));
  }, []);

  /** Merges items coming from the worker (or the DB) into the list. */
  const upsertItems = useCallback((incoming: Item[]) => {
    if (incoming.length === 0) return;
    setItems((prev) => {
      const map = new Map(prev.map((item) => [item.id, item]));
      incoming.forEach((item) => map.set(item.id, item));
      return sortItems([...map.values()]);
    });
  }, []);

  /* ------------------------------------------------------------ worker glue */

  const handlersRef = useRef<AnalysisHandlers>({});
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;

  useEffect(() => {
    handlersRef.current = {
      onStarted: (ids) =>
        setAnalysis({ running: true, activeIds: ids, total: ids.length, processed: 0, failed: 0 }),
      onItems: (updated) => upsertItems(updated),
      onItemError: (_id, message) => notify('error', message),
      onFinished: (result) => {
        setAnalysis(IDLE_ANALYSIS);
        if (result.processed > 0 || result.failed > 0) {
          notify(
            result.failed > 0 ? 'error' : 'success',
            `Analysis finished: ${pluralize(result.processed, 'photo')} processed${
              result.failed > 0 ? `, ${result.failed} failed` : ''
            }.`,
          );
        }
        void refresh();
      },
    };
  });

  const getSession = useCallback((): AnalysisSession => {
    if (!sessionRef.current) {
      sessionRef.current = createAnalysisSession({
        onStarted: (ids) => handlersRef.current.onStarted?.(ids),
        onItems: (updated) => handlersRef.current.onItems?.(updated),
        onItemError: (id, message) => handlersRef.current.onItemError?.(id, message),
        onFinished: (result) => handlersRef.current.onFinished?.(result),
      });
    }
    return sessionRef.current;
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.terminate();
      sessionRef.current = null;
    };
  }, []);

  /* --------------------------------------------------------- library actions */

  const addPhotos = useCallback(
    async (input: FileList | File[]): Promise<number> => {
      const files = Array.from(input).filter(isImageFile);
      let added = 0;
      for (const file of files) {
        const id = newId();
        const photoBlobId = `${id}:photo`;
        const thumbnailBlobId = `${id}:thumb`;
        await db.putBlob({
          id: photoBlobId,
          blob: file,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          name: file.name,
        });

        let thumbBlob: Blob = file;
        let thumbMime = file.type || 'application/octet-stream';
        try {
          thumbBlob = await createThumbnail(file);
          thumbMime = 'image/jpeg';
        } catch {
          // HEIC and friends cannot always be decoded; keep the original so the
          // grid still shows something instead of a broken tile.
          notify('info', `Could not build a thumbnail for ${file.name}.`);
        }
        await db.putBlob({
          id: thumbnailBlobId,
          blob: thumbBlob,
          mime: thumbMime,
          size: thumbBlob.size,
          name: `${id}-thumb.jpg`,
        });

        const saved = await db.putItem({
          id,
          photoBlobId,
          thumbnailBlobId,
          category: '',
          subcategory: '',
          attributes: {},
          description: '',
          confidence: 0,
          status: 'queued',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          syncedToNas: false,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        });
        upsertItems([saved]);
        added += 1;
      }
      if (added > 0) {
        notify('success', `${pluralize(added, 'photo')} added and queued for analysis.`);
        void refreshStorage();
      }
      return added;
    },
    [notify, refreshStorage, upsertItems],
  );

  const updateItem = useCallback(
    async (id: string, patch: Partial<Item>) => {
      const existing = itemsRef.current.find((item) => item.id === id);
      if (!existing) return;
      const saved = await db.putItem({ ...existing, ...patch, id });
      upsertItems([saved]);
    },
    [upsertItems],
  );

  const removeItem = useCallback(
    async (id: string) => {
      await db.deleteItem(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      void refreshStorage();
    },
    [refreshStorage],
  );

  const removeCategory = useCallback(
    async (category: string): Promise<number> => {
      // "Uncategorized" can be stored either as an empty string (fresh photo) or
      // as the literal fallback category the model returned.
      const categories =
        category === FALLBACK_CATEGORY || category === ''
          ? ['', FALLBACK_CATEGORY]
          : [category];
      const count = await db.deleteCategories(categories);
      await refresh();
      void refreshStorage();
      return count;
    },
    [refresh, refreshStorage],
  );

  const clearLibrary = useCallback(async () => {
    await db.deleteEverything();
    setItems([]);
    void refreshStorage();
  }, [refreshStorage]);

  /* -------------------------------------------------------- analysis actions */

  const analyzeQueue = useCallback(
    async (ids?: string[]) => {
      const targets = ids && ids.length > 0 ? ids : await db.getQueuedItemIds();
      if (targets.length === 0) {
        notify('info', 'Nothing to analyze — every photo is done.');
        return;
      }
      const current = settingsRef.current;
      if (!current.apiKey.trim()) {
        notify('error', 'Add your OpenRouter API key in Settings before analyzing.');
        return;
      }
      getSession().start(
        {
          apiKey: current.apiKey.trim(),
          model: current.model,
          confidenceThreshold: current.confidenceThreshold,
          parallelRequests: current.parallelRequests,
        },
        targets,
      );
    },
    [getSession, notify],
  );

  const cancelAnalysis = useCallback(() => {
    sessionRef.current?.cancel();
    notify('info', 'Stopping the analysis queue…');
  }, [notify]);

  const retryItem = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((entry) => entry.id === id);
      if (!item) return;
      const queued = await db.putItem({ ...item, status: 'queued', error: undefined });
      upsertItems([queued]);
      await analyzeQueue([id]);
    },
    [analyzeQueue, upsertItems],
  );

  /* ------------------------------------------------------- settings & export */

  const saveAppSettings = useCallback(async (patch: SettingsPatch) => {
    setSettings(await db.saveSettings(patch));
  }, []);

  const exportZip = useCallback(async () => {
    const list = itemsRef.current;
    if (list.length === 0) {
      notify('info', 'There is nothing to export yet.');
      return;
    }
    try {
      const result = await buildExportZip(list);
      downloadBlob(result.blob, result.fileName);
      notify(
        'success',
        `Exported ${pluralize(result.itemCount, 'item')} with ${pluralize(
          result.photoCount,
          'photo',
        )}${result.missingPhotos > 0 ? ` (${result.missingPhotos} photos missing)` : ''}.`,
      );
    } catch (error) {
      notify('error', `Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [notify]);

  /**
   * Restores a ZIP export (see lib/importZip.ts). Additive: existing items are
   * left alone and archive entries that are already present are skipped.
   */
  const importZip = useCallback(
    async (file: File): Promise<RestoreResult | null> => {
      try {
        const result = await restoreFromZip(file);
        await refresh();
        void refreshStorage();

        if (result.items > 0) {
          const extras = [
            result.duplicates > 0 ? `${result.duplicates} already present` : '',
            result.skipped > 0 ? `${result.skipped} skipped` : '',
          ].filter(Boolean);
          notify(
            'success',
            `Restored ${pluralize(result.items, 'item')} from the archive${
              extras.length > 0 ? ` (${extras.join(', ')})` : ''
            }.`,
          );
        } else if (result.duplicates > 0) {
          notify('info', `Nothing to restore — all ${result.duplicates} items are already here.`);
        } else {
          notify('error', 'The archive did not contain any restorable items.');
        }
        if (result.errors.length > 0) notify('info', result.errors[0]);
        return result;
      } catch (error) {
        notify('error', `Import failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
    [notify, refresh, refreshStorage],
  );

  const syncNas = useCallback(async (): Promise<NasSyncResult | null> => {
    const config = settingsRef.current.nas;
    if (!config.url.trim()) {
      notify('error', 'Configure your NAS in Settings first.');
      return null;
    }
    setSyncing(true);
    setSyncProgress('Connecting…');
    try {
      const result = await syncLibraryToNas({
        config,
        items: itemsRef.current,
        onProgress: (done, total, label) => setSyncProgress(`${done}/${total} · ${label}`),
      });
      if (result.syncedItemIds.length > 0) {
        const synced = itemsRef.current
          .filter((item) => result.syncedItemIds.includes(item.id))
          .map((item) => ({ ...item, syncedToNas: true, updatedAt: Date.now() }));
        await db.putItems(synced);
        upsertItems(synced);
      }
      if (result.failed === 0) {
        notify('success', `NAS sync complete: ${pluralize(result.uploaded, 'photo')} uploaded.`);
      } else {
        notify(
          'error',
          `NAS sync had ${pluralize(result.failed, 'problem')}: ${result.errors[0] ?? 'unknown error'}`,
        );
      }
      return result;
    } catch (error) {
      notify('error', `NAS sync failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [notify, upsertItems]);

  const requestPersistence = useCallback(async () => {
    const granted = await requestPersistentStorage();
    notify(
      granted ? 'success' : 'info',
      granted
        ? 'The browser will now keep your library even under storage pressure.'
        : 'The browser declined persistent storage; export a ZIP as a backup.',
    );
    void refreshStorage();
  }, [notify, refreshStorage]);

  /* ------------------------------------------------------------------ effects */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await db.loadSettings();
        // Items that were mid-flight when the tab closed go back into the queue
        // (plan section 5, step 3: resume on open).
        const resumed = await db.resetInterruptedAnalysis();
        const list = await db.listItems();
        if (cancelled) return;
        setSettings(loaded);
        setItems(sortItems(list));
        setReady(true);
        if (resumed > 0) {
          notify(
            'info',
            `Recovered ${pluralize(resumed, 'interrupted analysis', 'interrupted analyses')} from the previous session.`,
          );
        }
        void refreshStorage();
      } catch (error) {
        if (cancelled) return;
        setReady(true);
        notify(
          'error',
          `Local storage could not be opened: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify, refreshStorage]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Resume the queue automatically once the app is usable again.
  useEffect(() => {
    if (!ready || resumeAttempted.current) return;
    if (!settings.autoResumeAnalysis || !settings.apiKey.trim()) return;
    resumeAttempted.current = true;
    void (async () => {
      const queued = await db.getQueuedItemIds();
      if (queued.length === 0) return;
      notify('info', `Resuming analysis for ${pluralize(queued.length, 'photo')}.`);
      await analyzeQueue();
    })();
  }, [ready, settings.autoResumeAnalysis, settings.apiKey, analyzeQueue, notify]);

  // iOS Safari suspends background work when the tab is hidden, so we also
  // check for pending work whenever the app becomes visible again.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (analysisRef.current.running) return;
      if (!settingsRef.current.apiKey.trim()) return;
      void (async () => {
        const queued = await db.getQueuedItemIds();
        if (queued.length > 0) await analyzeQueue();
      })();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [analyzeQueue]);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      items,
      settings,
      online,
      storage,
      analysis,
      syncing,
      syncProgress,
      toasts,
      notify,
      dismissToast,
      addPhotos,
      updateItem,
      removeItem,
      removeCategory,
      analyzeQueue,
      cancelAnalysis,
      retryItem,
      saveAppSettings,
      exportZip,
      importZip,
      syncNas,
      clearLibrary,
      requestPersistence,
      refreshStorage,
    }),
    [
      ready,
      items,
      settings,
      online,
      storage,
      analysis,
      syncing,
      syncProgress,
      toasts,
      notify,
      dismissToast,
      addPhotos,
      updateItem,
      removeItem,
      removeCategory,
      analyzeQueue,
      cancelAnalysis,
      retryItem,
      saveAppSettings,
      exportZip,
      importZip,
      syncNas,
      clearLibrary,
      requestPersistence,
      refreshStorage,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside <AppProvider>');
  return context;
}
