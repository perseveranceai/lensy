// SPDX-License-Identifier: MIT
// `lensy check` (Req 1.1, 1.3, 1.7-1.9, 3.1), run in process over saved
// fixtures, plus the built binary for exit codes. No network.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { EXIT, Io, normalizeUrl, run } from '../src/main';
import { loadFixture, replayFetch, FixtureEntry } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';

function io(fetchImpl?: typeof fetch, opts: { tty?: boolean; env?: Record<string, string> } = {}) {
  let out = '';
  let err = '';
  const value: Io = {
    stdout: { write: (s: string) => { out += s; }, isTTY: opts.tty ?? false },
    stderr: { write: (s: string) => { err += s; } },
    env: opts.env ?? {},
    fetchImpl,
    version: '0.0.0-test',
  };
  return { io: value, out: () => out, err: () => err };
}

const vitest = loadFixture('vitest-guide');
const stripe = loadFixture('stripe-payments');
const both: FixtureEntry[] = [...vitest.entries, ...stripe.entries];

describe('one page', () => {
  test('prints both scores, the banner, the agent preview and every check with points', async () => {
    const t = io(replayFetch(vitest.entries));
    const code = await run(['check', vitest.expected.url], t.io);
    expect(code).toBe(EXIT.ok);
    const out = t.out();
    expect(out).toContain(`Coding agents ${vitest.expected.coding.total}/100`);
    expect(out).toContain(`AI search ${vitest.expected.search.total}/100`);
    expect(out).toContain('Reachability: an honest AI agent can read this page');
    expect(out).toContain('What an agent receives:');
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']) expect(out).toMatch(new RegExp(`\\b${id}\\b`));
    expect(out).toMatch(/Fix: /);
    expect(out).not.toMatch(/Page\s+Coding agents\s+AI search\s+Status/); // no summary table for one page
  });

  test('no colour when stdout is not a terminal, with --no-color, or with NO_COLOR', async () => {
    const esc = /\x1b\[/;
    const plain = io(replayFetch(vitest.entries), { tty: false });
    await run(['check', vitest.expected.url], plain.io);
    expect(plain.out()).not.toMatch(esc);

    const tty = io(replayFetch(vitest.entries), { tty: true });
    await run(['check', vitest.expected.url], tty.io);
    expect(tty.out()).toMatch(esc);

    const flag = io(replayFetch(vitest.entries), { tty: true });
    await run(['check', '--no-color', vitest.expected.url], flag.io);
    expect(flag.out()).not.toMatch(esc);

    const env = io(replayFetch(vitest.entries), { tty: true, env: { NO_COLOR: '1' } });
    await run(['check', vitest.expected.url], env.io);
    expect(env.out()).not.toMatch(esc);
  });
});

describe('several pages', () => {
  test('arguments and --urls-file give a summary table, then each page', async () => {
    const file = path.join(os.tmpdir(), `lensy-urls-${process.pid}.txt`);
    fs.writeFileSync(file, `# docs to check\n${stripe.expected.url}\n\n`);
    const t = io(replayFetch(both));
    const code = await run(['check', vitest.expected.url, '--urls-file', file], t.io);
    fs.rmSync(file);
    expect(code).toBe(EXIT.ok);
    const out = t.out();
    expect(out).toMatch(/Page\s+Coding agents\s+AI search\s+Status/);
    const summary = out.indexOf('Status');
    expect(out.indexOf(vitest.expected.url, summary + 10)).toBeGreaterThan(summary);
    expect(out).toContain(`${stripe.expected.coding.total}/100`);
  });

  test('a blocked page: exit 3, the perseveranceai.com pointer, and no advice to weaken bot protection', async () => {
    const replay = replayFetch(vitest.entries);
    const impl = (async (input: any, init?: RequestInit) =>
      String(input).startsWith('https://blocked.example.com')
        ? new Response('denied', { status: 403, headers: { 'content-type': 'text/html' } })
        : replay(input, init)) as typeof fetch;
    const t = io(impl);
    const code = await run(['check', vitest.expected.url, 'https://blocked.example.com/docs'], t.io);
    expect(code).toBe(EXIT.notChecked);
    expect(t.out()).toContain("This site's bot protection refused Lensy-CLI (HTTP 403), so this page wasn't checked. Run the audit at https://perseveranceai.com instead.");
    const blockedSection = t.out().slice(t.out().lastIndexOf('https://blocked.example.com/docs\n'));
    expect(blockedSection).not.toMatch(/allow|whitelist|disable|user.agent/i);
    expect(t.out()).toMatch(/blocked\.example\.com\S*\s+-\s+-\s+blocked/);
  });

  test('unreachable and not-HTML pages: exit 3 with a plain message', async () => {
    const impl = (async (input: any) => {
      if (String(input).includes('json')) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      throw new TypeError('fetch failed: ENOTFOUND');
    }) as typeof fetch;
    const t = io(impl);
    expect(await run(['check', 'https://gone.example.com', 'https://api.example.com/json'], t.io)).toBe(EXIT.notChecked);
    expect(t.out()).toContain("Lensy couldn't fetch this page (network error), so it wasn't checked.");
    expect(t.out()).toContain("This URL didn't return an HTML page (HTTP 200), so it wasn't checked.");
  });
});

describe('several pages in the terminal (spec answers 9 and 10)', () => {
  test('summary, top fixes per page and the report pointer, not every check', async () => {
    const t = io(replayFetch(both));
    await run(['check', vitest.expected.url, stripe.expected.url], t.io);
    const out = t.out();
    expect(out).toContain('Full results: rerun with --html report.html or --md report.md.');
    expect((out.match(/Fix: /g) || []).length).toBeLessThanOrEqual(6); // 3 per page
    expect(out).not.toMatch(/PASS\s+C1/); // no per-check rows
  });

  test('one page shows every check and no report pointer', async () => {
    const t = io(replayFetch(vitest.entries));
    await run(['check', vitest.expected.url], t.io);
    expect(t.out()).toMatch(/PASS\s+C1/);
    expect(t.out()).not.toContain('Full results:');
  });

  test('more than 15 URLs: every page is checked, after a notice with the count and time', async () => {
    const requested = new Set<string>();
    const impl = (async (input: any) => { requested.add(new URL(String(input)).pathname); throw new TypeError('fetch failed: ENOTFOUND'); }) as typeof fetch;
    const list = Array.from({ length: 40 }, (_, i) => `https://docs.example.com/p${i}`);
    const t = io(impl);
    expect(await run(['check', ...list, list[0]], t.io)).toBe(EXIT.notChecked);
    expect(requested.size).toBe(40);
    expect(t.out().startsWith('Checking 40 pages, 2 at a time. This takes about 2 to 5 minutes.')).toBe(true);
  });

  test('15 pages or fewer: no notice', async () => {
    const impl = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const t = io(impl);
    await run(['check', ...Array.from({ length: 15 }, (_, i) => `https://docs.example.com/p${i}`)], t.io);
    expect(t.out()).not.toContain('This takes about');
  });
});

describe('invalid usage exits 2 before any request', () => {
  test.each([
    [[], 'Give at least one URL'],
    [['http://localhost:3000'], 'Checking a local build comes in a later version.'],
    [['ftp://example.com'], "isn't an http or https URL"],
    [['--concurrency', '9', 'example.com'], 'from 1 to 5'],
    [['--urls-file', 'no-such-file.txt'], "Can't read --urls-file"],
  ])('%j', async (args, message) => {
    let calls = 0;
    const t = io((async () => { calls++; return new Response(''); }) as typeof fetch);
    expect(await run(['check', ...args], t.io)).toBe(EXIT.usage);
    expect(t.err()).toContain(message);
    expect(calls).toBe(0);
  });

  test('a bare hostname gets https://, like the website (REG-17)', () => {
    expect(normalizeUrl('docs.example.com/guide')).toBe('https://docs.example.com/guide');
    expect(normalizeUrl('http://docs.example.com')).toBe('http://docs.example.com/');
  });
});

describe('built binary', () => {
  const bin = path.join(__dirname, '..', 'dist', 'cli.js');
  const exec = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

  test.skipIf(!fs.existsSync(bin))('--version exits 0; usage errors exit 2', () => {
    const v = exec('--version');
    expect(v.status).toBe(0);
    expect(v.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(exec('check').status).toBe(2);
    expect(exec('check', 'http://localhost:3000').status).toBe(2);
    expect(exec('nope').status).toBe(2);
  });
});
