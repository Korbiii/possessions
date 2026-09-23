import { useMemo, useState, type ReactNode } from 'react';
import { StatusBadge, Thumbnail } from '../components/Thumbnail';
import { EmptyState } from '../components/Toasts';
import { reviewQueue } from '../lib/categories';
import { formatConfidence, truncate } from '../lib/format';
import { itemPath } from '../lib/routes';
import type { Item } from '../types';
import { useApp } from '../state/AppState';

/** One row of the review list with inline category editing. */
function ReviewRow({ item }: { item: Item }): ReactNode {
  const { updateItem, retryItem, notify } = useApp();
  const [category, setCategory] = useState(item.category);

  const confirm = async () => {
    await updateItem(item.id, { category: category.trim(), status: 'done' });
    notify('success', 'Item confirmed.');
  };

  return (
    <li className="review-row">
      <a href={itemPath(item.id)} className="review-row__thumb">
        <Thumbnail blobId={item.thumbnailBlobId} alt={item.description || 'Item'} />
      </a>
      <div className="review-row__body">
        <p className="review-row__title">{truncate(item.description || 'No description', 110)}</p>
        <p className="hint">
          <StatusBadge status={item.status} /> · confidence {formatConfidence(item.confidence)}
          {item.subcategory ? ` · ${item.subcategory}` : ''}
        </p>
        {item.error ? <p className="error-box">{item.error}</p> : null}
        <div className="review-row__actions">
          <input
            aria-label="Category"
            value={category}
            placeholder="Category"
            onChange={(event) => setCategory(event.target.value)}
          />
          <button type="button" className="btn btn--primary" onClick={() => void confirm()}>
            ✔ Confirm
          </button>
          {item.status === 'failed' ? (
            <button type="button" className="btn" onClick={() => void retryItem(item.id)}>
              🔄 Retry
            </button>
          ) : null}
          <a className="btn" href={itemPath(item.id)}>
            Edit
          </a>
        </div>
      </div>
    </li>
  );
}

/** Review flow for low-confidence results (plan section 5, step 4). */
export function ReviewPage(): ReactNode {
  const { items } = useApp();
  const queue = useMemo(() => reviewQueue(items), [items]);

  return (
    <div className="page">
      <div className="page__header">
        <a className="link" href="#/">
          ← Library
        </a>
        <h1>Review</h1>
        <p className="hint">
          Items the model was unsure about, failed photos and anything still waiting in the queue.
        </p>
      </div>

      {queue.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          message="Every item is classified with sufficient confidence."
        />
      ) : (
        <ul className="review-list">
          {queue.map((item) => (
            <ReviewRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
