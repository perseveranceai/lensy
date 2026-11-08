// SPDX-License-Identifier: MIT
// Checking a local build end to end, with the real AFDocs module: --dir with and
// without --site-url, --all, a preview server on localhost, saving and comparing
// under a stable address, and no request leaving 127.0.0.1.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/main';
import { startServer } from '../src/serve';
import { DAY, T0, makeIo, makeProject, useTempDirs } from './helpers';

const SITE = path.join(__dirname, 'sample-site');
const tmp = useTempDirs();

/** A fetch that records every host it is asked for, and refuses anything off this machine. */
function guardedFetch() {
  const hosts = new Set<string>();
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    hosts.add(u.hostname);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw new Error(`test: left the machine for ${u.href}`);
    return fetch(input, init);
  }) as typeof fetch;
  return { impl, hosts };
}

function io(fetchImpl: typeof fetch, cwd = path.dirname(SITE), now = () => T0) {
  const { root, home } = makeProject(tmp);
  const t = makeIo({ cwd: cwd === 'project' ? root : cwd, home, fetchImpl, now });
  t.io.loadAfdocs = undefined; // the real AFDocs module, routed through the local fetch
  return { ...t, root, home };
}

describe('--dir', () => {
  test('with --site-url and --all: every page, shown by its published address, scored as points checked', async () => {
    const g = guardedFetch();
    const t = io(g.impl);
    const code = await run(['check', '--dir', SITE, '--site-url', 'https://docs.example.test', '--all', '--no-save', '--json', '-'], t.io);
    expect(code).toBe(EXIT.ok);
    const doc = JSON.parse(t.out());
    expect(doc.pages.map((p: { url: string }) => p.url)).toEqual(['https://docs.example.test/', 'https://docs.example.test/guide/start']);
    for (const p of doc.pages) {
      expect(p.status).toBe('ok');
      expect(p.report.mode).toBe('local');
      expect(p.report.finalUrl).toBe(p.url); // never the server's random port
      const s = p.report.scores.codingAgents;
      expect(s.label).toBe('local');
      expect(s.score).toBeLessThanOrEqual(s.coveredMax);
      expect(s.coveredMax).toBeLessThan(100);
      const skipped = s.checks.filter((c: { status: string }) => c.status === 'skipped').map((c: { id: string }) => c.id);
      expect(skipped).toEqual(expect.arrayContaining(['content-negotiation', 'http-status-codes']));
    }
    // The sitemap and llms.txt name docs.example.test: with --site-url they resolve to the build.
    const start = doc.pages[1].report.scores.aiSearch.checks.find((c: { id: string }) => c.id === 'S3');
    expect(start.detail).toMatch(/in sitemap: yes/);
    expect([...g.hosts]).toEqual(['127.0.0.1']);
    expect(t.err()).toContain('Checking the build in');
  });

  test('without --site-url: a local address, the hint to add it, and still nothing off the machine', async () => {
    const g = guardedFetch();
    const t = io(g.impl);
    const code = await run(['check', '--dir', SITE, '/guide/start', '--no-save', '--no-color'], t.io);
    expect(code).toBe(EXIT.ok);
    const out = t.out();
    expect(out).toContain('http://localhost/guide/start');
    expect(out).not.toMatch(/127\.0\.0\.1:\d+/);
    expect(out).toContain('Add --site-url');
    expect(out).toMatch(/Coding agents \d+ of \d+ points checked/);
    expect(out).toMatch(/Not checked here \(your web server or CDN decides these/);
    expect(out).toMatch(/weren't\s+sent/);
    expect(out).not.toContain('Re-scan');
    expect([...g.hosts]).toEqual(['127.0.0.1']);
  });

  test.each([
    [['--dir', 'no-such-folder'], "there's no folder there"],
    [['--dir', '.', '--site-url', 'http://localhost:3000'], 'not the local one'],
    [['--dir', SITE, 'https://elsewhere.example.com/a'], 'give pages as paths in the build'],
  ])('%j exits 2 before checking', async (args, message) => {
    const g = guardedFetch();
    const t = io(g.impl);
    expect(await run(['check', ...args, '--no-save'], t.io)).toBe(EXIT.usage);
    expect(t.err()).toContain(message);
    expect(g.hosts.size).toBe(0);
  });

  test('a folder with no HTML: exit 2 and the build commands', async () => {
    const dir = tmp('lensy-md-');
    fs.writeFileSync(path.join(dir, 'a.md'), '# A');
    const t = io(guardedFetch().impl);
    expect(await run(['check', '--dir', dir, '--no-save'], t.io)).toBe(EXIT.usage);
    expect(t.err()).toContain('has no .html pages');
    expect(t.err()).toContain('npx vitepress build docs');
  });

  test('a folder given as a URL: exit 2 and the --dir command, not a fetch of https://folder/', async () => {
    const g = guardedFetch();
    const t = io(g.impl);
    expect(await run(['check', 'sample-site', '--no-save'], t.io)).toBe(EXIT.usage);
    expect(t.err()).toContain('lensy check --dir sample-site');
    expect(g.hosts.size).toBe(0);
  });
});

describe('a preview server on localhost', () => {
  test('--all reads its sitemap; --site-url maps the published domain to it', async () => {
    const s = await startServer(SITE);
    try {
      const g = guardedFetch();
      const t = io(g.impl);
      const local = s.origin.replace('127.0.0.1', 'localhost');
      const code = await run(['check', local, '--all', '--site-url', 'https://docs.example.test', '--no-save', '--no-color'], t.io);
      expect(code).toBe(EXIT.ok);
      expect(t.out()).toContain('Checking a server on your machine');
      expect(t.out()).toMatch(/https:\/\/docs\.example\.test\/guide\/start\s+\d+ of \d+/);
      expect([...g.hosts].every(h => h === 'localhost' || h === '127.0.0.1')).toBe(true);
    } finally {
      await s.close();
    }
  });

  test('--site-url or --all with only live pages: exit 2', async () => {
    const t = io(guardedFetch().impl);
    expect(await run(['check', 'https://docs.example.test/', '--all', '--no-save'], t.io)).toBe(EXIT.usage);
    expect(t.err()).toContain('--all is for a local build');
  });
});

describe('saving a local build', () => {
  test('two runs compare under the published address, though the server port changes', async () => {
    const g = guardedFetch();
    const { root, home } = makeProject(tmp);
    const runAt = async (now: number) => {
      const t = makeIo({ cwd: root, home, fetchImpl: g.impl, now: () => now });
      t.io.loadAfdocs = undefined;
      const code = await run(['check', '--dir', SITE, '--site-url', 'https://docs.example.test', '/guide/start', '--save', '--no-color'], t.io);
      return { code, out: t.out() };
    };
    const first = await runAt(T0);
    expect(first.code).toBe(EXIT.ok);
    expect(first.out).toContain('First saved run');
    const second = await runAt(T0 + DAY);
    expect(second.out).toMatch(/Since yesterday: Coding agents (\d+) → \1/);
    const folder = path.join(root, '.lensy', 'pages', 'docs.example.test', 'guide', 'start');
    expect(fs.readdirSync(path.join(folder, 'runs'))).toHaveLength(2);
  });
});
