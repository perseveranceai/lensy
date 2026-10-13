import { expect, Page, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { blockAnalytics, trackConsoleErrors } from './helpers';

// Report download (H-001): Markdown and PDF, built in the browser.
//
// These tests use a saved report instead of a live scan: the report and
// citation fixtures in ./fixtures came from real gamma scans of U-1 and U-5 on
// 2026-10-13. The backend citation calls are mocked, so no paid Perplexity
// call is made and the "citations not run yet" paths are deterministic.
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const stripeReport = fixture('report-stripe.json');
const stripeCitations = fixture('citations-stripe.json');
const SESSION = 'session-e2e-download';

type Seed = { report: any; citations?: any };

// Put a finished scan where LensyApp restores it from (sessionStorage), and
// keep every network call this page makes local to the test.
async function openSavedReport(page: Page, seed: Seed) {
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
  }, { ...seed, session: SESSION });
  await page.goto('/results');
  await expect(page.getByText('What Lensy found')).toBeVisible();
}

async function downloadAs(page: Page, label: RegExp) {
  await page.getByTestId('download-report').click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('menuitem', { name: label }).click(),
  ]);
  const file = await download.path();
  return { name: download.suggestedFilename(), body: fs.readFileSync(file!) };
}

async function dataLayerEvents(page: Page) {
  return page.evaluate(() =>
    ((window as any).dataLayer || [])
      .map((entry: any) => Array.from(entry as ArrayLike<any>))
      .filter((args: any[]) => args[0] === 'event')
      .map((args: any[]) => ({ name: String(args[1]), params: args[2] || {} })),
  );
}

test('DL-01: with citations done, Markdown downloads at once with everything on the page', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  let citationCalls = 0;
  await page.route(/\/run-citations$|\/citations\//, (route) => { citationCalls += 1; return route.abort(); });
  await openSavedReport(page, { report: stripeReport, citations: stripeCitations });

  const { name, body } = await downloadAs(page, /markdown/i);
  const md = body.toString('utf8');
  expect(name).toMatch(/^lensy-report-docs\.stripe\.com-\d{4}-\d{2}-\d{2}\.md$/);
  expect(citationCalls).toBe(0);

  // Same facts as the page.
  expect(md).toContain('url: "https://docs.stripe.com/api"');
  expect(md).toContain(`readiness_score: ${stripeReport.overallScore}`);
  expect(md).toContain(`Fixes (${stripeReport.recommendations.length} recommendations)`);
  await expect(page.getByText(`View all ${stripeReport.recommendations.length} recommendations`)).toBeVisible();
  for (const rec of stripeReport.recommendations) expect(md).toContain(rec.issue);
  for (const bot of stripeReport.categories.botAccess.bots) expect(md).toContain(bot.name);
  for (const heading of ['### Structured data', '### Discoverability', '### Content quality', '## AI bot access', '## AI citations', '## Page check']) {
    expect(md).toContain(heading);
  }
  const results = stripeCitations.engines.perplexity.results;
  const cited = results.filter((r: any) => r.cited).length;
  expect(md).toContain(`Cited in ${cited} of ${results.length} tested queries (Perplexity)`);
  for (const r of results) expect(md).toContain(r.query);
  // Agent-friendly: plain status words, no icon glyphs or HTML wrappers.
  expect(md).not.toMatch(/[✓✗⚠◉◇]/);
  expect(md).toContain('## How to use this file');

  const events = await dataLayerEvents(page);
  const clicked = events.filter((e) => e.name === 'report_download_clicked');
  const completed = events.filter((e) => e.name === 'report_download_completed');
  expect(clicked).toHaveLength(1);
  expect(clicked[0].params).toMatchObject({ format: 'md', citations_state: 'done', view: 'readiness' });
  expect(completed).toHaveLength(1);
  expect(completed[0].params).toMatchObject({ format: 'md', citations_included: true });

  // N-06: a reload must not replay download events.
  await page.reload();
  await expect(page.getByText('What Lensy found')).toBeVisible();
  const afterReload = (await dataLayerEvents(page)).filter((e) => e.name.startsWith('report_download_'));
  expect(afterReload).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('DL-02: PDF downloads as a real, small PDF', async ({ page }) => {
  await openSavedReport(page, { report: stripeReport, citations: stripeCitations });
  const { name, body } = await downloadAs(page, /^pdf/i);
  expect(name).toMatch(/^lensy-report-docs\.stripe\.com-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  expect(body.length).toBeLessThan(1024 * 1024);
  // The embedded site font, not just the built-in Helvetica.
  expect(body.toString('latin1')).toContain('/FontName /');
});

test('DL-03: without citations, the download runs them once, then saves both formats', async ({ page }) => {
  let runs = 0;
  let polls = 0;
  await page.route(/\/run-citations$/, (route) => { runs += 1; return route.fulfill({ json: { status: 'started', sessionId: SESSION } }); });
  // The WebSocket is silent in this test, so the result arrives through the
  // polling fallback (H-001 B1) on the second poll.
  await page.route(/\/citations\//, (route) => {
    polls += 1;
    return route.fulfill({ json: polls < 2 ? { status: 'running' } : { status: 'done', data: stripeCitations } });
  });
  await openSavedReport(page, { report: stripeReport });

  await page.getByTestId('download-report').click();
  const mdDownload = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('menuitem', { name: /markdown/i }).click();
  await expect(page.getByTestId('download-report')).toContainText('Running AI citations');
  // Ask for the PDF too while waiting: the same run serves both.
  await page.getByTestId('download-report').click();
  const pdfDownload = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('menuitem', { name: /^pdf/i }).click();

  const md = fs.readFileSync((await (await mdDownload).path())!, 'utf8');
  await pdfDownload;
  expect(runs).toBe(1);
  expect(md).toContain('Cited in');
  expect(md).toContain(stripeCitations.engines.perplexity.results[0].query);
  // The citations card filled in as well.
  await expect(page.getByText(/Cited in \d+ of \d+ tested queries/)).toBeVisible();

  const runEvents = (await dataLayerEvents(page)).filter((e) => e.name === 'run_citations_clicked');
  expect(runEvents).toHaveLength(1);
  expect(runEvents[0].params).toMatchObject({ trigger: 'download' });
});

test('DL-04: if citations cannot run, the file says so and never says "not cited"', async ({ page }) => {
  await page.route(/\/run-citations$/, (route) => route.fulfill({ status: 500, json: { error: 'boom' } }));
  await openSavedReport(page, { report: stripeReport });
  const { body } = await downloadAs(page, /markdown/i);
  const md = body.toString('utf8');
  expect(md).toContain('AI citations could not run for this report');
  expect(md).not.toMatch(/\| Not cited \|/);
  expect(md).toContain('citations: "failed"');
});

test('DL-05: "Download without citations" saves right away while the check runs', async ({ page }) => {
  await page.route(/\/run-citations$/, (route) => route.fulfill({ json: { status: 'started', sessionId: SESSION } }));
  await page.route(/\/citations\//, (route) => route.fulfill({ json: { status: 'running' } }));
  await openSavedReport(page, { report: stripeReport });
  await page.getByTestId('download-report').click();
  await page.getByRole('menuitem', { name: /markdown/i }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Download without citations' }).click(),
  ]);
  const md = fs.readFileSync((await download.path())!, 'utf8');
  expect(md).toContain('AI citations are not in this report');
  const completed = (await dataLayerEvents(page)).filter((e) => e.name === 'report_download_completed');
  expect(completed[0].params).toMatchObject({ citations_included: false, citations_skipped: true });
});

test('DL-06: at 375px the download menu fits on screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openSavedReport(page, { report: stripeReport, citations: stripeCitations });
  await page.getByTestId('download-report').click();
  const menu = page.getByRole('menu', { name: 'Download report' });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
});
