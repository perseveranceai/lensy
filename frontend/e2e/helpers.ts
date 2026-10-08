import { expect, Page } from '@playwright/test';

// Test URLs from docs/test-cases.md ("Test URLs"). Last confirmed 2026-10-08.
export const URLS = {
  stripeApi: 'https://docs.stripe.com/api', // U-1 happy path
  githubRest: 'https://docs.github.com/en/rest', // U-2
  ditaDocs: 'https://docs.paloaltonetworks.com/common-services/subscription-and-tenant-management/get-started', // U-3
  spa: 'https://redocly.github.io/redoc/', // U-4
  noRobots: 'https://www.lua.org/manual/5.4/manual.html', // U-5
  marketing: 'https://stripe.com/', // U-8
  invalid: 'not a url', // U-9
};

// gamma and prod share one GA4 property. Never let a test run send real
// analytics: block every Google Analytics request. The inline gtag() stub in
// index.html still pushes events into window.dataLayer, so tests can assert on
// them without anything leaving the browser.
export async function blockAnalytics(page: Page) {
  await page.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
}

export async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
}

// Collects uncaught page errors and console.error output for the whole test.
export function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Our own analytics block shows up as a failed request; that's expected.
    if (/googletagmanager|google-analytics|net::ERR_FAILED/.test(text)) return;
    errors.push(text);
  });
  return errors;
}

// The colour actually painted behind the page content: walk up from <main> to
// the first element with a non-transparent background.
export async function paintedBackground(page: Page) {
  return page.evaluate(() => {
    let el: HTMLElement | null = document.querySelector('main');
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      el = el.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
}

export async function startScan(page: Page, url: string) {
  await page.goto('/');
  await page.getByPlaceholder('docs.yourcompany.com').fill(url);
  await page.getByRole('button', { name: /start scan/i }).click();
}

export async function expectReport(page: Page) {
  await expect(page).toHaveURL(/\/results/, { timeout: 150_000 });
  await expect(page.getByText('What Lensy found')).toBeVisible({ timeout: 30_000 });
}

// GA events recorded by the inline gtag() stub: ['event', name, params].
export async function gaEvents(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    ((window as any).dataLayer || [])
      .map((entry: any) => Array.from(entry as ArrayLike<any>))
      .filter((args: any[]) => args[0] === 'event')
      .map((args: any[]) => String(args[1])),
  );
}
