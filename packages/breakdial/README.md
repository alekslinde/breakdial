<!--
SPDX-FileCopyrightText: 2026 Aleks Linde
SPDX-License-Identifier: Apache-2.0
-->

# breakdial

One dial (`0`–`10`) that breaks anything — from UI jank to backend outage.

This is the convenience entry point: it re-exports [`@breakdial/core`](https://www.npmjs.com/package/@breakdial/core)
and carries the CLI. Install a `@breakdial/*` adapter for the host you are
breaking.

```bash
npm install breakdial
```

```ts
import { dial } from 'breakdial'

dial(6, { seed: 'ci-42' })
// 0=off, 1-2 paper-cut, 3-4 jank, 5-7 outage, 8-10 catastrophe
```

## CLI

```bash
npx breakdial --level 7 --seed ci-42
```

| flag | purpose |
|---|---|
| `-l, --level <0-10>` | chaos level (required) |
| `-s, --seed <value>` | seed for reproducible runs |
| `-h, --help` | usage |
| `-v, --version` | version |

`--app <url>` is reserved for the HTTP chaos proxy and is rejected until
`@breakdial/proxy` ships, rather than appearing to proxy.

## Packages

| package | purpose |
|---|---|
| [`@breakdial/core`](https://www.npmjs.com/package/@breakdial/core) | the dial engine, seeded RNG, scenarios |
| [`@breakdial/fetch`](https://www.npmjs.com/package/@breakdial/fetch) | `wrapFetch()`: latency / 500 / abort |
| [`@breakdial/express`](https://www.npmjs.com/package/@breakdial/express) | `breaker()` middleware |
| [`@breakdial/react`](https://www.npmjs.com/package/@breakdial/react) | `<BreakDial/>` slider + `useBreak()` |
| [`@breakdial/mcp`](https://www.npmjs.com/package/@breakdial/mcp) | MCP server for agent control |

## Licence

Apache-2.0. See [NOTICE](https://github.com/alekslinde/breakdial/blob/main/NOTICE).
