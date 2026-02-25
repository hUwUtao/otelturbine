# otelturbine

OTLP/HTTP JSON to Prometheus remote-write pipeline for Bun.

[![npm version](https://img.shields.io/npm/v/otelturbine.svg)](https://www.npmjs.com/package/otelturbine)
[![license](https://img.shields.io/npm/l/otelturbine.svg)](https://github.com/hUwUtao/otelturbine)

## Install

```bash
bun add otelturbine
```

## Example

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

## Parameterized Route

Parameterized route example with route-param label injection:

```ts
app.post('/v1/metrics/:name', async (req, { name }) => {
  if (!valid(name)) return new Response('invalid name', { status: 400 });

  const result = await turbine
    .ingest(req)
    .inject({ instance_name: name })
    .push();

  if (result.status === 200 || result.status === 204) {
    return new Response(null, { status: 204 });
  }
  return new Response(result.message, { status: result.status });
});
```

## Ingest From Body

```ts
const result = await turbine
  .ingest(body, { contentType: 'application/json' })
  .inject({ instance_name: 'worker-a' })
  .push();
```

`ingest()` returns a per-request chain; injections do not leak across requests.

## Route Macro

Route macro descriptor:

```ts
const { method, path, handler } = turbine.routeMacro('/v1/metrics');
router.on(method, path, handler);
```

## Schemas

Schemas are **first match wins**. For a matching metric name:

- `labels: { key: pattern }`: label must exist and match, or the whole series is dropped
- `labels: { '*': pattern }`: keep unlisted labels if their values match the pattern (omit `'*'` to drop all unlisted)
- `inject: { k: v }`: add/override labels after filtering
- `maxLabels`: cap label count (excluding `__name__`)

Example schema:

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

`push()` returns `{ status, message }`.

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
