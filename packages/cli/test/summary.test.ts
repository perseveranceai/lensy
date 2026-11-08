// SPDX-License-Identifier: MIT
// The short view's helpers: one-page wording, the action sentence of a fix,
// and losses on the 0-100 scale that add up to the score.
import { describe, expect, test } from 'vitest';
import type { Score } from '@perseverance-ai/lensy-core';
import { actionLine, capFrom, cleanFix, scaledLosses, tidy } from '../src/summary';

describe('tidy: one page, not a site sample', () => {
  test.each([
    ['All 1 pages contain server-rendered content', 'The page contains server-rendered content'],
    ['No llms.txt directive found in HTML of any of 1 pages', 'No llms.txt directive found in HTML of the page'],
    ['All 1 markdown pages deliver complete content in one fetch', 'The Markdown version delivers complete content in one fetch'],
    ['1 of 1 markdown pages carry links that are unresolvable', 'The Markdown version carries links that are unresolvable'],
    ['1 of 1 pages have minor content differences', 'The page has minor content differences'],
    ['No tabbed content detected across 1 pages', 'No tabbed content detected on the page'],
    ['Server ignores Accept: text/markdown header (0/1 pages return markdown)', 'Server ignores Accept: text/markdown header'],
    ['1/1 pages support .md URLs (100%)', 'The page supports .md URLs'],
    ['All 20 code fences properly closed across 2 pages', 'All 20 code fences properly closed across 2 pages'],
    ['llms.txt directive found in HTML of 1 of 1 pages, but buried', 'llms.txt directive found in HTML of the page, but buried'],
    ['All 1 pages under 50K chars (median 6K, max 6K)', 'The page is under 50K chars (median 6K, max 6K)'],
    ['1 pages have minor content differences between their markdown and HTML versions.', 'The page has minor content differences between its Markdown and HTML versions.'],
  ])('%s', (input, out) => expect(tidy(input)).toBe(out));
});

describe('actionLine: the sentence that says what to do', () => {
  test('skips the restated problem', () => {
    expect(actionLine('Your server ignores Accept: text/markdown and returns HTML. Some agents request markdown this way. Configure your server to honor content negotiation.'))
      .toBe('Configure your server to honor content negotiation.');
  });
  test("drops sentences that name another tool's options", () => {
    expect(actionLine('1 pages have minor content differences. If this is intentional, adjust --parity-pass-threshold and --parity-warn-threshold.')).toBeNull();
  });
  test('cleanFix keeps the whole fix but drops the sentence with another tool\'s options', () => {
    expect(cleanFix('1 pages have minor differences. If this is intentional, adjust --parity-pass-threshold.')).toBe('The page has minor differences.');
  });
  test('keeps a fix that starts with the action', () => {
    expect(actionLine('Add a JSON-LD block (for example TechArticle) with dateModified. It carries little weight, so do this last.'))
      .toBe('Add a JSON-LD block (for example TechArticle) with dateModified.');
  });
});

const check = (id: string, points: number, max: number) => ({ id, source: 'afdocs', label: id, max, points, status: points === max ? 'pass' : 'fail', detail: '' }) as Score['checks'][number];

describe('scaledLosses', () => {
  test('losses on a 112-point AFDocs score add up to 100 minus the score', () => {
    const checks = [check('a', 0, 7), check('b', 0, 4), check('c', 0, 4), check('d', 97, 97)];
    const score: Score = { score: Math.round((97 * 100) / 112), coveredMax: 100, checks };
    const losses = scaledLosses(score);
    expect([...losses.values()].reduce((n, v) => n + v, 0)).toBe(100 - score.score!);
    expect(losses.get('a')).toBeGreaterThan(losses.get('b')!);
  });
  test('a 0-point check loses nothing', () => {
    const score: Score = { score: 100, coveredMax: 100, checks: [check('a', 0, 0), check('b', 10, 10)] };
    expect(scaledLosses(score).get('a')).toBeUndefined();
  });
  test('capFrom spots a score below what its checks add up to', () => {
    const score: Score = { score: 59, coveredMax: 100, checks: [check('a', 66, 100)] };
    expect(capFrom(score)).toBe(66);
    expect(capFrom({ ...score, score: 66 })).toBeNull();
  });
});
