import { describe, expect, it } from 'vitest';
import {
  applyPlan,
  buildExtraItems,
  markFailed,
  planFromDetections,
  statusForConfidence,
} from './analysis';
import type { DetectedItem } from '../types';
import { makeItem } from './testing/fixtures';

const detection = (overrides: Partial<DetectedItem> = {}): DetectedItem => ({
  category: 'Clothing',
  subcategory: 'Shirts',
  description: 'A blue shirt',
  confidence: 0.9,
  ...overrides,
});

describe('statusForConfidence', () => {
  it('accepts results at or above the threshold', () => {
    expect(statusForConfidence(0.7, 0.7)).toBe('done');
    expect(statusForConfidence(0.95, 0.7)).toBe('done');
  });

  it('flags results below the threshold for review', () => {
    expect(statusForConfidence(0.69, 0.7)).toBe('needs_review');
  });
});

describe('planFromDetections', () => {
  it('sorts by confidence and keeps the highest first', () => {
    const plans = planFromDetections(
      [detection({ description: 'low', confidence: 0.2 }), detection({ description: 'high', confidence: 0.99 })],
      0.7,
    );
    expect(plans.map((plan) => plan.description)).toEqual(['high', 'low']);
    expect(plans.map((plan) => plan.status)).toEqual(['done', 'needs_review']);
  });

  it('copies colour and material into attributes', () => {
    const [plan] = planFromDetections([detection({ color: 'Blue', material: 'Cotton' })], 0.5);
    expect(plan.attributes).toEqual({ color: 'Blue', material: 'Cotton' });
  });

  it('omits empty attributes instead of storing empty strings', () => {
    const [plan] = planFromDetections([detection({ color: '', material: undefined })], 0.5);
    expect(plan.attributes).toEqual({});
  });

  it('caps the number of items taken from one photo', () => {
    const many = Array.from({ length: 30 }, (_value, index) =>
      detection({ description: `item ${index}` }),
    );
    expect(planFromDetections(many, 0.5)).toHaveLength(12);
  });
});

describe('applyPlan', () => {
  it('merges the detection into the item and clears stale errors', () => {
    const item = makeItem({ status: 'analyzing', error: 'old failure', confidence: 0 });
    const updated = applyPlan(item, {
      category: 'Toys',
      subcategory: 'Cars',
      attributes: { color: 'Red' },
      description: 'A red toy car',
      confidence: 0.4,
      status: 'needs_review',
    });
    expect(updated.category).toBe('Toys');
    expect(updated.attributes).toEqual({ color: 'Red', material: 'Cotton' });
    expect(updated.description).toBe('A red toy car');
    expect(updated.status).toBe('needs_review');
    expect(updated.error).toBeUndefined();
  });
});

describe('buildExtraItems', () => {
  it('creates sibling items that share the photo blobs', () => {
    const source = makeItem({ id: 'primary' });
    let counter = 0;
    const extras = buildExtraItems(
      source,
      [
        {
          category: 'Toys',
          subcategory: 'Cars',
          attributes: {},
          description: 'A toy car',
          confidence: 0.8,
          status: 'done',
        },
      ],
      () => `generated-${(counter += 1)}`,
      42,
    );

    expect(extras).toHaveLength(1);
    const [extra] = extras;
    expect(extra.id).toBe('generated-1');
    expect(extra.photoBlobId).toBe(source.photoBlobId);
    expect(extra.thumbnailBlobId).toBe(source.thumbnailBlobId);
    expect(extra.createdAt).toBe(42);
    expect(extra.updatedAt).toBe(42);
    expect(extra.syncedToNas).toBe(false);
    expect(extra.mimeType).toBe('image/jpeg');
  });
});

describe('markFailed', () => {
  it('records the failure reason and status', () => {
    const failed = markFailed(makeItem({ status: 'analyzing' }), 'Rate limited');
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Rate limited');
  });
});
