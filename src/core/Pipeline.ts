/**
 * Stateless pipeline: process(body, contentType) → PipelineResult
 *
 * Steps:
 *  1. Validate content type (must be application/json or application/x-protobuf)
 *  2. Parse OTLP JSON body
 *  3. Convert to TimeSeries[]
 *  4. Apply schemas
 *  5. If empty result, return 204
 *  6. Encode to protobuf
 *  7. Compress with snappy
 *  8. POST to remote-write endpoint
 */

import type { RemoteWriteConfig } from './RemoteWriteConfig.ts';
import type { CompiledSchema, DefaultAction } from '../types/schema.ts';
import type { OtlpMetricsPayload } from '../types/otlp.ts';
import { otlpToTimeSeries } from '../transform/otlpToTimeSeries.ts';
import { applySchemas } from '../transform/SchemaEngine.ts';
import { encodeWriteRequest } from '../proto/writeRequest.ts';
import { snappyCompress } from '../compress/snappy.ts';
import type { TimeSeries } from '../types/prometheus.ts';

export interface PipelineResult {
  status: number;
  message: string;
}

export interface LabelInjectionRule {
  selector: '*' | string | RegExp;
  labels: Record<string, string>;
}

export interface ProcessOptions {
  injectLabels?: LabelInjectionRule[];
}

export function applyRequestLabelInjections(
  series: TimeSeries[],
  injectRules: LabelInjectionRule[]
): TimeSeries[] {
  if (injectRules.length === 0) return series;

  return series.map((ts) => {
    const labelsMap = new Map(ts.labels.map((l) => [l.name, l.value]));
    const metricName = labelsMap.get('__name__') ?? '';

    for (const rule of injectRules) {
      if (!selectorMatches(rule.selector, metricName)) continue;
      for (const [key, value] of Object.entries(rule.labels)) {
        labelsMap.set(key, value);
      }
    }

    const labels = [...labelsMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      labels,
      samples: ts.samples,
    };
  });
}

function selectorMatches(selector: LabelInjectionRule['selector'], metricName: string): boolean {
  if (selector === '*') return true;
  if (typeof selector === 'string') return selector === metricName;
  return selector.test(metricName);
}

export class Pipeline {
  constructor(
    private readonly remoteWrite: RemoteWriteConfig,
    private readonly schemas: CompiledSchema[],
    private readonly defaultAction: DefaultAction
  ) {}

  async process(
    body: string | Uint8Array,
    contentType: string,
    options?: ProcessOptions
  ): Promise<PipelineResult> {
    // Only accept JSON content types for OTLP
    const ct = contentType.split(';')[0]!.trim().toLowerCase();
    if (ct === 'application/x-protobuf') {
      return { status: 415, message: 'Protobuf OTLP not supported; use application/json' };
    }
    if (ct !== 'application/json') {
      return { status: 415, message: `Unsupported content type: ${contentType}` };
    }

    // Parse JSON
    let payload: OtlpMetricsPayload;
    try {
      const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
      payload = JSON.parse(text) as OtlpMetricsPayload;
    } catch {
      return { status: 400, message: 'Invalid JSON body' };
    }

    // Validate basic shape
    if (!payload || !Array.isArray(payload.resourceMetrics)) {
      return { status: 400, message: 'Invalid OTLP payload: missing resourceMetrics' };
    }

    // Convert to TimeSeries
    let series = otlpToTimeSeries(payload);

    // Apply schemas
    if (this.schemas.length > 0) {
      series = applySchemas(series, this.schemas, this.defaultAction);
    } else if (this.defaultAction === 'drop') {
      series = [];
    }

    // Per-request injection happens after schema filtering so user logic always applies.
    if (options?.injectLabels && options.injectLabels.length > 0) {
      series = applyRequestLabelInjections(series, options.injectLabels);
    }

    // Empty result → 204 No Content
    if (series.length === 0) {
      return { status: 204, message: 'No metrics after filtering' };
    }

    // Encode to protobuf
    const protoBytes = encodeWriteRequest({ timeseries: series });

    // Compress with snappy
    const compressed = snappyCompress(protoBytes);

    // POST to remote-write
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.remoteWrite.timeout);

      let response: Response;
      try {
        response = await fetch(this.remoteWrite.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-protobuf',
            'Content-Encoding': 'snappy',
            'X-Prometheus-Remote-Write-Version': '0.1.0',
            ...this.remoteWrite.headers,
          },
          body: compressed,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          status: 502,
          message: `Remote write failed: HTTP ${response.status} ${body}`.slice(0, 500),
        };
      }

      return { status: 200, message: 'OK' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 502, message: `Remote write error: ${msg}` };
    }
  }
}
