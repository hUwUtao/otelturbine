// OtelTurbine fluent builder and built instance.
//
// Usage:
//   const turbine = new OtelTurbine()
//     .remoteWrite('http://prometheus:9090/api/v1/write')
//     .defaultAction('drop')
//     .schema([{ name: /^http_/, labels: { method: /^GET$/ } }])
//     .build();
//
//   Bun.serve({ routes: { '/v1/metrics': { POST: turbine.bunRouteHandler() } } });
//   Bun.serve({ fetch: turbine.bunHandler() });

import type { MetricSchema, DefaultAction } from '../types/schema.ts';
import type { RemoteWriteConfig } from './RemoteWriteConfig.ts';
import { compileSchemas } from '../transform/SchemaEngine.ts';
import { Pipeline } from './Pipeline.ts';
import { bunRouteHandler, bunHandler, routeMacro } from '../adapters/bun.ts';
import type { RouteMacro } from '../adapters/bun.ts';
import { createCompatHandler, createIngestSession } from './Compat.ts';
import type {
  CompatHandler,
  CompatRequestLike,
  IngestOptions,
  IngestSession,
} from './Compat.ts';

/** OtelTurbine fluent builder. */
export class OtelTurbine {
  private _remoteWrite?: RemoteWriteConfig;
  private _defaultAction: DefaultAction = 'pass';
  private _schemas: MetricSchema[] = [];

  /**
   * Configure the Prometheus remote-write endpoint.
   * @param url Remote-write URL
   * @param options Optional timeout and extra headers
   */
  remoteWrite(url: string, options?: { timeout?: number; headers?: Record<string, string> }): this {
    this._remoteWrite = {
      url,
      timeout: options?.timeout ?? 10_000,
      headers: options?.headers,
    };
    return this;
  }

  /**
   * Set the default action for metrics that match no schema.
   * - 'pass' (default): forward unchanged
   * - 'drop': discard
   */
  defaultAction(action: DefaultAction): this {
    this._defaultAction = action;
    return this;
  }

  /**
   * Register metric schemas for filtering and transformation.
   * Schemas are matched in order; first match wins.
   */
  schema(schemas: MetricSchema[]): this {
    this._schemas = [...this._schemas, ...schemas];
    return this;
  }

  /** Build the configured pipeline. Throws if remoteWrite was not configured. */
  build(): BuiltOtelTurbine {
    if (!this._remoteWrite) {
      throw new Error('OtelTurbine: remoteWrite() must be called before build()');
    }
    const compiled = compileSchemas(this._schemas);
    const pipeline = new Pipeline(this._remoteWrite, compiled, this._defaultAction);
    return new BuiltOtelTurbine(pipeline);
  }
}

/** A configured, built OtelTurbine pipeline ready to handle requests. */
export class BuiltOtelTurbine {
  constructor(private readonly pipeline: Pipeline) {}

  /**
   * Returns a Bun route handler for use as a route value in Bun.serve routes.
   * Handles only POST requests; returns 405 for other methods.
   *
   * Usage: Bun.serve({ routes: { '/v1/metrics': { POST: turbine.bunRouteHandler() } } })
   */
  bunRouteHandler(): (req: Request) => Promise<Response> {
    return bunRouteHandler(this.pipeline);
  }

  /**
   * Returns a Bun fetch handler for use as the `fetch` option in Bun.serve.
   * Handles POST /v1/metrics; returns 405 for wrong method, 404 for other paths.
   *
   * Usage: Bun.serve({ fetch: turbine.bunHandler() })
   */
  bunHandler(path = '/v1/metrics'): (req: Request) => Promise<Response> {
    return bunHandler(this.pipeline, path);
  }

  /**
   * Route macro descriptor for framework-agnostic routing:
   * `{ method: 'POST', path, handler }`
   */
  routeMacro(path = '/v1/metrics'): RouteMacro {
    return routeMacro(this.pipeline, path);
  }

  /**
   * Returns a framework-agnostic request adapter.
   * Usage:
   *   const otelTurbine = turbine.compat();
   *   await otelTurbine(req).inject('*', { instance_name: 'a' }).push();
   */
  compat(): CompatHandler {
    return createCompatHandler(this.pipeline);
  }

  /**
   * Starts an isolated request/session chain.
   * ingest(...) never mutates builder/global state.
   *
   * Usage:
   *   await turbine.ingest(req).inject('*', { instance_name: name }).push();
   *   await turbine.ingest(rawJson).inject({ instance_name: name }).push();
   */
  ingest(
    input: Request | CompatRequestLike | string | Uint8Array | object | null | undefined,
    options?: IngestOptions
  ): IngestSession {
    return createIngestSession(this.pipeline, input, options);
  }

  /** Direct access to the pipeline for advanced use cases or testing. */
  get rawPipeline(): Pipeline {
    return this.pipeline;
  }
}
