<!--
SPDX-FileCopyrightText: 2026 Aleks Linde
SPDX-License-Identifier: Apache-2.0
-->

# @breakdial/express

Express-style middleware that injects delay, 500s and 503s, scaled by the
BreakDial level. Works with Express and any framework taking
`(req, res, next)`.

```bash
npm install @breakdial/express
```

```ts
import { dial } from '@breakdial/core'
import { breaker } from '@breakdial/express'

app.use(breaker({ only: ['/checkout'] }))
dial(6, { seed: 'ci-42' })
```

## Options

| option | default | purpose |
|---|---|---|
| `latencyMs` | `250` | base delay, scaled by level |
| `failureRate` | `0.4` | probability of an injected failure at L10 |
| `only` | `[]` | break these path prefixes; empty matches all |
| `key` | path | stream key per request |

At level 8 and above the injected status is `503` rather than `500`.

## Behaviour

Each request draws from its own stream, keyed on the path by default, so
concurrent requests stay independently reproducible under a fixed seed.

The middleware will not write to a response that is already committed — a client
that gave up during the injected delay is left alone — and an internal error is
routed through `next(err)` rather than becoming an unhandled rejection.

## Licence

Apache-2.0. See [NOTICE](https://github.com/alekslinde/breakdial/blob/main/NOTICE).
