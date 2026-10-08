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
| `only` | `[]` | match these URL substrings; empty matches all |
| `key` | URL | stream key per request (see below) |

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
