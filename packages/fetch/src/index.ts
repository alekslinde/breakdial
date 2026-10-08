// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
import { getDial } from '@breakdial/core';

export interface WrapFetchOptions {
  /** base latency ms scaled by level (default 300 => L10 adds ~3000ms) */
  latencyMs?: number;
  /** probability of 500 at L10 (default 0.5) */
  failureRate?: number;
  /**
   * How long a `timeout` fault hangs before rejecting, in ms (default 30000).
   * Set it above your client's own deadline to assert the client gives up
   * first, or below to see what your code does with a `TimeoutError`.
   *
   * The timer is unref'd, so a hung request never keeps an otherwise idle
   * Node process alive — if nothing else is pending, the process exits
   * instead of waiting out the hang.
   */
  timeoutMs?: number;
  /** probability of a hang at L10 (default 0.1) */
  timeoutRate?: number;
  /** probability of an offline blip at L10 (default 0.1) */
  offlineRate?: number;
  /** match only these URL substrings; empty = all */
  only?: string[];
  /**
   * Stream key per call, so concurrent requests stay independently
   * reproducible. Defaults to the request URL: same URL => same faults.
   */
  key?: (url: string, init?: RequestInit) => string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The error a browser throws when the network is gone. */
function offlineError(): Error {
  return new TypeError('breakdial: injected offline — failed to fetch');
}

/**
 * Hangs, then rejects as a timed-out request would.
 *
 * Honours the caller's own AbortSignal, so a client with a deadline aborts on
 * schedule and the test asserts the client's behaviour rather than this timer.
 * The timer is unref'd where the runtime allows it, so a hung request cannot
 * by itself hold a Node process open.
 */
function hang(ms: number, signal?: AbortSignal | null): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('breakdial: injected timeout', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      reject(new DOMException(`breakdial: injected timeout after ${ms}ms`, 'TimeoutError'));
    }, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('breakdial: injected timeout', 'AbortError'));
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

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
  const {
    latencyMs = 300,
    failureRate = 0.5,
    timeoutMs = 30_000,
    timeoutRate = 0.1,
    offlineRate = 0.1,
    only = [],
    key,
  } = opts;

  const patched = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const dial = getDial();
    if (dial.level <= 0 || (only.length > 0 && !only.some((s) => url.includes(s)))) {
      return orig.call(globalThis, input, init);
    }
    // One stream per request: draws here never shift any other request's
    // sequence, so a seeded run reproduces under concurrency.
    const s = dial.stream(key ? key(url, init) : url);

    // Order matters and is fixed, so a given seed always produces the same
    // fault for a request: offline (never reached the network) before latency,
    // then timeout, then an error response.
    if (s.shouldBreak(offlineRate)) throw offlineError();

    if (s.shouldBreak(0.7)) await delay(latencyMs * (dial.level / 2));

    if (s.shouldBreak(timeoutRate)) {
      const signal: AbortSignal | undefined = init?.signal ?? input?.signal;
      await hang(timeoutMs, signal);
    }

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
