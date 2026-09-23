import type { ReactNode } from 'react';
import { useApp } from '../state/AppState';
import { pluralize } from '../lib/format';
import { settingsPath } from '../lib/routes';

/** Queue status + the single "Analyze" button from plan section 5, step 2. */
export function AnalysisBar({ queuedCount }: { queuedCount: number }): ReactNode {
  const { analysis, analyzeQueue, cancelAnalysis, settings } = useApp();
  const hasKey = settings.apiKey.trim().length > 0;

  if (analysis.running) {
    const done = analysis.processed + analysis.failed;
    return (
      <div className="analysis-bar analysis-bar--running">
        <div className="analysis-bar__text">
          <strong>Analyzing…</strong>
          <span>
            {done}/{analysis.total} finished
            {analysis.failed > 0 ? ` · ${analysis.failed} failed` : ''}
          </span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={analysis.total} aria-valuenow={done}>
          <div
            className="progress__bar"
            style={{ width: `${analysis.total === 0 ? 0 : Math.round((done / analysis.total) * 100)}%` }}
          />
        </div>
        <button type="button" className="btn btn--ghost" onClick={cancelAnalysis}>
          Stop
        </button>
      </div>
    );
  }

  if (queuedCount === 0) return null;

  return (
    <div className="analysis-bar">
      <div className="analysis-bar__text">
        <strong>{pluralize(queuedCount, 'photo')} waiting</strong>
        <span>{hasKey ? 'Ready to classify with OpenRouter.' : 'Add an API key to enable analysis.'}</span>
      </div>
      {hasKey ? (
        <button type="button" className="btn btn--primary" onClick={() => void analyzeQueue()}>
          ✨ Analyze {queuedCount}
        </button>
      ) : (
        <a className="btn btn--primary" href={settingsPath}>
          Add API key
        </a>
      )}
    </div>
  );
}
