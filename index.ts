// otelturbine — OTLP → Prometheus Remote-Write Pipeline Library

// Core builder
export { OtelTurbine, BuiltOtelTurbine } from './src/core/OtelTurbine.ts';

// Pipeline (for advanced/testing use)
export { Pipeline } from './src/core/Pipeline.ts';
export { applyRequestLabelInjections } from './src/core/Pipeline.ts';
export type { PipelineResult, LabelInjectionRule, ProcessOptions } from './src/core/Pipeline.ts';
export { createCompatHandler, createIngestSession, IngestSession } from './src/core/Compat.ts';
export type {
  CompatHandler,
  CompatRequestLike,
  CompatHeaders,
  IngestOptions,
} from './src/core/Compat.ts';
export type { RouteMacro } from './src/adapters/bun.ts';

// Types
export type { MetricSchema, LabelPattern, DefaultAction, CompiledSchema } from './src/types/schema.ts';
export type { TimeSeries, Label, Sample, WriteRequest } from './src/types/prometheus.ts';
export type { OtlpMetricsPayload, OtlpResourceMetrics, OtlpMetric } from './src/types/otlp.ts';
export type { RemoteWriteConfig } from './src/core/RemoteWriteConfig.ts';

// Transform utilities (for advanced use)
export { otlpToTimeSeries } from './src/transform/otlpToTimeSeries.ts';
export { compileSchemas, applySchemas } from './src/transform/SchemaEngine.ts';

// Proto encoding (for advanced use)
export { encodeWriteRequest } from './src/proto/writeRequest.ts';

// Compression (for advanced use)
export { snappyCompress, snappyUncompress } from './src/compress/snappy.ts';
