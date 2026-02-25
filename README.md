# otelturbine

`otelturbine` is a small OTLP/HTTP to Prometheus remote-write pipeline.

Send OTLP JSON in, apply your own per-request logic (route params, label injection, filtering rules), push to Prometheus-compatible storage.

[![npm version](https://img.shields.io/npm/v/otelturbine.svg)](https://www.npmjs.com/package/otelturbine)
[![license](https://img.shields.io/npm/l/otelturbine.svg)](https://github.com/hUwUtao/otelturbine)

## Install

```bash
bun add otelturbine
```

## Quick Start

```ts
import { OtelTurbine } from 'otelturbine';

const turbine = new OtelTurbine()
  .remoteWrite('http://prometheus:9090/api/v1/write')
  .defaultAction('drop')
  .schema([
    {
      name: /^http_.*/,
      labels: {
        method: /^(GET|POST|PUT|DELETE)$/,
        status: /.*/,
        '*': /.*/,
      },
      inject: { env: 'prod' },
      maxLabels: 12,
    },
  ])
  .build();
```

## Parameterized Route + Parameterized Injection

Main flow for custom routing:

```ts
// /v1/metrics/:name
app.post('/v1/metrics/:name', async (req, { name }) => {
  if (!valid(name)) return new Response('invalid name', { status: 400 });

  const result = await turbine
    .ingest(req) // creates an isolated request session
    .inject('*', { instance_name: name })
    .push();

  return new Response(result.message, {
    status: result.status === 200 ? 204 : result.status,
  });
});
```

You can also ingest raw body directly:

```ts
const result = await turbine
  .ingest(body, { contentType: 'application/json' })
  .inject({ instance_name: 'worker-a' }) // shorthand for selector "*"
  .push();
```

## Ownership Model (important)

`ingest(...)` creates a duplicated per-request chain object. That means:

- injection in one request never leaks into another request
- builder config stays immutable after `.build()`
- it is safe under concurrency

## Route Macro (not plugin)

`routeMacro()` gives a framework-agnostic descriptor:

```ts
const macro = turbine.routeMacro('/v1/metrics/:name');
// { method: 'POST', path: '/v1/metrics/:name', handler }

router.on(macro.method, macro.path, macro.handler);
```

Use this where your framework accepts explicit method/path/handler registration.

## Builder API

### `.remoteWrite(url, options?)`

```ts
turbine.remoteWrite('http://victoria-metrics:8428/api/v1/write', {
  timeout: 5000,
  headers: { 'X-Scope-OrgID': 'tenant-a' },
});
```

### `.defaultAction('pass' | 'drop')`

- `pass`: unmatched metrics continue unchanged (default)
- `drop`: unmatched metrics are dropped

### `.schema([...])`

First-match-wins metric schema rules.

```ts
turbine.schema([
  {
    name: 'process_cpu_seconds_total',
    labels: { '*': /.*/ },
  },
  {
    name: /^http_.*/,
    labels: {
      method: /^(GET|POST)$/,
      '*': /.*/,
    },
    inject: { service: 'api' },
    maxLabels: 10,
  },
]);
```

### `.build()`

Returns a built, immutable pipeline instance.

## Built API

### `.ingest(input, options?)`

Creates an isolated request session chain:

- `.inject(selector, labels)`
- `.inject(labels)`
- `.push()`

### `.compat()`

Returns a request-first helper for middleware/router integration:

```ts
const otelTurbine = turbine.compat();
await otelTurbine(req).inject('*', { instance_name: 'x' }).push();
```

### `.routeMacro(path?)`

Returns `{ method, path, handler }` descriptor.

### `.bunRouteHandler()` / `.bunHandler(path?)`

Optional Bun-native integrations.

## Result Codes

`push()` and `Pipeline.process()` return:

- `200`: forwarded successfully
- `204`: nothing to forward after filtering
- `400`: invalid JSON/payload
- `415`: unsupported content type
- `502`: remote-write downstream failed

## Development

```bash
bun test
bun run typecheck
bun run build
```
