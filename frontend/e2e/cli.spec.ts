import { test, expect } from '@playwright/test';
import { blockAnalytics, setTheme } from './helpers';

// CLI-01 to CLI-03 (docs/test-cases.md): the command-line guide and its pointer on
// the home page. Spec: .context/specs/cli-docs-page.md.
test.beforeEach(async ({ page }) => {
  await blockAnalytics(page);
});

test('CLI-01: the home page points to the CLI guide, above the questions', async ({ page }) => {
  await page.goto('/');
  const section = page.locator('#command-line');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Check docs from your terminal.' })).toBeVisible();
  // It sits before "A few good questions", as asked.
  const before = await page.evaluate(() => {
    const a = document.getElementById('command-line')!;
    const b = document.getElementById('questions')!;
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(before).toBe(true);
  await section.getByRole('link', { name: /Read the CLI guide/ }).click();
  await expect(page).toHaveURL(/\/cli$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('command line');
});

test('CLI-02: /cli has the guide sections in order, the install command and the limits', async ({ page }) => {
  await page.goto('/cli');
  await expect(page).toHaveTitle('Command-line guide - Lensy');
  const guide = page.getByTestId('cli-guide');
  await expect(guide.locator('h2')).toHaveText([
    'What it is', 'Install', 'Check a page', 'Check several pages', 'Check a local build', 'Save a report',
    'Save and compare runs', 'Explain a check', 'Exit codes', 'What it sends', "What it can't do yet",
  ]);
  await expect(guide.getByLabel('Install command')).toContainText('npm install -g @perseverance-ai/lensy@next');
  // Check a page: the short view and its options, matching `lensy check --help` (guide.test.ts).
  await expect(guide.getByLabel('Example output for one page')).toContainText('Fix these first');
  await expect(guide.getByText(/The points add up to each score/)).toBeVisible();
  await expect(guide.locator('code', { hasText: '--verbose' }).first()).toBeVisible();
  await expect(guide.getByLabel('Save reports')).toContainText('--json report.json');
  // Local builds are supported now: the old "refused" line is gone.
  await expect(guide.getByText(/local addresses are refused/)).toHaveCount(0);
  // The user agent matches the one /bot describes, and the link goes there.
  await expect(guide.getByText('lensy-cli/<version> (+https://perseveranceai.com/bot)')).toBeVisible();
  await guide.getByRole('link', { name: 'bot page' }).click();
  await expect(page).toHaveURL(/\/bot$/);
});

test('CLI-05: "Save and compare runs" shows the question, a comparison, the folder and the settings', async ({ page }) => {
  await page.goto('/cli');
  const guide = page.getByTestId('cli-guide');
  await expect(guide.getByLabel('The first-run question')).toContainText('Save Lensy results for this project in .lensy?');
  await expect(guide.getByLabel('Example comparison')).toContainText('Since Nov 2 (6 days ago): Coding agents 80 → 87 (+7)');
  await expect(guide.getByLabel('Example comparison')).toContainText('Fixed: llms.txt exists');
  await expect(guide.getByLabel('The .lensy folder')).toContainText('history.md');
  await expect(guide.getByLabel('Project settings')).toContainText('"pages"');
  // The flags match `lensy check --help` (packages/cli/test/guide.test.ts checks every option).
  for (const flag of ['--save', '--no-save', '--save-dir']) await expect(guide.locator('code', { hasText: flag }).first()).toBeVisible();
  await expect(guide.getByText(/Saved results stay on your machine/)).toBeVisible();
  // The side link lands on the section.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Save and compare runs' }).click();
  await expect(page).toHaveURL(/#save-and-compare$/);
});

test('CLI-06: "Check a local build" shows --dir, --site-url, a points-checked result and the comparison', async ({ page }) => {
  await page.goto('/cli');
  const guide = page.getByTestId('cli-guide');
  await expect(guide.getByLabel('Check a VitePress build')).toContainText('lensy check --dir docs/.vitepress/dist --site-url https://docs.example.com --all');
  await expect(guide.getByLabel('Example local check')).toContainText('58 of 70 points checked');
  await expect(guide.getByLabel('Example local check')).toContainText('Not checked here');
  await expect(guide.getByLabel('Example local comparison')).toContainText('AI search 77 → 89 (+12)');
  await expect(guide.getByText(/not the dev server/)).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Check a local build' }).click();
  await expect(page).toHaveURL(/#local-build$/);
});

test('CLI-02: the side links jump to a section', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/cli');
  await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Exit codes' }).click();
  await expect(page).toHaveURL(/#exit-codes$/);
  // The site scrolls smoothly, so wait until the section has stopped moving, then
  // check it landed below the sticky header and not under it.
  const topOf = () => page.locator('#exit-codes').evaluate((el) => Math.round(el.getBoundingClientRect().top));
  await expect.poll(topOf, { timeout: 5000 }).toBeLessThan(300);
  expect(await topOf()).toBeGreaterThan(40);
});

test('CLI-03: at 375px the home section and the guide fit in both themes, and long commands scroll inside their box', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    for (const path of ['/', '/cli']) {
      await page.goto(path);
      if (path === '/') await expect(page.locator('#command-line')).toBeVisible();
      else await expect(page.getByTestId('cli-guide')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal scroll on ${path} in ${theme} theme`).toBeLessThanOrEqual(0);
    }
    // The longest command is wider than the screen, so it scrolls inside its own box.
    const block = page.getByLabel('Run without installing');
    await block.scrollIntoViewIfNeeded();
    const m = await block.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, right: el.getBoundingClientRect().right }));
    expect(m.scroll, `command not scrollable in ${theme} theme`).toBeGreaterThan(m.client);
    expect(m.right, `command box wider than the screen in ${theme} theme`).toBeLessThanOrEqual(375);
    // It can be reached with the keyboard.
    await block.focus();
    await expect(block).toBeFocused();
  }
});
