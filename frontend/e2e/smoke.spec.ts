import { test, expect } from '@playwright/test';
import { URLS, blockAnalytics, setTheme, trackConsoleErrors, paintedBackground, startScan, expectReport, gaEvents } from './helpers';

// Smoke S-01..S-08 from docs/test-cases.md. IDs in test titles match the doc.

test.beforeEach(async ({ page }) => {
  await blockAnalytics(page);
});

for (const [theme, expected] of [['light', 'rgb(255, 255, 255)'], ['dark', 'rgb(15, 16, 17)']] as const) {
  test(`S-01 / REG-01: home renders correctly in ${theme} theme`, async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await setTheme(page, theme);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /start scan/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // REG-01: a minifier-merged opacity class once painted the light page at
    // 15% alpha (dark grey). Exact solid colour, no alpha, is the check.
    expect(await paintedBackground(page)).toBe(expected);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Plus Jakarta Sans');
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('S-02, S-08, REG-06, REG-09: scan, progress log, report, reload', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await startScan(page, URLS.stripeApi);
  // D-04: the progress log is open by default while scanning.
  await expect(page.locator('[aria-live="polite"] [style*="max-height: 300px"]')).toBeAttached({ timeout: 10_000 });
  await expectReport(page);
  await expect(page.getByText(/Bot access/).first()).toBeVisible();
  await expect(page.getByText(/^Fix:/).first()).toBeVisible();

  // REG-06: exactly one started and one completed event per scan.
  const events = await gaEvents(page);
  expect(events.filter((e) => e === 'generate_report_started')).toHaveLength(1);
  expect(events.filter((e) => e === 'generate_report_completed')).toHaveLength(1);

  // REG-09: one robots meta tag on /results, and it is noindex.
  const robots = await page.locator('meta[name="robots"]').evaluateAll((els) => els.map((e) => (e as HTMLMetaElement).content));
  expect(robots).toEqual(['noindex']);

  // S-08: the report survives a reload.
  await page.reload();
  await expect(page.getByText('What Lensy found')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

// Known open bug N-06: reloading /results fires generate_report_completed
// again, inflating GA completions. Confirmed by this test on 2026-10-08.
// test.fixme keeps it from blocking deploys; when N-06 is fixed, change
// test.fixme to test so it guards against the bug coming back.
test.fixme('N-06: reloading /results does not re-fire generate_report_completed', async ({ page }) => {
  await startScan(page, URLS.stripeApi);
  await expectReport(page);
  await page.reload();
  await expect(page.getByText('What Lensy found')).toBeVisible();
  expect((await gaEvents(page)).filter((e) => e === 'generate_report_completed')).toHaveLength(0);
});

test('S-03, S-06, REG-12: citation check, then no clipping at 375px', async ({ page }) => {
  test.skip(!!process.env.E2E_SKIP_CITATIONS, 'E2E_SKIP_CITATIONS set (each run makes paid Perplexity calls)');
  await startScan(page, URLS.stripeApi);
  await expectReport(page);
  await page.getByText('Run citation check').click();
  await expect(page.getByText(/citations check completed/i)).toBeVisible({ timeout: 150_000 });
  const table = page.locator('table').first();
  await expect(table.getByRole('columnheader', { name: 'Perplexity' })).toBeVisible();
  await expect(table.getByText(/(High|Mid|Low) intent/).first()).toBeVisible();

  // REG-12: at 375px the table must fit its wrapper, so no pill is clipped.
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await table.evaluate((t) => {
    const wrap = t.parentElement!;
    return wrap.scrollWidth - wrap.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

test('S-04: home-page error cards', async ({ page }) => {
  await startScan(page, URLS.invalid);
  await expect(page.getByText("That doesn't look like a valid URL")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

  await startScan(page, URLS.marketing);
  await expect(page.getByText("This doesn't look like a documentation page")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Report an issue' })).toBeVisible();
});

test('S-05: contact form validates without sending anything', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET') posts.push(r.url()); });
  await page.goto('/contact');
  await page.getByRole('button', { name: 'Join waitlist' }).click();
  await expect(page.getByText('Add your developer portal or website URL to continue.')).toBeVisible();
  await expect(page.getByText('Add your name so we know who to contact.')).toBeVisible();
  await expect(page.getByText('Enter a valid email address to join the waitlist.')).toBeVisible();
  expect(posts).toEqual([]);
});

test('S-06: mobile menu shows the Beta badge', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('#mobile-navigation').getByText('Beta', { exact: true })).toBeVisible();
});

test('S-07, REG-11: 404 page has the site shell and is noindex', async ({ page }) => {
  await page.goto('/this-page-does-not-exist-e2e');
  await expect(page.getByText('This page does not exist')).toBeVisible();
  await expect(page.locator('footer')).toBeVisible();
  await expect(page.getByRole('link', { name: 'How it works' }).first()).toBeAttached();
  const robots = await page.locator('meta[name="robots"]').evaluateAll((els) => els.map((e) => (e as HTMLMetaElement).content));
  expect(robots).toEqual(['noindex']);
});
