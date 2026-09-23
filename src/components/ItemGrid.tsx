import type { ReactNode } from 'react';
import type { Item } from '../types';
import { itemPath } from '../lib/routes';
import { formatConfidence, truncate } from '../lib/format';
import { StatusBadge, Thumbnail } from './Thumbnail';

/** One tile in a photo grid (plan section 8). */
export function ItemCard({ item, showCategory = false }: { item: Item; showCategory?: boolean }): ReactNode {
  const label = item.description || item.category || 'Unlabeled item';
  return (
    <a className="card" href={itemPath(item.id)}>
      <Thumbnail blobId={item.thumbnailBlobId} alt={label} className="card__thumb" />
      <div className="card__body">
        <p className="card__title">{truncate(label, 70)}</p>
        {showCategory && item.category ? (
          <p className="card__meta">
            {item.category}
            {item.subcategory ? ` · ${item.subcategory}` : ''}
          </p>
        ) : null}
        <div className="card__footer">
          <StatusBadge status={item.status} />
          {item.confidence > 0 ? (
            <span className="card__confidence">{formatConfidence(item.confidence)}</span>
          ) : null}
          {item.syncedToNas ? <span className="card__synced" title="Synced to NAS">☁︎</span> : null}
        </div>
      </div>
    </a>
  );
}

export function ItemGrid({ items, showCategory = false }: { items: Item[]; showCategory?: boolean }): ReactNode {
  return (
    <div className="grid">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} showCategory={showCategory} />
      ))}
    </div>
  );
}
