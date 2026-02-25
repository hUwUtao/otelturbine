/**
 * OTLP JSON payload types (minimal subset used for metrics ingestion).
 * Based on the OTLP specification for metrics export.
 */

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

export interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values: OtlpAnyValue[] };
  kvlistValue?: { values: OtlpKeyValue[] };
}

export interface OtlpResource {
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}

export interface OtlpNumberDataPoint {
  attributes?: OtlpKeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano?: string;
  asDouble?: number;
  asInt?: string | number;
  exemplars?: unknown[];
  flags?: number;
}

export interface OtlpHistogramDataPoint {
  attributes?: OtlpKeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano?: string;
  count?: string | number;
  sum?: number;
  bucketCounts?: (string | number)[];
  explicitBounds?: number[];
  exemplars?: unknown[];
  flags?: number;
}

export interface OtlpGauge {
  dataPoints: OtlpNumberDataPoint[];
}

export interface OtlpSum {
  dataPoints: OtlpNumberDataPoint[];
  aggregationTemporality?: number;
  isMonotonic?: boolean;
}

export interface OtlpHistogram {
  dataPoints: OtlpHistogramDataPoint[];
  aggregationTemporality?: number;
}

export interface OtlpMetric {
  name: string;
  description?: string;
  unit?: string;
  gauge?: OtlpGauge;
  sum?: OtlpSum;
  histogram?: OtlpHistogram;
}

export interface OtlpScopeMetrics {
  scope?: { name?: string; version?: string };
  metrics: OtlpMetric[];
}

export interface OtlpResourceMetrics {
  resource?: OtlpResource;
  scopeMetrics: OtlpScopeMetrics[];
}

export interface OtlpMetricsPayload {
  resourceMetrics: OtlpResourceMetrics[];
}
