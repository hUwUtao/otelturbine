/**
 * Bun-native adapter helpers for the Analyta pipeline.
 */

import type { Pipeline } from '../core/Pipeline.ts';

export interface RouteMacro {
  method: 'POST';
  path: string;
  handler: (req: Request) => Promise<Response>;
}

/** Map pipeline status codes to appropriate HTTP responses. */
function pipelineResultToResponse(status: number, message: string): Response {
  switch (status) {
    case 200:
      return new Response(null, { status: 204 }); // Success → 204 No Content to caller
    case 204:
      return new Response(null, { status: 204 }); // Empty after filtering → 204
    case 400:
      return new Response(message, { status: 400 });
    case 415:
      return new Response(message, { status: 415 });
    case 502:
      return new Response(message, { status: 502 });
    default:
      return new Response(message, { status });
  }
}

/**
 * Returns a handler for use as a Bun.serve route POST handler.
 * Assumes the route only handles POST (method checking done by Bun.serve routing).
 */
export function bunRouteHandler(pipeline: Pipeline): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const contentType = req.headers.get('content-type') ?? 'application/json';
    const body = await req.text();
    const result = await pipeline.process(body, contentType);
    return pipelineResultToResponse(result.status, result.message);
  };
}

/**
 * Returns a Bun fetch handler that handles POST to the specified path.
 * Returns 405 for wrong method, 404 for unmatched paths.
 */
export function bunHandler(
  pipeline: Pipeline,
  path: string
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname !== path) {
      return new Response('Not Found', { status: 404 });
    }
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'POST' },
      });
    }
    const contentType = req.headers.get('content-type') ?? 'application/json';
    const body = await req.text();
    const result = await pipeline.process(body, contentType);
    return pipelineResultToResponse(result.status, result.message);
  };
}

/**
 * Framework-agnostic route macro descriptor:
 * `{ method, path, handler }`
 */
export function routeMacro(pipeline: Pipeline, path = '/v1/metrics'): RouteMacro {
  return {
    method: 'POST',
    path,
    handler: bunRouteHandler(pipeline),
  };
}
