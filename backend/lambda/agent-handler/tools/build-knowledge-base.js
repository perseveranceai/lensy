"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildKnowledgeBaseTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const https = require("https");
const http = require("http");
const { invokeBedrockModel } = require("../shared/bedrock-helpers");
const { writeToS3, readFromS3 } = require("../shared/s3-helpers");
const { createProgressHelper } = require("./publish-progress");

/**
 * Tool: Build Knowledge Base
 * Crawls a documentation website (via llms.txt, llms-full.txt, or sitemap),
 * summarizes pages with Haiku, and caches in S3.
 * Replaces: github-issues-analyzer crawlDocsWebsite() (lines 1206-1382)
 */

const HAIKU_MODEL = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
const ANALYSIS_BUCKET = process.env.ANALYSIS_BUCKET || '';
const CIRCUIT_BREAKER_MS = 180000; // 3 minutes

exports.buildKnowledgeBaseTool = (0, tools_1.tool)(async (input) => {
    console.log(`[build_knowledge_base] Building KB from ${input.crawlUrl}`);
    const publisher = createProgressHelper(input.sessionId);
    const startTime = Date.now();

    // Normalize URL
    let baseUrl = input.crawlUrl.replace(/\/$/, '');
    if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
    const domain = baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    try {
        // Step 1: Try llms-full.txt (richest source)
        try {
            const fullContent = await httpGet(`${baseUrl}/llms-full.txt`);
            if (fullContent && fullContent.length > 500) {
                const sections = fullContent.split(/(?=^#\s)/m).filter(s => s.trim().length > 100);
                const docs = sections.map(section => {
                    const firstLine = section.split('\n')[0].replace(/^#+\s*/, '').trim();
                    return { path: `[website] ${firstLine || 'docs'}`, content: section.substring(0, 15000) };
                });

                if (docs.length > 0) {
                    console.log(`  Found llms-full.txt with ${docs.length} sections`);
                    await publisher.success(`Found llms-full.txt with ${docs.length} sections`, { contentType: 'llms-full.txt' });

                    return JSON.stringify({
                        success: true,
                        status: 'kb-ready',
                        domain,
                        pageCount: docs.length,
                        source: 'llms-full.txt',
                        cachedAt: new Date().toISOString()
                    });
                }
            }
        } catch { /* no llms-full.txt */ }

        // Step 2: Try llms.txt
        let entries = [];
        try {
            const llmsTxtContent = await httpGet(`${baseUrl}/llms.txt`);
            if (llmsTxtContent && llmsTxtContent.length > 50) {
                entries = parseLlmsTxt(llmsTxtContent, baseUrl);
                console.log(`  Found llms.txt with ${entries.length} entries`);
                await publisher.info(`Found llms.txt with ${entries.length} pages`, { contentType: 'llms.txt' });
            }
        } catch { console.log('  No llms.txt found'); }

        // Step 3: Fallback to sitemap.xml
        if (entries.length === 0) {
            await publisher.info('No llms.txt found, trying sitemap.xml...');
            try {
                const sitemapContent = await httpGet(`${baseUrl}/sitemap.xml`);
                const urlMatches = sitemapContent.match(/<loc>(.*?)<\/loc>/gi) || [];
                const allUrls = urlMatches.map(m => m.replace(/<\/?loc>/gi, '').trim());

                const docsPatterns = [/\/docs\//i, /\/documentation\//i, /\/guide/i, /\/tutorial/i, /\/api\//i, /\/reference/i];
                let docsUrls = allUrls.filter(u => docsPatterns.some(p => p.test(u)));
                if (docsUrls.length === 0) {
                    docsUrls = allUrls.filter(u =>
                        !u.match(/\.(jpg|png|gif|svg|css|js|pdf|zip|ico)$/i) &&
                        !u.includes('/tag/') && !u.includes('/category/')
                    );
                }

                entries = docsUrls.map(u => ({
                    title: u.replace(baseUrl, '').replace(/^\//, '') || 'home',
                    url: u
                }));
                console.log(`  Found ${entries.length} URLs from sitemap`);
            } catch {
                entries = [{ title: 'home', url: baseUrl }];
            }
        }

        // Step 4: Check S3 cache
        const cacheKey = `docs-cache/${domain}/pages.json`;
        let cachedPages = null;

        if (ANALYSIS_BUCKET) {
            try {
                const existing = await readFromS3(ANALYSIS_BUCKET, cacheKey);
                if (existing && existing.pages) {
                    console.log(`  Cache hit for ${domain}: ${existing.pageCount} pages`);
                    await publisher.cacheHit(`Cache hit! ${existing.pageCount} pages cached for ${domain}`);
                    cachedPages = existing.pages;
                }
            } catch { /* cache miss */ }
        }

        if (!cachedPages) {
            await publisher.cacheMiss(`No cache for ${domain} — crawling ${entries.length} pages...`);

            // Phase 1: Crawl pages in parallel batches of 10
            const crawledPages = [];
            const CRAWL_BATCH = 10;
            const totalCrawlBatches = Math.ceil(entries.length / CRAWL_BATCH);

            for (let i = 0; i < entries.length; i += CRAWL_BATCH) {
                const batchNum = Math.floor(i / CRAWL_BATCH) + 1;
                const batch = entries.slice(i, i + CRAWL_BATCH);
                await publisher.progress(`Crawling batch ${batchNum}/${totalCrawlBatches}...`, 'url-processing');

                const results = await Promise.allSettled(
                    batch.map(async (entry) => {
                        try {
                            const html = await httpGet(entry.url);
                            const text = stripHtml(html);
                            if (text.length > 100) {
                                return { title: entry.title, url: entry.url, rawContent: text.substring(0, 15000) };
                            }
                        } catch { /* skip */ }
                        return null;
                    })
                );

                for (const r of results) {
                    if (r.status === 'fulfilled' && r.value) crawledPages.push(r.value);
                }

                if (i + CRAWL_BATCH < entries.length) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }

            console.log(`  Crawled ${crawledPages.length}/${entries.length} pages`);

            // Circuit breaker check
            if (Date.now() - startTime > CIRCUIT_BREAKER_MS) {
                console.log('  Circuit breaker: using crawled pages without summaries');
                cachedPages = crawledPages.map(p => ({
                    title: p.title, url: p.url, summary: '', rawContent: p.rawContent
                }));
            } else {
                // Phase 2: Summarize with Haiku in batches of 5
                const summarizedPages = [];
                const SUMMARY_BATCH = 5;
                const totalSummaryBatches = Math.ceil(crawledPages.length / SUMMARY_BATCH);

                for (let i = 0; i < crawledPages.length; i += SUMMARY_BATCH) {
                    const batchNum = Math.floor(i / SUMMARY_BATCH) + 1;
                    const batch = crawledPages.slice(i, i + SUMMARY_BATCH);
                    await publisher.progress(`Summarizing batch ${batchNum}/${totalSummaryBatches}...`, 'structure-detection');

                    const results = await Promise.allSettled(
                        batch.map(async (page) => {
                            const summary = await summarizePage(page.title, page.rawContent);
                            return { ...page, summary };
                        })
                    );

                    for (const r of results) {
                        if (r.status === 'fulfilled') summarizedPages.push(r.value);
                    }

                    if (i + SUMMARY_BATCH < crawledPages.length) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }

                cachedPages = summarizedPages;
            }

            // Write to S3 cache
            if (ANALYSIS_BUCKET && cachedPages.length > 0) {
                const cacheData = {
                    domain,
                    createdAt: new Date().toISOString(),
                    pageCount: cachedPages.length,
                    pages: cachedPages
                };
                await writeToS3(ANALYSIS_BUCKET, cacheKey, cacheData);
                await publisher.success(`Cached ${cachedPages.length} pages for ${domain}`);
            }
        }

        const result = {
            success: true,
            status: 'kb-ready',
            domain,
            pageCount: cachedPages.length,
            source: 'crawl+summarize',
            cachedAt: new Date().toISOString()
        };

        console.log(`[build_knowledge_base] KB ready: ${cachedPages.length} pages for ${domain}`);
        return JSON.stringify(result);

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[build_knowledge_base] Error: ${msg}`);
        return JSON.stringify({ success: false, error: msg });
    }
}, {
    name: 'build_knowledge_base',
    description: 'Crawls a documentation website (tries llms-full.txt, llms.txt, sitemap.xml), summarizes pages with AI, and caches the knowledge base in S3. Call this before analyze_issues_against_docs when the user provides a docs website URL.',
    schema: zod_1.z.object({
        crawlUrl: zod_1.z.string().describe('The documentation website URL to crawl (e.g., "docs.anthropic.com")'),
        sessionId: zod_1.z.string().describe('The analysis session ID')
    })
});

// ─── Helper Functions ────────────────────────────────────────

function httpGet(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: 15000, headers: { 'User-Agent': 'Lensy/1.0', 'Accept': 'text/html,text/plain,application/xml' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpGet(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function stripHtml(html) {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseLlmsTxt(content, baseUrl) {
    const entries = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) continue;

        const linkMatch = trimmed.match(/^\-?\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*:?\s*(.*))?$/);
        if (linkMatch) {
            let url = linkMatch[2].trim();
            if (url.startsWith('/')) url = `${baseUrl}${url}`;
            else if (!url.startsWith('http')) url = `${baseUrl}/${url}`;
            entries.push({ title: linkMatch[1].trim(), url, description: linkMatch[3]?.trim() });
            continue;
        }

        const urlMatch = trimmed.match(/^(https?:\/\/[^\s]+)/);
        if (urlMatch) {
            entries.push({ title: urlMatch[1].replace(baseUrl, '').replace(/^\//, '') || 'Home', url: urlMatch[1] });
        }
    }
    return entries;
}

async function summarizePage(title, rawContent) {
    const truncated = rawContent.substring(0, 12000);
    const prompt = `Summarize this documentation page for a documentation quality auditor.

## Page Title: ${title}

## Page Content:
${truncated}

## Output Format (keep under 1500 characters):
TOPIC: What this page documents (1 sentence)
KEY TERMS: keywords, feature names, config keys (comma-separated)
COVERS:
- Specific topic 1
- Specific topic 2
CODE EXAMPLES: What examples exist (or "None")
LIMITATIONS: Caveats, known issues (or "None noted")`;

    try {
        return await invokeBedrockModel(prompt, {
            modelId: HAIKU_MODEL,
            maxTokens: 1000,
            temperature: 0.1
        });
    } catch (err) {
        console.error(`Summarization failed for "${title}":`, err);
        return `TOPIC: ${title}\nKEY TERMS: ${title}\nCOVERS:\n- Page content\nCODE EXAMPLES: Unknown\nLIMITATIONS: None noted`;
    }
}
