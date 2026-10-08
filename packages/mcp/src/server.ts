// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// A registrable MCP server over the breakdial tools.
//
// Uses the low-level Server rather than McpServer: McpServer's registerTool
// only accepts a Zod schema, while TOOLS already carries JSON Schema. Serving
// those verbatim keeps the advertised schemas and the dispatcher from drifting,
// and keeps Zod out of this package's own types.
import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, handleTool } from './index.js';

/** Version for the handshake, read from the manifest so it cannot drift. */
function readVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

const INSTRUCTIONS =
  'Chaos dial for fault injection. breakdial_set raises the level (0=off '
  + 'through 10=catastrophe), breakdial_fire triggers a named scenario, and '
  + 'breakdial_verify reports the level plus the seed needed to reproduce a run. '
  + 'Faults apply to code sharing this process.';

/**
 * Builds an MCP server exposing breakdial_set / list / fire / verify.
 *
 * The dial lives in this process, so the tools affect faults injected by code
 * running here — a test runner or app that imports `@breakdial/core` in the
 * same process. To drive a separate app, create the server inside it rather
 * than running the bin standalone.
 */
export function createServer(): Server {
  const server = new Server(
    { name: 'breakdial', version: readVersion() },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, args ?? {});
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    } catch (err) {
      // Report the failure to the agent rather than killing the server: a
      // rejected level or an unknown scenario must not end the session.
      return {
        isError: true,
        content: [
          { type: 'text' as const, text: err instanceof Error ? err.message : String(err) },
        ],
      };
    }
  });

  return server;
}

/** Connects a server to stdio. Resolves once the transport is connected. */
export async function startStdioServer(server: Server = createServer()): Promise<Server> {
  await server.connect(new StdioServerTransport());
  return server;
}
