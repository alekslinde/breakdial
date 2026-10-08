// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// Asserts the running Node satisfies every package's declared engines.node.
//
// A CI matrix entry of `22` resolves to the latest 22.x, so it cannot by
// itself prove a `>=22.14.0` claim is tested. An install that succeeds and
// then fails at runtime arrives later as someone else's bug report.
import { readdirSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * -1 if a < b, 0 if equal, 1 if a > b, comparing the numeric release only.
 *
 * A prerelease (`22.14.0-rc.1`) sorts BELOW its release, per semver. Mapping
 * segments through Number() would turn `0-rc` into NaN and fall through to the
 * "greater" branch, accepting a Node below the declared floor — the unsafe
 * direction for this check.
 */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre] = String(v).split('-', 2);
    return {
      parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0),
      isPrerelease: pre !== undefined && pre !== '',
    };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const p = x.parts[i] ?? 0;
    const q = y.parts[i] ?? 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  // Same numeric release: a prerelease is lower than the release itself.
  if (x.isPrerelease !== y.isPrerelease) return x.isPrerelease ? -1 : 1;
  return 0;
}

/**
 * Checks `version` against the lower bound of a `>=` range.
 *
 * Only `>=N[.N[.N]]` is supported, optionally with further comparators. An
 * upper bound is reported rather than silently ignored, since this cannot
 * verify one from a single running version.
 */
export function satisfiesFloor(version, range) {
  const text = String(range ?? '').trim();
  if (text === '') return { ok: false, reason: 'engines.node is unset' };

  const m = /^>=\s*v?(\d+(?:\.\d+)*)/.exec(text);
  if (!m) {
    return {
      ok: false,
      reason: `engines.node "${text}" is not a ">=N" floor — this check cannot verify it`,
    };
  }
  const floor = m[1];

  // `>=22.14.0 <25` parses, but one running version cannot prove the ceiling.
  const rest = text.slice(m[0].length).trim();
  const note = rest === '' ? '' : ` (upper bound "${rest}" not checked here)`;

  if (compareVersions(version, floor) < 0) {
    return { ok: false, reason: `node ${version} is below engines.node >=${floor}${note}` };
  }
  return { ok: true, reason: `node ${version} satisfies >=${floor}${note}` };
}

// Running as the entry point, not when imported by the smoke suite.
const isEntryPoint = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isEntryPoint()) {
  const running = process.argv[2] ?? process.versions.node;
  const packages = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'packages', e.name, 'package.json')))
    .map((e) => e.name)
    .sort();

  let failures = 0;
  for (const pkg of packages) {
    const m = JSON.parse(readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'));
    const { ok, reason } = satisfiesFloor(running, m.engines?.node);
    if (ok) {
      console.log(`  ok  ${m.name}: ${reason}`);
    } else {
      failures++;
      console.error(`FAIL: ${m.name}: ${reason}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} package(s) claim a floor this Node does not meet`);
    process.exit(1);
  }
  console.log(`\nnode ${running} satisfies all ${packages.length} packages`);
}
