// SPDX-License-Identifier: MIT
// Local mode: checking a docs build served on this machine (a tool's preview
// server such as `vitepress preview`, or `lensy check --dir`). Three parts:
//   - which URLs are local (loopback only: they never leave the machine);
//   - request routing: with a site URL, requests for the real site go to the
//     local server, so the sitemap, llms.txt and canonical links of the build
//     are checked as they'll be published; requests to any other host are
//     refused, so a local check sends nothing off the machine;
//   - scoring: checks the registry marks as decided by the real host (Markdown
//     on request, real 404s, redirects, cache headers, login walls, bot
//     protection) are skipped, and a score counts only the points a local
//     preview can test: "71 of 84 points checked", never stretched to 100.
import { CHECKS_BY_ID } from './engine';
import type { Check, Score } from './report';

/** Loopback hosts: localhost and *.localhost, 127.0.0.0/8, 0.0.0.0 and ::1. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0.0.0.0') return true;
  return /^127(\.\d{1,3}){3}$/.test(h);
}

export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && isLocalHost(u.hostname);
  } catch {
    return false;
  }
}

/**
 * The published origin and path prefix for --site-url. Only http(s), no query
 * or fragment. The path prefix (for a site built with VitePress `base` or
 * Docusaurus `baseUrl`) keeps its trailing slash.
 */
export function parseSiteUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error(`--site-url "${raw}" isn't a URL.`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`--site-url "${raw}" isn't an http or https URL.`);
  if (u.search || u.hash) throw new Error('--site-url takes the site\'s address only, without ? or #.');
  if (isLocalHost(u.hostname)) throw new Error('--site-url is the published address of your docs, for example https://docs.example.com, not the local one.');
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u;
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/**
 * A fetch for local mode. Requests to `localOrigin` go through. With `siteUrl`,
 * a request to the published site (same origin, under its path prefix) goes to
 * the local server with the same path and query. Anything else is refused with
 * a TypeError, which the engine records as a network error: those checks come
 * back unknown instead of reaching the internet.
 */
export function makeLocalFetch(localOrigin: string, siteUrl: URL | undefined, base: typeof fetch = fetch): typeof fetch {
  const local = new URL(localOrigin).origin;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(urlOf(input));
    if (url.origin === local) return base(input, init);
    if (siteUrl && url.origin === siteUrl.origin) {
      return base(`${local}${url.pathname}${url.search}`, init);
    }
    throw new TypeError(`blocked in local mode: ${url.origin} (only ${local}${siteUrl ? ` and ${siteUrl.origin}` : ''} are checked)`);
  }) as typeof fetch;
}

/** The published URL for a page served locally: same path and query, on the site URL's origin. */
export function publishedUrl(localUrl: string, siteUrl: URL): string {
  const u = new URL(localUrl);
  return `${siteUrl.origin}${u.pathname}${u.search}`;
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/**
 * A score in local mode. Checks the registry marks hostDependent 'full' are
 * skipped; 'partial' ones keep their points and get the host note. Then:
 *   earned = points of the checks that ran, on the 0-100 scale of all checks
 *   checked = the 0-100 points those checks are worth
 * so `score` (earned) never exceeds `coveredMax` (checked), and both are on the
 * same scale as a live check. An AFDocs cap still applies.
 */
export function localScore(s: Score, cap?: number): Score {
  if (s.score === null) return s;
  const checks: Check[] = s.checks.map(c => {
    const meta = CHECKS_BY_ID[c.id];
    if (meta?.hostDependent === 'full' && c.points !== null) {
      const { fix: _fix, ...rest } = c;
      return { ...rest, points: null, status: 'skipped', note: `depends on your hosting: ${meta.hostNote ?? 'decided by your web server or CDN'}` };
    }
    if (meta?.hostDependent === 'partial' && meta.hostNote && !c.note) return { ...c, note: meta.hostNote };
    return c;
  });
  const all = checks.filter(c => c.max > 0);
  const possible = sum(all.map(c => c.max));
  if (!possible) return { ...s, checks, label: 'local' };
  const ran = all.filter(c => c.points !== null);
  const earnedRaw = sum(ran.map(c => c.points as number));
  const coveredMax = Math.round((100 * sum(ran.map(c => c.max))) / possible);
  let score = Math.min(coveredMax, Math.round((100 * earnedRaw) / possible));
  if (cap !== undefined) score = Math.min(score, Math.round((cap * coveredMax) / 100));
  return { ...s, score, coveredMax, label: 'local', checks };
}

/** The ids of checks a local preview can't test, for the notes. */
export function skippedIds(s: Score): string[] {
  return s.checks.filter(c => c.status === 'skipped').map(c => c.id);
}
