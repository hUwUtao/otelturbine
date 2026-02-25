import type { Pipeline, PipelineResult, LabelInjectionRule } from './Pipeline.ts';

export type CompatHeaders =
  | Headers
  | { get?: (name: string) => string | null | undefined }
  | Record<string, string | string[] | undefined>;

export interface CompatRequestLike {
  method?: string;
  headers?: CompatHeaders;
  contentType?: string;
  body?: unknown;
  text?: () => Promise<string> | string;
}

export interface IngestOptions {
  method?: string;
  headers?: CompatHeaders;
  contentType?: string;
}

export class IngestSession {
  private readonly injectRules: LabelInjectionRule[] = [];

  constructor(
    private readonly pipeline: Pipeline,
    private readonly req: Request | CompatRequestLike
  ) {}

  inject(selector: LabelInjectionRule['selector'], labels: Record<string, string>): this;
  inject(labels: Record<string, string>): this;
  inject(
    selectorOrLabels: LabelInjectionRule['selector'] | Record<string, string>,
    maybeLabels?: Record<string, string>
  ): this {
    if (
      typeof selectorOrLabels === 'object' &&
      selectorOrLabels !== null &&
      !(selectorOrLabels instanceof RegExp)
    ) {
      this.injectRules.push({ selector: '*', labels: { ...selectorOrLabels } });
      return this;
    }
    const selector = selectorOrLabels as LabelInjectionRule['selector'];
    const labels = maybeLabels ?? {};
    this.injectRules.push({ selector, labels: { ...labels } });
    return this;
  }

  // Backward-compatible alias
  injectLabel(selector: LabelInjectionRule['selector'], labels: Record<string, string>): this {
    return this.inject(selector, labels);
  }

  async push(): Promise<PipelineResult> {
    const normalized = await normalizeRequest(this.req);
    if (normalized.method && normalized.method !== 'POST') {
      return { status: 405, message: 'Method Not Allowed' };
    }
    return this.pipeline.process(normalized.body, normalized.contentType, {
      injectLabels: this.injectRules,
    });
  }
}

export type CompatHandler = (req: Request | CompatRequestLike) => IngestSession;

export function createCompatHandler(pipeline: Pipeline): CompatHandler {
  return (req: Request | CompatRequestLike) => new IngestSession(pipeline, req);
}

export function createIngestSession(
  pipeline: Pipeline,
  input: Request | CompatRequestLike | string | Uint8Array | object | null | undefined,
  options?: IngestOptions
): IngestSession {
  if (input instanceof Request || isCompatRequestLike(input)) {
    return new IngestSession(pipeline, input as Request | CompatRequestLike);
  }
  return new IngestSession(pipeline, {
    method: options?.method ?? 'POST',
    headers: options?.headers,
    contentType: options?.contentType,
    body: input,
  });
}

interface NormalizedRequest {
  method: string | undefined;
  contentType: string;
  body: string | Uint8Array;
}

async function normalizeRequest(req: Request | CompatRequestLike): Promise<NormalizedRequest> {
  if (req instanceof Request) {
    return {
      method: req.method,
      contentType: req.headers.get('content-type') ?? 'application/json',
      body: await req.text(),
    };
  }

  const method = typeof req.method === 'string' ? req.method.toUpperCase() : undefined;
  const contentType = req.contentType ?? getHeader(req.headers, 'content-type') ?? 'application/json';

  if (typeof req.text === 'function') {
    const text = await req.text();
    return { method, contentType, body: text };
  }

  const body = req.body;
  if (typeof body === 'string') return { method, contentType, body };
  if (body instanceof Uint8Array) return { method, contentType, body };
  if (body instanceof ArrayBuffer) return { method, contentType, body: new Uint8Array(body) };
  if (body === undefined || body === null) return { method, contentType, body: '' };
  if (typeof body === 'object') return { method, contentType, body: JSON.stringify(body) };
  return { method, contentType, body: String(body) };
}

function isCompatRequestLike(value: unknown): value is CompatRequestLike {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof Request) return true;
  const maybe = value as CompatRequestLike;
  return (
    typeof maybe.text === 'function' ||
    maybe.body !== undefined ||
    maybe.headers !== undefined ||
    maybe.contentType !== undefined ||
    maybe.method !== undefined
  );
}

function getHeader(headers: CompatHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    const value = (headers as Headers).get(name);
    return value ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const direct = record[name];
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct) && direct.length > 0) return direct[0];
  const lowered = record[name.toLowerCase()];
  if (typeof lowered === 'string') return lowered;
  if (Array.isArray(lowered) && lowered.length > 0) return lowered[0];
  return undefined;
}
