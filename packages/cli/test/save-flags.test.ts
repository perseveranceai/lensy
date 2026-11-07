// SPDX-License-Identifier: MIT
// --save, --save-dir and --no-save (Req 3.2, 7.1): three separate options, so
// "--no-save given" is never confused with "neither given", and conflicting
// flags exit 2 before anything is read, asked or fetched.
import { describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/main';
import { makeIo, makeProject, replayFetch, useTempDirs, vitest } from './helpers';

const tmp = useTempDirs();

function setup(fetchImpl?: typeof fetch) {
  const { root, home } = makeProject(tmp);
  return makeIo({ cwd: root, home, fetchImpl });
}

describe('conflicting flags exit 2 before any request', () => {
  test.each([
    [['--save', '--no-save'], "--save and --no-save can't be used together."],
    [['--no-save', '--save'], "--save and --no-save can't be used together."],
    [['--save-dir', 'out', '--no-save'], "--save-dir and --no-save can't be used together."],
    [['--no-save', '--save-dir=out'], "--save-dir and --no-save can't be used together."],
    [['--save-dir', ' '], '--save-dir needs a folder'],
  ])('%j', async (flags, message) => {
    let calls = 0;
    const t = setup((async () => { calls++; return new Response(''); }) as typeof fetch);
    expect(await run(['check', 'https://docs.example.com/guide', ...flags], t.io)).toBe(EXIT.usage);
    expect(t.err()).toContain(message);
    expect(calls).toBe(0);
  });

  test('--save-dir without a value is a usage error', async () => {
    const t = setup();
    expect(await run(['check', 'https://docs.example.com/guide', '--save-dir'], t.io)).toBe(EXIT.usage);
    expect(t.err()).toMatch(/argument missing/);
  });
});

describe('each flag on its own is accepted', () => {
  test.each([[['--save']], [['--save-dir', 'results']], [['--no-save']], [[]]])('%j', async (flags) => {
    const f = vitest();
    const t = setup(replayFetch(f.entries));
    expect(await run(['check', f.expected.url, ...flags], t.io)).toBe(EXIT.ok);
    expect(t.out()).toMatch(/Coding agents \d+\/100/);
  });
});

describe('--help', () => {
  test('lists --save, --save-dir <dir> and --no-save, each with one short line', async () => {
    const t = setup();
    await run(['check', '--help'], t.io);
    const lines = t.out().split('\n');
    for (const flag of ['--save', '--save-dir <dir>', '--no-save']) {
      const line = lines.find(l => l.trimStart().startsWith(flag + ' '));
      expect(line, `${flag} is missing from --help`).toBeDefined();
      expect(line!.length).toBeLessThan(110);
    }
  });
});
