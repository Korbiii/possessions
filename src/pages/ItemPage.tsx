import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FullImage, StatusBadge } from '../components/Thumbnail';
import { EmptyState } from '../components/Toasts';
import { categoryOptions } from '../lib/categories';
import { CATEGORY_SUGGESTIONS, FALLBACK_CATEGORY } from '../lib/constants';
import { formatConfidence, formatDateTime, formatRelativeTime } from '../lib/format';
import { categoryPath, homePath } from '../lib/routes';
import { ITEM_STATUSES, STATUS_LABELS, type Item, type ItemStatus } from '../types';
import { useApp } from '../state/AppState';

interface ItemForm {
  category: string;
  subcategory: string;
  color: string;
  material: string;
  size: string;
  brand: string;
  description: string;
  status: ItemStatus;
}

function toForm(item: Item | undefined): ItemForm {
  return {
    category: item?.category ?? '',
    subcategory: item?.subcategory ?? '',
    color: item?.attributes.color ?? '',
    material: item?.attributes.material ?? '',
    size: item?.attributes.size ?? '',
    brand: item?.attributes.brand ?? '',
    description: item?.description ?? '',
    status: item?.status ?? 'queued',
  };
}

/** Detail view: full photo, editable attributes, delete (plan section 8). */
export function ItemPage({ id }: { id: string }): ReactNode {
  const { items, updateItem, removeItem, retryItem, notify } = useApp();
  const item = items.find((entry) => entry.id === id);
  const [form, setForm] = useState<ItemForm>(() => toForm(item));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const itemKey = `${item?.id ?? ''}:${item?.status ?? ''}:${item?.updatedAt ?? 0}`;

  // Re-sync the form when the record changes underneath us (e.g. the analysis
  // worker finishes while this page is open) but keep local edits otherwise.
  useEffect(() => {
    setForm(toForm(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  const categories = useMemo(
    () =>
      [...new Set([...categoryOptions(items), ...CATEGORY_SUGGESTIONS])].sort((a, b) =>
        a.localeCompare(b),
      ),
    [items],
  );

  if (!item) {
    return (
      <div className="page">
        <EmptyState title="Item not found" message="It may have been deleted.">
          <a className="btn" href={homePath}>
            Back to the library
          </a>
        </EmptyState>
      </div>
    );
  }

  const update = (patch: Partial<ItemForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = async (patch: Partial<ItemForm> = {}) => {
    const next = { ...form, ...patch };
    setSaving(true);
    try {
      await updateItem(item.id, {
        category: next.category.trim(),
        subcategory: next.subcategory.trim(),
        description: next.description.trim(),
        status: next.status,
        attributes: {
          ...(next.color.trim() ? { color: next.color.trim() } : {}),
          ...(next.material.trim() ? { material: next.material.trim() } : {}),
          ...(next.size.trim() ? { size: next.size.trim() } : {}),
          ...(next.brand.trim() ? { brand: next.brand.trim() } : {}),
        },
        // A manual edit invalidates the previous NAS copy.
        syncedToNas: false,
      });
      setForm(next);
      notify('success', 'Item saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setConfirming(false);
    await removeItem(item.id);
    notify('success', 'Item deleted.');
    window.location.hash = homePath;
  };

  const categoryHref = categoryPath(item.category || FALLBACK_CATEGORY);

  return (
    <div className="page">
      <div className="page__header">
        <a className="link" href={categoryHref}>
          ← {item.category || FALLBACK_CATEGORY}
        </a>
        <h1>{item.description || 'Untitled item'}</h1>
        <p className="hint">
          <StatusBadge status={item.status} /> · confidence {formatConfidence(item.confidence)} ·
          added {formatRelativeTime(item.createdAt)}
          {item.syncedToNas ? ' · on NAS' : ''}
        </p>
      </div>

      <FullImage blobId={item.photoBlobId} alt={item.description || 'Item photo'} />

      {item.error ? <p className="error-box">{item.error}</p> : null}

      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Category
          <input
            list="category-options"
            value={form.category}
            onChange={(event) => update({ category: event.target.value })}
            placeholder={FALLBACK_CATEGORY}
          />
        </label>
        <datalist id="category-options">
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>

        <label>
          Subcategory
          <input
            value={form.subcategory}
            onChange={(event) => update({ subcategory: event.target.value })}
          />
        </label>

        <div className="form__row">
          <label>
            Colour
            <input value={form.color} onChange={(event) => update({ color: event.target.value })} />
          </label>
          <label>
            Material
            <input
              value={form.material}
              onChange={(event) => update({ material: event.target.value })}
            />
          </label>
        </div>

        <div className="form__row">
          <label>
            Size
            <input value={form.size} onChange={(event) => update({ size: event.target.value })} />
          </label>
          <label>
            Brand
            <input value={form.brand} onChange={(event) => update({ brand: event.target.value })} />
          </label>
        </div>

        <label>
          Description
          <textarea
            rows={3}
            value={form.description}
            onChange={(event) => update({ description: event.target.value })}
          />
        </label>

        <label>
          Status
          <select
            value={form.status}
            onChange={(event) => update({ status: event.target.value as ItemStatus })}
          >
            {ITEM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <p className="hint">
          Created {formatDateTime(item.createdAt)} · updated {formatDateTime(item.updatedAt)}
        </p>

        <div className="toolbar">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : '💾 Save'}
          </button>
          {item.status !== 'done' ? (
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => void save({ status: 'done' })}
            >
              ✔ Confirm
            </button>
          ) : null}
          <button type="button" className="btn" disabled={saving} onClick={() => void retryItem(item.id)}>
            🔄 Re-analyze
          </button>
          <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
            🗑 Delete
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        title="Delete this item?"
        message="The item and its photo will be removed from this device. This cannot be undone."
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
