// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
import { getDial } from '@breakdial/core';

export interface BreakerOptions {
  latencyMs?: number;
  failureRate?: number;
  /** only break these path prefixes; empty = all */
  only?: string[];
  /**
   * Stream key per request, so concurrent requests stay independently
   * reproducible. Defaults to the request path.
   */
  key?: (req: any) => string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Express-style middleware (works with express/fastify/hono adapters). */
export function breaker(opts: BreakerOptions = {}) {
  const { latencyMs = 250, failureRate = 0.4, only = [], key } = opts;
  return async function breakdialMiddleware(req: any, res: any, next: any) {
    const dial = getDial();
    // `?? ''` would let a present-but-empty path through the `only` filter and
    // skip faults on exactly the targeted routes; treat empty as unmatched.
    const path: string = req?.path || req?.url || '';
    if (dial.level <= 0 || (only.length > 0 && !only.some((s) => path.startsWith(s)))) {
      return next();
    }
    try {
      // One stream per request — see wrapFetch for the same reasoning.
      const s = dial.stream(key ? key(req) : path);
      if (s.shouldBreak(0.7)) await delay(latencyMs * (dial.level / 2));
      if (s.shouldBreak(failureRate)) {
        // The client may have given up during the delay above.
        if (res.headersSent || res.writableEnded) return;
        res.statusCode = dial.level >= 8 ? 503 : 500;
        res.end('breakdial: injected fault');
        return;
      }
    } catch (err) {
      // After an await, a throw is an unhandled rejection rather than a
      // routed error, so hand it to the error middleware explicitly.
      next(err);
      return;
    }
    // Outside the try: a downstream sync throw must propagate to Express,
    // not come back here and call next() a second time.
    next();
  };
}
