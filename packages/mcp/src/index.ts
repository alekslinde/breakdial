import { dial, getLevel, listScenarios, fire, levelLabel } from '@breakdial/core';

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
      const s = dial(args.level ?? 0, { seed: args.seed });
      return { level: s.level, label: levelLabel(s.level) };
    }
    case 'breakdial_list':
      return { scenarios: listScenarios() };
    case 'breakdial_fire':
      await fire(args.name);
      return { fired: args.name };
    case 'breakdial_verify':
      return { level: getLevel(), label: levelLabel() };
    default:
      throw new Error(`breakdial/mcp: unknown tool "${name}"`);
  }
}
