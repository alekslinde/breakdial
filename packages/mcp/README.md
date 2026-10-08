<!--
SPDX-FileCopyrightText: 2026 Aleks Linde
SPDX-License-Identifier: Apache-2.0
-->

# @breakdial/mcp

Tool definitions and a handler that let an agent drive the BreakDial remotely:
set the level, fire a scenario, then verify what it did.

```bash
npm install @breakdial/mcp
```

```ts
import { TOOLS, handleTool } from '@breakdial/mcp'

// register TOOLS with your MCP server, then dispatch:
await handleTool('breakdial_set', { level: 7, seed: 'ci-42' })
await handleTool('breakdial_verify')
// -> { level: 7, label: 'outage', seed: 'ci-42' }
```

## Tools

| tool | purpose |
|---|---|
| `breakdial_set` | set the level `0`–`10`, with an optional seed |
| `breakdial_list` | list registered scenarios |
| `breakdial_fire` | fire a named scenario |
| `breakdial_verify` | report the current level, label and seed |

`breakdial_set` rejects a level it cannot read rather than reporting `NaN` as
`catastrophe`, so an agent is never told chaos is at maximum while nothing is
being injected. `breakdial_verify` returns the seed, so an agent can hand back a
reproduction.

## Transport

This package is transport-agnostic: it exports the tool schemas and a dispatcher
for you to register with an MCP server. It does not open a stdio server itself.

## Licence

Apache-2.0. See [NOTICE](https://github.com/alekslinde/breakdial/blob/main/NOTICE).
