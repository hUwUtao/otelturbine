/**
 * User-facing MetricSchema and internal CompiledSchema types.
 */

/** A label value pattern: RegExp for pattern match, string for exact match. */
export type LabelPattern = RegExp | string;

export interface MetricSchema {
  name: string | RegExp;
  labels?: { [labelName: string]: LabelPattern };
  inject?: Record<string, string>;
  maxLabels?: number;
}

/**
 * Fast matcher that avoids regex overhead for common patterns.
 * Compiled once at build() time.
 */
export type FastMatcher =
  | { type: 'any' }                  // /.*/ — always true, zero cost
  | { type: 'exact'; value: string } // /^foo$/ or string — equality check
  | { type: 'regex'; re: RegExp }    // general fallback

export interface CompiledSchema {
  namePattern: RegExp;
  /** Explicit label matchers (excludes "*"). */
  labelMatchers: Map<string, FastMatcher>;
  /** Wildcard matcher for unlisted labels. undefined = drop all unlisted. */
  wildcardMatcher: FastMatcher | undefined;
  inject: Record<string, string>;
  /** Pre-computed entries array — avoids Object.entries() per series. */
  injectEntries: Array<[string, string]>;
  maxLabels: number | undefined;
}

export type DefaultAction = 'pass' | 'drop';
