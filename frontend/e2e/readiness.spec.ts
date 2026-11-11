import { test, expect, Page } from '@playwright/test';
import { blockAnalytics } from './helpers';

// The home page's "Our own score" chart (.context/specs/site-architecture.md, phase 2).
// The weekly history is served from /readiness/history.json. Tests supply their
// own test history; the real site only ever shows real runs.

// Test history: 200 daily runs, 2026-04-24 to 2026-11-09. Lensy's checks change on 2026-05-01.
// As in the real file, only the newest run keeps its pages.
function testHistory() {
  const runs = Array.from({ length: 200 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 3, 24 + i)).toISOString().slice(0, 10);
    const ca = Math.min(100, 40 + Math.floor(i / 3));
    const ai = Math.min(100, 55 + Math.floor(i / 4));
    return { date, cli: '0.2.0', engine: i < 7 ? 'aaaaaaa' : 'bbbbbbb', codingAgents: ca, aiSearch: ai, ...(i === 199 ? { pages: [{ path: '/', codingAgents: ca, aiSearch: ai }] } : {}) };
  });
  return { version: 1, site: 'https://perseveranceai.com', runs };
}

async function serveHistory(page: Page, history: unknown | null) {
  await page.route('**/readiness/history.json', (route) => history
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(history) })
    : route.fulfill({ status: 404, contentType: 'text/html', body: 'not found' }));
}

async function chartSection(page: Page) {
  const section = page.locator('#our-score');
  await section.scrollIntoViewIfNeeded();
  return section;
}

test.beforeEach(async ({ page }) => { await blockAnalytics(page); });

test('READY-01: with no history file yet, the home chart shows only the real Nov 10 baseline', async ({ page }) => {
  await serveHistory(page, null);
  await page.goto('/');
  const section = await chartSection(page);
  await expect(section.getByRole('heading', { level: 2 })).toHaveText('Same checks, on our own site.');
  await expect(section.getByTestId('score-chart')).toHaveAttribute('data-runs', '1');
  await expect(section.getByText('Last checked Nov 10, 2026')).toBeVisible();
  // One run: no time ranges to choose from.
  await expect(section.getByRole('group', { name: 'Time range' })).toHaveCount(0);
});

test('READY-02: the chart switches range, shows a run on hover and on the arrow keys, and marks check changes', async ({ page }) => {
  await serveHistory(page, testHistory());
  await page.goto('/');
  const section = await chartSection(page);
  const chart = section.getByTestId('score-chart');
  await expect(chart).toHaveAttribute('data-runs', '200');
  await expect(section.getByText('Last checked Nov 9, 2026')).toBeVisible();
  await expect(chart.getByTestId('engine-change')).toHaveCount(1);

  // About 7 months of daily runs: 7D, 1M and 3M are offered, 1Y isn't (it would show everything).
  await expect(section.getByRole('button', { name: 'Last year' })).toHaveCount(0);
  await section.getByRole('button', { name: 'Last 7 days' }).click();
  await expect(section.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(chart).toHaveAttribute('data-runs', '7');
  await section.getByRole('button', { name: 'Last month' }).click();
  await expect(chart).toHaveAttribute('data-runs', '30');
  await section.getByRole('button', { name: 'Last 3 months' }).click();
  await expect(chart).toHaveAttribute('data-runs', '91');
  await section.getByRole('button', { name: 'All runs' }).click();
  await expect(chart).toHaveAttribute('data-runs', '200');

  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.locator('svg').boundingBox())!;
  // The last point sits at the chart's right padding (16px); daily points are a few pixels apart.
  await page.mouse.move(box.x + box.width - 17, box.y + box.height / 2);
  await expect(page.getByTestId('chart-tooltip')).toContainText('Nov 9, 2026');
  await expect(page.getByTestId('chart-tooltip')).toContainText('Coding agents');

  await page.mouse.move(0, 0);
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('chart-tooltip')).toContainText('Apr 24, 2026');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('chart-tooltip')).toContainText("Lensy's checks changed this week");
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chart-tooltip')).toBeHidden();
});

test('READY-03: the chart fits a phone', async ({ page }) => {
  await serveHistory(page, testHistory());
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const section = await chartSection(page);
  await expect(section.getByTestId('score-chart')).toHaveAttribute('data-runs', '200');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('READY-04: the saved home page carries the chart section and the history it was drawn with', async ({ page, request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('id="readiness-data"');
  expect(html).toContain('Same checks, on our own site.');
  expect(html).not.toContain('/ai-readiness');
  const problems: string[] = [];
  page.on('console', (m) => { if (/\[Hydrate\]|Minified React error #(418|423|425)/.test(m.text())) problems.push(m.text().slice(0, 160)); });
  await page.goto('/', { waitUntil: 'load' });
  await (await chartSection(page)).getByTestId('score-chart').waitFor();
  await page.waitForTimeout(500);
  expect(problems).toEqual([]);
});
