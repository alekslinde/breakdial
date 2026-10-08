// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// Checks each source file's header names the licence for its directory,
// manifest fields match, and LICENSES/ has every text.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MARKER = ['SPDX-License', 'Identifier: Apache-2.0'].join('-'); // split so linters don't read this line as a declaration
let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`FAIL: ${msg}`);
};

if (!existsSync(join(ROOT, 'LICENSES/Apache-2.0.txt'))) fail('LICENSES/Apache-2.0.txt missing');
if (!existsSync(join(ROOT, 'LICENSE'))) fail('LICENSE missing');
if (!existsSync(join(ROOT, 'NOTICE'))) fail('NOTICE missing');

// Discovered, not listed: a hardcoded list silently skips any package added
// later, and this is the only licence gate in CI.
const PACKAGES = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'packages', e.name, 'package.json')))
  .map((e) => e.name)
  .sort();
if (PACKAGES.length === 0) fail('no packages found under packages/');
const manifests = ['', ...PACKAGES.map((p) => `packages/${p}`)];
for (const dir of manifests) {
  const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
  if (pkg.license !== 'Apache-2.0') fail(`${dir || '.'}/package.json license is ${pkg.license}`);
}

const checkDir = (dir) => {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'dist' && entry.name !== 'node_modules') checkDir(rel);
    } else if (/\.(ts|js|mjs)$/.test(entry.name)) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      if (!src.includes(MARKER)) fail(`${rel} missing SPDX header`);
    }
  }
};
for (const p of PACKAGES) {
  const src = `packages/${p}/src`;
  if (!existsSync(join(ROOT, src))) {
    fail(`${src} missing — every package ships sources`);
    continue;
  }
  checkDir(src);
}
checkDir('scripts');

if (failures > 0) {
  console.error(`${failures} licence check(s) failed`);
  process.exit(1);
}
console.log('licence check OK');
