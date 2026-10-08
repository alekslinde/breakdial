// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
import {
  dial, getDial, getLevel, getState, shouldBreak, levelLabel,
  defineScenario, fire, listScenarios, resetDial,
} from '../packages/core/dist/index.js';
import assert from 'node:assert';

// --- dial basics -----------------------------------------------------------
dial(0);
assert.equal(getLevel(), 0);
assert.equal(shouldBreak(1), false, 'L0 never breaks');

dial(10, { seed: 'ci-42' });
assert.equal(getLevel(), 10);
assert.equal(shouldBreak(1), true, 'L10 rate=1 always breaks');
assert.equal(levelLabel(), 'catastrophe');

// --- fail closed on unreadable input ---------------------------------------
// NaN must mean "no chaos", never "max chaos with injection silently off".
for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'loud']) {
  const d = dial(bad);
  assert.equal(d.level, 0, `level ${String(bad)} clamps to 0`);
  assert.equal(d.label, 'off', `level ${String(bad)} labels as off`);
  assert.equal(d.shouldBreak(1), false, `level ${String(bad)} never breaks`);
}
assert.equal(levelLabel(NaN), 'off', 'levelLabel(NaN) is off, not catastrophe');

// --- seeds stay distinct ---------------------------------------------------
const seq = (seed) => {
  const d = dial(5, { seed });
  return Array.from({ length: 8 }, () => d.stream('k').random());
};
assert.notDeepEqual(seq(0), seq(1), 'seeds 0 and 1 differ');
assert.notDeepEqual(seq(0.5), seq(0.25), 'fractional seeds stay distinct');
assert.notDeepEqual(seq('a'), seq('b'), 'string seeds differ');
assert.deepEqual(seq('same'), seq('same'), 'same seed reproduces');

// --- seed survives reset (reproduction info must not be destroyed) ---------
dial(7, { seed: 'keep-me' });
resetDial();
assert.equal(getLevel(), 0, 'reset turns chaos off');
assert.equal(getState().seed, 'keep-me', 'reset preserves the seed');

// --- streams: independent AND advancing ------------------------------------
// Both properties must hold at once, and each is checked against a fresh dial
// so the test can actually fail.
// Re-resolve the stream on every draw, exactly as wrapFetch/breaker do per
// request. Holding one stream object in a local would mask a stateless
// per-call stream, since a retained object advances its own state fine.
const drawSolo = (seed, k, n) => {
  const dd = dial(5, { seed });
  return Array.from({ length: n }, () => dd.stream(k).random());
};
const soloA = drawSolo('concurrency', 'a', 6);
const soloB = drawSolo('concurrency', 'b', 6);

// (1) advancing: successive draws on one key differ. A stateless per-call
// stream freezes each key's outcome forever and fails here.
assert.equal(new Set(soloA).size, soloA.length, 'draws on one key advance');

// (2) independent: interleaving draws across keys does not change either
// sequence, so concurrent requests reproduce.
const d = dial(5, { seed: 'concurrency' });
const woven = { a: [], b: [] };
for (let i = 0; i < 6; i++) {
  woven.b.push(d.stream('b').random()); // re-resolve each time: same stream
  woven.a.push(d.stream('a').random());
}
assert.deepEqual(woven.a, soloA, 'stream a unaffected by draws on b');
assert.deepEqual(woven.b, soloB, 'stream b unaffected by draws on a');
assert.notDeepEqual(soloA, soloB, 'different keys give different sequences');

// stream(key) is stable per dial, and reset by a new dial()
const d2 = dial(5, { seed: 'stable' });
assert.equal(d2.stream('x'), d2.stream('x'), 'same key returns the same stream');

// typed seeds don't collide
assert.notDeepEqual(drawSolo(42, 'k', 4), drawSolo('42', 'k', 4), "42 and '42' differ");

// shouldBreak advances the stream regardless of rate, so later draws stay put
const pos = (rate) => {
  const dd = dial(10, { seed: 'rate-pos' });
  dd.stream('k').shouldBreak(rate);
  return dd.stream('k').random();
};
assert.equal(pos(1), pos(0.3), 'stream position does not depend on rate');

// faults on one key vary across requests (retry paths are reachable)
const dv = dial(5, { seed: 'vary' });
const outcomes = new Set(Array.from({ length: 24 }, () => dv.stream('/checkout').shouldBreak(0.5)));
assert.equal(outcomes.size, 2, 'repeated requests to one route both break and pass');

// --- scenarios -------------------------------------------------------------
defineScenario('smoke-ok', () => {});
assert.ok(listScenarios().includes('smoke-ok'));
await fire('smoke-ok');

let threw = false;
try { await fire('nope'); } catch { threw = true; }
assert.ok(threw, 'unknown scenario throws');

// --- mcp -------------------------------------------------------------------
const { handleTool } = await import('../packages/mcp/dist/index.js');
const out = await handleTool('breakdial_set', { level: 3, seed: 'mcp-seed' });
assert.equal(out.level, 3);
assert.equal(out.label, 'jank');
assert.equal(out.seed, 'mcp-seed');

const verified = await handleTool('breakdial_verify');
assert.equal(verified.level, 3);
assert.equal(verified.seed, 'mcp-seed', 'verify reports the reproduction seed');

let mcpThrew = false;
try { await handleTool('breakdial_set', { level: 'loud' }); } catch { mcpThrew = true; }
assert.ok(mcpThrew, 'mcp rejects a non-numeric level instead of reporting NaN');

// --- fetch -----------------------------------------------------------------
const { wrapFetch } = await import('../packages/fetch/dist/index.js');
const sentinel = async () => new Response('real', { status: 200 });

globalThis.fetch = sentinel;
dial(0);
let restore = wrapFetch();
assert.equal((await fetch('http://x/ok')).status, 200, 'L0 passes through');
restore();
assert.equal(globalThis.fetch, sentinel, 'restore() reinstates the exact original');

// a stale restore() must not clobber a newer wrap
globalThis.fetch = sentinel;
const r1 = wrapFetch();
const afterFirst = globalThis.fetch;
const r2 = wrapFetch();
r1(); // r1 no longer owns the global; must be a no-op
assert.notEqual(globalThis.fetch, sentinel, 'stale restore() does not clobber the newer wrap');
r2();
assert.equal(globalThis.fetch, afterFirst, 'owning restore() unwinds one layer');
globalThis.fetch = sentinel;

// a nested wrap composes: the inner wrap's faults still apply through the outer.
// failureRate 1 at L10 is certain regardless of where the RNG sits, so this
// pins composition rather than a particular draw.
globalThis.fetch = sentinel;
dial(10, { seed: 'nested' });
const inner = wrapFetch({ only: ['/x'], failureRate: 1, latencyMs: 0 });
const outer = wrapFetch({ only: ['/never-matches'], latencyMs: 0 });
const nested = await fetch('http://h/x');
assert.equal(nested.status, 500, 'inner wrap not bypassed by outer');
outer();
inner();
assert.equal(globalThis.fetch, sentinel, 'reverse unwind restores original');

// `only` filter
dial(10, { seed: 'fetch-only' });
restore = wrapFetch({ only: ['/break'], failureRate: 1, latencyMs: 0 });
assert.equal((await fetch('http://x/safe')).status, 200, 'unmatched URL untouched');
restore();
globalThis.fetch = sentinel;

// requests are keyed independently: two different URLs draw from their own
// streams, so one URL's faults never shift another's sequence.
const statusesFor = async (urls, key) => {
  dial(4, { seed: 'fetch-keys' });
  globalThis.fetch = sentinel;
  const off = wrapFetch({ latencyMs: 0, failureRate: 0.5, ...(key ? { key } : {}) });
  const out = [];
  for (const u of urls) out.push((await fetch(u)).status);
  off();
  return out;
};
const urlsA = ['http://h/a', 'http://h/b', 'http://h/c', 'http://h/d'];
// Interleaving a second URL must not change what /a sees.
const soloRuns = await statusesFor(['http://h/a', 'http://h/a', 'http://h/a']);
const wovenRuns = await statusesFor(['http://h/a', 'http://h/zzz', 'http://h/a', 'http://h/zzz', 'http://h/a']);
assert.deepEqual(
  wovenRuns.filter((_, i) => i % 2 === 0), soloRuns,
  '/a sees the same sequence regardless of other URLs in flight',
);
// A custom key changes the grouping, so it must change the outcome pattern.
const byUrl = await statusesFor(urlsA);
const oneBucket = await statusesFor(urlsA, () => 'same-bucket');
assert.notDeepEqual(byUrl, oneBucket, 'the key function selects the stream');
globalThis.fetch = sentinel;

// --- express ---------------------------------------------------------------
const { breaker } = await import('../packages/express/dist/index.js');
const run = (mw, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200, headersSent: false, writableEnded: false,
      end() { this.writableEnded = true; resolve({ outcome: 'ended', status: this.statusCode }); },
    };
    mw(req, res, (err) => resolve({ outcome: err ? 'error' : 'next', err }));
  });

dial(0);
assert.equal((await run(breaker(), { path: '/a' })).outcome, 'next', 'L0 calls next()');

dial(10, { seed: 'express-fault' });
const hit = await run(breaker({ failureRate: 1, latencyMs: 0 }), { path: '/a' });
assert.equal(hit.outcome, 'ended');
assert.equal(hit.status, 503, 'L10 serves 503');

// `only` must actually gate: a matching path breaks, a non-matching one doesn't,
// and an empty path counts as non-matching rather than slipping through.
const gated = (req) => run(breaker({ only: ['/checkout'], failureRate: 1, latencyMs: 0 }), req);
assert.equal((await gated({ path: '/checkout' })).outcome, 'ended', 'only: matching path breaks');
assert.equal((await gated({ path: '/health' })).outcome, 'next', 'only: other path passes');
// A present-but-empty `path` must fall through to `url` rather than being
// taken as the route. With `??` it would read as '', match no prefix, and
// skip faults on exactly the route `only` targets.
assert.equal((await gated({ path: '', url: '/checkout/pay' })).outcome, 'ended',
  'empty path falls through to url and still matches only');
// With neither present there is nothing to match, so it passes through.
assert.equal((await gated({ path: '', url: '' })).outcome, 'next', 'no path at all is unmatched');

// a downstream throw must reach the caller, and next() must run exactly once
dial(10, { seed: 'passthrough' });
let nextCalls = 0;
let propagated = false;
try {
  await breaker({ failureRate: 0, latencyMs: 0 })(
    { path: '/a' },
    { statusCode: 200, headersSent: false, writableEnded: false, end() {} },
    () => { nextCalls++; throw new Error('downstream'); },
  );
} catch { propagated = true; }
assert.equal(nextCalls, 1, 'next() called exactly once');
assert.ok(propagated, 'downstream throw reaches the caller');

// an injected fault routes through next(err) rather than rejecting
dial(10, { seed: 'route-err' });
const routed = await run(
  breaker({ failureRate: 1, latencyMs: 0, key: () => { throw new Error('keyfn'); } }),
  { path: '/a' },
);
assert.equal(routed.outcome, 'error', 'an internal throw goes to next(err)');
assert.equal(routed.err?.message, 'keyfn');

// already-committed response is left alone
dial(10, { seed: 'committed' });
const committed = await new Promise((resolve) => {
  const res = { statusCode: 200, headersSent: true, writableEnded: false, end() { resolve('ended'); } };
  breaker({ failureRate: 1, latencyMs: 0 })({ path: '/a' }, res, () => resolve('next'));
  setTimeout(() => resolve('untouched'), 20);
});
assert.equal(committed, 'untouched', 'does not write to a committed response');

resetDial();
console.log('smoke OK: core + mcp + fetch + express (streams, fail-closed, restore)');
