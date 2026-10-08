<!--
SPDX-FileCopyrightText: 2026 Aleks Linde
SPDX-License-Identifier: Apache-2.0
-->

# @breakdial/core

The BreakDial engine: one dial, `0`–`10`, that decides how hard everything else
breaks. Zero dependencies, works in Node and the browser.

```bash
npm install @breakdial/core
```

```ts
import { dial } from '@breakdial/core'

dial(6, { seed: 'ci-42' })
// 0=off, 1-2 paper-cut, 3-4 jank, 5-7 outage, 8-10 catastrophe
```

## Reproducible runs

Pass a `seed` to make a run repeatable, and derive one **stream** per concurrent
unit of work (a request, a page load, a job). Draws on one stream never shift
another's sequence, so the same seed replays the same faults even when requests
interleave:

```ts
const d = dial(6, { seed: 'ci-42' })

const s = d.stream(req.id)        // independent, keyed sequence
if (s.shouldBreak(0.7)) await injectLatency()
```

Successive draws on one key still differ, so repeated requests to the same route
vary and retry paths stay reachable.

The flat `shouldBreak()` / `pick()` helpers draw from a shared stream and are
order-dependent — prefer `stream(key)` under concurrency.

## Scenarios

Name a specific failure so a test — or an agent, via `@breakdial/mcp` — can
trigger it on demand, rather than waiting for the dial to roll it:

```ts
import { defineScenario, fire } from '@breakdial/core'

defineScenario('payment-gateway-down', async (ctx) => {
  await ctx.server.stop()
})

await fire('payment-gateway-down', { server })
```

`fire()` awaits an async scenario and rejects on an unknown name, listing what
is registered. Defining the same name twice replaces it.

## Failing closed

A level that cannot be read (`NaN`, `Infinity`, a non-number) clamps to `0`.
Fault injection never reports maximum chaos while injecting nothing, because a
green suite that ran no faults is worse than a red one.

## API

| export | purpose |
|---|---|
| `dial(level, opts?)` | set the global dial, returns a `Dial` |
| `getDial()` / `getLevel()` / `getState()` | read the active dial |
| `resetDial()` | chaos off, seed preserved for reproduction |
| `Dial.stream(key)` | an independent, keyed sequence |
| `stream(key)` | same, from the active dial |
| `shouldBreak(rate)` / `pick(arr)` | shared-stream helpers |
| `levelLabel(level?)` | `off` / `paper-cut` / `jank` / `outage` / `catastrophe` |
| `defineScenario` / `listScenarios` / `fire` | named scenario registry |

## Adapters

`@breakdial/fetch`, `@breakdial/express`, `@breakdial/react` and
`@breakdial/mcp` all read this one shared dial — install core once.

## Licence

Apache-2.0. See [NOTICE](https://github.com/alekslinde/breakdial/blob/main/NOTICE).
