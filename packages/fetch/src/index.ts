// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
import { getLevel, shouldBreak } from '@breakdial/core';

export interface WrapFetchOptions {
  /** base latency ms scaled by level (default 300 => L10 adds ~3000ms) */
  latencyMs?: number;
  /** probability of 500 at L10 (default 0.5) */
  failureRate?: number;
  /** match only these URL substrings; empty = all */
  only?: string[];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Monkey-patches globalThis.fetch. Returns restore(). */
export function wrapFetch(opts: WrapFetchOptions = {}): () => void {
  const orig = globalThis.fetch?.bind(globalThis);
  if (!orig) throw new Error('breakdial/fetch: global fetch not available');
  const { latencyMs = 300, failureRate = 0.5, only = [] } = opts;

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const level = getLevel();
    if (level <= 0 || (only.length > 0 && !only.some((s) => url.includes(s)))) {
      return orig(input, init);
    }
    if (shouldBreak(0.7)) await delay(latencyMs * (level / 2));
    if (shouldBreak(failureRate)) {
      return new Response('breakdial: injected 500', { status: 500 });
    }
    if (level >= 8 && shouldBreak(0.2)) {
      throw new DOMException('breakdial: injected abort', 'AbortError');
    }
    return orig(input, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = orig;
  };
}
