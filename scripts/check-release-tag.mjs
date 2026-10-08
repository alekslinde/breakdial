// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// Asserts a release tag matches the version in the manifests.
//
// A tag that disagrees with the manifests names a release one thing and ships
// another, and the version number is spent either way. Usage:
//
//   node scripts/check-release-tag.mjs v0.1.0
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tag = process.argv[2];

if (!tag) {
  console.error('usage: check-release-tag.mjs <tag>');
  process.exit(2);
}

const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
if (!match) {
  console.error(`FAIL: tag "${tag}" is not vMAJOR.MINOR.PATCH`);
  process.exit(1);
}
const want = match[1];

const packages = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'packages', e.name, 'package.json')))
  .map((e) => e.name)
  .sort();

let failures = 0;
for (const pkg of packages) {
  const m = JSON.parse(readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'));
  if (m.version === want) {
    console.log(`  ok  ${m.name}@${m.version}`);
  } else {
    failures++;
    console.error(`FAIL: ${m.name} is ${m.version}, tag says ${want}`);
  }
}

// Versions are independent per package by design, but a vX.Y.Z tag claims one
// release across the set. If they ever diverge, tag per package instead.
if (failures > 0) {
  console.error(`\n${failures} package(s) disagree with tag ${tag}`);
  process.exit(1);
}
console.log(`\ntag ${tag} matches all ${packages.length} packages`);
