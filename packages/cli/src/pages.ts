// SPDX-License-Identifier: MIT
// Which pages a run checks. Lensy never crawls: it checks exactly the URLs
// given, each once. There is no page limit (spec answer 9); a long list gets a
// notice with the count and a rough time, so nobody waits without knowing why.
export const LARGE_RUN = 15;

// A page takes about 5 to 15 seconds (the page plus robots.txt, sitemap,
// llms.txt links and the Markdown version), and `concurrency` run at once.
const SECONDS_PER_PAGE = [5, 15] as const;

export function uniquePages(urls: string[]): { pages: string[]; duplicates: number } {
  const pages = [...new Set(urls)];
  return { pages, duplicates: urls.length - pages.length };
}

export function estimateMinutes(pages: number, concurrency: number): [number, number] {
  const [lo, hi] = SECONDS_PER_PAGE.map(s => Math.max(1, Math.ceil((pages * s) / concurrency / 60)));
  return [lo, hi];
}

export function largeRunNotice(pages: number, concurrency: number): string | null {
  if (pages <= LARGE_RUN) return null;
  const [lo, hi] = estimateMinutes(pages, concurrency);
  const faster = concurrency < 5 ? ' A higher --concurrency (up to 5) is faster.' : '';
  return `Checking ${pages} pages, ${concurrency} at a time. This takes about ${lo} to ${hi} minutes.${faster}`;
}
