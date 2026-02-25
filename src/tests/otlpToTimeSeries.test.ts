import { describe, it, expect } from 'bun:test';
import { otlpToTimeSeries } from '../transform/otlpToTimeSeries.ts';
import type { OtlpMetricsPayload } from '../types/otlp.ts';

const basePayload = (metrics: OtlpMetricsPayload['resourceMetrics'][0]['scopeMetrics'][0]['metrics']): OtlpMetricsPayload => ({
  resourceMetrics: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test-svc' } }] },
      scopeMetrics: [{ metrics }],
    },
  ],
});

describe('otlpToTimeSeries', () => {
  describe('gauge', () => {
    it('converts a gauge to a single TimeSeries', () => {
      const payload = basePayload([
        {
          name: 'cpu_usage',
          gauge: {
            dataPoints: [
              {
                attributes: [{ key: 'host', value: { stringValue: 'server1' } }],
                timeUnixNano: '1700000000000000000',
                asDouble: 0.75,
              },
            ],
          },
        },
      ]);

      const series = otlpToTimeSeries(payload);
      expect(series).toHaveLength(1);
      const ts = series[0]!;
      expect(ts.labels.find(l => l.name === '__name__')?.value).toBe('cpu_usage');
      expect(ts.labels.find(l => l.name === 'host')?.value).toBe('server1');
      expect(ts.labels.find(l => l.name === 'service.name')?.value).toBe('test-svc');
      expect(ts.samples[0]?.value).toBe(0.75);
      expect(ts.samples[0]?.timestamp).toBe(1700000000000n);
    });

    it('labels are sorted alphabetically', () => {
      const payload = basePayload([
        {
          name: 'mem_usage',
          gauge: {
            dataPoints: [
              {
                attributes: [
                  { key: 'zone', value: { stringValue: 'us-east' } },
                  { key: 'app', value: { stringValue: 'api' } },
                ],
                timeUnixNano: '1000000000000000000',
                asDouble: 512.0,
              },
            ],
          },
        },
      ]);

      const series = otlpToTimeSeries(payload);
      const names = series[0]!.labels.map(l => l.name);
      expect(names).toEqual([...names].sort());
    });

    it('dp attributes win over resource attributes on conflict', () => {
      const payload: OtlpMetricsPayload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [{ key: 'env', value: { stringValue: 'resource-env' } }],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'test',
                    gauge: {
                      dataPoints: [
                        {
                          attributes: [{ key: 'env', value: { stringValue: 'dp-env' } }],
                          timeUnixNano: '1000000000000000000',
                          asDouble: 1.0,
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const series = otlpToTimeSeries(payload);
      expect(series[0]!.labels.find(l => l.name === 'env')?.value).toBe('dp-env');
    });
  });

  describe('sum', () => {
    it('converts a sum to a single TimeSeries', () => {
      const payload = basePayload([
        {
          name: 'requests_total',
          sum: {
            dataPoints: [
              {
                timeUnixNano: '1700000000000000000',
                asInt: '100',
              },
            ],
            isMonotonic: true,
          },
        },
      ]);

      const series = otlpToTimeSeries(payload);
      expect(series).toHaveLength(1);
      expect(series[0]!.labels.find(l => l.name === '__name__')?.value).toBe('requests_total');
      expect(series[0]!.samples[0]?.value).toBe(100);
    });
  });

  describe('histogram', () => {
    it('converts a histogram to bucket + count + sum series', () => {
      const payload = basePayload([
        {
          name: 'latency',
          histogram: {
            dataPoints: [
              {
                timeUnixNano: '1700000000000000000',
                count: '10',
                sum: 500.0,
                explicitBounds: [10, 50, 100],
                bucketCounts: ['2', '3', '4', '1'],
              },
            ],
          },
        },
      ]);

      const series = otlpToTimeSeries(payload);
      // 4 buckets (3 bounds + +Inf) + _count + _sum = 6
      expect(series).toHaveLength(6);

      const buckets = series.filter(ts =>
        ts.labels.find(l => l.name === '__name__')?.value === 'latency_bucket'
      );
      expect(buckets).toHaveLength(4);

      // Check le labels
      const leValues = buckets.map(ts => ts.labels.find(l => l.name === 'le')?.value);
      expect(leValues).toContain('10');
      expect(leValues).toContain('50');
      expect(leValues).toContain('100');
      expect(leValues).toContain('+Inf');

      // Check cumulative counts
      const sortedBuckets = [...buckets].sort((a, b) => {
        const aLe = a.labels.find(l => l.name === 'le')?.value ?? '';
        const bLe = b.labels.find(l => l.name === 'le')?.value ?? '';
        if (aLe === '+Inf') return 1;
        if (bLe === '+Inf') return -1;
        return Number(aLe) - Number(bLe);
      });
      expect(sortedBuckets[0]!.samples[0]?.value).toBe(2);  // le=10: 2
      expect(sortedBuckets[1]!.samples[0]?.value).toBe(5);  // le=50: 2+3=5
      expect(sortedBuckets[2]!.samples[0]?.value).toBe(9);  // le=100: 2+3+4=9
      expect(sortedBuckets[3]!.samples[0]?.value).toBe(10); // le=+Inf: 2+3+4+1=10

      // Check _count and _sum
      const countSeries = series.find(ts =>
        ts.labels.find(l => l.name === '__name__')?.value === 'latency_count'
      );
      expect(countSeries?.samples[0]?.value).toBe(10);

      const sumSeries = series.find(ts =>
        ts.labels.find(l => l.name === '__name__')?.value === 'latency_sum'
      );
      expect(sumSeries?.samples[0]?.value).toBe(500.0);
    });
  });
});
