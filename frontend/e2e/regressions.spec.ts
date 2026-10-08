import { test, expect } from '@playwright/test';
import { URLS, blockAnalytics, startScan, expectReport, gaEvents } from './helpers';

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
