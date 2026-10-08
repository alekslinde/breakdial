#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Aleks Linde
// SPDX-License-Identifier: Apache-2.0
// breakdial CLI. Parses and reports the dial; the HTTP chaos proxy that
// `--app` will drive ships with @breakdial/proxy and is not available yet.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dial, levelLabel } from '@breakdial/core';

export interface ParsedArgs {
  level: number;
  seed?: string;
  help: boolean;
  version: boolean;
}

export class UsageError extends Error {}

const USAGE = `breakdial — one dial (0-10) that breaks anything

Usage:
  breakdial --level <0-10> [--seed <value>]

Options:
  -l, --level <0-10>   chaos level: 0=off, 1-2 paper-cut, 3-4 jank,
                       5-7 outage, 8-10 catastrophe
  -s, --seed <value>   seed for reproducible runs
  -h, --help           show this help
  -v, --version        show version

Not available yet:
  -a, --app <url>      proxy an app through the dial; ships with
                       @breakdial/proxy, which is unreleased

Examples:
  breakdial --level 3
  breakdial --level 7 --seed ci-42`;

/** Parses argv (without node/script). Throws UsageError on bad input. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { level: 0, help: false, version: false };
  let sawLevel = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // Accept --flag=value as well as --flag value.
    const eq = arg.indexOf('=');
    const [flag, inlineValue] = eq > 1 && arg.startsWith('-')
      ? [arg.slice(0, eq), arg.slice(eq + 1)]
      : [arg, undefined];
    // `--=value` splits to a bare `--`, which names nothing useful back to the
    // user; reject the token shape rather than reporting an empty flag.
    if (/^-+$/.test(flag)) throw new UsageError('expected an option name');
    const takeValue = (name: string): string => {
      const v = inlineValue ?? argv[++i];
      if (v === undefined || v === '') throw new UsageError(`${name} needs a value`);
      return v;
    };

    switch (flag) {
      case '-h':
      case '--help':
        out.help = true;
        break;
      case '-v':
      case '--version':
        out.version = true;
        break;
      case '-l':
      case '--level': {
        const raw = takeValue('--level');
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new UsageError(`--level must be a number 0-10, got "${raw}"`);
        if (n < 0 || n > 10) throw new UsageError(`--level must be between 0 and 10, got ${raw}`);
        out.level = n;
        sawLevel = true;
        break;
      }
      case '-s':
      case '--seed':
        out.seed = takeValue('--seed');
        break;
      case '-a':
      case '--app':
        // Reject the whole invocation rather than accepting a level and seed
        // and then dropping them: half-honouring the command is worse than
        // refusing it, because the exit code is the only signal either way.
        takeValue('--app');
        throw new UsageError(
          '--app needs @breakdial/proxy, which is not released yet. '
          + 'Set the dial from your app or tests instead (see --help).',
        );
      default:
        // Report `flag`, never `arg`: the raw token still carries any attached
        // value, and a typo'd flag would echo it into stderr and CI logs.
        throw new UsageError(`unknown option "${flag}"`);
    }
  }

  if (!sawLevel && !out.help && !out.version) {
    throw new UsageError('--level is required');
  }
  return out;
}

export interface CliResult {
  code: number;
  out: string[];
  err: string[];
}

/** Runs the CLI without touching process state, so it can be tested. */
export function run(argv: readonly string[], version: string): CliResult {
  const out: string[] = [];
  const err: string[] = [];

  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      err.push(`breakdial: ${e.message}`, '', USAGE);
      return { code: 2, out, err };
    }
    throw e;
  }

  if (args.help) {
    out.push(USAGE);
    return { code: 0, out, err };
  }
  if (args.version) {
    out.push(version);
    return { code: 0, out, err };
  }

  const d = dial(args.level, args.seed !== undefined ? { seed: args.seed } : undefined);
  out.push(`breakdial: level ${d.level} (${levelLabel(d.level)}), seed ${String(d.seed)}`);

  // Setting the dial in a short-lived process affects nothing else, so be
  // explicit about that instead of implying a running system was changed.
  out.push('Nothing to apply in a standalone process — import the dial in your app,');
  out.push('or drive it from tests via @breakdial/fetch, /express or /mcp.');
  return { code: 0, out, err };
}

/** Reads the version from the installed package manifest. */
function readVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * True when this module is the process entry point.
 *
 * npm installs `bin` as a symlink in node_modules/.bin, so argv[1] is the
 * symlink while import.meta.url is the resolved file. Comparing the two
 * directly never matches there, which silently turns `npx breakdial` into a
 * no-op, so resolve both through realpath before comparing.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    const self = realpathSync(fileURLToPath(import.meta.url));
    return realpathSync(entry) === self;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const { code, out, err } = run(process.argv.slice(2), readVersion());
  if (out.length > 0) process.stdout.write(out.join('\n') + '\n');
  if (err.length > 0) process.stderr.write(err.join('\n') + '\n');
  process.exit(code);
}
