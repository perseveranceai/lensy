import { test, expect } from '@playwright/test';
import { URLS, blockAnalytics, startScan, expectReport, gaEvents, trackConsoleErrors } from './helpers';

// Regression cases (REG-xx) from docs/test-cases.md. Each one is a bug that
// reached gamma or prod. When you fix a new one, add its REG case to the doc
// AND a test here, in the same PR.

test.beforeEach(async ({ page }) => {
  await blockAnalytics(page);
});

test('REG-02: enterprise and standard docs pages pass the doc check', async ({ page }) => {
  for (const url of [URLS.ditaDocs, URLS.githubRest]) {
    await startScan(page, url);
    await expectReport(page);
  }
});

test('REG-03: a JavaScript-rendered page is named as such, not "not documentation"', async ({ page }) => {
  await startScan(page, URLS.spa);
  await expect(page.getByText(/rendered by JavaScript/i).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("This doesn't look like a documentation page")).toHaveCount(0);
});

test('REG-05: a site with no robots.txt is not reported as "10/10 allowed"', async ({ page }) => {
  await startScan(page, URLS.noRobots);
  await expectReport(page);
  await expect(page.getByText(/no robots\.txt/i).first()).toBeVisible();
  await expect(page.getByText(/10\s*\/\s*10 allowed/)).toHaveCount(0);
});

test('REG-08: generated llms.txt, sitemap and article markdown are complete', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/how-it-works');
  expect(sitemap).not.toMatch(/\/about</);

  const llms = await (await request.get('/llms.txt')).text();
  expect(llms).toContain('/how-it-works');
  // Article links in llms.txt are absolute for the build's environment; test
  // the same paths on whichever host we're running against.
  const articlePaths = [...llms.matchAll(/\]\((https?:\/\/[^)]+\/education\/[^)]+)\)/g)].map((m) => new URL(m[1]).pathname);
  expect(articlePaths.length).toBeGreaterThan(0);
  for (const path of articlePaths) {
    const md = await (await request.get(`${path}.md`)).text();
    expect(md, path).toContain('## TL;DR');
    expect(md, path).toContain('## References');
  }
});

test('REG-10: leaving a scan mid-way does not strand /results', async ({ page }) => {
  await startScan(page, URLS.stripeApi);
  await page.getByRole('link', { name: 'Education' }).first().click();
  await page.goto('/results');
  await expect(page).toHaveURL(/\/$|\/\?/, { timeout: 15_000 });
  expect((await gaEvents(page)).filter((e) => e === 'generate_report_completed')).toHaveLength(0);
});

// REG-14: test traffic reached the production GA4 property (gamma, localhost
// and e2e runs all sent events to it), and the first page view of every visit
// was counted twice (gtag's automatic page_view plus App.tsx's). Only the live
// hostnames may load gtag.js, and each route counts one page_view.
test('REG-14: non-live hosts send nothing to GA, and each page view counts once', async ({ page }) => {
  const gaRequests: string[] = [];
  page.on('request', (req) => {
    if (/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/.test(req.url())) gaRequests.push(req.url());
  });
  await page.goto('/', { waitUntil: 'load' });
  await expect.poll(async () => (await gaEvents(page)).filter((e) => e === 'page_view')).toHaveLength(1);
  await page.getByRole('link', { name: 'Contact' }).first().click();
  await expect(page).toHaveURL(/\/contact/);
  await expect.poll(async () => (await gaEvents(page)).filter((e) => e === 'page_view')).toHaveLength(2);
  expect(gaRequests, gaRequests.join('\n')).toEqual([]);
});

test('REG-16: the social preview image the meta tags name is served as a 1200x630 PNG', async ({ page, request }) => {
  await page.goto('/');
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
  const twitterImage = await page.locator('meta[name="twitter:image"]').getAttribute('content');
  expect(ogImage).toBeTruthy();
  expect(twitterImage).toBe(ogImage);
  // The tags carry the build's absolute base URL; fetch the same path here.
  const res = await request.get(new URL(ogImage!).pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
  const png = await res.body();
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});

test('REG-18: a site behind bot protection shows the bot-protection card, not "unreachable"', async ({ page }) => {
  // The fetcher fallback itself is unit-tested (backend fetch-page.test.ts);
  // gamma's Lambda can't reach a local fixture site, so this part mocks the
  // scan API and checks only what the visitor sees.
  const errors = trackConsoleErrors(page);
  await blockAnalytics(page);
  await page.routeWebSocket(/execute-api/, () => { /* accept and stay silent */ });
  await page.route(/\/usage$/, (route) => route.fulfill({ json: { used: 0, limit: 100, remaining: 100, waitlisted: false } }));
  await page.route(/\/scan-doc$/, (route) => route.fulfill({ json: { executionArn: 'arn:e2e:reg-18' } }));
  await page.route(/\/status\//, (route) => route.fulfill({
    json: { status: 'failed', error: "This site's bot protection blocked our checker (HTTP 403)." },
  }));

  await startScan(page, 'https://help.branch.io/account-hub/onboarding-guide');
  await expect(page.getByText("This site's bot protection blocked our checker")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/HTTP 403\. .*allow the Lensy\/1\.0 user agent/)).toBeVisible();
  await expect(page.getByText("We couldn't reach that page")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('REG-18: /bot explains the checker and its user agent', async ({ page }) => {
  await page.goto('/bot');
  await expect(page.getByRole('heading', { name: 'User agent' })).toBeVisible();
  await expect(page.getByText('Lensy/1.0 (+https://perseveranceai.com/bot)')).toBeVisible();
  await expect(page.getByText("This page does not exist.")).toHaveCount(0);
});
