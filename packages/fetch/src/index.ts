// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
import { getDial } from '@breakdial/core';

export interface WrapFetchOptions {
  /** base latency ms scaled by level (default 300 => L10 adds ~3000ms) */
  latencyMs?: number;
  /** probability of 500 at L10 (default 0.5) */
  failureRate?: number;
  /** match only these URL substrings; empty = all */
  only?: string[];
  /**
   * Stream key per call, so concurrent requests stay independently
   * reproducible. Defaults to the request URL: same URL => same faults.
   */
  key?: (url: string, init?: RequestInit) => string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Monkey-patches globalThis.fetch. Returns restore().
 *
 * Nests by composing: an inner wrap's faults still apply through an outer one.
 * restore() is a no-op unless it still owns the global, so a stale restore
 * cannot clobber a newer wrap; unwind in reverse order to fully remove.
 */
export function wrapFetch(opts: WrapFetchOptions = {}): () => void {
  const orig = globalThis.fetch;
  if (!orig) throw new Error('breakdial/fetch: global fetch not available');
  const { latencyMs = 300, failureRate = 0.5, only = [], key } = opts;

  const patched = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const dial = getDial();
    if (dial.level <= 0 || (only.length > 0 && !only.some((s) => url.includes(s)))) {
      return orig.call(globalThis, input, init);
    }
    // One stream per request: draws here never shift any other request's
    // sequence, so a seeded run reproduces under concurrency.
    const s = dial.stream(key ? key(url, init) : url);
    if (s.shouldBreak(0.7)) await delay(latencyMs * (dial.level / 2));
    if (s.shouldBreak(failureRate)) {
      return new Response('breakdial: injected 500', { status: 500 });
    }
    if (dial.level >= 8 && s.shouldBreak(0.2)) {
      throw new DOMException('breakdial: injected abort', 'AbortError');
    }
    return orig.call(globalThis, input, init);
  }) as typeof fetch;

  globalThis.fetch = patched;

  return () => {
    // Only restore if we still own the global: a stale restore() must not
    // clobber a newer wrap.
    if (globalThis.fetch === patched) globalThis.fetch = orig;
  };
}
