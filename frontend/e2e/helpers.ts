import { expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Test URLs from docs/test-cases.md ("Test URLs"). Last confirmed 2026-10-08.
export const URLS = {
  stripeApi: 'https://docs.stripe.com/api', // U-1 happy path
  githubRest: 'https://docs.github.com/en/rest', // U-2
  ditaDocs: 'https://docs.paloaltonetworks.com/common-services/subscription-and-tenant-management/get-started', // U-3
  spa: 'https://redocly.github.io/redoc/', // U-4
  noRobots: 'https://www.lua.org/manual/5.4/manual.html', // U-5
  marketing: 'https://stripe.com/', // U-8
  invalid: 'not a url', // U-9
  bareHostname: 'https://docs.python.org', // REG-17: no trailing slash (doc subdomain). U-10 in the doc is help.branch.io
};

// gamma and prod share one GA4 property. Never let a test run send real
// analytics: block every Google Analytics request. The inline gtag() stub in
// index.html still pushes events into window.dataLayer, so tests can assert on
// them without anything leaving the browser.
export async function blockAnalytics(page: Page) {
  await page.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
}

export async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
}

// Collects uncaught page errors and console.error output for the whole test.
export function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Our own analytics block shows up as a failed request; that's expected.
    if (/googletagmanager|google-analytics|net::ERR_FAILED/.test(text)) return;
    errors.push(text);
  });
  return errors;
}

// The colour actually painted behind the page content: walk up from <main> to
// the first element with a non-transparent background.
export async function paintedBackground(page: Page) {
  return page.evaluate(() => {
    let el: HTMLElement | null = document.querySelector('main');
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      el = el.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
}

export async function startScan(page: Page, url: string) {
  await page.goto('/');
  await page.getByPlaceholder('docs.yourcompany.com').fill(url);
  await page.getByRole('button', { name: /start scan/i }).click();
}

export async function expectReport(page: Page) {
  await expect(page).toHaveURL(/\/results/, { timeout: 150_000 });
  await expect(page.getByText('What Lensy found')).toBeVisible({ timeout: 30_000 });
}

// GA events recorded by the inline gtag() stub: ['event', name, params].
export async function gaEvents(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    ((window as any).dataLayer || [])
      .map((entry: any) => Array.from(entry as ArrayLike<any>))
      .filter((args: any[]) => args[0] === 'event')
      .map((args: any[]) => String(args[1])),
  );
}

// The build's citations flag (REACT_APP_CITATIONS_ENABLED, spec two-score
// §8.3). Tests run against a build:gamma build, so read the same .env file
// unless the run says otherwise.
export const CITATIONS_ENABLED = process.env.REACT_APP_CITATIONS_ENABLED
  ? process.env.REACT_APP_CITATIONS_ENABLED === 'true'
  : /^REACT_APP_CITATIONS_ENABLED=true$/m.test(fs.readFileSync(path.join(__dirname, '..', '.env.gamma'), 'utf8'));

// Saved reports in ./fixtures (see the note at the top of download.spec.ts).
export const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

export const SAVED_SESSION = 'session-e2e-download';

// Put a finished scan where LensyApp restores it from (sessionStorage), and
// keep every network call this page makes local to the test.
export async function openSavedReport(page: Page, seed: { report: any; citations?: any }) {
  await blockAnalytics(page);
  await page.routeWebSocket(/execute-api/, () => { /* accept and stay silent */ });
  await page.route(/\/usage$/, (route) => route.fulfill({ json: { used: 0, limit: 100, remaining: 100, waitlisted: false } }));
  await page.addInitScript((s) => {
    window.sessionStorage.setItem('lensy-audit-state', JSON.stringify({
      url: s.report.scope?.url,
      asyncCards: s.citations ? { aiDiscoverability: s.citations } : {},
      analysisState: { status: 'completed', report: s.report, progressMessages: [] },
      heroTab: 'readiness',
      currentSessionId: s.session,
    }));
  }, { ...seed, session: SAVED_SESSION });
  await page.goto('/results');
  await expect(page.getByText('What Lensy found')).toBeVisible();
}

// The text of a jsPDF file, one array of text runs per page, in drawing order.
// jsPDF embeds the site fonts, so each run is a hex string of glyph ids; the
// font's ToUnicode map turns them back into text. Enough for our own PDFs
// (REG-23, REG-24), not a general PDF parser.
export function pdfPages(pdf: Buffer): string[][] {
  const src = pdf.toString('latin1');
  const objects = new Map<string, { dict: string; stream?: string }>();
  for (const m of src.matchAll(/(\d+) 0 obj\b/g)) {
    const from = m.index! + m[0].length;
    const end = src.indexOf('endobj', from);
    const at = src.indexOf('stream', from);
    const dict = src.slice(from, at > -1 && at < end ? at : end);
    let stream: string | undefined;
    if (at > -1 && at < end) {
      const start = at + (src.startsWith('stream\r\n', at) ? 8 : 7);
      const raw = pdf.subarray(start, src.indexOf('endstream', start));
      stream = (/FlateDecode/.test(dict) ? zlib.inflateSync(raw) : raw).toString('latin1');
    }
    objects.set(m[1], { dict, stream });
  }
  const ref = (dict: string, key: string) => dict.match(new RegExp(`/${key} (\\d+) 0 R`))?.[1];
  const cmaps = new Map<string, Map<string, string>>();
  const fontMap = (id: string) => {
    if (!cmaps.has(id)) {
      const map = new Map<string, string>();
      const cmap = objects.get(ref(objects.get(id)!.dict, 'ToUnicode')!)!.stream!;
      for (const [, g, u] of cmap.matchAll(/<([0-9a-f]{4})>\s*<([0-9a-f]{4})>/gi)) map.set(g.toLowerCase(), String.fromCharCode(parseInt(u, 16)));
      cmaps.set(id, map);
    }
    return cmaps.get(id)!;
  };
  // Font resource names (/F15) to font objects, from the shared resource dictionary.
  const fonts = new Map<string, string>();
  for (const { dict } of objects.values()) for (const [, name, id] of dict.matchAll(/\/(F\d+) (\d+) 0 R/g)) fonts.set(name, id);
  const pages = [...objects.values()].filter((o) => /\/Type \/Page\b/.test(o.dict));
  return pages.map((p) => {
    const content = objects.get(ref(p.dict, 'Contents')!)!.stream!;
    const runs: string[] = [];
    let font = '';
    for (const [, name, hex] of content.matchAll(/\/(F\d+) [\d.]+ Tf|<([0-9a-f]+)> Tj/gi)) {
      if (name) { font = name; continue; }
      const map = fontMap(fonts.get(font)!);
      runs.push(hex.match(/.{4}/g)!.map((g) => map.get(g.toLowerCase()) ?? '?').join(''));
    }
    return runs;
  });
}
