# otelturbine

A stateless **OTLP/HTTP → Prometheus remote-write** pipeline library for [Bun](https://bun.sh). Receive metrics from any OpenTelemetry SDK, apply filtering and label transformation rules, and forward to any Prometheus-compatible storage.

```
OTEL SDK  →  POST /v1/metrics  →  [parse]  →  [schema rules]  →  [proto+snappy]  →  remote-write
```

[![npm](https://img.shields.io/npm/v/otelturbine)](https://www.npmjs.com/package/otelturbine)
[![CI](https://github.com/your-org/otelturbine/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/otelturbine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Table of Contents

- [Features](#features)
- [Install](#install)
- [Quick Start](#quick-start)
- [Builder API](#builder-api)
  - [`.remoteWrite(url, options?)`](#remotewriteurl-options)
  - [`.defaultAction(action)`](#defaultactionaction)
  - [`.schema(schemas[])`](#schemashemas)
  - [`.build()`](#build)
- [MetricSchema Reference](#metricschema-reference)
  - [Name matching](#name-matching)
  - [Label filtering](#label-filtering)
  - [Wildcard catch-all](#wildcard-catch-all)
  - [Injecting labels](#injecting-labels)
  - [Capping label count](#capping-label-count)
- [Adapters](#adapters)
  - [Framework-agnostic compat handler](#framework-agnostic-compat-handler)
  - [Bun.serve — route handler](#bunserve--route-handler)
  - [Bun.serve — fetch handler](#bunserve--fetch-handler)
  - [ElysiaJS plugin](#elysiajs-plugin)
- [Advanced Usage](#advanced-usage)
  - [Accessing the raw pipeline](#accessing-the-raw-pipeline)
  - [Using pipeline utilities directly](#using-pipeline-utilities-directly)
- [TypeScript Notes](#typescript-notes)
- [Development](#development)

---

## Features

- **Plug-and-play** with Bun's native HTTP server and ElysiaJS
- **Framework-agnostic compat API** for custom route logic and request-scoped label injection
- **Fluent builder** — configure once, serve forever
- **Schema engine** — filter, relabel, inject, and cap labels per metric family
- **Hand-written protobuf encoder** — zero dependencies for wire encoding
- **Native snappy compression** via NAPI-RS bindings
- **Stateless** — safe to use behind a load balancer, no internal state between requests

---

## Install

```sh
bun add otelturbine
```

`snappy` (a native addon) is a regular dependency and is installed automatically. Bun handles native addons out of the box.

For the optional [ElysiaJS](https://elysiajs.com) adapter:

```sh
bun add elysia  # peer dep, only needed if you use .elysiaPlugin()
```

---

## Quick Start

```ts
import { OtelTurbine } from 'otelturbine';

const turbine = new OtelTurbine()
  .remoteWrite('http://prometheus:9090/api/v1/write')
  .defaultAction('drop')          // drop anything that doesn't match a schema
  .schema([
    {
      name: /^http_/,             // match all metrics starting with http_
      labels: {
        method: /^(GET|POST|PUT|DELETE)$/,
        status: /.*/,
        '*': /.*/,                // keep all other labels too
      },
      inject: { env: 'prod' },   // always stamp env=prod
      maxLabels: 12,
    },
    {
      name: 'process_cpu_seconds_total',
      labels: { '*': /.*/ },      // keep all labels, no filtering
    },
  ])
  .build();

Bun.serve({
  port: 4318,
  routes: {
    '/v1/metrics': { POST: turbine.bunRouteHandler() },
  },
});
```

Point your OpenTelemetry SDK at `http://localhost:4318/v1/metrics` and metrics will flow through to Prometheus.

---

## Builder API

### `.remoteWrite(url, options?)`

Configure the downstream Prometheus remote-write endpoint.

```ts
turbine.remoteWrite('http://victoria-metrics:8428/api/v1/write', {
  timeout: 5_000,                           // ms, default 10 000
  headers: { 'X-Scope-OrgID': 'tenant1' }, // forwarded as-is
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `number` | `10000` | Request timeout in milliseconds |
| `headers` | `Record<string, string>` | — | Extra headers sent with every remote-write request |

**Must be called before `.build()`.**

---

### `.defaultAction(action)`

What to do with metrics that match **no schema**.

```ts
.defaultAction('pass')  // forward unchanged (default)
.defaultAction('drop')  // silently discard
```

---

### `.schema(schemas[])`

Register one or more `MetricSchema` entries. Schemas are evaluated in order — **first match wins**. Multiple calls to `.schema()` append to the list.

```ts
.schema([
  { name: 'up', labels: { job: /.*/, instance: /.*/ } },
  { name: /^node_/, labels: { '*': /.*/ } },
])
.schema([
  { name: /^custom_/, inject: { source: 'myapp' } },
])
```

---

### `.build()`

Validates the configuration and returns a `BuiltOtelTurbine` instance exposing the adapter methods. Throws if `.remoteWrite()` was never called.

---

## MetricSchema Reference

```ts
interface MetricSchema {
  name: string | RegExp;
  labels?: { [key: string]: RegExp | string; '*'?: RegExp | string };
  inject?: Record<string, string>;
  maxLabels?: number;
}
```

### Name matching

| Value | Behaviour |
|-------|-----------|
| `'exact_name'` | Matches only that metric name |
| `/^http_/` | Matches any name satisfying the RegExp |

### Label filtering

For each incoming series that matches `name`, labels are processed in a single pass:

1. **Explicit keys** — the label must exist and its value must match the pattern. If the label is missing or the value doesn't match, **the entire series is dropped**.
2. **Unlisted keys** — handled by the wildcard rule (see below), or removed if no wildcard is set.

```ts
{
  name: 'http_requests_total',
  labels: {
    method: /^(GET|POST)$/,   // keep; drop series if value is anything else
    status: /^[245]\d\d$/,    // keep 2xx, 4xx, 5xx only
    // 'path' and anything else → removed (no wildcard set)
  },
}
```

### Wildcard catch-all

Add `'*'` to keep unlisted labels whose **value** matches the pattern. Without it, all unlisted labels are silently removed.

```ts
labels: {
  job: /.*/,
  '*': /.*/,   // keep every other label regardless of value
}
```

```ts
labels: {
  '*': /^(prod|staging)$/,   // keep unlisted labels only if value is "prod" or "staging"
}
```

### Injecting labels

`inject` labels are always added or overwritten **after** filtering. They never cause a series to be dropped.

```ts
{
  name: /.*/,
  inject: {
    cluster: 'eu-west-k8s',
    env:     'production',
  },
}
```

### Capping label count

`maxLabels` sets a hard cap on the number of labels **excluding `__name__`**. Labels are trimmed alphabetically after inject. `__name__` is always preserved.

```ts
{
  name: /^trace_/,
  labels: { '*': /.*/ },
  maxLabels: 8,
}
```

---

## Adapters

### Framework-agnostic compat handler

Use this when your routing logic is custom and you want per-request label injection without mutating global builder state.

```ts
const turbine = new OtelTurbine()
  .remoteWrite('http://prometheus:9090/api/v1/write')
  .build();

const otelTurbine = turbine.compat();

app.post('/v1/metrics/:name', async (req, { name }) => {
  if (!valid(name)) return new Response('bad name', { status: 400 });
  const result = await otelTurbine(req)
    .injectLabel('*', { instance_name: name })
    .push();
  return new Response(result.message, { status: result.status === 200 ? 204 : result.status });
});
```

Accepted request shapes:
- Native `Request`
- Objects with `method`, `headers`, and `body`
- Objects exposing `text()` for lazy body reads

### Bun.serve — route handler

The cleanest integration when you control the route table. Bun handles method dispatch — only `POST` calls reach this handler.

```ts
Bun.serve({
  port: 4318,
  routes: {
    '/v1/metrics': {
      POST: turbine.bunRouteHandler(),
    },
  },
});
```

### Bun.serve — fetch handler

Use this when you need full control over the `fetch` function, or you're already using a catch-all handler. Returns `404` for unmatched paths and `405` for non-POST methods.

```ts
Bun.serve({
  port: 4318,
  fetch: turbine.bunHandler('/v1/metrics'), // default path is '/v1/metrics'
});
```

### ElysiaJS plugin

Requires `elysia` to be installed as a peer dependency (`bun add elysia`). The plugin registers a POST route and integrates naturally with Elysia's lifecycle.

```ts
import { Elysia } from 'elysia';

new Elysia()
  .use(turbine.elysiaPlugin({ path: '/v1/metrics' })) // default path is '/v1/metrics'
  .listen(4318);
```

Compose it freely alongside other plugins:

```ts
new Elysia()
  .use(cors())
  .use(swagger())
  .use(turbine.elysiaPlugin())
  .listen(4318);
```

---

## Advanced Usage

### Accessing the raw pipeline

`BuiltOtelTurbine.rawPipeline` exposes the underlying `Pipeline` instance, useful for testing, custom routing, or wrapping in middleware.

```ts
const turbine = new OtelTurbine()
  .remoteWrite('http://prometheus:9090/api/v1/write')
  .build();

const result = await turbine.rawPipeline.process(
  JSON.stringify(otlpPayload),
  'application/json',
);
// result: { status: number, message: string }
```

`Pipeline.process` status codes:

| Status | Meaning |
|--------|---------|
| `200` | Forwarded successfully |
| `204` | No metrics after filtering (nothing to send) |
| `400` | Malformed JSON or invalid OTLP shape |
| `415` | Unsupported content type (protobuf OTLP not supported) |
| `502` | Remote-write endpoint returned an error or timed out |

### Using pipeline utilities directly

All internal utilities are exported for advanced use cases:

```ts
import {
  otlpToTimeSeries,   // OtlpMetricsPayload → TimeSeries[]
  compileSchemas,     // MetricSchema[] → CompiledSchema[]
  applySchemas,       // TimeSeries[] + CompiledSchema[] → TimeSeries[]
  encodeWriteRequest, // WriteRequest → Uint8Array (protobuf)
  snappyCompress,
  snappyUncompress,
} from 'otelturbine';
```

Building a fully custom pipeline:

```ts
import {
  otlpToTimeSeries, compileSchemas, applySchemas,
  encodeWriteRequest, snappyCompress,
} from 'otelturbine';

const schemas = compileSchemas([{ name: /.*/, labels: { '*': /.*/ } }]);

const payload = JSON.parse(await req.text());
const series  = applySchemas(otlpToTimeSeries(payload), schemas, 'pass');
const proto   = encodeWriteRequest({ timeseries: series });
const body    = snappyCompress(proto);

await fetch('http://my-remote-write/api/v1/write', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-protobuf',
    'Content-Encoding': 'snappy',
    'X-Prometheus-Remote-Write-Version': '0.1.0',
  },
  body,
});
```

---

## TypeScript Notes

otelturbine ships its TypeScript sources directly. When consumed from Bun, types resolve from `index.ts` with no extra configuration needed.

If you use `tsc` directly and see errors about `.ts` extension imports, add the following to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true
  }
}
```

---

## Development

```sh
bun install        # install dependencies
bun test           # run test suite (53 tests)
bun run bench.ts   # run benchmarks
bun run typecheck  # type-check without emitting
bun run build      # build dist/index.js for publishing
```

### Project structure

```
src/
├── adapters/
│   ├── bun.ts              bunHandler + bunRouteHandler
│   └── elysia.ts           createElysiaPlugin (optional peer dep)
├── compress/
│   └── snappy.ts           thin wrapper over native snappy
├── core/
│   ├── OtelTurbine.ts      fluent builder → BuiltOtelTurbine
│   ├── Pipeline.ts         stateless process() → PipelineResult
│   └── RemoteWriteConfig.ts
├── proto/
│   └── writeRequest.ts     hand-written two-pass protobuf encoder
├── transform/
│   ├── otlpToTimeSeries.ts OTLP JSON → TimeSeries[]
│   └── SchemaEngine.ts     compileSchemas + applySchemas
├── types/
│   ├── otlp.ts             OTLP payload interfaces
│   ├── prometheus.ts       internal TimeSeries / WriteRequest
│   └── schema.ts           MetricSchema + CompiledSchema + FastMatcher
└── util/
    └── varint.ts           LEB128 varint encoding
index.ts                    public barrel export
bench.ts                    mitata benchmarks
```

---

## License

MIT
