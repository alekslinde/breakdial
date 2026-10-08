#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// Runs the breakdial MCP server on stdio.
//
// Standalone, this drives the dial in its own process, which is useful for
// trying the tools out. To inject faults into your app, run the server from
// inside it (see createServer) so they share one dial.
import { startStdioServer } from './server.js';

startStdioServer().catch((err: unknown) => {
  // stdout is the protocol channel, so diagnostics go to stderr.
  process.stderr.write(`breakdial/mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
