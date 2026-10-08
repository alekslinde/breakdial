# breakdial

One dial (`0`–`10`) that breaks anything — from UI jank to backend outage.

```ts
import { dial } from '@breakdial/core'
dial(6) // 0=off, 1-2=paper-cuts, 3-4=jank, 5-7=outage, 8-10=catastrophe
```

## Reproducible runs

Pass a `seed` to make a run repeatable, and derive one **stream** per concurrent
unit of work (a request, a page load, a job). Draws on one stream never shift
another's sequence, so the same seed replays the same faults even when requests
interleave:

```ts
const d = dial(6, { seed: 'ci-42' })

const s = d.stream(req.id)   // independent sequence, keyed
if (s.shouldBreak(0.7)) await injectLatency()
```

`@breakdial/fetch` and `@breakdial/express` do this for you, keyed on URL and
path by default — override with `key` if you need something finer:

```ts
wrapFetch({ key: (url, init) => `${init?.method ?? 'GET'} ${url}` })
```

The flat `shouldBreak()` / `pick()` helpers still work and draw from a shared
stream. They are order-dependent, so prefer `stream(key)` under concurrency.

A level that can't be read (`NaN`, `Infinity`, a non-number) clamps to `0`.
Fault injection fails **closed**: it never reports maximum chaos while
injecting nothing.

## Packages

Shipping now; `presets`, `dom`, `playwright` and a no-code HTTP chaos proxy are next.

```
packages/core     @breakdial/core     dial engine, seeded RNG, scenarios (zero-dep)
packages/fetch    @breakdial/fetch    wrapFetch(): latency / 500 / timeout / offline
packages/react    @breakdial/react    <BreakDial/> slider + useBreak()
packages/express  @breakdial/express  breaker() middleware: delay / 500 per level
packages/mcp      @breakdial/mcp      breakdial_set / fire / list / verify (agent remote)
```

## Run

```bash
npm install
npm test   # build + smoke
```

## Licence

| Part | Licence |
|---|---|
| `breakdial`, `@breakdial/core`, `/fetch`, `/react`, `/express`, `/mcp` | `Apache-2.0` |

Permissive: embed in closed products with credit + notices kept. Copyright 2026 Aleks Linde. See `NOTICE`, `TRADEMARKS.md`, and `CONTRIBUTING.md` (DCO sign-off). Nothing was published under an earlier licence.
