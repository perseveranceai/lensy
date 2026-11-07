// SPDX-License-Identifier: MIT
// Shared by the save-and-compare tests: a project in a temp folder, a fake home
// folder, fake stdin, a fixed clock and saved fixtures. No network, and nothing
// is written outside the temp folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll } from 'vitest';
import type { Io } from '../src/main';
import { loadFixture, replayFetch } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';
import type { FixtureEntry } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';
import { replayAfdocs } from '../../core/test/afdocs-replay';

/** Temp folders, removed when the test file ends. Call once at the top of a test file. */
export function useTempDirs() {
  const made: string[] = [];
  afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
  return (prefix = 'lensy-save-') => {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    made.push(d);
    return d;
  };
}

/** A project (a folder with .git inside) and a separate fake home folder. */
export function makeProject(tmp: (prefix?: string) => string) {
  const root = tmp('lensy-proj-');
  fs.mkdirSync(path.join(root, '.git'));
  const home = tmp('lensy-home-');
  return { root, home };
}

export const DAY = 86_400_000;
/** 2026-11-08 18:30:12 UTC, the example in the spec */
export const T0 = Date.parse('2026-11-08T18:30:12.000Z');

export interface TestIoOptions {
  fetchImpl?: typeof fetch;
  cwd: string;
  home: string;
  env?: Record<string, string>;
  /** answers typed at the first-run question; undefined = no stdin at all */
  answers?: string[];
  /** stdin and stdout are terminals */
  interactive?: boolean;
  now?: () => number;
  stdoutIsTTY?: boolean;
  afdocs?: string[];
  version?: string;
  columns?: number;
}

export function makeIo(o: TestIoOptions) {
  let out = '';
  let err = '';
  const io: Io = {
    stdout: { write: (s: string) => { out += s; return true; }, isTTY: o.stdoutIsTTY ?? false, columns: o.columns },
    stderr: { write: (s: string) => { err += s; return true; } },
    env: o.env ?? {},
    fetchImpl: o.fetchImpl,
    // Saved AFDocs runs for the fixture pages; any other page falls back to C1-C6.
    loadAfdocs: replayAfdocs(...(o.afdocs ?? ['vitest-guide', 'stripe-payments'])),
    version: o.version ?? '0.0.0-test',
    now: o.now ?? (() => T0),
    cwd: o.cwd,
    home: o.home,
    isInteractive: o.interactive ?? false,
    stdin: o.answers ? Readable.from(o.answers.map(a => `${a}\n`)) : undefined,
  };
  return { io, out: () => out, err: () => err };
}

export const vitest = () => loadFixture('vitest-guide');
export const stripe = () => loadFixture('stripe-payments');
export const bothEntries = (): FixtureEntry[] => [...vitest().entries, ...stripe().entries];
export { replayFetch };

/** All files below a folder, as sorted paths relative to it (folders are not listed). */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}
