// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// @breakdial/core — dial engine. Zero dependencies, works in browser + node.

export type BreakLevel = number; // clamped 0-10

export interface DialState {
  level: number;
  /** the seed as given, so a failing run can be reproduced verbatim */
  seed: string | number;
}

export type ScenarioFn<TCtx = unknown> = (ctx: TCtx) => void | Promise<void>;

/** FNV-1a over the seed's string form. Distinct inputs stay distinct. */
function hashSeed(seed: string | number): number {
  // String() every input: hashing the text of a number keeps fractional and
  // out-of-range seeds distinct, which `>>> 0` on the number would collapse.
  // Tag the type so 42 and '42' don't collide — an env-var seed and a parsed
  // one would otherwise share a sequence while reading as different seeds.
  const s = typeof seed === 'number' ? `n:${seed}` : `s:${seed}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isUsableLevel(level: unknown): level is number {
  return typeof level === 'number' && Number.isFinite(level);
}

/**
 * One independent random sequence. Draws from a stream never affect any other
 * stream, so concurrent consumers stay reproducible.
 */
export class BreakStream {
  #state: number;
  readonly level: number;
  readonly key: string;

  constructor(level: number, seedHash: number, key: string) {
    this.level = level;
    this.key = key;
    // Mix the key into the seed so each key is its own sequence. The `|| 1`
    // guards mulberry32's one degenerate state without aliasing two seeds:
    // it applies to the mixed hash, not to the user's seed.
    this.#state = (Math.imul(seedHash ^ hashSeed(key), 2654435761) >>> 0) || 1;
  }

  /** Next float in [0, 1). mulberry32. */
  random(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.#state ^ (this.#state >>> 15), 1 | this.#state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** True with probability `rate * level/10`. level 0 => never. */
  shouldBreak(rate = 0.5): boolean {
    if (this.level <= 0) return false;
    // Always draw, even when the outcome is certain: skipping the draw would
    // make the stream's position depend on `rate`, desyncing every later call.
    const r = this.random();
    if (this.level >= 10 && rate >= 1) return true;
    return r < rate * (this.level / 10);
  }

  pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[Math.floor(this.random() * arr.length)];
  }
}

/**
 * A configured chaos dial. Hold one per test run; derive a stream per
 * concurrent unit of work (request, page load, job) via `stream()`.
 */
export class Dial {
  readonly level: number;
  readonly seed: string | number;
  readonly #seedHash: number;
  readonly #default: BreakStream;
  readonly #streams = new Map<string, BreakStream>();

  constructor(level: number, seed: string | number) {
    // Fail closed: a level we cannot read becomes 0 (no chaos), never NaN.
    // NaN would disable injection while reporting "catastrophe" — a green
    // suite that never ran a fault is the one outcome this must not produce.
    this.level = isUsableLevel(level) ? Math.max(0, Math.min(10, Math.round(level))) : 0;
    this.seed = seed;
    this.#seedHash = hashSeed(seed);
    this.#default = new BreakStream(this.level, this.#seedHash, '');
  }

  /**
   * The sequence for `key`, created on first use and advanced on every draw.
   *
   * Two properties hold together: a key's Nth draw is unaffected by draws on
   * any other key (so concurrent work stays reproducible), and successive
   * draws on one key differ (so repeated calls to the same route vary and
   * retry/recovery paths are actually exercised).
   *
   * Give each concurrent unit of work its own key. Keys accumulate for the
   * dial's lifetime, so key on a route or a request id, not on unbounded
   * values; `dial()` starts a fresh dial and drops them.
   */
  stream(key: string | number = ''): BreakStream {
    const k = String(key);
    let s = this.#streams.get(k);
    if (!s) {
      s = new BreakStream(this.level, this.#seedHash, k);
      this.#streams.set(k, s);
    }
    return s;
  }

  /** Shared stream. Order-dependent across callers — use `stream(key)` when concurrent. */
  shouldBreak(rate = 0.5): boolean {
    return this.#default.shouldBreak(rate);
  }

  pick<T>(arr: readonly T[]): T | undefined {
    return this.#default.pick(arr);
  }

  get label(): string {
    return levelLabel(this.level);
  }

  toState(): DialState {
    return { level: this.level, seed: this.seed };
  }
}

function defaultSeed(): number {
  return Date.now() % 2147483647;
}

let active = new Dial(0, 1);

/**
 * Set the global chaos dial and return it.
 * 0=off, 1-2=paper-cuts, 3-4=jank, 5-7=outage, 8-10=catastrophe.
 *
 * An unreadable level (NaN, Infinity, non-number) clamps to 0 — fault
 * injection fails closed rather than silently disabling itself.
 */
export function dial(level: number, opts?: { seed?: string | number }): Dial {
  active = new Dial(level, opts?.seed ?? defaultSeed());
  return active;
}

/** The dial currently set by `dial()`. */
export function getDial(): Dial {
  return active;
}

export function getLevel(): number {
  return active.level;
}

export function getState(): DialState {
  return active.toState();
}

/** Turn chaos off, preserving the seed so a failing run stays reproducible. */
export function resetDial(): void {
  active = new Dial(0, active.seed);
}

/** Derive an independent stream from the active dial. */
export function stream(key: string | number = ''): BreakStream {
  return active.stream(key);
}

/** True with probability `rate * level/10`, drawn from the active dial's shared stream. */
export function shouldBreak(rate = 0.5): boolean {
  return active.shouldBreak(rate);
}

export function pick<T>(arr: readonly T[]): T | undefined {
  return active.pick(arr);
}

export function levelLabel(level: number = active.level): string {
  if (!isUsableLevel(level) || level <= 0) return 'off';
  if (level <= 2) return 'paper-cut';
  if (level <= 4) return 'jank';
  if (level <= 7) return 'outage';
  return 'catastrophe';
}

const scenarios = new Map<string, ScenarioFn<any>>();

export function defineScenario<TCtx = unknown>(name: string, fn: ScenarioFn<TCtx>): void {
  scenarios.set(name, fn as ScenarioFn<any>);
}

export function listScenarios(): string[] {
  return [...scenarios.keys()];
}

export async function fire<TCtx = unknown>(name: string, ctx?: TCtx): Promise<void> {
  const fn = scenarios.get(name);
  if (!fn) throw new Error(`breakdial: unknown scenario "${name}" (known: ${listScenarios().join(', ') || 'none'})`);
  await fn(ctx);
}
