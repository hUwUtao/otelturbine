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

describe('routeMacro', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns route descriptor and working handler', async () => {
    const turbine = new OtelTurbine()
      .remoteWrite('http://localhost:9090/api/v1/write')
      .build();

    const macro = turbine.routeMacro('/v1/metrics/:name');
    expect(macro.method).toBe('POST');
    expect(macro.path).toBe('/v1/metrics/:name');

    const res = await macro.handler(new Request('http://localhost/v1/metrics/a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    }));
    expect(res.status).toBe(204);
  });
});
