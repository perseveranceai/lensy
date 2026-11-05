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
    'What it is', 'Install', 'Check a page', 'Check several pages', 'Save a report',
    'Explain a check', 'Exit codes', 'What it sends', "What it can't do yet",
  ]);
  await expect(guide.getByLabel('Install command')).toContainText('npm install -g @perseverance-ai/lensy@next');
  // What it can't do yet: no local builds, said plainly.
  await expect(guide.getByText(/local addresses are refused with exit code 2/)).toBeVisible();
  // The user agent matches the one /bot describes, and the link goes there.
  await expect(guide.getByText('lensy-cli/<version> (+https://perseveranceai.com/bot)')).toBeVisible();
  await guide.getByRole('link', { name: 'bot page' }).click();
  await expect(page).toHaveURL(/\/bot$/);
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
