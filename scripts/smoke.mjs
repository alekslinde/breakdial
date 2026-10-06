import { dial, getLevel, shouldBreak, defineScenario, fire, listScenarios, resetDial } from '../packages/core/dist/index.js';
import assert from 'node:assert';

dial(0);
assert.equal(getLevel(), 0);
assert.equal(shouldBreak(1), false, 'L0 never breaks');

dial(10, { seed: 'ci-42' });
assert.equal(getLevel(), 10);
assert.equal(shouldBreak(1), true, 'L10 rate=1 always breaks');

defineScenario('smoke-ok', () => {});
assert.ok(listScenarios().includes('smoke-ok'));
await fire('smoke-ok');

let threw = false;
try { await fire('nope'); } catch { threw = true; }
assert.ok(threw, 'unknown scenario throws');

const { handleTool } = await import('../packages/mcp/dist/index.js');
const out = await handleTool('breakdial_set', { level: 3 });
assert.equal(out.level, 3);

resetDial();
console.log('smoke OK: core + mcp');
