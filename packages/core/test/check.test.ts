// SPDX-License-Identifier: MIT
// check() behaviour (tasks 4.6, Req 1.4-1.8): honest user agent on every
// request, no browser retry, and pages that can't be checked get no scores.
import { describe, expect, test } from 'vitest';
import { check, defaultUserAgent, isLocalUrl, LocalUrlError } from '../src/check';
import { loadFixture, replayFetch } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';

const PAGE = 'https://docs.example.com/guide';

function stub(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; ua: string }[] = [];
  const impl = (async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, ua: (init.headers as Record<string, string>)['User-Agent'] });
    return answer(url, init);
  }) as typeof fetch;
  return { impl, calls };
}

describe('pages that cannot be checked', () => {
  test.each([403, 429])('%i: blocked after one request, no browser user agent', async (status) => {
    const { impl, calls } = stub(() => new Response('denied', { status, headers: { 'content-type': 'text/html' } }));
    const r = await check(PAGE, { fetchImpl: impl });
    expect(calls).toHaveLength(1);
    expect(calls[0].ua).toBe(defaultUserAgent());
    expect(r).toMatchObject({ status: 'blocked', gate: { state: 'blocked', honestStatus: status } });
    expect(r.scores.codingAgents.score).toBeNull();
    expect(r.scores.aiSearch.score).toBeNull();
  });

  test('network error: unreachable', async () => {
    const { impl } = stub(() => { throw new TypeError('fetch failed: getaddrinfo ENOTFOUND'); });
    const r = await check(PAGE, { fetchImpl: impl });
    expect(r.status).toBe('unreachable');
    expect(r.scores.codingAgents.score).toBeNull();
  });

  test('404: unreachable', async () => {
    const { impl } = stub(() => new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } }));
    expect((await check(PAGE, { fetchImpl: impl })).status).toBe('unreachable');
  });

  test('not HTML', async () => {
    const { impl } = stub(() => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } }));
    expect((await check(PAGE, { fetchImpl: impl })).status).toBe('not-html');
  });

  test.each(['http://localhost:3000/', 'http://127.0.0.1:8080/docs', 'http://[::1]/'])('%s is refused until local builds ship', async (url) => {
    expect(isLocalUrl(url)).toBe(true);
    await expect(check(url, { fetchImpl: stub(() => new Response('')).impl })).rejects.toBeInstanceOf(LocalUrlError);
  });
});

describe('a checked page', () => {
  test('the default user agent is lowercase, with the version and the /bot link', () => {
    expect(defaultUserAgent('0.1.0')).toBe('lensy-cli/0.1.0 (+https://perseveranceai.com/bot)');
    expect(defaultUserAgent()).toMatch(/^lensy-cli\/\d+\.\d+\.\d+\S* \(\+https:\/\/perseveranceai\.com\/bot\)$/);
  });

  // Runs the real AFDocs module (spec criterion 2). Its requests that have no
  // fixture fail, which is fine: only the user agent is checked. Anything that
  // bypasses the wrapper reaches the guard instead of the network.
  test('every request, AFDocs ones included, carries the CLI user agent, and --user-agent overrides it', async () => {
    const { entries, expected } = loadFixture('vitest-guide');
    const replay = replayFetch(entries);
    const uas = new Set<string>();
    let afdocsUrls = 0;
    const impl = (async (input: any, init: RequestInit = {}) => {
      const h = new Headers(init.headers as HeadersInit);
      uas.add(h.get('user-agent') ?? '(none)');
      if (h.get('accept')?.includes('text/markdown') || /llms\.txt$/.test(String(input))) afdocsUrls++;
      return replay(input, init);
    }) as typeof fetch;
    const escaped: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: any) => { escaped.push(String(input)); throw new TypeError('guard: request bypassed fetchImpl'); }) as typeof fetch;
    try {
      const r = await check(expected.url, { fetchImpl: impl, now: 0 });
      expect(r.status).toBe('ok');
      expect([...uas]).toEqual([defaultUserAgent()]);
      expect(afdocsUrls).toBeGreaterThan(0);

      uas.clear();
      await check(expected.url, { fetchImpl: impl, now: 0, userAgent: 'lensy-cli/9.9.9 (test)' });
      expect([...uas]).toEqual(['lensy-cli/9.9.9 (test)']);
      expect(escaped).toEqual([]);
    } finally {
      globalThis.fetch = real;
    }
  }, 120000);

  test('a sub-request network error makes its checks unknown and the score partial', async () => {
    const { entries, expected } = loadFixture('vitest-guide');
    const replay = replayFetch(entries);
    const impl = (async (input: any, init: RequestInit = {}) => {
      if (String(input).endsWith('/robots.txt')) throw new TypeError('fetch failed: ECONNRESET');
      return replay(input, init);
    }) as typeof fetch;
    const r = await check(expected.url, { fetchImpl: impl, now: 0, afdocs: false });
    const s1 = r.scores.aiSearch.checks.find(c => c.id === 'S1')!;
    expect(s1).toMatchObject({ status: 'unknown', points: null });
    expect(s1.note).toMatch(/^network error: .*robots\.txt$/);
    expect(r.scores.aiSearch).toMatchObject({ label: 'partial', coveredMax: 80 });
    expect(r.scores.codingAgents.label).toBeUndefined();
    expect(r.netErrors.some(u => u.endsWith('/robots.txt'))).toBe(true);
  });
});
