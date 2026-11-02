// SPDX-License-Identifier: MIT
// No page limit; a long run says how many pages and roughly how long (spec answer 9).
import { describe, expect, test } from 'vitest';
import { estimateMinutes, largeRunNotice, uniquePages } from '../src/pages';

describe('pages', () => {
  test('duplicates count once and order is kept', () => {
    expect(uniquePages(['a', 'b', 'a', 'c', 'b'])).toEqual({ pages: ['a', 'b', 'c'], duplicates: 2 });
  });

  test('no notice for 15 pages or fewer', () => {
    expect(largeRunNotice(15, 2)).toBeNull();
  });

  test('a long run: count, time range and the --concurrency hint', () => {
    expect(estimateMinutes(2000, 2)).toEqual([84, 250]);
    expect(largeRunNotice(2000, 2)).toBe('Checking 2000 pages, 2 at a time. This takes about 84 to 250 minutes. A higher --concurrency (up to 5) is faster.');
    expect(largeRunNotice(40, 5)).toBe('Checking 40 pages, 5 at a time. This takes about 1 to 2 minutes.');
  });
});
