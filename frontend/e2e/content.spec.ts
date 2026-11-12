import { test, expect } from '@playwright/test';
import { blockAnalytics } from './helpers';
import checks from '../src/checks.json';

// Phase 3 content pages (.context/specs/site-architecture.md).

test.beforeEach(async ({ page }) => { await blockAnalytics(page); });

test('CONTENT-01: the home page shows a real result, with the score each fix adds to', async ({ page }) => {
  await page.goto('/');
  const result = page.locator('#what-you-get');
  await result.scrollIntoViewIfNeeded();
  await expect(result.getByRole('heading', { level: 2 })).toHaveText('Two scores, and what to fix first.');
  await expect(result).toContainText('perseveranceai.com: before (Nov 10, 2026) and after (Nov 12, 2026)');
  await expect(result).toContainText('Content without JavaScript');
  await expect(result).toContainText('+29 Coding agents');
  await expect(result).toContainText('+15 AI search');
});

test('CONTENT-02: /docs/checks lists every check from the registry, with its points', async ({ page }) => {
  await page.goto('/docs/checks');
  const list = page.locator('main');
  // One row per check, plus a header row per table (AI search, Coding agents, the C1-C6 fallback).
  await expect(list.getByRole('row')).toHaveCount(checks.aiSearch.length + checks.codingAgents.length + checks.fallback.length + 3);
  const aiSearch = page.locator('section[aria-labelledby="checks-aiSearch"]');
  for (const c of checks.aiSearch) await expect(aiSearch.getByRole('row', { name: new RegExp(`^${c.label}.*${c.points}$`) })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="checks-codingAgents"]').getByRole('row', { name: /^Real 404s for missing pages/ })).toBeVisible();
});

test('CONTENT-03: /about is a page, not a redirect, and links to the rest of the site', async ({ page, request }) => {
  const res = await request.get('/about');
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('<link rel="canonical" href="');
  await page.goto('/about');
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/About\s+Lensy\./);
  for (const h of ['What Lensy does', 'Where it runs', 'How we hold ourselves to it', 'Who builds it', 'Contact']) {
    await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
  }
  await expect(page.locator('main').getByRole('link', { name: 'changelog' })).toHaveAttribute('href', '/changelog');
});

test('CONTENT-04: /changelog lists changes newest first, with dates', async ({ page }) => {
  await page.goto('/changelog');
  await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('November 2026');
  const dates = await page.locator('main time').evaluateAll((els) => els.map((e) => e.getAttribute('datetime')));
  expect(dates.length).toBeGreaterThan(5);
  expect([...dates].sort().reverse()).toEqual(dates);
  // Reachable from the footer on every page.
  await page.goto('/docs/cli');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Changelog' }).click();
  await expect(page).toHaveURL(/\/changelog$/);
});

test('CONTENT-05: articles have a breadcrumb and sentence-case headings', async ({ page }) => {
  await page.goto('/learn/research-behind-ai-ready-docs');
  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  await expect(crumb.getByRole('link', { name: 'Learn' })).toHaveAttribute('href', '/learn');
  await expect(crumb.locator('[aria-current="page"]')).toHaveText('The research behind AI-ready documentation');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The research behind AI-ready documentation');
  await expect(page.getByRole('heading', { level: 2, name: 'Why document structure matters' })).toBeVisible();
});
