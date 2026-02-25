import { describe, it, expect } from 'bun:test';
import {
  createCompatHandler,
  createIngestSession,
  type CompatRequestLike,
} from '../core/Compat.ts';
import {
  applyRequestLabelInjections,
  type LabelInjectionRule,
} from '../core/Pipeline.ts';
import type { TimeSeries } from '../types/prometheus.ts';

function makeSeries(name: string, labels: Record<string, string> = {}): TimeSeries {
  return {
    labels: [
      { name: '__name__', value: name },
      ...Object.entries(labels).map(([k, v]) => ({ name: k, value: v })),
    ].sort((a, b) => a.name.localeCompare(b.name)),
    samples: [{ value: 1, timestamp: 1n }],
  };
}

describe('compat handler', () => {
  it('passes per-request injection rules to pipeline.process', async () => {
    const calls: Array<{ body: string | Uint8Array; contentType: string; injectCount: number }> = [];
    const fakePipeline = {
      process: async (
        body: string | Uint8Array,
        contentType: string,
        options?: { injectLabels?: LabelInjectionRule[] }
      ) => {
        calls.push({
          body,
          contentType,
          injectCount: options?.injectLabels?.length ?? 0,
        });
        return { status: 200, message: 'OK' };
      },
    };

    const otelTurbine = createCompatHandler(fakePipeline as never);
    const req: CompatRequestLike = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"resourceMetrics":[]}',
    };

    const result = await otelTurbine(req)
      .inject('*', { instance_name: 'worker-a' })
      .push();

    expect(result.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.injectCount).toBe(1);
    expect(calls[0]!.contentType).toBe('application/json');
  });

  it('keeps request ownership isolated between calls', async () => {
    const injectCounts: number[] = [];
    const fakePipeline = {
      process: async (
        _body: string | Uint8Array,
        _contentType: string,
        options?: { injectLabels?: LabelInjectionRule[] }
      ) => {
        injectCounts.push(options?.injectLabels?.length ?? 0);
        return { status: 200, message: 'OK' };
      },
    };

    const otelTurbine = createCompatHandler(fakePipeline as never);
    const req: CompatRequestLike = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"resourceMetrics":[]}',
    };

    await otelTurbine(req).inject('*', { instance_name: 'one' }).push();
    await otelTurbine(req).push();

    expect(injectCounts).toEqual([1, 0]);
  });

  it('returns 405 for non-POST methods', async () => {
    const fakePipeline = {
      process: async () => ({ status: 200, message: 'OK' }),
    };
    const otelTurbine = createCompatHandler(fakePipeline as never);
    const result = await otelTurbine({
      method: 'GET',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).push();
    expect(result.status).toBe(405);
  });

  it('supports ingest(body).inject(...).push() chain', async () => {
    const calls: number[] = [];
    const fakePipeline = {
      process: async (
        _body: string | Uint8Array,
        _contentType: string,
        options?: { injectLabels?: LabelInjectionRule[] }
      ) => {
        calls.push(options?.injectLabels?.length ?? 0);
        return { status: 200, message: 'OK' };
      },
    };

    const sessionA = createIngestSession(fakePipeline as never, '{"resourceMetrics":[]}', {
      contentType: 'application/json',
    });
    const sessionB = createIngestSession(fakePipeline as never, '{"resourceMetrics":[]}', {
      contentType: 'application/json',
    });

    await sessionA.inject({ instance_name: 'a' }).push();
    await sessionB.push();

    expect(calls).toEqual([1, 0]);
  });
});

describe('applyRequestLabelInjections', () => {
  it('injects labels for wildcard selector', () => {
    const out = applyRequestLabelInjections(
      [makeSeries('cpu_usage', { host: 'a' })],
      [{ selector: '*', labels: { instance_name: 'node-1' } }]
    );
    expect(out[0]!.labels.find((l) => l.name === 'instance_name')?.value).toBe('node-1');
  });

  it('supports exact and regex selectors', () => {
    const out = applyRequestLabelInjections(
      [
        makeSeries('http_requests_total'),
        makeSeries('db_connections'),
      ],
      [
        { selector: 'db_connections', labels: { domain: 'db' } },
        { selector: /^http_/, labels: { domain: 'http' } },
      ]
    );
    expect(out[0]!.labels.find((l) => l.name === 'domain')?.value).toBe('http');
    expect(out[1]!.labels.find((l) => l.name === 'domain')?.value).toBe('db');
  });
});
