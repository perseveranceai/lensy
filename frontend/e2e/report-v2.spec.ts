import { expect, test } from '@playwright/test';
import { CITATIONS_ENABLED, fixture, openSavedReport, setTheme, trackConsoleErrors } from './helpers';

// The two-score report (spec docs/two-score-readiness/spec.md §8, §9.2) on
// saved reports, so every run sees the same scores. report-stripe-v2.json is
// U-1 scored by the backend's own v2 code; report-stripe.json is the same page
// as scored before v2.
const stripeV2 = fixture('report-stripe-v2.json');
const stripeV1 = fixture('report-stripe.json');

test('S-02: two score cards, the reachability banner, three signal groups, points on each signal', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await openSavedReport(page, { report: stripeV2 });
  await expect(page.getByTestId('score-card-search')).toContainText(`${stripeV2.scores.aiSearch.score}/100`);
  await expect(page.getByTestId('score-card-coding')).toContainText(`${stripeV2.scores.codingAgents.score}/100`);
  await expect(page.getByTestId('reachability-banner')).toContainText('an honest AI agent can read this page (HTTP 200)');
  await expect(page.getByTestId('reachability-banner')).toContainText('robots.txt allows all 6 AI search bots');
  const groups = page.getByTestId('signal-groups').locator('section');
  await expect(groups).toHaveCount(3);
  await expect(groups.locator('h2')).toHaveText(['Both audiences', 'Coding agents', 'AI search']);
  // Every row carries points: 11 checks, with C1 and S2 sharing one row.
  await expect(page.getByTestId('signal-points')).toHaveCount(11);
  await expect(page.getByTestId('agent-preview')).toContainText('Markdown, 1,926 characters (about 482 tokens), fits in one fetch');
  await expect(page.getByText(/^Fix:/).first()).toBeVisible();
  for (const tip of stripeV2.tips) await expect(page.getByTestId('report-tips')).toContainText(tip.text);
  await expect(page.getByTestId('legacy-report-note')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('S-03: retired while citations are off; no citations card renders', async ({ page }) => {
  // The real S-03 (run the citation check) is in smoke.spec.ts and runs only
  // on a build with REACT_APP_CITATIONS_ENABLED=true (docs/test-cases.md).
  if (CITATIONS_ENABLED) return;
  await openSavedReport(page, { report: stripeV2 });
  await expect(page.getByText(/^(Run citation check|AI citations)$/i)).toHaveCount(0);
  await expect(page.getByTestId('score-cards').locator('button')).toHaveCount(2);
});

test('S-09: clicking a score card filters the signals to that score', async ({ page }) => {
  await openSavedReport(page, { report: stripeV2 });
  const groupTitles = page.getByTestId('signal-groups').locator('section h2');

  await page.getByTestId('score-card-search').click();
  await expect(page.getByTestId('score-card-search')).toHaveAttribute('aria-pressed', 'true');
  await expect(groupTitles).toHaveText(['Both audiences', 'AI search']);
  // Both audiences keeps the shared row and the search-only row (S2, S5).
  await expect(page.getByText('Answer-ready sections')).toBeVisible();
  await expect(page.getByText('Sections findable')).toHaveCount(0);
  await expect(page.getByTestId('agent-preview')).toHaveCount(0);

  await page.getByTestId('score-card-coding').click();
  await expect(groupTitles).toHaveText(['Both audiences', 'Coding agents']);
  await expect(page.getByText('Sections findable')).toBeVisible();
  await expect(page.getByText('Answer-ready sections')).toHaveCount(0);
  await expect(page.getByTestId('agent-preview')).toBeVisible();

  // A second click on the same card shows everything again.
  await page.getByTestId('score-card-coding').click();
  await expect(page.getByTestId('score-card-coding')).toHaveAttribute('aria-pressed', 'false');
  await expect(groupTitles).toHaveText(['Both audiences', 'Coding agents', 'AI search']);
});

test('S-10: an older single-score report shows the legacy view with a re-scan note', async ({ page }) => {
  await openSavedReport(page, { report: stripeV1 });
  await expect(page.getByTestId('legacy-report-note')).toContainText('Re-scan to see the new scores');
  await expect(page.getByTestId('legacy-report-note').getByRole('button', { name: 'Re-scan' })).toBeVisible();
  await expect(page.getByTestId('score-cards')).toHaveCount(0);
  await expect(page.getByText(`${stripeV1.overallScore}/100`)).toBeVisible();
  await expect(page.getByText(/Bot access/).first()).toBeVisible();
  await expect(page.getByTestId('signal-groups').locator('section h2')).toHaveText(['Structured data', 'Discoverability', 'Content quality']);
});

test('S-08: reloading /results keeps both scores', async ({ page }) => {
  await openSavedReport(page, { report: stripeV2 });
  await page.reload();
  await expect(page.getByText('What Lensy found')).toBeVisible();
  await expect(page.getByTestId('score-card-search')).toContainText(`${stripeV2.scores.aiSearch.score}/100`);
  await expect(page.getByTestId('score-card-coding')).toContainText(`${stripeV2.scores.codingAgents.score}/100`);
});

test('S-06: at 375px both score cards and the agent preview fit with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openSavedReport(page, { report: stripeV2 });
  for (const id of ['score-card-search', 'score-card-coding', 'agent-preview', 'reachability-banner']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box!.x, id).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, id).toBeLessThanOrEqual(375);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('REG-18: a two-score report whose server refused an honest agent shows the warn banner', async ({ page }) => {
  const warned = { ...stripeV2, gate: { state: 'warn', via: 'browser', honestStatus: 403, browserStatus: 200, robotsBlocks: [], mismatch: 'robots.txt allows AI bots but the server blocked an honest agent' } };
  await openSavedReport(page, { report: warned });
  const banner = page.getByTestId('reachability-banner');
  await expect(banner).toContainText('Reachability warning: the server refused an honest AI agent (HTTP 403). A browser got HTTP 200.');
  await expect(banner).toContainText('Your robots.txt allows AI bots, but the server refused an agent that named itself');
});

// The new hero in both themes at desktop and phone width, kept as test
// artifacts for the PR's visual check (spec §9.2).
for (const theme of ['light', 'dark'] as const) {
  for (const width of [1280, 375]) {
    test(`S-01 / S-02: two-score hero renders in ${theme} theme at ${width}px`, async ({ page }, testInfo) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      await openSavedReport(page, { report: stripeV2 });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.screenshot({ path: testInfo.outputPath(`hero-${theme}-${width}.png`), fullPage: false });
    });
  }
}
