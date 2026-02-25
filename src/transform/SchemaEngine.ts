/**
 * Schema compilation and application engine.
 *
 * Compilation (once at build()):
 *  - string name → exact-match RegExp (anchored)
 *  - LabelPattern → FastMatcher (any / exact / regex)
 *  - "*" key extracted as wildcardMatcher
 *  - inject entries pre-computed as Array<[string, string]>
 *
 * Application (per-series):
 *  1. Match series name against compiled schemas (first match wins)
 *  2. Single pass over ts.labels:
 *     - explicit key: value must match FastMatcher; else DROP series
 *     - count how many explicit labels were seen; drop if any missing
 *     - wildcard: keep unlisted labels whose value matches; drop otherwise
 *  3. Apply inject (binary search on sorted outLabels)
 *  4. Apply maxLabels cap
 *  5. Re-sort labels
 */

import type { MetricSchema, CompiledSchema, FastMatcher, LabelPattern, DefaultAction } from '../types/schema.ts';
import type { TimeSeries, Label } from '../types/prometheus.ts';

// ─── Compilation ────────────────────────────────────────────────────────────

function compileFastMatcher(p: LabelPattern): FastMatcher {
  if (typeof p === 'string') {
    return { type: 'exact', value: p };
  }
  const src = p.source;
  // /.*/ with any flags → always matches
  if (src === '.*' || src === '^.*$') return { type: 'any' };
  // /^exact$/ where inner part has no regex special chars → equality
  const exactInner = src.match(/^\^([^.*+?[\](){}\\|^$]+)\$$/)?.[1];
  if (exactInner !== undefined) return { type: 'exact', value: exactInner };
  return { type: 'regex', re: p };
}

function nameToRegExp(n: string | RegExp): RegExp {
  if (n instanceof RegExp) return n;
  return new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

export function compileSchemas(schemas: MetricSchema[]): CompiledSchema[] {
  return schemas.map((s) => {
    const labelMatchers = new Map<string, FastMatcher>();
    let wildcardMatcher: FastMatcher | undefined;

    if (s.labels) {
      for (const [key, pattern] of Object.entries(s.labels)) {
        if (key === '*') {
          wildcardMatcher = compileFastMatcher(pattern);
        } else {
          labelMatchers.set(key, compileFastMatcher(pattern));
        }
      }
    }

    const inject = s.inject ?? {};
    return {
      namePattern: nameToRegExp(s.name),
      labelMatchers,
      wildcardMatcher,
      inject,
      injectEntries: Object.entries(inject) as Array<[string, string]>,
      maxLabels: s.maxLabels,
    };
  });
}

// ─── Fast matcher ────────────────────────────────────────────────────────────

function testFastMatcher(m: FastMatcher, value: string): boolean {
  switch (m.type) {
    case 'any':   return true;
    case 'exact': return value === m.value;
    case 'regex': return m.re.test(value);
  }
}

// ─── Binary search over sorted Label[] ──────────────────────────────────────

function bsearchLabel(labels: Label[], name: string): number {
  let lo = 0, hi = labels.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const n = labels[mid]!.name;
    if (n === name) return mid;
    if (n < name) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

// ─── Application ─────────────────────────────────────────────────────────────

export function applySchemas(
  series: TimeSeries[],
  schemas: CompiledSchema[],
  defaultAction: DefaultAction
): TimeSeries[] {
  const result: TimeSeries[] = [];
  for (const ts of series) {
    const nameLabel = ts.labels[bsearchLabel(ts.labels, '__name__')];
    const metricName = nameLabel?.value ?? '';

    const schema = schemas.find((s) => s.namePattern.test(metricName));
    if (!schema) {
      if (defaultAction === 'pass') result.push(ts);
      continue;
    }

    const transformed = applySchema(ts, schema);
    if (transformed !== null) result.push(transformed);
  }
  return result;
}

function applySchema(ts: TimeSeries, schema: CompiledSchema): TimeSeries | null {
  const outLabels: Label[] = [];
  // Track how many of the required explicit labels we've seen
  let seenExplicit = 0;
  const explicitCount = schema.labelMatchers.size;

  for (const label of ts.labels) {
    const name = label.name;

    if (name === '__name__') {
      outLabels.push(label);
      continue;
    }

    const matcher = schema.labelMatchers.get(name);
    if (matcher !== undefined) {
      if (!testFastMatcher(matcher, label.value)) return null; // value mismatch → drop series
      outLabels.push(label);
      seenExplicit++;
    } else if (schema.wildcardMatcher !== undefined) {
      if (testFastMatcher(schema.wildcardMatcher, label.value)) {
        outLabels.push(label);
      }
      // else: label value doesn't match wildcard → drop this label (not the series)
    }
    // No wildcard → drop unlisted label
  }

  // All explicitly required labels must have been present in the series
  if (seenExplicit < explicitCount) return null;

  // Apply inject labels (outLabels is still sorted here)
  for (const [k, v] of schema.injectEntries) {
    const idx = bsearchLabel(outLabels, k);
    if (idx >= 0) {
      outLabels[idx] = { name: k, value: v };
    } else {
      outLabels.push({ name: k, value: v });
    }
  }

  // Apply maxLabels cap
  if (schema.maxLabels !== undefined) {
    const nameIdx = outLabels.findIndex((l) => l.name === '__name__');
    const nameLabel = nameIdx >= 0 ? outLabels.splice(nameIdx, 1)[0]! : undefined;
    outLabels.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const trimmed = outLabels.slice(0, schema.maxLabels);
    if (nameLabel) trimmed.push(nameLabel);
    trimmed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { labels: trimmed, samples: ts.samples };
  }

  // Re-sort (inject may have added new labels at the end)
  outLabels.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { labels: outLabels, samples: ts.samples };
}
