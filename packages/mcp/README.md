<!--
SPDX-FileCopyrightText: 2026 Aleks Linde
SPDX-License-Identifier: Apache-2.0
-->

# @breakdial/mcp

An MCP server that lets an agent drive the BreakDial: set the level, fire a
scenario, then verify what it did.

```bash
npm install @breakdial/mcp
```

## As a server

```bash
npx breakdial-mcp          # stdio MCP server
```

```jsonc
// register it with an MCP client
{
  "mcpServers": {
    "breakdial": { "command": "npx", "args": ["breakdial-mcp"] }
  }
}
```

## Inside your own app

The dial lives in the server's process, so a standalone server drives its own
dial — handy for trying the tools out, but it injects no faults into your app.
To break *your* code, create the server inside it so both share one dial:

```ts
import { startStdioServer } from '@breakdial/mcp/server'

await startStdioServer()
```

`createServer()` returns the server unconnected if you want a different
transport.

## Or wire up the tools yourself

```ts
import { TOOLS, handleTool } from '@breakdial/mcp'

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

## Errors

A rejected level or an unknown scenario comes back as an error result, not a
dropped connection, so an agent can read what went wrong and carry on.

## Licence

Apache-2.0. See [NOTICE](https://github.com/alekslinde/breakdial/blob/main/NOTICE).
