import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DEFAULT_CONFIDENCE_THRESHOLD, SUGGESTED_MODELS } from '../lib/constants';
import { formatBytes } from '../lib/format';
import { checkApiKey } from '../lib/openrouter';
import { testConnection } from '../lib/webdav';
import type { AppSettings } from '../types';
import { useApp } from '../state/AppState';

type Feedback = { kind: 'ok' | 'error'; message: string } | null;

/** Settings: OpenRouter credentials, analysis tuning, NAS sync, storage. */
export function SettingsPage(): ReactNode {
  const {
    settings,
    saveAppSettings,
    storage,
    requestPersistence,
    refreshStorage,
    exportZip,
    importZip,
    syncNas,
    syncing,
    syncProgress,
    clearLibrary,
    notify,
    items,
  } = useApp();

  const [draft, setDraft] = useState<AppSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [keyFeedback, setKeyFeedback] = useState<Feedback>(null);
  const [nasFeedback, setNasFeedback] = useState<Feedback>(null);
  const [checking, setChecking] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [importing, setImporting] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const handleZipPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      await importZip(file);
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    void refreshStorage();
  }, [refreshStorage]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const save = async () => {
    await saveAppSettings({
      ...draft,
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      confidenceThreshold: draft.confidenceThreshold,
      parallelRequests: Math.min(6, Math.max(1, draft.parallelRequests)),
      nas: {
        url: draft.nas.url.trim(),
        username: draft.nas.username.trim(),
        password: draft.nas.password,
        remotePath: draft.nas.remotePath.trim() || '/inventory',
      },
    });
    notify('success', 'Settings saved.');
  };

  const testKey = async () => {
    setChecking(true);
    setKeyFeedback(null);
    try {
      const result = await checkApiKey(draft.apiKey.trim());
      setKeyFeedback({ kind: result.valid ? 'ok' : 'error', message: result.message });
    } finally {
      setChecking(false);
    }
  };

  const testNas = async () => {
    setChecking(true);
    setNasFeedback(null);
    try {
      const result = await testConnection({ config: draft.nas });
      setNasFeedback({ kind: result.ok ? 'ok' : 'error', message: result.message });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="page">
      <div className="page__header">
        <a className="link" href="#/">
          ← Library
        </a>
        <h1>Settings</h1>
      </div>

      <section className="panel">
        <h2>Vision analysis (OpenRouter)</h2>
        <p className="hint">
          One API key for every model. Create a key at openrouter.ai/keys — it is stored only in
          this browser's IndexedDB and sent exclusively to openrouter.ai.
        </p>

        <label>
          API key
          <div className="input-row">
            <input
              type={showKey ? 'text' : 'password'}
              value={draft.apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-or-v1-…"
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            />
            <button type="button" className="btn" onClick={() => setShowKey((value) => !value)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <label>
          Model
          <input
            list="model-options"
            value={draft.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
        </label>
        <datalist id="model-options">
          {SUGGESTED_MODELS.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>

        <label>
          Confidence threshold: {Math.round(draft.confidenceThreshold * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.confidenceThreshold}
            onChange={(event) =>
              setDraft({ ...draft, confidenceThreshold: Number(event.target.value) })
            }
          />
        </label>
        <p className="hint">
          Results below {Math.round(draft.confidenceThreshold * 100)}% (default{' '}
          {DEFAULT_CONFIDENCE_THRESHOLD * 100}%) are flagged for review instead of being accepted
          silently.
        </p>

        <label>
          Parallel requests: {draft.parallelRequests}
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={draft.parallelRequests}
            onChange={(event) =>
              setDraft({ ...draft, parallelRequests: Number(event.target.value) })
            }
          />
        </label>
        <p className="hint">Lower this if OpenRouter answers with 429 rate limits.</p>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.autoResumeAnalysis}
            onChange={(event) => setDraft({ ...draft, autoResumeAnalysis: event.target.checked })}
          />
          Resume unfinished analysis automatically when the app is opened
        </label>

        <div className="toolbar">
          <button type="button" className="btn" onClick={() => void testKey()} disabled={checking}>
            {checking ? 'Testing…' : '🔌 Test key'}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!dirty}>
            💾 Save settings
          </button>
        </div>
        {keyFeedback ? (
          <p className={keyFeedback.kind === 'ok' ? 'ok-box' : 'error-box'}>{keyFeedback.message}</p>
        ) : null}
      </section>

      <section className="panel">
        <h2>NAS sync (WebDAV)</h2>
        <p className="hint">
          Works with Nextcloud, Synology DSM and QNAP. Use an app-specific password rather than your
          main account password. The NAS has to allow cross-origin (CORS) requests from this origin.
        </p>

        <label>
          NAS URL
          <input
            value={draft.nas.url}
            placeholder="https://nas.local:5006"
            spellCheck={false}
            onChange={(event) =>
              setDraft({ ...draft, nas: { ...draft.nas, url: event.target.value } })
            }
          />
        </label>
        <label>
          Remote folder
          <input
            value={draft.nas.remotePath}
            placeholder="/inventory"
            spellCheck={false}
            onChange={(event) =>
              setDraft({ ...draft, nas: { ...draft.nas, remotePath: event.target.value } })
            }
          />
        </label>
        <div className="form__row">
          <label>
            Username
            <input
              value={draft.nas.username}
              autoComplete="off"
              onChange={(event) =>
                setDraft({ ...draft, nas: { ...draft.nas, username: event.target.value } })
              }
            />
          </label>
          <label>
            App password
            <input
              type="password"
              value={draft.nas.password}
              autoComplete="off"
              onChange={(event) =>
                setDraft({ ...draft, nas: { ...draft.nas, password: event.target.value } })
              }
            />
          </label>
        </div>

        <div className="toolbar">
          <button type="button" className="btn" onClick={() => void testNas()} disabled={checking}>
            {checking ? 'Testing…' : '🔌 Test connection'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void syncNas()}
            disabled={syncing || items.length === 0}
          >
            {syncing ? '☁︎ Syncing…' : '☁︎ Sync now'}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!dirty}>
            💾 Save settings
          </button>
        </div>
        {syncing && syncProgress ? <p className="hint">{syncProgress}</p> : null}
        {nasFeedback ? (
          <p className={nasFeedback.kind === 'ok' ? 'ok-box' : 'error-box'}>{nasFeedback.message}</p>
        ) : null}
      </section>

      <section className="panel">
        <h2>Local storage</h2>
        <p className="hint">
          {items.length} items ·{' '}
          {storage
            ? `${formatBytes(storage.usage)} used${storage.quota > 0 ? ` of ${formatBytes(storage.quota)}` : ''}`
            : 'measuring…'}
          {storage?.persisted ? ' · persistent storage granted' : ''}
        </p>

        <div className="toolbar">
          <button type="button" className="btn" onClick={() => void exportZip()}>
            ⬇️ Export ZIP
          </button>
          <input
            ref={zipInputRef}
            className="visually-hidden"
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => void handleZipPicked(event)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => zipInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? '⬆️ Restoring…' : '⬆️ Restore from ZIP'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void requestPersistence()}
            disabled={storage?.persisted === true}
          >
            📌 Request persistent storage
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => setConfirmingWipe(true)}
            disabled={items.length === 0}
          >
            🗑 Delete everything
          </button>
        </div>
        <p className="hint">
          Everything lives in this browser only. Export a ZIP regularly — clearing browser data
          removes the library. A restore <strong>adds</strong> the archive's items to this library;
          entries that are already present are skipped, nothing here is overwritten.
        </p>
      </section>

      <ConfirmDialog
        open={confirmingWipe}
        title="Delete the whole library?"
        message={`All ${items.length} items and their photos will be deleted from this device. This cannot be undone.`}
        confirmLabel="Delete everything"
        onConfirm={() => {
          setConfirmingWipe(false);
          void (async () => {
            await clearLibrary();
            notify('success', 'Library deleted.');
          })();
        }}
        onCancel={() => setConfirmingWipe(false)}
      />
    </div>
  );
}
