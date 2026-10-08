<!--
SPDX-FileCopyrightText: 2026 Aleks Linde
SPDX-License-Identifier: Apache-2.0
-->

# @breakdial/fetch

Breaks `fetch`: latency, 500s and aborts, scaled by the BreakDial level.

```bash
npm install @breakdial/fetch
```

```ts
import { dial } from '@breakdial/core'
import { wrapFetch } from '@breakdial/fetch'

const restore = wrapFetch({ only: ['/api'] })
dial(6, { seed: 'ci-42' })

// ... run your tests ...

restore()
```

## Options

| option | default | purpose |
|---|---|---|
| `latencyMs` | `300` | base delay, scaled by level (L10 adds ~3000ms) |
| `failureRate` | `0.5` | probability of an injected 500 at L10 |
| `timeoutMs` | `30000` | how long a timeout fault hangs before rejecting |
| `timeoutRate` | `0.1` | probability of a hang at L10 |
| `offlineRate` | `0.1` | probability of an offline blip at L10 |
| `only` | `[]` | match these URL substrings; empty matches all |
| `key` | URL | stream key per request (see below) |

## Faults

| fault | what your code sees |
|---|---|
| latency | the request resolves late |
| offline | `TypeError: failed to fetch`, as when the network is down |
| timeout | hangs, then `TimeoutError` — or `AbortError` if your own signal fires first |
| error response | a real `Response` with status `500` |
| abort | `AbortError` (level 8+ only) |

They are evaluated in a fixed order, so a given seed always produces the same
fault for the same request.

Set `timeoutMs` above your client's own deadline to assert the client gives up
first; the hang honours an `AbortSignal` you pass in. The timer is unref'd, so
a hung request never keeps an otherwise idle Node process alive.

## Reproducibility

Each request draws from its own stream, keyed on the URL by default, so
concurrent requests stay independently reproducible under a fixed seed. Override
when the URL is too coarse:

```ts
wrapFetch({ key: (url, init) => `${init?.method ?? 'GET'} ${url}` })
```

## Restoring

`wrapFetch()` returns `restore()`. Wraps compose, so an inner wrap's faults still
apply through an outer one, and a stale `restore()` is a no-op rather than
clobbering a newer wrap. Unwind in reverse order to remove them all.

## Licence

Apache-2.0. See [NOTICE](https://github.com/alekslinde/breakdial/blob/main/NOTICE).
