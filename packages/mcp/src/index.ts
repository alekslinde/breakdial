// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
import { dial, getDial, listScenarios, fire } from '@breakdial/core';

export const TOOLS = [
  {
    name: 'breakdial_set',
    description: 'Set chaos dial 0-10 (0=off, 1-2 paper-cut, 3-4 jank, 5-7 outage, 8-10 catastrophe)',
    inputSchema: { type: 'object', properties: { level: { type: 'number' }, seed: { type: ['string', 'number'] } } },
  },
  { name: 'breakdial_list', description: 'List registered scenarios', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'breakdial_fire',
    description: 'Fire a named scenario',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'breakdial_verify',
    description: 'Report current level + label (agents call after recovery attempt)',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

export async function handleTool(name: string, args: any = {}) {
  switch (name) {
    case 'breakdial_set': {
      // Reject a level we cannot read rather than reporting NaN as
      // "catastrophe" — an agent would be told chaos is at maximum while
      // nothing is actually being injected.
      const raw = args.level ?? 0;
      const level = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(level)) {
        throw new Error(`breakdial/mcp: level must be a finite number 0-10, got ${JSON.stringify(raw)}`);
      }
      const d = dial(level, { seed: args.seed });
      return { level: d.level, label: d.label, seed: d.seed };
    }
    case 'breakdial_list':
      return { scenarios: listScenarios() };
    case 'breakdial_fire':
      await fire(args.name);
      return { fired: args.name };
    case 'breakdial_verify': {
      const d = getDial();
      return { level: d.level, label: d.label, seed: d.seed };
    }
    default:
      throw new Error(`breakdial/mcp: unknown tool "${name}"`);
  }
}
