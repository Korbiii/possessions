import { useMemo, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FilterBar } from '../components/FilterBar';
import { ItemGrid } from '../components/ItemGrid';
import { EmptyState } from '../components/Toasts';
import { colorOptions, subcategoryOptions } from '../lib/categories';
import { FALLBACK_CATEGORY } from '../lib/constants';
import { pluralize } from '../lib/format';
import { homePath } from '../lib/routes';
import { filterItems } from '../lib/search';
import { ITEM_STATUSES, STATUS_LABELS } from '../types';
import { useApp } from '../state/AppState';

/** Category view with subcategory/colour/status filters (plan section 8). */
export function CategoryPage({ category }: { category: string }): ReactNode {
  const { items, removeCategory, notify } = useApp();
  const [subcategory, setSubcategory] = useState('');
  const [color, setColor] = useState('');
  const [status, setStatus] = useState('');
  const [confirming, setConfirming] = useState(false);

  const categoryItems = useMemo(
    () => items.filter((item) => (item.category || FALLBACK_CATEGORY) === category),
    [items, category],
  );
  const filtered = useMemo(
    () => filterItems(categoryItems, { subcategory, color, status }),
    [categoryItems, subcategory, color, status],
  );

  const handleDelete = async () => {
    setConfirming(false);
    const removed = await removeCategory(category);
    notify('success', `Deleted ${pluralize(removed, 'item')} from ${category || FALLBACK_CATEGORY}.`);
    window.location.hash = homePath;
  };

  return (
    <div className="page">
      <div className="page__header">
        <a className="link" href={homePath}>
          ← Library
        </a>
        <h1>{category || FALLBACK_CATEGORY}</h1>
        <p className="hint">
          {pluralize(categoryItems.length, 'item')}
          {filtered.length !== categoryItems.length ? ` · ${filtered.length} shown` : ''}
        </p>
      </div>

      <FilterBar
        groups={[
          {
            label: 'Subcategory',
            value: subcategory,
            options: subcategoryOptions(categoryItems).map((value) => ({ value, label: value })),
            onChange: setSubcategory,
          },
          {
            label: 'Colour',
            value: color,
            options: colorOptions(categoryItems).map((value) => ({ value, label: value })),
            onChange: setColor,
          },
          {
            label: 'Status',
            value: status,
            options: ITEM_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
            onChange: setStatus,
          },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState title="Nothing here" message="No items match the current filters." />
      ) : (
        <ItemGrid items={filtered} />
      )}

      {categoryItems.length > 0 ? (
        <div className="danger-zone">
          <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
            Delete category “{category || FALLBACK_CATEGORY}”
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={`Delete “${category || FALLBACK_CATEGORY}”?`}
        message={`${pluralize(
          categoryItems.length,
          'item',
        )} and their photos will be removed from this device. This cannot be undone — export a ZIP first if you are unsure.`}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
