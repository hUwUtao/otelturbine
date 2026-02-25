import { describe, it, expect } from 'bun:test';
import { compileSchemas, applySchemas } from '../transform/SchemaEngine.ts';
import type { TimeSeries } from '../types/prometheus.ts';
import type { MetricSchema } from '../types/schema.ts';

function makeSeries(name: string, labels: Record<string, string> = {}): TimeSeries {
  const allLabels = [
    { name: '__name__', value: name },
    ...Object.entries(labels).map(([k, v]) => ({ name: k, value: v })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return {
    labels: allLabels,
    samples: [{ value: 1.0, timestamp: 1000n }],
  };
}

describe('SchemaEngine', () => {
  describe('name matching', () => {
    it('matches exact string name', () => {
      const schemas = compileSchemas([{ name: 'cpu_usage' }]);
      const series = [makeSeries('cpu_usage'), makeSeries('mem_usage')];
      const result = applySchemas(series, schemas, 'drop');
      expect(result).toHaveLength(1);
      expect(result[0]!.labels.find(l => l.name === '__name__')?.value).toBe('cpu_usage');
    });

    it('matches regexp name', () => {
      const schemas = compileSchemas([{ name: /^http_/ }]);
      const series = [
        makeSeries('http_requests_total'),
        makeSeries('http_errors_total'),
        makeSeries('grpc_requests_total'),
      ];
      const result = applySchemas(series, schemas, 'drop');
      expect(result).toHaveLength(2);
    });

    it('first matching schema wins', () => {
      const schemas: MetricSchema[] = [
        { name: /^http_/, inject: { matched: 'first' } },
        { name: /^http_requests/, inject: { matched: 'second' } },
      ];
      const compiled = compileSchemas(schemas);
      const series = [makeSeries('http_requests_total', { method: 'GET' })];
      const result = applySchemas(series, compiled, 'drop');
      expect(result[0]!.labels.find(l => l.name === 'matched')?.value).toBe('first');
    });
  });

  describe('defaultAction', () => {
    it('passes through unmatched metrics when defaultAction=pass', () => {
      const schemas = compileSchemas([{ name: 'cpu_usage' }]);
      const series = [makeSeries('mem_usage')];
      const result = applySchemas(series, schemas, 'pass');
      expect(result).toHaveLength(1);
    });

    it('drops unmatched metrics when defaultAction=drop', () => {
      const schemas = compileSchemas([{ name: 'cpu_usage' }]);
      const series = [makeSeries('mem_usage')];
      const result = applySchemas(series, schemas, 'drop');
      expect(result).toHaveLength(0);
    });
  });

  describe('explicit label matching', () => {
    it('keeps series when explicit label matches', () => {
      const schemas = compileSchemas([
        { name: 'http_req', labels: { method: /^GET$/ } },
      ]);
      const series = [makeSeries('http_req', { method: 'GET', status: '200' })];
      const result = applySchemas(series, schemas, 'drop');
      expect(result).toHaveLength(1);
    });

    it('drops series when explicit label value does not match', () => {
      const schemas = compileSchemas([
        { name: 'http_req', labels: { method: /^GET$/ } },
      ]);
      const series = [makeSeries('http_req', { method: 'POST' })];
      const result = applySchemas(series, schemas, 'drop');
      expect(result).toHaveLength(0);
    });

    it('drops series when required explicit label is missing', () => {
      const schemas = compileSchemas([
        { name: 'http_req', labels: { method: /^GET$/ } },
      ]);
      const series = [makeSeries('http_req', { status: '200' })];
      const result = applySchemas(series, schemas, 'drop');
      expect(result).toHaveLength(0);
    });

    it('drops unlisted labels when no wildcard', () => {
      const schemas = compileSchemas([
        { name: 'http_req', labels: { method: /^GET$/ } },
      ]);
      const series = [makeSeries('http_req', { method: 'GET', status: '200', extra: 'val' })];
      const result = applySchemas(series, schemas, 'drop');
      expect(result).toHaveLength(1);
      const labelNames = result[0]!.labels.map(l => l.name);
      expect(labelNames).toContain('__name__');
      expect(labelNames).toContain('method');
      expect(labelNames).not.toContain('status');
      expect(labelNames).not.toContain('extra');
    });
  });

  describe('wildcard label matching', () => {
    it('keeps unlisted labels when wildcard matches', () => {
      const schemas = compileSchemas([
        {
          name: 'http_req',
          labels: {
            method: /^GET$/,
            '*': /.*/,
          },
        },
      ]);
      const series = [makeSeries('http_req', { method: 'GET', status: '200', host: 'api.example.com' })];
      const result = applySchemas(series, schemas, 'drop');
      expect(result).toHaveLength(1);
      const labelNames = result[0]!.labels.map(l => l.name);
      expect(labelNames).toContain('status');
      expect(labelNames).toContain('host');
    });

    it('drops unlisted labels when wildcard value does not match', () => {
      // Wildcard matches label VALUES, not names
      // labels: { a: 'allowed_val', b: 'blocked_val' }
      // wildcard /^allowed_/ → keep 'a' (value matches), drop 'b' (value doesn't)
      const schemas = compileSchemas([
        {
          name: 'http_req',
          labels: {
            '*': /^allowed_/,
          },
        },
      ]);
      const series = [makeSeries('http_req', { a: 'allowed_val', b: 'blocked_val' })];
      const result = applySchemas(series, schemas, 'drop');
      const labelNames = result[0]!.labels.map(l => l.name);
      expect(labelNames).toContain('a');
      expect(labelNames).not.toContain('b');
    });
  });

  describe('inject', () => {
    it('adds new labels via inject', () => {
      const schemas = compileSchemas([
        { name: 'test_metric', inject: { env: 'prod', region: 'us-east' } },
      ]);
      const series = [makeSeries('test_metric')];
      const result = applySchemas(series, schemas, 'drop');
      expect(result[0]!.labels.find(l => l.name === 'env')?.value).toBe('prod');
      expect(result[0]!.labels.find(l => l.name === 'region')?.value).toBe('us-east');
    });

    it('overrides existing labels via inject', () => {
      const schemas = compileSchemas([
        {
          name: 'test_metric',
          labels: { env: /.*/ },
          inject: { env: 'overridden' },
        },
      ]);
      const series = [makeSeries('test_metric', { env: 'original' })];
      const result = applySchemas(series, schemas, 'drop');
      expect(result[0]!.labels.find(l => l.name === 'env')?.value).toBe('overridden');
    });

    it('inject does not cause series drop', () => {
      const schemas = compileSchemas([
        { name: 'test_metric', inject: { always: 'here' } },
      ]);
      const series = [makeSeries('test_metric')];
      const result = applySchemas(series, schemas, 'drop');
      expect(result).toHaveLength(1);
    });
  });

  describe('maxLabels', () => {
    it('caps total labels excluding __name__', () => {
      const schemas = compileSchemas([
        {
          name: 'test_metric',
          labels: { '*': /.*/ },
          maxLabels: 2,
        },
      ]);
      const series = [makeSeries('test_metric', { a: '1', b: '2', c: '3', d: '4' })];
      const result = applySchemas(series, schemas, 'drop');
      const labelNames = result[0]!.labels.map(l => l.name).filter(n => n !== '__name__');
      expect(labelNames).toHaveLength(2);
    });

    it('always preserves __name__', () => {
      const schemas = compileSchemas([
        {
          name: 'test_metric',
          labels: { '*': /.*/ },
          maxLabels: 1,
        },
      ]);
      const series = [makeSeries('test_metric', { a: '1', b: '2', c: '3' })];
      const result = applySchemas(series, schemas, 'drop');
      expect(result[0]!.labels.find(l => l.name === '__name__')).toBeDefined();
    });
  });

  describe('output sorted', () => {
    it('output labels are sorted alphabetically', () => {
      const schemas = compileSchemas([
        { name: 'test_metric', labels: { '*': /.*/ } },
      ]);
      const series = [makeSeries('test_metric', { z: '1', a: '2', m: '3' })];
      const result = applySchemas(series, schemas, 'drop');
      const names = result[0]!.labels.map(l => l.name);
      expect(names).toEqual([...names].sort());
    });
  });
});
