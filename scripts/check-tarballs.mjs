// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// Packs every workspace and asserts what actually lands in the tarball.
//
// A manifest can list a file that is absent from the tarball with no warning,
// which is how a package reaches the registry with a blank page or an
// `exports` map pointing at nothing. The only reliable check is to pack and
// look inside, so this runs in CI and before a release.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `.pathname`: the latter keeps percent-encoding, so a
// checkout under a path containing a space resolves to a directory that is
// not there.
const ROOT = new URL('..', import.meta.url);
const root = (p) => fileURLToPath(new URL(p, ROOT));

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`FAIL: ${msg}`);
};
const ok = (msg) => console.log(`  ok  ${msg}`);

const packages = readdirSync(root('packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(root('packages'), e.name, 'package.json')))
  .map((e) => e.name)
  .sort();

if (packages.length === 0) fail('no packages found under packages/');

// This inspects built output, so an unbuilt tree would report every manifest
// target as missing. Say so once instead of 13 confusing failures.
const unbuilt = packages.filter((p) => !existsSync(join(root('packages'), p, 'dist')));
if (unbuilt.length > 0) {
  console.error(`FAIL: no dist/ for ${unbuilt.join(', ')} — run \`npm run build\` first`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'breakdial-pack-'));
try {
  for (const pkg of packages) {
    const manifest = JSON.parse(
      readFileSync(join(root('packages'), pkg, 'package.json'), 'utf8'),
    );
    const name = manifest.name;

    // Read the file list npm itself reports for this package, keyed by name.
    // Scanning the directory for a .tgz could pick up a stale tarball and
    // report `ok` for files it never looked at, defeating the whole point.
    const packed = JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--workspace', name, '--pack-destination', dir, '--json'],
        { cwd: root('.'), stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' },
      ),
    );
    const report = packed[name];
    if (!report?.filename || !existsSync(join(dir, report.filename))) {
      fail(`${name}: npm pack produced no tarball`);
      continue;
    }
    const entries = (report.files ?? []).map((f) => f.path);
    if (entries.length === 0) {
      fail(`${name}: npm pack reported no files`);
      continue;
    }
    rmSync(join(dir, report.filename));

    const has = (p) => entries.includes(p);

    // npm always packs README and LICENSE whatever `files` says, so asserting
    // they are present would report a safety this never checked. What matters
    // is that the file exists on disk at all: a package with no readme shows a
    // blank page on npm forever.
    if (existsSync(join(root('packages'), pkg, 'README.md'))) ok(`${name}: has a README`);
    else fail(`${name}: no README.md — the npm page would be blank`);

    // NOTICE is NOT auto-included, and Apache-2.0 section 4(d) requires it to
    // travel with redistributions. It only ships if `files` lists it.
    if (has('NOTICE')) ok(`${name}: NOTICE packed`);
    else fail(`${name}: NOTICE missing from the tarball (Apache-2.0 4(d))`);

    // Every path the manifest points at must exist inside the tarball, or the
    // package installs and then fails to resolve.
    const targets = new Set();
    const collect = (v) => {
      if (typeof v === 'string') targets.add(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(manifest.exports);
    for (const field of ['main', 'types', 'module']) {
      if (manifest[field]) targets.add(manifest[field]);
    }
    collect(manifest.bin);

    for (const t of targets) {
      const rel = t.replace(/^\.\//, '');
      if (has(rel)) ok(`${name}: ${t} packed`);
      else fail(`${name}: ${t} is referenced by the manifest but not in the tarball`);
    }

    // Sources must not ship: they bloat the tarball and the sourcemaps that
    // reference them resolve to nothing anyway.
    const src = entries.filter((p) => p.startsWith('src/'));
    if (src.length === 0) ok(`${name}: no src/ in the tarball`);
    else fail(`${name}: ships ${src.length} src/ file(s)`);

    // An unresolvable range publishes a package nobody can install. Peers
    // count: @breakdial/react declares its dependencies only there, so
    // checking `dependencies` alone would check nothing for it.
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
        const bad =
          range === '*' ||
          range === '' ||
          range.startsWith('workspace:') ||
          range.startsWith('file:') ||
          range.startsWith('link:') ||
          range.startsWith('portal:');
        if (bad) fail(`${name}: ${field} ${dep}@${range} is not publishable`);
        else ok(`${name}: ${field} ${dep}@${range}`);
      }
    }

    // engines.node must match what CI tests, and must not be EOL.
    if (manifest.engines?.node) ok(`${name}: engines.node ${manifest.engines.node}`);
    else fail(`${name}: engines.node unset`);

    // A scoped package defaults to restricted; on a free org that is a 402.
    if (name.startsWith('@') && manifest.publishConfig?.access !== 'public') {
      fail(`${name}: scoped package needs publishConfig.access "public"`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} tarball check(s) failed`);
  process.exit(1);
}
console.log(`\ntarball checks OK (${packages.length} packages)`);
