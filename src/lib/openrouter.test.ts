import { describe, expect, it, vi } from 'vitest';
import {
  analyzePhoto,
  checkApiKey,
  describeOpenRouterError,
  normalizeDetectedItem,
  parseClassificationResponse,
  parseJsonLoosely,
} from './openrouter';

const body = (content: unknown) => ({
  choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
});

describe('parseClassificationResponse', () => {
  it('reads the items_detected array from the message content', () => {
    const items = parseClassificationResponse(
      body({
        items_detected: [
          { category: 'Toys', subcategory: 'Cars', description: 'Toy car', confidence: 0.8 },
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('Toys');
  });

  it('prefers the parsed field when the provider returns structured output', () => {
    const items = parseClassificationResponse({
      choices: [
        {
          message: {
            parsed: {
              items_detected: [
                { category: 'Books', subcategory: '', description: 'Novel', confidence: 0.5 },
              ],
            },
          },
        },
      ],
    });
    expect(items[0].description).toBe('Novel');
  });

  it('accepts a bare object with items_detected', () => {
    const items = parseClassificationResponse({
      items_detected: [{ category: '', subcategory: '', description: 'Thing', confidence: 2 }],
    });
    expect(items[0].category).toBe('Uncategorized');
    expect(items[0].confidence).toBe(1);
  });

  it('throws when the payload is unusable', () => {
    expect(() => parseClassificationResponse({ choices: [] })).toThrow(/no item data/);
    expect(() => parseClassificationResponse({ choices: [{ message: { content: 'hi' } }] })).toThrow();
  });
});

describe('normalizeDetectedItem', () => {
  it('falls back to the fallback category and clamps confidence', () => {
    const item = normalizeDetectedItem({ description: 'Something', confidence: -3 });
    expect(item?.category).toBe('Uncategorized');
    expect(item?.confidence).toBe(0);
  });

  it('drops entries without any useful content', () => {
    expect(normalizeDetectedItem({ confidence: 0.5 })).toBeNull();
    expect(normalizeDetectedItem('nope')).toBeNull();
  });
});

describe('parseJsonLoosely', () => {
  it('strips markdown fences', () => {
    expect(parseJsonLoosely('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts the object from surrounding prose', () => {
    expect(parseJsonLoosely('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
  });
});

describe('describeOpenRouterError', () => {
  it('explains common status codes', () => {
    expect(describeOpenRouterError(401, null)).toMatch(/API key/);
    expect(describeOpenRouterError(402, null)).toMatch(/credits/);
    expect(describeOpenRouterError(429, null)).toMatch(/rate limit/i);
  });

  it('passes provider messages through for other codes', () => {
    expect(describeOpenRouterError(500, { error: { message: 'boom' } })).toBe('boom');
  });
});

describe('analyzePhoto', () => {
  it('sends a structured-output request and parses the reply', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify(
          body({
            items_detected: [
              { category: 'Kitchen', subcategory: 'Mug', description: 'White mug', confidence: 0.9 },
            ],
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const items = await analyzePhoto({
      apiKey: 'sk-test',
      model: 'google/gemini-2.5-flash-lite',
      dataUrl: 'data:image/jpeg;base64,AAAA',
      fetchImpl,
    });

    expect(items[0].category).toBe('Kitchen');
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('openrouter.ai');
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.response_format.json_schema.strict).toBe(true);
    expect(payload.provider.require_parameters).toBe(true);
    expect(payload.messages[0].content[1].image_url.url).toContain('base64');
  });

  it('surfaces a readable error for a failed request', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 401 }),
    ) as unknown as typeof fetch;

    await expect(
      analyzePhoto({ apiKey: 'bad', model: 'm', dataUrl: 'data:', fetchImpl }),
    ).rejects.toThrow(/API key/);
  });
});

describe('checkApiKey', () => {
  it('reports success with usage information', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { label: 'my-key', usage: 0.5, limit: 10 } }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    const result = await checkApiKey('sk-test', fetchImpl);
    expect(result.valid).toBe(true);
    expect(result.message).toContain('my-key');
  });

  it('rejects an empty key without calling the network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await checkApiKey('  ', fetchImpl);
    expect(result.valid).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
