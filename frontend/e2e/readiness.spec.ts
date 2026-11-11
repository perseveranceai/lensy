import { test, expect, Page } from '@playwright/test';
import { blockAnalytics } from './helpers';

// This site's own readiness page and footer line (.context/specs/site-architecture.md, phase 2).
// The weekly history is served from /readiness/history.json; tests supply their own.

const pages = (ca: number, ai: number) => ['/', '/cli', '/how-it-works'].map((path) => ({ path, codingAgents: ca, aiSearch: ai }));

// 12 weekly runs, 2026-08-24 to 2026-11-09. Lensy's checks change on 2026-10-12.
function weeklyHistory() {
  const runs = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 7, 24 + i * 7)).toISOString().slice(0, 10);
    const ca = Math.min(100, 40 + i * 6);
    const ai = Math.min(100, 55 + i * 5);
    return { date, cli: '0.2.0', engine: i < 7 ? 'aaaaaaa' : 'bbbbbbb', codingAgents: ca, aiSearch: ai, pages: pages(ca, ai) };
  });
  return { version: 1, site: 'https://perseveranceai.com', runs };
}

async function serveHistory(page: Page, history: unknown | null) {
  await page.route('**/readiness/history.json', (route) => history
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(history) })
    : route.fulfill({ status: 404, contentType: 'text/html', body: 'not found' }));
}

test.beforeEach(async ({ page }) => { await blockAnalytics(page); });

test('READY-01: with no history file yet, the page shows the Nov 10 baseline', async ({ page }) => {
  await serveHistory(page, null);
  await page.goto('/ai-readiness');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Our own\s+AI readiness\./);
  const latest = page.getByTestId('readiness-latest');
  await expect(latest).toContainText('39');
  await expect(latest).toContainText('55');
  await expect(page.getByTestId('score-chart')).toHaveAttribute('data-runs', '1');
  await expect(page.locator('main table tbody tr')).toHaveCount(4);
  await expect(page.getByTestId('readiness-line')).toContainText('This site scores 39 for coding agents and 55 for AI search');
});

test('READY-02: the chart switches range, shows a run on hover and on the arrow keys, and marks check changes', async ({ page }) => {
  await serveHistory(page, weeklyHistory());
  await page.goto('/ai-readiness');
  const chart = page.getByTestId('score-chart');
  await expect(page.getByTestId('readiness-latest')).toContainText('100');
  await expect(chart).toHaveAttribute('data-runs', '12');
  await expect(page.getByText('12 runs since Aug 24, 2026')).toBeVisible();
  await expect(chart.getByTestId('engine-change')).toHaveCount(1);

  await page.getByRole('button', { name: 'Last 30 days' }).click();
  await expect(page.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(chart).toHaveAttribute('data-runs', '5');
  await page.getByRole('button', { name: 'Last 7 days' }).click();
  await expect(chart).toHaveAttribute('data-runs', '1');
  await page.getByRole('button', { name: 'All runs' }).click();
  await expect(chart).toHaveAttribute('data-runs', '12');

  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.locator('svg').boundingBox())!;
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await expect(page.getByTestId('chart-tooltip')).toContainText('Nov 9, 2026');
  await expect(page.getByTestId('chart-tooltip')).toContainText('Coding agents');

  await page.mouse.move(0, 0);
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('chart-tooltip')).toContainText('Aug 24, 2026');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('chart-tooltip')).toContainText("Lensy's checks changed this week");
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chart-tooltip')).toBeHidden();
});

test('READY-03: the footer line links to the page, and the page fits a phone', async ({ page }) => {
  await serveHistory(page, weeklyHistory());
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/cli');
  const line = page.getByTestId('readiness-line');
  await expect(line).toContainText('This site scores 100 for coding agents and 100 for AI search. Checked weekly.');
  await line.click();
  await expect(page).toHaveURL(/\/ai-readiness$/);
  await expect(page.getByTestId('score-chart')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('READY-04: the saved HTML carries the scores and the history it was drawn with', async ({ page, request }) => {
  const html = await (await request.get('/ai-readiness')).text();
  expect(html).toContain('id="readiness-data"');
  expect(html).toMatch(/<h2[^>]*>Every page<\/h2>/);
  expect(html).toMatch(/This site scores <span[^>]*>\d+<\/span> for coding agents/);
  const problems: string[] = [];
  page.on('console', (m) => { if (/\[Hydrate\]|Minified React error #(418|423|425)/.test(m.text())) problems.push(m.text().slice(0, 160)); });
  await page.goto('/ai-readiness', { waitUntil: 'load' });
  await expect(page.getByTestId('score-chart')).toBeVisible();
  await page.waitForTimeout(500);
  expect(problems).toEqual([]);
});
