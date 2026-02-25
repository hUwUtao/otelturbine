import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { bunHandler, bunRouteHandler } from '../adapters/bun.ts';
import { Pipeline } from '../core/Pipeline.ts';

const validOtlpPayload = JSON.stringify({
  resourceMetrics: [
    {
      resource: {},
      scopeMetrics: [
        {
          metrics: [
            {
              name: 'test_metric',
              gauge: {
                dataPoints: [
                  { timeUnixNano: '1700000000000000000', asDouble: 1.0 },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
});

describe('bunHandler', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makePipeline() {
    return new Pipeline(
      { url: 'http://localhost:9090/api/v1/write', timeout: 5000 },
      [],
      'pass'
    );
  }

  it('returns 404 for wrong path', async () => {
    const handler = bunHandler(makePipeline(), '/v1/metrics');
    const req = new Request('http://localhost/wrong/path', {
      method: 'POST',
      body: validOtlpPayload,
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });

  it('returns 405 for GET request', async () => {
    const handler = bunHandler(makePipeline(), '/v1/metrics');
    const req = new Request('http://localhost/v1/metrics', { method: 'GET' });
    const res = await handler(req);
    expect(res.status).toBe(405);
  });

  it('returns 405 for PUT request', async () => {
    const handler = bunHandler(makePipeline(), '/v1/metrics');
    const req = new Request('http://localhost/v1/metrics', { method: 'PUT', body: '' });
    const res = await handler(req);
    expect(res.status).toBe(405);
  });

  it('processes valid POST request', async () => {
    const handler = bunHandler(makePipeline(), '/v1/metrics');
    const req = new Request('http://localhost/v1/metrics', {
      method: 'POST',
      body: validOtlpPayload,
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await handler(req);
    expect(res.status).toBe(204);
  });

  it('returns 405 with Allow header', async () => {
    const handler = bunHandler(makePipeline(), '/v1/metrics');
    const req = new Request('http://localhost/v1/metrics', { method: 'GET' });
    const res = await handler(req);
    expect(res.headers.get('Allow')).toBe('POST');
  });
});

describe('bunRouteHandler', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('processes valid POST request', async () => {
    const pipeline = new Pipeline(
      { url: 'http://localhost:9090/api/v1/write', timeout: 5000 },
      [],
      'pass'
    );
    const handler = bunRouteHandler(pipeline);
    const req = new Request('http://localhost/v1/metrics', {
      method: 'POST',
      body: validOtlpPayload,
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await handler(req);
    expect(res.status).toBe(204);
  });

  it('returns 400 for bad JSON', async () => {
    const pipeline = new Pipeline(
      { url: 'http://localhost:9090/api/v1/write', timeout: 5000 },
      [],
      'pass'
    );
    const handler = bunRouteHandler(pipeline);
    const req = new Request('http://localhost/v1/metrics', {
      method: 'POST',
      body: 'bad json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });
});
