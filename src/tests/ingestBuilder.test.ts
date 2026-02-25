import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { OtelTurbine } from '../core/OtelTurbine.ts';

const payload = JSON.stringify({
  resourceMetrics: [
    {
      resource: {},
      scopeMetrics: [
        {
          metrics: [
            {
              name: 'test_metric',
              gauge: { dataPoints: [{ timeUnixNano: '1700000000000000000', asDouble: 1 }] },
            },
          ],
        },
      ],
    },
  ],
});

describe('BuiltOtelTurbine.ingest', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('supports ingest(req).inject(...).push()', async () => {
    const turbine = new OtelTurbine()
      .remoteWrite('http://localhost:9090/api/v1/write')
      .build();

    const req = new Request('http://localhost/v1/metrics/a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });

    const result = await turbine.ingest(req).inject('*', { instance_name: 'a' }).push();
    expect(result.status).toBe(200);
  });

  it('returns 405 on non-POST in ingest session', async () => {
    const turbine = new OtelTurbine()
      .remoteWrite('http://localhost:9090/api/v1/write')
      .build();

    const req = new Request('http://localhost/v1/metrics/a', {
      method: 'GET',
    });

    const result = await turbine.ingest(req).inject('*', { instance_name: 'a' }).push();
    expect(result.status).toBe(405);
  });
});
