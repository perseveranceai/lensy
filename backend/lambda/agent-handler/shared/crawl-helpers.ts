/**
 * Shared crawl helpers for parsing llms.txt and crawling documentation pages.
 * Used by check-ai-readiness tool to populate the Page Knowledge Base.
 *
 * Extracted from github-issues-analyzer/index.ts to avoid duplication.
 */

import { summarizeAndParsePage, writePagesToKB, deriveSafeDomain, PageSummary } from './page-summarizer';
import { ProgressPublisher } from './progress-publisher';

// ─── Types ───────────────────────────────────────────────────

export interface LlmsTxtEntry {
    title: string;
    url: string;
    description?: string;
}

// ─── llms.txt Parser ─────────────────────────────────────────

/**
 * Parse an llms.txt file into structured entries.
 * Handles markdown links [Title](url), plain URLs, and relative paths.
 */
export function parseLlmsTxt(content: string, baseUrl: string): LlmsTxtEntry[] {
    const entries: LlmsTxtEntry[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) continue;

        // Match markdown links: [Title](url) or [Title](url): description
        const linkMatch = trimmed.match(/^\-?\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*:?\s*(.*))?$/);
        if (linkMatch) {
            let url = linkMatch[2].trim();
            // Resolve relative URLs
            if (url.startsWith('/')) {
                url = `${baseUrl}${url}`;
            } else if (!url.startsWith('http')) {
                url = `${baseUrl}/${url}`;
            }
            entries.push({
                title: linkMatch[1].trim(),
                url,
                description: linkMatch[3]?.trim() || undefined
            });
            continue;
        }

        // Match plain URLs
        const urlMatch = trimmed.match(/^(https?:\/\/[^\s]+)/);
        if (urlMatch) {
            entries.push({
                title: urlMatch[1].replace(baseUrl, '').replace(/^\//, '') || 'Home',
                url: urlMatch[1]
            });
        }
    }

    return entries;
}

// ─── Single Page Crawl ───────────────────────────────────────

/**
 * Fetch a single page and extract its text content.
 * Strips scripts, styles, nav, footer, header.
 */
export async function crawlSinglePage(url: string): Promise<{ content: string; title: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'text/html' }
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            return { content: '', title: '' };
        }

        const html = await res.text();

        // Extract title from <title> tag
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch?.[1]?.trim() || '';

        // Strip non-content elements, extract text
        const textContent = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return { content: textContent, title };
    } catch (e) {
        clearTimeout(timeoutId);
        console.log(`[CrawlHelpers] Failed to crawl ${url}: ${(e as Error).message}`);
        return { content: '', title: '' };
    }
}

// ─── Batch Crawl + Summarize + Write to KB ───────────────────

/**
 * Crawl pages from llms.txt entries, summarize each with Haiku,
 * and write all summaries to the DynamoDB Knowledge Base.
 *
 * @param entries - Parsed llms.txt entries
 * @param sourceUrl - The original URL (used to derive domain key)
 * @param maxPages - Maximum pages to process (default 50)
 * @param publisher - Optional progress publisher for WebSocket updates
 * @returns Number of pages successfully written to KB
 */
export async function crawlAndPopulateKB(
    entries: LlmsTxtEntry[],
    sourceUrl: string,
    maxPages: number = 50,
    publisher?: ProgressPublisher
): Promise<number> {
    const domain = deriveSafeDomain(sourceUrl);
    const toProcess = entries.slice(0, maxPages);
    const summaries: PageSummary[] = [];

    console.log(`[CrawlHelpers] Crawling ${toProcess.length} pages for domain ${domain}...`);

    // Crawl in batches of 10
    const crawlBatchSize = 10;
    for (let i = 0; i < toProcess.length; i += crawlBatchSize) {
        const batch = toProcess.slice(i, i + crawlBatchSize);

        const crawlResults = await Promise.all(
            batch.map(async (entry) => {
                const { content, title } = await crawlSinglePage(entry.url);
                return {
                    url: entry.url,
                    title: title || entry.title,
                    content,
                    category: entry.description
                };
            })
        );

        // Rate-limit between batches
        if (i + crawlBatchSize < toProcess.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Summarize pages that have content
        for (const page of crawlResults) {
            if (page.content.length < 100) continue; // Skip empty/error pages

            try {
                const summary = await summarizeAndParsePage(
                    page.url,
                    page.title,
                    page.content,
                    page.category
                );
                summaries.push(summary);
            } catch (err) {
                console.log(`[CrawlHelpers] Failed to summarize ${page.url}: ${err}`);
            }
        }

        // Progress update
        const processed = Math.min(i + crawlBatchSize, toProcess.length);
        console.log(`[CrawlHelpers] Crawled+summarized ${processed}/${toProcess.length} pages (${summaries.length} successful)`);
        if (publisher) {
            await publisher.info(
                `Building KB from llms.txt: ${summaries.length}/${toProcess.length} pages summarized...`
            );
        }
    }

    // Write all summaries to DynamoDB KB
    if (summaries.length > 0) {
        await writePagesToKB(domain, summaries, 'doc-audit');
        console.log(`[CrawlHelpers] Wrote ${summaries.length} page summaries to KB for domain ${domain}`);
    }

    return summaries.length;
}
