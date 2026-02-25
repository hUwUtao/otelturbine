/**
 * Converts OTLP JSON metrics payload to Prometheus TimeSeries[].
 *
 * Supports:
 *  - gauge → 1 TimeSeries per data point
 *  - sum   → 1 TimeSeries per data point
 *  - histogram → _bucket (cumulative) × (bounds+1) + _count + _sum per data point
 *
 * Resource attributes are merged into every series (dp attributes win on conflict).
 * Labels are sorted alphabetically (Prometheus requirement).
 */

import type { OtlpMetricsPayload, OtlpKeyValue, OtlpNumberDataPoint, OtlpHistogramDataPoint } from '../types/otlp.ts';
import type { TimeSeries, Label } from '../types/prometheus.ts';

/** Convert OTLP key-value attributes to a plain string map. */
function attrsToMap(attrs: OtlpKeyValue[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!attrs) return map;
  for (const kv of attrs) {
    const v = kv.value;
    if (v.stringValue !== undefined) {
      map[kv.key] = v.stringValue;
    } else if (v.intValue !== undefined) {
      map[kv.key] = String(v.intValue);
    } else if (v.doubleValue !== undefined) {
      map[kv.key] = String(v.doubleValue);
    } else if (v.boolValue !== undefined) {
      map[kv.key] = String(v.boolValue);
    } else {
      map[kv.key] = '';
    }
  }
  return map;
}

/** Convert timeUnixNano string to milliseconds as BigInt. */
function nanoToMs(timeUnixNano: string | undefined): bigint {
  if (!timeUnixNano) return BigInt(Date.now());
  return BigInt(timeUnixNano) / 1_000_000n;
}

/** Build sorted Label[] from a merged attribute map + metric name. */
function buildLabels(name: string, merged: Record<string, string>): Label[] {
  const labels: Label[] = [{ name: '__name__', value: name }];
  for (const [k, v] of Object.entries(merged)) {
    labels.push({ name: k, value: v });
  }
  // Sort alphabetically by name (__name__ sorts before most names — fine)
  labels.sort((a, b) => a.name.localeCompare(b.name));
  return labels;
}

/** Merge resource attrs and data point attrs; dp wins on conflict. */
function mergeAttrs(
  resourceAttrs: Record<string, string>,
  dpAttrs: OtlpKeyValue[] | undefined
): Record<string, string> {
  const dp = attrsToMap(dpAttrs);
  return { ...resourceAttrs, ...dp };
}

function processNumberDataPoint(
  name: string,
  dp: OtlpNumberDataPoint,
  resourceAttrs: Record<string, string>
): TimeSeries {
  const merged = mergeAttrs(resourceAttrs, dp.attributes);
  const labels = buildLabels(name, merged);
  const timestamp = nanoToMs(dp.timeUnixNano);
  let value: number;
  if (dp.asDouble !== undefined) {
    value = dp.asDouble;
  } else if (dp.asInt !== undefined) {
    value = Number(dp.asInt);
  } else {
    value = 0;
  }
  return { labels, samples: [{ value, timestamp }] };
}

function processHistogramDataPoint(
  name: string,
  dp: OtlpHistogramDataPoint,
  resourceAttrs: Record<string, string>
): TimeSeries[] {
  const merged = mergeAttrs(resourceAttrs, dp.attributes);
  const timestamp = nanoToMs(dp.timeUnixNano);
  const series: TimeSeries[] = [];

  // Bucket series: cumulative counts
  const bounds = dp.explicitBounds ?? [];
  const bucketCounts = dp.bucketCounts ?? [];

  let cumulative = 0n;
  for (let i = 0; i <= bounds.length; i++) {
    const le = i < bounds.length ? String(bounds[i]) : '+Inf';
    const count = bucketCounts[i] !== undefined ? BigInt(bucketCounts[i]!) : 0n;
    cumulative += count;
    const bucketLabels = buildLabels(`${name}_bucket`, { ...merged, le });
    series.push({
      labels: bucketLabels,
      samples: [{ value: Number(cumulative), timestamp }],
    });
  }

  // _count series
  const countVal = dp.count !== undefined ? Number(dp.count) : 0;
  series.push({
    labels: buildLabels(`${name}_count`, merged),
    samples: [{ value: countVal, timestamp }],
  });

  // _sum series
  const sumVal = dp.sum !== undefined ? dp.sum : 0;
  series.push({
    labels: buildLabels(`${name}_sum`, merged),
    samples: [{ value: sumVal, timestamp }],
  });

  return series;
}

/**
 * Convert an OTLP metrics payload to an array of Prometheus TimeSeries.
 */
export function otlpToTimeSeries(payload: OtlpMetricsPayload): TimeSeries[] {
  const result: TimeSeries[] = [];

  for (const rm of payload.resourceMetrics) {
    const resourceAttrs = attrsToMap(rm.resource?.attributes);

    for (const sm of rm.scopeMetrics) {
      for (const metric of sm.metrics) {
        const name = metric.name;

        if (metric.gauge) {
          for (const dp of metric.gauge.dataPoints) {
            result.push(processNumberDataPoint(name, dp, resourceAttrs));
          }
        } else if (metric.sum) {
          for (const dp of metric.sum.dataPoints) {
            result.push(processNumberDataPoint(name, dp, resourceAttrs));
          }
        } else if (metric.histogram) {
          for (const dp of metric.histogram.dataPoints) {
            result.push(...processHistogramDataPoint(name, dp, resourceAttrs));
          }
        }
        // Other metric types (ExponentialHistogram, Summary) not yet supported
      }
    }
  }

  return result;
}
