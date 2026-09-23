import { useMemo, useState, type ReactNode } from 'react';
import { AnalysisBar } from '../components/AnalysisBar';
import { ItemGrid } from '../components/ItemGrid';
import { PhotoCapture } from '../components/PhotoCapture';
import { Thumbnail } from '../components/Thumbnail';
import { EmptyState } from '../components/Toasts';
import { buildCategoryTiles } from '../lib/categories';
import { pluralize } from '../lib/format';
import { categoryPath } from '../lib/routes';
import { searchItems } from '../lib/search';
import { useApp } from '../state/AppState';

/** Home screen: capture bar, search, category tiles (plan section 8). */
export function HomePage(): ReactNode {
  const { items, addPhotos, exportZip, syncNas, syncing, syncProgress, settings } = useApp();
  const [query, setQuery] = useState('');
  const [capturing, setCapturing] = useState(false);

  const queued = useMemo(() => items.filter((item) => item.status === 'queued').length, [items]);
  const tiles = useMemo(() => buildCategoryTiles(items), [items]);
  const results = useMemo(() => searchItems(items, query), [items, query]);
  const searching = query.trim().length > 0;
  const nasConfigured = settings.nas.url.trim().length > 0;

  const handleFiles = async (files: FileList) => {
    setCapturing(true);
    try {
      await addPhotos(files);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="page">
      <PhotoCapture onFiles={handleFiles} busy={capturing} />

      <AnalysisBar queuedCount={queued} />

      <div className="toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => void exportZip()}
          disabled={items.length === 0}
        >
          ⬇️ Export ZIP
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void syncNas()}
          disabled={!nasConfigured || syncing || items.length === 0}
          title={nasConfigured ? 'Upload new photos and items.json to your NAS' : 'Configure a NAS in Settings'}
        >
          {syncing ? '☁︎ Syncing…' : '☁︎ Sync to NAS'}
        </button>
      </div>
      {syncing && syncProgress ? <p className="hint">{syncProgress}</p> : null}

      {items.length === 0 ? (
        <EmptyState
          title="No possessions yet"
          message="Take a photo of the things you want to catalogue. Everything stays on this device until you export or sync it."
        />
      ) : (
        <>
          <label className="search">
            <span className="visually-hidden">Search</span>
            <input
              type="search"
              placeholder="Search description, colour, brand…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {searching ? (
            <>
              <p className="hint">
                {pluralize(results.length, 'match', 'matches')} for “{query.trim()}”
              </p>
              <ItemGrid items={results} showCategory />
            </>
          ) : (
            <div className="tiles">
              {tiles.map((tile) => (
                <a className="tile" key={tile.category} href={categoryPath(tile.category)}>
                  <Thumbnail
                    blobId={tile.thumbnailBlobId}
                    alt={tile.category}
                    className="tile__thumb"
                  />
                  <div className="tile__body">
                    <h2 className="tile__title">{tile.category || 'Uncategorized'}</h2>
                    <p className="tile__meta">{pluralize(tile.count, 'item')}</p>
                    {tile.needsReview > 0 ? (
                      <p className="tile__review">
                        {pluralize(tile.needsReview, 'needs review', 'need review')}
                      </p>
                    ) : null}
                  </div>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
