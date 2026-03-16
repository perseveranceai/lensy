"use strict";
/**
 * Shared crawl helpers for parsing llms.txt and crawling documentation pages.
 * Used by check-ai-readiness tool to populate the Page Knowledge Base.
 *
 * Extracted from github-issues-analyzer/index.ts to avoid duplication.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLlmsTxt = parseLlmsTxt;
exports.crawlSinglePage = crawlSinglePage;
exports.filterRelevantEntries = filterRelevantEntries;
exports.crawlAndPopulateKB = crawlAndPopulateKB;
const page_summarizer_1 = require("./page-summarizer");
// ─── llms.txt Parser ─────────────────────────────────────────
/**
 * Parse an llms.txt file into structured entries.
 * Handles markdown links [Title](url), plain URLs, and relative paths.
 */
function parseLlmsTxt(content, baseUrl) {
    const entries = [];
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>'))
            continue;
        // Match markdown links: [Title](url) or [Title](url): description
        const linkMatch = trimmed.match(/^\-?\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*:?\s*(.*))?$/);
        if (linkMatch) {
            let url = linkMatch[2].trim();
            // Resolve relative URLs
            if (url.startsWith('/')) {
                url = `${baseUrl}${url}`;
            }
            else if (!url.startsWith('http')) {
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
async function crawlSinglePage(url) {
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
    }
    catch (e) {
        clearTimeout(timeoutId);
        console.log(`[CrawlHelpers] Failed to crawl ${url}: ${e.message}`);
        return { content: '', title: '' };
    }
}
// ─── Relevance Filter ─────────────────────────────────────────
/**
 * Filter llms.txt entries to those relevant to the target URL.
 * Relevance is determined by shared URL path prefix:
 *   - Same path depth-1 (siblings): /docs/sdk-react → all /docs/* entries
 *   - Also includes root/parent entries
 */
function filterRelevantEntries(entries, targetUrl) {
    try {
        const target = new URL(targetUrl);
        const targetPath = target.pathname.replace(/\/$/, ''); // e.g., /docs/sdk-react-library
        const targetSegments = targetPath.split('/').filter(Boolean); // ['docs', 'sdk-react-library']
        // Build prefix paths to match against (from most specific to broadest)
        // e.g., /docs/sdk-react-library → match /docs/* (parent section)
        const parentPath = targetSegments.length > 1
            ? '/' + targetSegments.slice(0, -1).join('/') // /docs
            : '/';
        return entries.filter(entry => {
            try {
                const entryUrl = new URL(entry.url);
                // Must be same host (or subdomain of same domain)
                if (entryUrl.hostname !== target.hostname)
                    return false;
                const entryPath = entryUrl.pathname.replace(/\/$/, '');
                // Include if: same parent path (siblings), or is an ancestor, or is the page itself
                return entryPath.startsWith(parentPath) || targetPath.startsWith(entryPath);
            }
            catch {
                return false;
            }
        });
    }
    catch {
        // If URL parsing fails, return all entries (fallback)
        return entries;
    }
}
// ─── Batch Crawl + Summarize + Write to KB ───────────────────
/**
 * Crawl relevant pages from llms.txt entries, summarize each with Haiku,
 * and write summaries to the DynamoDB Knowledge Base.
 *
 * Only crawls pages relevant to the target URL (URL path prefix match)
 * and skips pages already in KB (within TTL). Caps at maxPages per run.
 * KB grows incrementally across runs.
 *
 * @param entries - Parsed llms.txt entries (all from llms.txt)
 * @param sourceUrl - The target URL being analyzed (used for relevance + domain key)
 * @param maxPages - Maximum pages to crawl per run (default 50)
 * @param publisher - Optional progress publisher for WebSocket updates
 * @returns Number of pages successfully written to KB
 */
async function crawlAndPopulateKB(entries, sourceUrl, maxPages = 50, publisher) {
    const domain = (0, page_summarizer_1.deriveSafeDomain)(sourceUrl);
    // Step 1: Filter to pages relevant to the target URL
    const relevant = filterRelevantEntries(entries, sourceUrl);
    console.log(`[CrawlHelpers] ${relevant.length}/${entries.length} entries relevant to ${sourceUrl}`);
    // Step 2: Query existing KB to skip pages already indexed (within TTL)
    const existingKB = await (0, page_summarizer_1.queryKB)(domain);
    const existingUrls = new Set(existingKB.map(e => e.url));
    const needsCrawl = relevant.filter(entry => !existingUrls.has(entry.url));
    console.log(`[CrawlHelpers] ${needsCrawl.length} pages need crawling (${existingUrls.size} already in KB)`);
    if (needsCrawl.length === 0) {
        if (publisher) {
            await publisher.info(`KB up-to-date for this section (${existingKB.length} pages indexed)`);
        }
        return existingKB.length;
    }
    // Step 3: Cap at maxPages per run
    const toProcess = needsCrawl.slice(0, maxPages);
    const summaries = [];
    console.log(`[CrawlHelpers] Crawling ${toProcess.length} pages for domain ${domain}...`);
    // Crawl in batches of 10
    const crawlBatchSize = 10;
    for (let i = 0; i < toProcess.length; i += crawlBatchSize) {
        const batch = toProcess.slice(i, i + crawlBatchSize);
        const crawlResults = await Promise.all(batch.map(async (entry) => {
            const { content, title } = await crawlSinglePage(entry.url);
            return {
                url: entry.url,
                title: title || entry.title,
                content,
                category: entry.description
            };
        }));
        // Rate-limit between batches
        if (i + crawlBatchSize < toProcess.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        // Summarize pages that have content
        for (const page of crawlResults) {
            if (page.content.length < 100)
                continue; // Skip empty/error pages
            try {
                const summary = await (0, page_summarizer_1.summarizeAndParsePage)(page.url, page.title, page.content, page.category);
                summaries.push(summary);
            }
            catch (err) {
                console.log(`[CrawlHelpers] Failed to summarize ${page.url}: ${err}`);
            }
        }
        // Progress update
        const processed = Math.min(i + crawlBatchSize, toProcess.length);
        console.log(`[CrawlHelpers] Crawled+summarized ${processed}/${toProcess.length} pages (${summaries.length} successful)`);
        if (publisher) {
            await publisher.info(`Building KB from llms.txt: ${summaries.length}/${toProcess.length} pages summarized...`);
        }
    }
    // Write all summaries to DynamoDB KB
    if (summaries.length > 0) {
        await (0, page_summarizer_1.writePagesToKB)(domain, summaries, 'doc-audit');
        console.log(`[CrawlHelpers] Wrote ${summaries.length} page summaries to KB for domain ${domain}`);
    }
    return summaries.length;
}
