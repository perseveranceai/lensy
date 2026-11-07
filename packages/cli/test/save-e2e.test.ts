// SPDX-License-Identifier: MIT
// The whole feature in process, over the saved fixtures: two pages saved, then a week
// later one fixture is changed so a passing check fails, and the second run is compared
// with the first (Req 3, 4, 5, 8; tasks.md 7.1). No network; the clock is fixed.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { run } from '../src/main';
import { resolvePageFolder } from '../src/page-folder';
import { DAY, T0, listFiles, makeIo, makeProject, replayFetch, stripe, useTempDirs, vitest } from './helpers';

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'UTC'; });
afterAll(() => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ; });

const tmp = useTempDirs();
const V = vitest();
const S = stripe();
const URL1 = V.expected.url;
const URL2 = S.expected.url;

/** The same fixture entries, with the vitest robots.txt closing the door on an AI search bot. */
const changedEntries = () => {
  const entries = [...V.entries, ...S.entries].map(e => ({ ...e }));
  const robots = entries.find(e => e.url === 'https://vitest.dev/robots.txt');
  if (!robots) throw new Error('fixture has no robots.txt entry');
  robots.body = 'User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
  return entries;
};

describe('two saved runs a week apart, one fixture changed in between', () => {
  test('first run, then the comparison in the terminal, the JSON, latest.md and history.md', async () => {
    const { root, home } = makeProject(tmp);
    const lensy = path.join(root, '.lensy');
    const go = async (entries: ReturnType<typeof changedEntries>, now: number, args: string[]) => {
      const t = makeIo({ cwd: root, home, fetchImpl: replayFetch(entries), now: () => now });
      const code = await run(['check', URL1, URL2, ...args], t.io);
      return { code, out: t.out(), err: t.err() };
    };
    const rows = () => fs.readFileSync(path.join(lensy, 'history.md'), 'utf8').split('\n').filter(l => l.startsWith('| 20'));

    // Run 1
    const first = await go([...V.entries, ...S.entries], T0, ['--save']);
    expect(first.err).toBe('');
    expect(first.out).toContain('First saved run');
    expect(first.out.trimEnd().endsWith('Results saved in .lensy')).toBe(true);
    expect(rows().length).toBe(2);
    for (const url of [URL1, URL2]) {
      const dir = resolvePageFolder(lensy, url).dir;
      expect(fs.existsSync(path.join(dir, 'latest.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'latest.md'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'page.json'))).toBe(true);
      expect(fs.readdirSync(path.join(dir, 'runs')).length).toBe(1);
    }
    expect(fs.existsSync(path.join(lensy, 'latest.md'))).toBe(true);

    // Run 2: a week later, one page changed. The terminal view and a JSON file from the same run.
    const second = await go(changedEntries(), T0 + 7 * DAY, ['--save', '--json', path.join(root, 'run2.json')]);
    expect(second.err).toBe('');
    expect(second.out).toMatch(/^  Since Nov 8 \(7 days ago\): Coding agents (\d+) → \1 {4}AI search (\d+) → (\d+)$/m);
    expect(second.out).toMatch(/^  New: .+/m);
    const doc = JSON.parse(fs.readFileSync(path.join(root, 'run2.json'), 'utf8'));
    const changed = doc.pages.find((p: { url: string }) => p.url === URL1);
    const same = doc.pages.find((p: { url: string }) => p.url === URL2);
    expect(changed.change.since).toBe('2026-11-08T18:30:12.000Z');
    expect(changed.change.previousStatus).toBe('ok');
    expect(changed.change.new.map((n: { check: string }) => n.check)).toEqual(['AI search bots allowed']);
    expect(changed.change.fixed).toEqual([]);
    expect(changed.change.aiSearch).toMatchObject({ from: 68, to: 65, delta: -3 });
    expect(changed.change.codingAgents.delta).toBe(0);
    expect(same.change).toMatchObject({ fixed: [], new: [], worse: [], better: [] });
    // the terminal's "New:" is what the JSON says
    for (const n of changed.change.new) expect(second.out).toContain(n.check);

    // latest.md and history.md
    const latest = fs.readFileSync(path.join(lensy, 'latest.md'), 'utf8');
    expect(latest).toContain('Since last run');
    const history = rows();
    expect(history.length).toBe(4);
    expect(history[0]).toContain('2026-11-15');
    expect(history[history.length - 1]).toContain('2026-11-08');
    expect(fs.readdirSync(path.join(resolvePageFolder(lensy, URL1).dir, 'runs')).length).toBe(2);
    expect(fs.readdirSync(path.join(resolvePageFolder(lensy, URL2).dir, 'runs')).length).toBe(2);
    expect(listFiles(lensy).filter(n => /(^|\/)(\.lock|.*\.tmp-.*)$/.test(n))).toEqual([]);
  });
});
