// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
import {
  dial, getDial, getLevel, getState, shouldBreak, levelLabel,
  defineScenario, fire, listScenarios, resetDial, Dial,
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

// --- pick() ----------------------------------------------------------------
{
  const d = dial(5, { seed: 'pick' });
  assert.equal(d.pick([]), undefined, 'empty array yields undefined');
  assert.equal(d.pick(['only']), 'only', 'single element always chosen');

  // Every element is reachable, and the choice is keyed and reproducible.
  const seen = new Set(
    Array.from({ length: 200 }, () => dial(5, { seed: 'pick-dist' }).stream('k').pick(['a', 'b', 'c'])),
  );
  assert.equal(seen.size, 1, 'a fresh dial + same key always picks the same element');
  const runs = [1, 2].map(() => {
    const dd = dial(5, { seed: 'pick-seq' });
    return Array.from({ length: 6 }, () => dd.stream('q').pick(['a', 'b', 'c'])).join('');
  });
  assert.equal(runs[0], runs[1], 'the same seed replays the same picks');
  assert.ok(new Set(runs[0]).size > 1, 'successive picks on one key vary');
}

// --- Dial / BreakStream used directly --------------------------------------
// Both are public exports, so a consumer can hold an isolated dial instead of
// the global one (parallel test workers, say).
{
  const d = new Dial(7, 'direct');
  assert.equal(d.level, 7);
  assert.equal(d.label, 'outage');
  assert.deepEqual(d.toState(), { level: 7, seed: 'direct' });
  // An isolated Dial must not disturb the global one.
  dial(2, { seed: 'global' });
  d.stream('x').shouldBreak(1);
  assert.equal(getLevel(), 2, 'a directly constructed Dial leaves the global dial alone');

  // rate 1 at level 7 means 70% per draw, not "always" — check the model
  // rather than a single draw.
  const s = new Dial(7, 'rate').stream('k');
  const hits = Array.from({ length: 1000 }, () => s.shouldBreak(1)).filter(Boolean).length;
  assert.ok(hits > 600 && hits < 800, `level 7 rate 1 should break ~70% of the time, got ${hits}/1000`);
  assert.equal(new Dial(10, 'certain').stream('k').shouldBreak(1), true, 'level 10 rate 1 is certain');
  assert.equal(new Dial(0, 'off').stream('k').shouldBreak(1), false, 'level 0 never breaks');
}

// --- scenarios -------------------------------------------------------------
defineScenario('smoke-ok', () => {});
assert.ok(listScenarios().includes('smoke-ok'));
await fire('smoke-ok');

let threw = false;
try { await fire('nope'); } catch { threw = true; }
assert.ok(threw, 'unknown scenario throws');

// ctx reaches the scenario, as the ScenarioFn<TCtx> type promises
let received;
defineScenario('with-ctx', (ctx) => { received = ctx; });
await fire('with-ctx', { user: 'u1' });
assert.deepEqual(received, { user: 'u1' }, 'fire passes ctx through');

// an async scenario is awaited, not fired and forgotten
let finished = false;
defineScenario('async-one', async () => {
  await new Promise((r) => setTimeout(r, 10));
  finished = true;
});
await fire('async-one');
assert.ok(finished, 'fire awaits an async scenario');

// redefining replaces rather than duplicating
defineScenario('dup', () => { received = 'first'; });
defineScenario('dup', () => { received = 'second'; });
await fire('dup');
assert.equal(received, 'second', 'the later definition wins');
assert.equal(listScenarios().filter((n) => n === 'dup').length, 1, 'no duplicate entry');

// the error names what is available, so a typo is diagnosable
try {
  await fire('nope');
  assert.fail('should have thrown');
} catch (e) {
  assert.ok(e.message.includes('smoke-ok'), 'the error lists registered scenarios');
}

// --- mcp -------------------------------------------------------------------
const { handleTool, TOOLS } = await import('../packages/mcp/dist/index.js');
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

// The stdio server must actually complete an MCP handshake and serve the
// tools. Compiling is not evidence that it speaks the protocol, so drive it
// with a real client over a spawned process.
{
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { fileURLToPath } = await import('node:url');
  const bin = fileURLToPath(new URL('../packages/mcp/dist/bin.js', import.meta.url));
  const repo = fileURLToPath(new URL('..', import.meta.url));

  const client = new Client({ name: 'breakdial-smoke', version: '0.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [bin],
    cwd: repo,
  }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['breakdial_fire', 'breakdial_list', 'breakdial_set', 'breakdial_verify'],
      'the server advertises every tool',
    );
    // The advertised schema is the one the dispatcher documents, so the two
    // cannot drift.
    assert.deepEqual(
      tools.find((t) => t.name === 'breakdial_set').inputSchema,
      TOOLS.find((t) => t.name === 'breakdial_set').inputSchema,
      'advertised schema matches TOOLS',
    );

    const set = await client.callTool({ name: 'breakdial_set', arguments: { level: 7, seed: 'agent' } });
    assert.deepEqual(JSON.parse(set.content[0].text), { level: 7, label: 'outage', seed: 'agent' });

    // A bad call is reported to the agent, not fatal to the session.
    const bad = await client.callTool({ name: 'breakdial_set', arguments: { level: 'loud' } });
    assert.equal(bad.isError, true, 'a rejected level is an error result');
    const unknown = await client.callTool({ name: 'breakdial_fire', arguments: { name: 'nope' } });
    assert.equal(unknown.isError, true, 'an unknown scenario is an error result');

    const after = await client.callTool({ name: 'breakdial_verify', arguments: {} });
    assert.equal(JSON.parse(after.content[0].text).level, 7, 'the server survives failed calls');
  } finally {
    await client.close();
  }
}

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
const inner = wrapFetch({ only: ['/x'], failureRate: 1, latencyMs: 0, timeoutRate: 0, offlineRate: 0 });
const outer = wrapFetch({ only: ['/never-matches'], latencyMs: 0 });
const nested = await fetch('http://h/x');
assert.equal(nested.status, 500, 'inner wrap not bypassed by outer');
outer();
inner();
assert.equal(globalThis.fetch, sentinel, 'reverse unwind restores original');

// `only` filter
dial(10, { seed: 'fetch-only' });
restore = wrapFetch({ only: ['/break'], failureRate: 1, latencyMs: 0, timeoutRate: 0, offlineRate: 0 });
assert.equal((await fetch('http://x/safe')).status, 200, 'unmatched URL untouched');
restore();
globalThis.fetch = sentinel;

// requests are keyed independently: two different URLs draw from their own
// streams, so one URL's faults never shift another's sequence.
const statusesFor = async (urls, key) => {
  dial(6, { seed: 'fetch-keys' });
  globalThis.fetch = sentinel;
  // Only the 500 fault, so the assertions below compare status codes. The
  // timeout and offline faults are tested on their own further down; leaving
  // them at their defaults here would hang or throw instead.
  const off = wrapFetch({
    latencyMs: 0,
    failureRate: 0.5,
    timeoutRate: 0,
    offlineRate: 0,
    ...(key ? { key } : {}),
  });
  const out = [];
  for (const u of urls) out.push((await fetch(u)).status);
  off();
  return out;
};
// Enough distinct URLs that per-URL and single-bucket keying cannot coincide
// by luck: with one bucket the draws advance together, so the pattern differs.
const urlsA = Array.from({ length: 12 }, (_, i) => `http://h/p${i}`);
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

// --- fetch: offline and timeout faults -------------------------------------
{
  // offline: the request never reaches the network, as when it is down
  dial(10, { seed: 'offline' });
  globalThis.fetch = sentinel;
  let off = wrapFetch({ offlineRate: 1, latencyMs: 0 });
  await assert.rejects(
    () => fetch('http://h/x'),
    (e) => e instanceof TypeError && /offline/.test(e.message),
    'offline rejects with a TypeError, like a browser with no network',
  );
  off();

  // timeout: honours the caller's own deadline, so a client with an
  // AbortController gives up on schedule instead of waiting out the hang
  dial(10, { seed: 'timeout-abort' });
  off = wrapFetch({ timeoutRate: 1, offlineRate: 0, latencyMs: 0, timeoutMs: 30_000 });
  const ac = new AbortController();
  const started = Date.now();
  setTimeout(() => ac.abort(), 50);
  await assert.rejects(
    () => fetch('http://h/x', { signal: ac.signal }),
    (e) => e.name === 'AbortError',
    'a caller signal aborts the hang',
  );
  assert.ok(Date.now() - started < 5000, 'the client deadline won, not the 30s hang');
  off();

  // timeout: rejects on its own deadline when the caller has none
  dial(10, { seed: 'timeout-own' });
  off = wrapFetch({ timeoutRate: 1, offlineRate: 0, latencyMs: 0, timeoutMs: 60 });
  // The hang's timer is unref'd, so hold the loop open to observe it firing.
  const keepAlive = setInterval(() => {}, 10);
  try {
    await assert.rejects(
      () => fetch('http://h/x'),
      (e) => e.name === 'TimeoutError',
      'the hang eventually rejects as a timeout',
    );
  } finally {
    clearInterval(keepAlive);
    off();
  }

  // both faults are off at level 0
  dial(0);
  off = wrapFetch({ offlineRate: 1, timeoutRate: 1, timeoutMs: 10 });
  assert.equal((await fetch('http://h/x')).status, 200, 'level 0 injects neither fault');
  off();
  globalThis.fetch = sentinel;
}

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

// --- react -----------------------------------------------------------------
// The component owns `type` and `value`. Omit<> in the prop type is erased at
// runtime, so a plain-JS caller must not be able to override either.
{
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { BreakDial } = await import('../packages/react/dist/index.js');
  const { createElement } = await import('react');

  dial(6, { seed: 'react-smoke' });
  const plain = renderToStaticMarkup(createElement(BreakDial));
  assert.ok(plain.includes('type="range"'), 'renders a range input');
  assert.ok(plain.includes('value="6"'), 'reflects the dial level');

  // useBreak works on its own, not only inside BreakDial, and reads the
  // engine rather than keeping separate state.
  const { useBreak } = await import('../packages/react/dist/index.js');
  dial(3, { seed: 'hook' });
  const Probe = () => {
    const [level, setLevel] = useBreak();
    assert.equal(typeof setLevel, 'function', 'useBreak returns a setter');
    return createElement('span', null, `level=${level}`);
  };
  assert.ok(
    renderToStaticMarkup(createElement(Probe)).includes('level=3'),
    'useBreak reads the current dial level',
  );
  // and setting through it preserves the seed, so a reproducible run keeps
  // reproducing after someone moves the slider
  const { useBreak: hook } = await import('../packages/react/dist/index.js');
  dial(2, { seed: 'keep-this-seed' });
  const Setter = () => {
    const [, setLevel] = hook();
    setLevel(9);
    return null;
  };
  try { renderToStaticMarkup(createElement(Setter)); } catch { /* setState during render */ }
  assert.equal(getState().seed, 'keep-this-seed', 'setLevel carries the seed forward');

  dial(6, { seed: 'react-smoke' });
  const hostile = renderToStaticMarkup(
    createElement(BreakDial, { type: 'text', value: 99, className: 'keep-me' }),
  );
  assert.ok(hostile.includes('type="range"'), 'caller cannot change the input type');
  assert.ok(!hostile.includes('type="text"'), 'type="text" is not honoured');
  assert.ok(hostile.includes('value="6"'), 'caller cannot desync the value');
  assert.ok(hostile.includes('keep-me'), 'unrelated props still pass through');
}

// --- engines.node floor ----------------------------------------------------
// A prerelease sorts below its release, so 22.14.0-rc.1 must NOT satisfy
// >=22.14.0 — accepting it is the unsafe direction for this check.
{
  const { satisfiesFloor } = await import('./check-node-floor.mjs');
  const cases = [
    ['22.14.0', '>=22.14.0', true],
    ['22.13.0', '>=22.14.0', false],
    ['22.14.0-rc.1', '>=22.14.0', false],
    ['22.15.0-rc.1', '>=22.14.0', true],
    ['22.14.1', '>=22.14.0', true],
    ['24.0.0', '>=22.14.0', true],
    ['22.14.0', '>=22.14.0 <25', true],
    ['22.14.0', '^22.14.0', false], // unsupported range is reported, not assumed ok
    ['22.14.0', '', false],
    ['22.14.0', undefined, false],
  ];
  for (const [version, range, want] of cases) {
    const { ok } = satisfiesFloor(version, range);
    assert.equal(ok, want, `satisfiesFloor(${version}, ${JSON.stringify(range)})`);
  }
}

// --- cli -------------------------------------------------------------------
const { run: cliRun, parseArgs } = await import('../packages/breakdial/dist/cli.js');

assert.equal(cliRun(['--level', '3'], '9.9.9').code, 0, 'valid level exits 0');
assert.equal(cliRun(['--help'], '9.9.9').code, 0);
assert.deepEqual(cliRun(['--version'], '9.9.9').out, ['9.9.9'], '--version prints the version');

// usage errors exit 2 and explain themselves on stderr.
// The `--level` cases matter most: Number() would accept '', ' ', '0x5', '1e1'
// and silently round '3.7', so an empty CI variable would exit 0 with chaos
// off — a green run that injected nothing.
for (const argv of [
  [], ['--level', '11'], ['--level', '-1'], ['--level', 'loud'], ['--bogus'], ['--level'],
  ['--=oops'], ['--'],
  ['--level', ''], ['--level', ' '], ['--level', '0x5'], ['--level', '1e1'],
  ['--level', '3.7'], ['--level', '1_0'], ['--level', 'Infinity'], ['--level', 'NaN'],
]) {
  const r = cliRun(argv, '9.9.9');
  assert.equal(r.code, 2, `${JSON.stringify(argv)} is a usage error`);
  assert.ok(r.err.join('\n').includes('breakdial:'), 'usage error names the tool');
  assert.deepEqual(r.out, [], `${JSON.stringify(argv)} writes nothing to stdout`);
}

// A token with no option name reports that, rather than `unknown option "--"`,
// which names nothing back to the user.
for (const argv of [['--=oops'], ['--'], ['-']]) {
  const r = cliRun(argv, '9.9.9');
  assert.ok(
    r.err.join('\n').includes('expected an option name'),
    `${JSON.stringify(argv)} should report a missing option name, got ${JSON.stringify(r.err[0])}`,
  );
}

// No error may echo a supplied value: a seed or token mistyped into any flag
// would otherwise land in stderr and CI logs. Covers every shape that carries
// a value, including the single-dash `-=x` form.
for (const argv of [
  ['--level', '3', '--sed=super-secret'],
  ['-=super-secret'],
  ['--level', 'super-secret'],
  ['--level=super-secret'],
  ['-l=super-secret'],
  ['--seed=ok', '--bogus=super-secret'],
]) {
  const r = cliRun(argv, '9.9.9');
  assert.equal(r.code, 2, `${JSON.stringify(argv)} is a usage error`);
  assert.ok(
    !r.err.join('\n').includes('super-secret'),
    `${JSON.stringify(argv)} must not echo the supplied value, got ${JSON.stringify(r.err[0])}`,
  );
}
// the unknown-flag error still names the flag, so the message stays useful
assert.ok(
  cliRun(['--sed=x'], '9.9.9').err.join('\n').includes('--sed'),
  'unknown option still names the flag',
);

// A flag-shaped value means the real value was omitted. `--seed --version`
// would otherwise record "--version" as the seed and drop the flag, so the
// seed reported for a failed run would not match the command that ran.
for (const argv of [['--seed', '--version'], ['--level', '--seed'], ['--seed', '-v']]) {
  const r = cliRun(argv, '9.9.9');
  assert.equal(r.code, 2, `${JSON.stringify(argv)} is a usage error`);
  assert.ok(r.err.join('\n').includes('needs a value'), 'says the value is missing');
}
// but an inline value may legitimately start with a dash
assert.equal(parseArgs(['--level', '3', '--seed=-dash']).seed, '-dash', 'inline dash value is kept');

// --flag=value and short flags
assert.equal(parseArgs(['--level=6']).level, 6, '--flag=value form');
assert.equal(parseArgs(['-l', '6', '-s', 'abc']).seed, 'abc', 'short flags');

// every valid level is accepted, and only those
for (let n = 0; n <= 10; n++) {
  assert.equal(parseArgs(['--level', String(n)]).level, n, `level ${n} accepted`);
}

// the level given actually reaches the engine
cliRun(['--level', '8', '--seed', 'cli-seed'], '9.9.9');
assert.equal(getLevel(), 8, 'cli sets the dial');
assert.equal(getState().seed, 'cli-seed', 'cli passes the seed through');

// --app rejects the whole invocation rather than accepting a level and seed
// and then silently discarding them.
for (const argv of [
  ['--level', '3', '--app', 'http://localhost:3000'],
  ['--app', 'http://localhost:3000', '--level', '8', '--seed', 'ci-42'],
  ['-a', 'http://localhost:3000', '-l', '4'],
]) {
  const r = cliRun(argv, '9.9.9');
  assert.equal(r.code, 2, '--app is a usage error, not a partial success');
  assert.ok(r.err.join('\n').includes('@breakdial/proxy'), '--app names what it needs');
  assert.deepEqual(r.out, [], '--app writes nothing to stdout');
}
// and it must not have touched the dial on the way out
dial(0, { seed: 'untouched' });
cliRun(['--level', '9', '--app', 'http://localhost:3000'], '9.9.9');
assert.equal(getLevel(), 0, '--app leaves the dial alone');

// --app still requires its value, so the next token is not eaten as a level
assert.equal(cliRun(['--app'], '9.9.9').code, 2, '--app with no value is a usage error');

// The bin runs when invoked through a symlink, as npm/npx install it. The
// entry-point guard compares argv[1] to import.meta.url, which never matches
// through a symlink unless both are realpath'd — and the failure is silent:
// exit 0, no output. Importing run() cannot catch that, so spawn it.
{
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { mkdtempSync, symlinkSync, rmSync, statSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  // import-relative, like every other path here, so the suite runs from any cwd
  const cli = fileURLToPath(new URL('../packages/breakdial/dist/cli.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'breakdial-bin-'));
  try {
    const direct = execFileSync(process.execPath, [cli, '--level', '5'], { encoding: 'utf8' });
    assert.ok(direct.includes('level 5'), 'cli prints when run directly');

    // Reproduce how npm installs a bin: a symlink outside the package tree
    // pointing at the real file, launched via its shebang rather than an
    // explicit `node`. Passing process.execPath would make both the mode and
    // the shebang irrelevant, and copying the file elsewhere would break its
    // own resolution of @breakdial/core.
    assert.ok(
      readFileSync(cli, 'utf8').startsWith('#!'),
      'dist/cli.js keeps its shebang, or an exec-ed bin cannot start',
    );
    // tsc emits 0644, so the build chmods it; npm would also do this on
    // install, but a clone should be able to run the bin too.
    assert.ok(statSync(cli).mode & 0o111, 'dist/cli.js is executable after build');
    const link = join(dir, 'breakdial');
    symlinkSync(cli, link);

    const viaLink = spawnSync(link, ['--level', '5'], { encoding: 'utf8' });
    assert.equal(viaLink.error, undefined, `bin failed to exec: ${viaLink.error?.message ?? ''}`);
    assert.equal(viaLink.status, 0, 'cli exits 0 through a symlink');
    assert.ok(
      viaLink.stdout.includes('level 5'),
      `cli must produce output through a symlink (npx path), got ${JSON.stringify(viaLink.stdout)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

resetDial();
console.log('smoke OK: core + mcp + fetch + express + react + cli (streams, fail-closed, restore)');
