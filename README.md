# otelturbine

`otelturbine` is a tiny OTLP/HTTP to Prometheus remote-write pipeline for Bun.

Send OTLP JSON in, add your own per-request logic (route params, label injection), and push to Prometheus-compatible storage (Prometheus, VictoriaMetrics, Mimir, etc).

[![npm version](https://img.shields.io/npm/v/otelturbine.svg)](https://www.npmjs.com/package/otelturbine)
[![license](https://img.shields.io/npm/l/otelturbine.svg)](https://github.com/hUwUtao/otelturbine)

## Install

```bash
bun add otelturbine
```

## Build The Pipeline

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

## Parameterized Route + Parameterized Injection (main pattern)

This is the intended usage. You own routing, you own validation, you stamp labels from params.

```ts
app.post('/v1/metrics/:name', async (req, { name }) => {
  if (!valid(name)) return new Response('invalid name', { status: 400 });

  const result = await turbine
    .ingest(req) // creates an isolated request/session chain
    .inject('*', { instance_name: name })
    .push();

  return new Response(result.message, {
    status: result.status === 200 ? 204 : result.status,
  });
});
```

### Ingest Raw Body Directly

Useful if your framework doesn’t hand you a native `Request`, or you already buffered the body.

```ts
const result = await turbine
  .ingest(body, { contentType: 'application/json' })
  .inject({ instance_name: 'worker-a' }) // shorthand for selector "*"
  .push();
```

## Ownership Model

`ingest(...)` returns a per-request chain. It does not mutate global/built state.

- injection in one request never leaks into another request
- safe under concurrency

## Route Macro (not a plugin)

If your router accepts `{ method, path, handler }`, use `routeMacro()`:

```ts
const macro = turbine.routeMacro('/v1/metrics/:name');
// { method: 'POST', path: '/v1/metrics/:name', handler }

router.on(macro.method, macro.path, macro.handler);
```

If your router needs a different handler signature, use the parameterized route pattern above.

## Schema Rules (short reference)

Schemas are **first match wins**. For a matching metric name:

- `labels: { key: pattern }`: label must exist and match, or the whole series is dropped
- `labels: { '*': pattern }`: keep unlisted labels if their values match the pattern (omit `'*'` to drop all unlisted)
- `inject: { k: v }`: add/override labels after filtering
- `maxLabels`: cap label count (excluding `__name__`)

Example:

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

## Return Codes

`push()` returns:

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
