import { bench, group, run } from 'mitata';
import { encodeVarint } from './src/util/varint.ts';
import { encodeWriteRequest } from './src/proto/writeRequest.ts';
import { snappyCompress } from './src/compress/snappy.ts';
import { otlpToTimeSeries } from './src/transform/otlpToTimeSeries.ts';
import { compileSchemas, applySchemas } from './src/transform/SchemaEngine.ts';
import { Pipeline } from './src/core/Pipeline.ts';
import type { OtlpMetricsPayload } from './src/types/otlp.ts';
import type { TimeSeries } from './src/types/prometheus.ts';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeGaugePayload(metricCount: number, dpPerMetric: number): OtlpMetricsPayload {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'bench-svc' } }] },
        scopeMetrics: [
          {
            metrics: Array.from({ length: metricCount }, (_, mi) => ({
              name: `metric_${mi}`,
              gauge: {
                dataPoints: Array.from({ length: dpPerMetric }, (_, di) => ({
                  attributes: [
                    { key: 'host', value: { stringValue: `host-${di}` } },
                    { key: 'region', value: { stringValue: 'us-east-1' } },
                    { key: 'env', value: { stringValue: 'prod' } },
                  ],
                  timeUnixNano: '1700000000000000000',
                  asDouble: Math.random() * 100,
                })),
              },
            })),
          },
        ],
      },
    ],
  };
}

function makeHistogramPayload(metricCount: number): OtlpMetricsPayload {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'bench-svc' } }] },
        scopeMetrics: [
          {
            metrics: Array.from({ length: metricCount }, (_, mi) => ({
              name: `latency_${mi}`,
              histogram: {
                dataPoints: [
                  {
                    attributes: [{ key: 'method', value: { stringValue: 'GET' } }],
                    timeUnixNano: '1700000000000000000',
                    count: '1000',
                    sum: 12345.6,
                    explicitBounds: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
                    bucketCounts: ['10', '50', '100', '200', '250', '150', '100', '80', '50', '10'],
                  },
                ],
              },
            })),
          },
        ],
      },
    ],
  };
}

const smallPayload = makeGaugePayload(1, 1);
const medPayload = makeGaugePayload(10, 5);     // 50 series
const largePayload = makeGaugePayload(50, 10);  // 500 series
const histPayload = makeHistogramPayload(10);   // 10 histograms → 120 series

const smallJson = JSON.stringify(smallPayload);
const medJson = JSON.stringify(medPayload);
const largeJson = JSON.stringify(largePayload);
const histJson = JSON.stringify(histPayload);

// Pre-converted series for downstream benchmarks
const medSeries = otlpToTimeSeries(medPayload);
const largeSeries = otlpToTimeSeries(largePayload);

// Pre-encoded proto for compression benchmarks
const medProto = encodeWriteRequest({ timeseries: medSeries });
const largeProto = encodeWriteRequest({ timeseries: largeSeries });

// Compiled schemas
const passAllSchemas = compileSchemas([{ name: /.*/, labels: { '*': /.*/ } }]);
const filterSchemas = compileSchemas([
  {
    name: /^metric_/,
    labels: { host: /.*/, region: /^us-east-1$/, '*': /.*/ },
    inject: { cluster: 'prod-k8s' },
    maxLabels: 8,
  },
]);

// Pipeline with mocked fetch
const nopFetch = () => Promise.resolve(new Response(null, { status: 204 }));
globalThis.fetch = nopFetch as unknown as typeof fetch;
const pipeline = new Pipeline(
  { url: 'http://localhost:9090/api/v1/write', timeout: 5000 },
  passAllSchemas,
  'pass'
);

// ─── Benchmarks ────────────────────────────────────────────────────────────

group('varint', () => {
  bench('encode 1', () => encodeVarint(1n));
  bench('encode 128', () => encodeVarint(128n));
  bench('encode 2^32', () => encodeVarint(4294967296n));
  bench('encode 2^56 (max timestamp ms)', () => encodeVarint(72057594037927936n));
});

group('otlp → timeseries', () => {
  bench('1 gauge (1 dp)', () => otlpToTimeSeries(smallPayload));
  bench('10 gauges × 5 dp = 50 series', () => otlpToTimeSeries(medPayload));
  bench('50 gauges × 10 dp = 500 series', () => otlpToTimeSeries(largePayload));
  bench('10 histograms → 120 series', () => otlpToTimeSeries(histPayload));
});

group('schema engine', () => {
  bench('pass-all: 50 series', () => applySchemas(medSeries, passAllSchemas, 'pass'));
  bench('pass-all: 500 series', () => applySchemas(largeSeries, passAllSchemas, 'pass'));
  bench('filter+inject: 50 series', () => applySchemas(medSeries, filterSchemas, 'drop'));
  bench('filter+inject: 500 series', () => applySchemas(largeSeries, filterSchemas, 'drop'));
});

group('protobuf encode', () => {
  bench('50 series', () => encodeWriteRequest({ timeseries: medSeries }));
  bench('500 series', () => encodeWriteRequest({ timeseries: largeSeries }));
});

group('snappy compress', () => {
  bench(`proto ~${medProto.length}B (50 series)`, () => snappyCompress(medProto));
  bench(`proto ~${largeProto.length}B (500 series)`, () => snappyCompress(largeProto));
});

group('json parse (OTLP)', () => {
  bench('small (1 series)', () => JSON.parse(smallJson));
  bench('medium (50 series)', () => JSON.parse(medJson));
  bench('large (500 series)', () => JSON.parse(largeJson));
  bench('histograms (120 series)', () => JSON.parse(histJson));
});

group('pipeline end-to-end (fetch mocked)', () => {
  bench('medium payload (50 series)', () => pipeline.process(medJson, 'application/json'));
  bench('large payload (500 series)', () => pipeline.process(largeJson, 'application/json'));
  bench('histogram payload (120 series)', () => pipeline.process(histJson, 'application/json'));
});

await run({ format: 'mitata', colors: true });
