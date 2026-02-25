/**
 * ElysiaJS adapter for Analyta.
 * Uses import type only — Elysia is an optional peer dependency.
 * At runtime, dynamically imports Elysia only if the user has it installed.
 */

import type { Elysia as ElysiaType } from 'elysia';
import type { Pipeline } from '../core/Pipeline.ts';

/**
 * Creates an ElysiaJS plugin that registers a POST handler for OTLP metrics.
 *
 * @param pipeline - The compiled Analyta pipeline
 * @param path - The route path (default: '/v1/metrics')
 * @returns An Elysia plugin instance (typed as unknown to avoid hard dep)
 */
export function createElysiaPlugin(pipeline: Pipeline, path: string): unknown {
  // Dynamic import to avoid hard runtime dependency
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { Elysia } = require('elysia') as { Elysia: typeof ElysiaType };

  return new Elysia({ name: 'otelturbine' }).post(path, async ({ request }) => {
    const contentType = request.headers.get('content-type') ?? 'application/json';
    const body = await request.text();
    const result = await pipeline.process(body, contentType);

    switch (result.status) {
      case 200:
      case 204:
        return new Response(null, { status: 204 });
      default:
        return new Response(result.message, { status: result.status });
    }
  });
}
