// SPDX-License-Identifier: MIT
// Local mode (local.ts): which URLs are local, request routing for --site-url,
// and scores that count only what a local preview can test.
import { describe, expect, test } from 'vitest';
import { isLocalHost, isLocalUrl, localScore, makeLocalFetch, parseSiteUrl, publishedUrl } from '../src/local';
import type { Check, Score } from '../src/report';

describe('isLocalUrl: loopback only', () => {
  test.each([
    'http://localhost:4173/', 'http://LOCALHOST/', 'http://docs.localhost:5173/guide', 'http://127.0.0.1:8080/',
    'http://127.1.2.3/', 'http://[::1]:3000/', 'http://0.0.0.0:4173/',
  ])('%s is local', url => expect(isLocalUrl(url)).toBe(true));
  test.each([
    'https://docs.example.com/', 'http://192.168.1.20:4173/', 'http://localhost.example.com/', 'http://128.0.0.1/',
    'ftp://localhost/', 'not a url',
  ])('%s is not', url => expect(isLocalUrl(url)).toBe(false));
  test('host names', () => {
    expect(isLocalHost('[::1]')).toBe(true);
    expect(isLocalHost('mylocalhost')).toBe(false);
  });
});

describe('parseSiteUrl', () => {
  test('an origin gets a trailing slash; a base path keeps it', () => {
    expect(parseSiteUrl('https://docs.example.com').href).toBe('https://docs.example.com/');
    expect(parseSiteUrl('docs.example.com/docs').href).toBe('https://docs.example.com/docs/');
  });
  test.each([
    ['ftp://docs.example.com', "isn't an http or https URL"],
    ['https://docs.example.com/?a=1', 'without ? or #'],
    ['http://localhost:4173', 'not the local one'],
  ])('%s is refused', (raw, message) => expect(() => parseSiteUrl(raw)).toThrow(message));
});

describe('makeLocalFetch', () => {
  const recorder = () => {
    const seen: string[] = [];
    const base = (async (input: RequestInfo | URL) => { seen.push(typeof input === 'string' ? input : String(input)); return new Response('ok'); }) as typeof fetch;
    return { seen, base };
  };
  test('the local origin passes; the published site goes to it with the same path and query; anything else is refused', async () => {
    const r = recorder();
    const f = makeLocalFetch('http://127.0.0.1:4000', parseSiteUrl('https://docs.example.com'), r.base);
    await f('http://127.0.0.1:4000/guide/start');
    await f('https://docs.example.com/sitemap.xml?x=1');
    await expect(f('https://cdn.other.com/a.js')).rejects.toThrow('blocked in local mode');
    await expect(f('http://docs.example.com/llms.txt')).rejects.toThrow('blocked in local mode'); // another origin (http)
    expect(r.seen).toEqual(['http://127.0.0.1:4000/guide/start', 'http://127.0.0.1:4000/sitemap.xml?x=1']);
  });
  test('without a site URL only the local origin is reachable', async () => {
    const r = recorder();
    const f = makeLocalFetch('http://localhost:4173', undefined, r.base);
    await f(new URL('http://localhost:4173/'));
    await expect(f('https://docs.example.com/')).rejects.toThrow(TypeError);
    expect(r.seen).toHaveLength(1);
  });
  test('publishedUrl keeps the path and query', () => {
    expect(publishedUrl('http://127.0.0.1:5000/docs/guide?a=1', parseSiteUrl('https://docs.example.com/docs'))).toBe('https://docs.example.com/docs/guide?a=1');
  });
});

describe('localScore', () => {
  const c = (id: string, points: number | null, max: number, status: Check['status'] = points === max ? 'pass' : 'fail'): Check =>
    ({ id, source: 'afdocs', label: id, max, points, status, detail: '', ...(status !== 'pass' ? { fix: 'do it' } : {}) });
  test('host-decided checks are skipped; the score is points earned of the points checked, on the 0-100 scale', () => {
    // content-negotiation (4) and http-status-codes (7) are hostDependent 'full' in the registry.
    const s: Score = { score: 80, coveredMax: 100, checks: [c('llms-txt-exists', 10, 10), c('rendering-strategy', 5, 10), c('content-negotiation', 0, 4), c('http-status-codes', 0, 7), c('markdown-url-support', 7, 7)] };
    const l = localScore(s);
    expect(l.label).toBe('local');
    const skipped = l.checks.filter(x => x.status === 'skipped');
    expect(skipped.map(x => x.id)).toEqual(['content-negotiation', 'http-status-codes']);
    expect(skipped.every(x => x.points === null && x.note?.startsWith('depends on your hosting') && x.fix === undefined)).toBe(true);
    // possible 38; checked 27 → 71; earned 22 → 58
    expect(l.coveredMax).toBe(Math.round((100 * 27) / 38));
    expect(l.score).toBe(Math.round((100 * 22) / 38));
    expect(l.score!).toBeLessThanOrEqual(l.coveredMax);
  });
  test('a partial check keeps its points and gets the host note', () => {
    const l = localScore({ score: 100, coveredMax: 100, checks: [c('markdown-url-support', 7, 7), c('llms-txt-exists', 10, 10)] });
    expect(l.checks[0].note).toMatch(/host/);
    expect(l.score).toBe(100);
    expect(l.coveredMax).toBe(100);
  });
  test('an AFDocs cap still applies, on the points-checked scale', () => {
    const l = localScore({ score: 59, coveredMax: 100, checks: [c('llms-txt-exists', 0, 10), c('rendering-strategy', 10, 10), c('content-negotiation', 0, 4)] }, 59);
    expect(l.score).toBeLessThanOrEqual(Math.round((59 * l.coveredMax) / 100));
  });
  test('a page that was not checked is left alone', () => {
    const none: Score = { score: null, coveredMax: 0, checks: [] };
    expect(localScore(none)).toBe(none);
  });
});
