import { test, expect, APIRequestContext } from '@playwright/test';
import { blockAnalytics } from './helpers';
import sitePages from '../src/site-pages.json';

// Site structure and AI readiness (.context/specs/site-architecture.md, phase 1).
// Every check here reads what a crawler or coding agent gets: plain HTTP, no
// JavaScript. The page list comes from sitemap.xml, so new articles are covered.

const HEADER = ['Scan', 'CLI', 'How it works', 'Education', 'Contact'];
const mdPath = (p: string) => (p === '/' ? '/index.md' : `${p}.md`);

async function sitemapPaths(request: APIRequestContext) {
  const xml = await (await request.get('/sitemap.xml')).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
}

test('SITE-01: one page list feeds the sitemap, llms.txt and the header', async ({ page, request }) => {
  const indexable = sitePages.filter((p) => p.kind === 'page').map((p) => p.path);
  const paths = await sitemapPaths(request);
  for (const p of indexable) expect(paths, `sitemap.xml is missing ${p}`).toContain(p);
  expect(paths.filter((p) => /^\/education\/[a-z0-9-]+$/.test(p)).length).toBeGreaterThan(0);
  for (const hidden of ['/scan', '/results', '/console']) expect(paths).not.toContain(hidden);

  const llms = await (await request.get('/llms.txt')).text();
  const llmsPaths = [...llms.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => new URL(m[1]).pathname);
  for (const p of paths) expect(llmsPaths, `llms.txt is missing ${p}`).toContain(mdPath(p));
  expect(new Set(llmsPaths).size).toBe(llmsPaths.length);

  await blockAnalytics(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const rail = page.getByRole('navigation', { name: 'Main' });
  for (const label of HEADER) await expect(rail.getByRole('link', { name: label, exact: false }).first()).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  for (const label of HEADER) await expect(page.locator('#mobile-navigation').getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
});

test('SITE-02: every indexable page is reachable from the home page within 2 clicks', async ({ request }) => {
  const linksOn = async (p: string) => {
    const html = await (await request.get(p)).text();
    return new Set([...html.matchAll(/<a[^>]+href="(\/[^"#?]*)"/g)].map((m) => m[1].replace(/(.)\/$/, '$1')));
  };
  const first = await linksOn('/');
  const reached = new Set(first);
  for (const p of first) for (const l of await linksOn(p)) reached.add(l);
  for (const p of await sitemapPaths(request)) expect(reached, `${p} is more than 2 clicks from /`).toContain(p);
});

test('SITE-03 (REG-37): without JavaScript, every page has its own head, one H1 and its text', async ({ request }) => {
  for (const p of await sitemapPaths(request)) {
    const res = await request.get(p, { headers: { 'User-Agent': 'GPTBot/1.2 (lensy e2e)' } });
    expect(res.status(), p).toBe(200);
    const html = await res.text();
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    expect(canonical && new URL(canonical).pathname, `${p} canonical`).toBe(p);
    const body = html.slice(html.indexOf('<body'));
    expect(body.match(/<h1[\s>]/g)?.length, `${p} H1 count`).toBe(1);
    expect(body.match(/<h2[\s>]/g)?.length ?? 0, `${p} has no H2 sections`).toBeGreaterThan(0);
    expect(html, `${p} JSON-LD`).toMatch(/"dateModified":"\d{4}-\d{2}-\d{2}"/);
    expect(html, `${p} still says to enable JavaScript`).not.toContain('You need to enable JavaScript');
    expect(html).toContain('href="/llms.txt"');
    if (p !== '/') expect(html.match(/<title>([^<]+)/)?.[1], p).not.toBe('Lensy: can AI search and coding agents use your docs?');
  }
});

test('SITE-04: every page has a Markdown copy, also served for Accept: text/markdown', async ({ request }) => {
  for (const p of await sitemapPaths(request)) {
    const md = await request.get(mdPath(p));
    expect(md.status(), mdPath(p)).toBe(200);
    expect(md.headers()['content-type'], mdPath(p)).toContain('text/markdown');
    const text = await md.text();
    expect(text, mdPath(p)).toMatch(/^# \S/);
    expect(text.slice(0, 600), `${mdPath(p)} points to llms.txt near the top`).toContain('/llms.txt');
    expect(text).not.toMatch(/<(div|span|main)[\s>]/);
  }
  const negotiated = await request.get('/cli', { headers: { Accept: 'text/markdown' } });
  expect(negotiated.headers()['content-type']).toContain('text/markdown');
  expect(await negotiated.text()).toMatch(/^# Lensy command line/);
});

test('SITE-05: llms.txt follows llmstxt.org and every link in it works', async ({ request }) => {
  const llms = await (await request.get('/llms.txt')).text();
  expect(llms).toMatch(/^# .+\n\n> .+/);
  expect(llms).toMatch(/\n## Product\n/);
  expect(llms).toMatch(/\n## Optional\n/);
  const links = [...llms.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => new URL(m[1]).pathname);
  expect(links.length).toBeGreaterThan(8);
  for (const p of links) {
    expect(p, 'llms.txt links to Markdown').toMatch(/\.md$/);
    expect((await request.get(p)).status(), p).toBe(200);
  }
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
  expect(robots).not.toMatch(/Disallow: \/\s/);
});

test('SITE-06 (REG-35): missing pages return a real 404; app routes still load', async ({ request }) => {
  for (const p of ['/this-page-does-not-exist', '/cli-afdocs-nonexistent-8f3a', '/education/no-such-article']) {
    const res = await request.get(p);
    expect(res.status(), p).toBe(404);
    expect(await res.text(), p).toContain('This page does not exist');
  }
  for (const p of ['/scan', '/results', '/console']) expect((await request.get(p)).status(), p).toBe(200);
});

// REG-36: the generator wrote public/education/*.md but never deleted them, so
// five removed articles stayed live as Markdown (found 2026-11-10).
test('REG-36: Markdown for removed articles is gone', async ({ request }) => {
  for (const slug of ['blocking-ai-crawlers', 'why-ai-readiness-matters', 'text-to-html-ratio']) {
    expect((await request.get(`/education/${slug}.md`)).status(), slug).toBe(404);
  }
});

test('SITE-07: prerendered pages hydrate without falling back to a client render', async ({ page }) => {
  await blockAnalytics(page);
  const problems: string[] = [];
  page.on('console', (m) => { if (/\[Hydrate\]|Minified React error #(418|423|425)/.test(m.text())) problems.push(m.text().slice(0, 160)); });
  for (const p of ['/', '/cli', '/how-it-works', '/education', '/education/research-behind-ai-ready-docs', '/contact', '/bot', '/privacy']) {
    await page.goto(p, { waitUntil: 'load' });
    await expect(page.locator('main h1')).toBeVisible();
    await page.waitForTimeout(500);
  }
  expect(problems).toEqual([]);
});

test('SITE-08: one name for the scan action and the free allowance; no retired scoring copy', async ({ page }) => {
  await blockAnalytics(page);
  await page.route(/\/usage$/, (route) => route.fulfill({ json: { used: 0, limit: 100, remaining: 7, waitlisted: false } }));
  await page.goto('/');
  await expect(page.locator('#top').getByRole('link', { name: 'Start a free scan' })).toBeVisible();
  await expect(page.getByRole('button', { name: /start scan/i })).toBeVisible();
  await expect(page.getByText('7 free scans left').first()).toBeVisible();
  const main = (await page.locator('main').innerText()) + (await page.content());
  expect(main).not.toMatch(/content structure, structured data|bot access, content structure|audits left|Run a free check/);
});

test('SITE-10: content pages carry the new sections, dates and allowance messages', async ({ page }) => {
  await blockAnalytics(page);

  await page.goto('/how-it-works');
  await expect(page.getByRole('heading', { level: 2, name: 'The two scores.' })).toBeVisible();
  await expect(page.locator('#every-check').getByRole('row', { name: /AI search bots allowed .*20/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start a free scan' })).toBeVisible();

  await page.goto('/contact');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Join the waitlist.');
  await expect(page.getByRole('heading', { level: 2, name: 'Talk to us' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Join the waitlist' })).toBeVisible();

  await page.goto('/education');
  await expect(page.locator('main time').first()).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
  await page.goto('/education/research-behind-ai-ready-docs');
  await expect(page.locator('main')).toContainText('By Perseverance AI');
  await expect(page.locator('main')).toContainText('Published Mar 22, 2026');
  await expect(page.getByRole('heading', { level: 2, name: 'TL;DR' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'References' })).toBeVisible();

  // Out of free scans: the form still works and explains what to do next.
  await page.route(/\/usage$/, (route) => route.fulfill({ json: { used: 100, limit: 100, remaining: 0, waitlisted: false } }));
  await page.goto('/');
  await expect(page.getByText('Free scans refresh tomorrow').first()).toBeVisible();
  await page.getByPlaceholder('docs.yourcompany.com').fill('https://docs.example.com');
  await page.getByRole('button', { name: /start scan/i }).click();
  await expect(page.getByText('You’ve used today’s free scans.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Join the waitlist' })).toBeVisible();
});

// REG-38: page titles split with <br /> read as one glued word to anything that
// reads text instead of pixels ("Your docsbelong in theanswer.", "Join thewaitlist.").
test('REG-38: H1 titles keep the space where they break across lines', async ({ request }) => {
  const h1Text = async (p: string) => {
    const html = await (await request.get(p)).text();
    const inner = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '';
    return inner.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  };
  expect(await h1Text('/')).toBe('Your docs belong in the answer.');
  expect(await h1Text('/contact')).toBe('Join the waitlist.');
  expect(await h1Text('/cli')).toBe('Lensy command line.');
  expect(await h1Text('/bot')).toBe('Lensy checker.');
  expect(await h1Text('/education')).toBe('Education on AI-ready docs.');
});
