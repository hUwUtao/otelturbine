import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Pipeline } from '../core/Pipeline.ts';
import { compileSchemas } from '../transform/SchemaEngine.ts';

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
                  {
                    timeUnixNano: '1700000000000000000',
                    asDouble: 42.0,
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
});

const emptyOtlpPayload = JSON.stringify({
  resourceMetrics: [],
});

describe('Pipeline', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makePipeline(defaultAction: 'pass' | 'drop' = 'pass') {
    return new Pipeline(
      { url: 'http://localhost:9090/api/v1/write', timeout: 5000 },
      [],
      defaultAction
    );
  }

  it('returns 415 for application/x-protobuf content type', async () => {
    const pipeline = makePipeline();
    const result = await pipeline.process('', 'application/x-protobuf');
    expect(result.status).toBe(415);
  });

  it('returns 415 for unsupported content types', async () => {
    const pipeline = makePipeline();
    const result = await pipeline.process('', 'text/plain');
    expect(result.status).toBe(415);
  });

  it('returns 400 for invalid JSON', async () => {
    const pipeline = makePipeline();
    const result = await pipeline.process('not json at all {{{', 'application/json');
    expect(result.status).toBe(400);
  });

  it('returns 400 for valid JSON without resourceMetrics', async () => {
    const pipeline = makePipeline();
    const result = await pipeline.process('{"foo": "bar"}', 'application/json');
    expect(result.status).toBe(400);
  });

  it('returns 204 for empty resourceMetrics', async () => {
    const pipeline = makePipeline();
    const result = await pipeline.process(emptyOtlpPayload, 'application/json');
    expect(result.status).toBe(204);
  });

  it('returns 204 when all metrics are dropped', async () => {
    const pipeline = new Pipeline(
      { url: 'http://localhost:9090/api/v1/write', timeout: 5000 },
      [],
      'drop'
    );
    const result = await pipeline.process(validOtlpPayload, 'application/json');
    expect(result.status).toBe(204);
  });

  it('returns 200 on successful remote write', async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const pipeline = makePipeline();
    const result = await pipeline.process(validOtlpPayload, 'application/json');
    expect(result.status).toBe(200);
  });

  it('returns 502 when remote write fails with non-2xx', async () => {
    globalThis.fetch = mock(async () => new Response('Internal Server Error', { status: 500 })) as unknown as typeof fetch;
    const pipeline = makePipeline();
    const result = await pipeline.process(validOtlpPayload, 'application/json');
    expect(result.status).toBe(502);
    expect(result.message).toContain('500');
  });

  it('returns 502 when remote write throws (network error)', async () => {
    globalThis.fetch = mock(async () => { throw new Error('Connection refused'); }) as unknown as typeof fetch;
    const pipeline = makePipeline();
    const result = await pipeline.process(validOtlpPayload, 'application/json');
    expect(result.status).toBe(502);
    expect(result.message).toContain('Connection refused');
  });

  it('accepts content-type with charset parameter', async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const pipeline = makePipeline();
    const result = await pipeline.process(validOtlpPayload, 'application/json; charset=utf-8');
    expect(result.status).toBe(200);
  });

  it('applies schemas before sending', async () => {
    let capturedBody: Uint8Array | undefined;
    globalThis.fetch = mock(async (_: Request, init: RequestInit) => {
      capturedBody = init.body as Uint8Array;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const schemas = compileSchemas([{ name: 'test_metric' }]);
    const pipeline = new Pipeline(
      { url: 'http://localhost:9090/api/v1/write', timeout: 5000 },
      schemas,
      'drop'
    );
    const result = await pipeline.process(validOtlpPayload, 'application/json');
    expect(result.status).toBe(200);
    expect(capturedBody).toBeDefined();
  });
});
