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

export class CompatRequestSession {
  private readonly injectRules: LabelInjectionRule[] = [];

  constructor(
    private readonly pipeline: Pipeline,
    private readonly req: Request | CompatRequestLike
  ) {}

  injectLabel(selector: LabelInjectionRule['selector'], labels: Record<string, string>): this {
    this.injectRules.push({ selector, labels: { ...labels } });
    return this;
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

export type CompatHandler = (req: Request | CompatRequestLike) => CompatRequestSession;

export function createCompatHandler(pipeline: Pipeline): CompatHandler {
  return (req: Request | CompatRequestLike) => new CompatRequestSession(pipeline, req);
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
