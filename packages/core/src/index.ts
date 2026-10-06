// @breakdial/core — dial engine. Zero dependencies, works in browser + node.

export type BreakLevel = number; // clamped 0-10

export interface DialState {
  level: number;
  seed: number;
}

export type ScenarioFn<TCtx = unknown> = (ctx: TCtx) => void | Promise<void>;

const scenarios = new Map<string, ScenarioFn<any>>();

let state: DialState = { level: 0, seed: 1 };
let rngState = 1 >>> 0;

function hashSeed(seed: string | number): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function nextRandom(): number {
  // mulberry32
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Set the chaos dial. 0=off, 1-2=paper-cuts, 3-4=jank, 5-7=outage, 8-10=catastrophe. */
export function dial(level: number, opts?: { seed?: string | number }): DialState {
  const clamped = Math.max(0, Math.min(10, Math.round(level)));
  const seed = hashSeed(opts?.seed ?? Date.now() % 2147483647);
  state = { level: clamped, seed };
  rngState = seed === 0 ? 1 : seed;
  return { ...state };
}

export function getLevel(): number {
  return state.level;
}

export function getState(): DialState {
  return { ...state };
}

export function resetDial(): void {
  state = { level: 0, seed: 1 };
  rngState = 1;
}

/** True with probability `rate * level/10`. rate=1 + level 10 => always. level 0 => never. */
export function shouldBreak(rate = 0.5): boolean {
  if (state.level <= 0) return false;
  if (state.level >= 10 && rate >= 1) return true;
  return nextRandom() < rate * (state.level / 10);
}

export function pick<T>(arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(nextRandom() * arr.length)];
}

export function levelLabel(level: number = state.level): string {
  if (level <= 0) return 'off';
  if (level <= 2) return 'paper-cut';
  if (level <= 4) return 'jank';
  if (level <= 7) return 'outage';
  return 'catastrophe';
}

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
