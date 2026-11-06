// SPDX-License-Identifier: MIT
// The CLI guide on the website (frontend/src/CliGuide.tsx) must match the tool:
// every option the commands print in --help appears on the page, and the page
// doesn't mention an option the tool doesn't have. Spec: .context/specs/cli-docs-page.md.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { run } from '../src/main';

const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'CliGuide.tsx'), 'utf8');
const GLOBAL = new Set(['--help', '--version']);

async function helpOf(...args: string[]): Promise<string> {
  let out = '';
  await run([...args, '--help'], {
    stdout: { write: (s: string) => { out += s; } },
    stderr: { write: (s: string) => { out += s; } },
    env: {},
    version: '0.0.0-test',
  });
  return out;
}

// Not after an opening bracket: CSS variables such as var(--accent) are not options.
const flagsIn = (text: string) => new Set([...text.matchAll(/(?<![\w(-])--[a-z][a-z-]*/g)].map(m => m[0]));

describe('the CLI guide page', () => {
  test.each(['check', 'explain'])('mentions every option of `lensy %s`', async (command) => {
    const flags = [...flagsIn(await helpOf(command))].filter(f => !GLOBAL.has(f));
    for (const flag of flags) expect(PAGE, `${flag} is missing from CliGuide.tsx`).toContain(flag);
  });

  test('shows the check and explain commands', () => {
    expect(PAGE).toContain('lensy check ');
    expect(PAGE).toContain('lensy explain ');
  });

  test('mentions no option that the tool lacks', async () => {
    const real = new Set([...flagsIn(await helpOf('check')), ...flagsIn(await helpOf('explain')), ...GLOBAL]);
    for (const flag of flagsIn(PAGE)) expect(real, `${flag} is on the page but not in --help`).toContain(flag);
  });
});
