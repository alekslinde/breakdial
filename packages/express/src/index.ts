// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
import { getLevel, shouldBreak } from '@breakdial/core';

export interface BreakerOptions {
  latencyMs?: number;
  failureRate?: number;
  /** only break these path prefixes; empty = all */
  only?: string[];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Express-style middleware (works with express/fastify/hono adapters). */
export function breaker(opts: BreakerOptions = {}) {
  const { latencyMs = 250, failureRate = 0.4, only = [] } = opts;
  return async function breakdialMiddleware(req: any, res: any, next: any) {
    const level = getLevel();
    const path: string = req?.path ?? req?.url ?? '';
    if (level <= 0 || (only.length > 0 && !only.some((s) => path.startsWith(s)))) {
      return next();
    }
    if (shouldBreak(0.7)) await delay(latencyMs * (level / 2));
    if (shouldBreak(failureRate)) {
      res.statusCode = level >= 8 ? 503 : 500;
      res.end('breakdial: injected fault');
      return;
    }
    next();
  };
}
