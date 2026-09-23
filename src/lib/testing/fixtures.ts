import type { Item } from '../../types';

/** Builds an Item with sensible defaults so tests only state what matters. */
export function makeItem(overrides: Partial<Item> = {}): Item {
  const id = overrides.id ?? 'item-1';
  return {
    id,
    photoBlobId: `${id}:photo`,
    thumbnailBlobId: `${id}:thumb`,
    category: 'Clothing',
    subcategory: 'Shirts',
    attributes: { color: 'Blue', material: 'Cotton' },
    description: 'Blue cotton shirt',
    confidence: 0.9,
    status: 'done',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    syncedToNas: false,
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    ...overrides,
  };
}
