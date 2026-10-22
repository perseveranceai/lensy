import { expect, Page, test } from '@playwright/test';
import { blockAnalytics, trackConsoleErrors } from './helpers';

// Cookie banner and analytics consent. Google Analytics may only load after
// the visitor accepts; until then consent mode is "denied". These tests start
// from a first visit (no saved choice), unlike the rest of the suite, which
// starts with analytics declined (playwright.config.ts).
test.use({ storageState: { cookies: [], origins: [] } });

const CONSENT_KEY = 'lensy-analytics-consent';

// Consent commands recorded by the inline gtag() stub: ['consent', mode, settings].
async function consentCommands(page: Page) {
  return page.evaluate(() =>
    ((window as any).dataLayer || [])
      .map((entry: any) => Array.from(entry as ArrayLike<any>))
      .filter((args: any[]) => args[0] === 'consent')
      .map((args: any[]) => ({ mode: String(args[1]), analytics: args[2]?.analytics_storage })),
  );
}

async function gaDisabled(page: Page) {
  return page.evaluate(() => Object.keys(window).filter((k) => k.startsWith('ga-disable-')).map((k) => (window as any)[k]));
}

function watchGaRequests(page: Page) {
  const requests: string[] = [];
  page.on('request', (req) => {
    if (/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/.test(req.url())) requests.push(req.url());
  });
  return requests;
}

test('CK-01: first visit shows the banner, analytics starts denied, and Decline sticks', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  const gaRequests = watchGaRequests(page);
  await blockAnalytics(page);
  await page.goto('/');
  const banner = page.getByTestId('cookie-banner');
  await expect(banner).toBeVisible();
  expect((await consentCommands(page))[0]).toEqual({ mode: 'default', analytics: 'denied' });

  await banner.getByRole('button', { name: 'Decline' }).click();
  await expect(banner).toBeHidden();
  expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe('denied');
  expect(await gaDisabled(page)).toEqual([true]);

  await page.reload();
  await expect(page.getByText(/Your docs/).first()).toBeVisible();
  await expect(page.getByTestId('cookie-banner')).toBeHidden();
  expect(await gaDisabled(page)).toEqual([true]);
  expect(gaRequests, gaRequests.join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});

test('CK-02: Accept grants analytics, and non-live hosts still send nothing', async ({ page }) => {
  const gaRequests = watchGaRequests(page);
  await blockAnalytics(page);
  await page.goto('/');
  await page.getByTestId('cookie-banner').getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByTestId('cookie-banner')).toBeHidden();
  expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe('granted');
  expect(await consentCommands(page)).toContainEqual({ mode: 'update', analytics: 'granted' });

  // Granted survives a reload and is applied before the app starts.
  await page.reload({ waitUntil: 'load' });
  await expect(page.getByTestId('cookie-banner')).toBeHidden();
  expect(await consentCommands(page)).toContainEqual({ mode: 'update', analytics: 'granted' });
  // gtag.js only loads on perseveranceai.com (REG-14), even with consent.
  expect(gaRequests, gaRequests.join('\n')).toEqual([]);
});

test('CK-03: Cookie settings in the footer reopens the banner and can switch to Decline', async ({ page }) => {
  await blockAnalytics(page);
  await page.goto('/');
  await page.getByTestId('cookie-banner').getByRole('button', { name: 'Accept' }).click();
  await page.getByRole('button', { name: 'Cookie settings' }).click();
  const banner = page.getByTestId('cookie-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Decline' }).click();
  expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe('denied');
  expect(await consentCommands(page)).toContainEqual({ mode: 'update', analytics: 'denied' });
  expect(await gaDisabled(page)).toEqual([true]);

  // The privacy page describes what the banner controls and who gets data.
  await page.getByRole('link', { name: 'Terms and Policy' }).click();
  await page.getByRole('navigation', { name: 'Legal documents' }).getByRole('link', { name: 'Privacy Policy' }).click();
  await expect(page).toHaveURL(/\/privacy/);
  const policy = page.locator('main');
  for (const text of ['Google Analytics', '_ga', 'Jina', 'Perplexity', 'Amazon Bedrock', '30 days', 'Cookie settings']) {
    await expect(policy).toContainText(text);
  }
});

test('CK-04: at 375px the banner fits on screen with both choices visible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await blockAnalytics(page);
  await page.goto('/');
  const banner = page.getByTestId('cookie-banner');
  await expect(banner).toBeVisible();
  const box = await banner.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  await expect(banner.getByRole('button', { name: 'Accept' })).toBeInViewport();
  await expect(banner.getByRole('button', { name: 'Decline' })).toBeInViewport();
});
