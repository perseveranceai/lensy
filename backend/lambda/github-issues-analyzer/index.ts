/**
 * GitHub Issues Analyzer Lambda
 *
 * Two modes:
 * 1. FETCH: Takes owner/repo, fetches open issues via GitHub API, classifies docs-related ones
 * 2. ANALYZE: Takes selected issues + fetches repo docs context, uses Bedrock to map issues to docs gaps
 */

import * as https from 'https';
import { URL } from 'url';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ProgressPublisher } from './progress-publisher';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ANALYSIS_BUCKET = process.env.ANALYSIS_BUCKET || '';
const PAGE_KB_TABLE = process.env.PAGE_KB_TABLE || '';
const CACHE_TTL_HOURS = 168; // 7 days — docs sites don't change hourly
const MAX_ISSUES_PER_SESSION = parseInt(process.env.MAX_ISSUES_PER_SESSION || '5');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// ─── S3 Key Helpers ─────────────────────────────────────────────────────────

function domainS3Key(domain: string, filename: string): string {
    // All domain artifacts live under: {domain}/{filename}
    // e.g. docs.example.com/llms-semi.json, docs.example.com/llms-cache.json
    const safeDomain = domain.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${safeDomain}/${filename}`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface GitHubIssue {
    number: number;
    title: string;
    body: string;
    html_url: string;
    labels: Array<{ name: string }>;
    created_at: string;
    comments: number;
    reactions?: { total_count: number };
    state: string;
    isDocsRelated?: boolean;
    docsConfidence?: number;      // 0–100 confidence score from LLM
    docsCategories?: string[];    // e.g. ["missing-docs", "unclear-api"]
}

interface RepoDoc {
    path: string;
    content: string;
    url?: string; // Full URL for website docs pages
}

interface DocsGapResult {
    number: number;
    title: string;
    html_url: string;
    docsGap: {
        gapType: 'missing-content' | 'inaccurate-content' | 'unclear-content' | 'outdated-content';
        confidence: number;
        affectedDocs: string[];
        affectedDocsReason: string;
        originalText: string;
        correctedText: string;
        section: string;
        lineContext: string;
        sourceReferences?: Array<{
            type: 'docs-page' | 'issue-body';
            url: string;
            excerpt: string;  // Brief quote proving the recommendation is grounded
        }>;
    };
}

// ─── Domain Docs Cache (S3) ──────────────────────────────────────────────────

interface CachedPage {
    title: string;
    url: string;
    category?: string;       // From llms.txt heading hierarchy (e.g. "Development / APIs")
    // Structured fields parsed from Haiku output (llms-semi.txt schema)
    topic?: string;          // Required: 1-sentence description
    keyTerms?: string[];     // Required: keywords for issue matching
    covers?: string[];       // Required: bulleted topic list
    codeExamples?: string;   // Optional: "None" if not applicable
    limitations?: string;    // Optional: "None noted" if not applicable
    // Raw storage
    summary: string;         // Full Haiku text output (kept for debugging)
    rawContent: string;
    summaryLength: number;
    rawLength: number;
    crawledAt: string;
}

interface DomainDocsCache {
    domain: string;
    createdAt: string;
    pageCount: number;
    pages: CachedPage[];
}

async function getDomainCache(domain: string): Promise<DomainDocsCache | null> {
    if (!ANALYSIS_BUCKET) return null;
    const key = domainS3Key(domain, 'llms-cache.json');
    try {
        const response = await s3Client.send(new GetObjectCommand({
            Bucket: ANALYSIS_BUCKET,
            Key: key
        }));
        const body = await response.Body?.transformToString();
        if (!body) return null;
        const cache: DomainDocsCache = JSON.parse(body);
        // Check TTL
        const cacheAge = Date.now() - new Date(cache.createdAt).getTime();
        const ttlMs = CACHE_TTL_HOURS * 60 * 60 * 1000;
        if (cacheAge > ttlMs) {
            console.log(`Cache expired for ${domain} (${Math.round(cacheAge / 3600000)}h old)`);
            return null;
        }
        console.log(`Cache hit for ${domain}: ${cache.pageCount} pages, ${Math.round(cacheAge / 3600000)}h old`);
        return cache;
    } catch (err: any) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
            console.log(`No cache found for ${domain}`);
            return null;
        }
        console.error(`Error reading cache for ${domain}:`, err);
        return null;
    }
}

async function putDomainCache(domain: string, cache: DomainDocsCache): Promise<void> {
    if (!ANALYSIS_BUCKET) return;
    const cacheKey = domainS3Key(domain, 'llms-cache.json');
    const semiKey = domainS3Key(domain, 'llms-semi.json');
    const cacheBody = JSON.stringify(cache);

    // Build the llms-semi.json — structured KB without rawContent (smaller, shareable)
    const semiPayload = {
        version: '1.0',
        domain,
        generatedAt: cache.createdAt,
        totalPages: cache.pageCount,
        pages: cache.pages.map(p => ({
            url: p.url,
            title: p.title,
            category: p.category,
            topic: p.topic,
            keyTerms: p.keyTerms,
            covers: p.covers,
            codeExamples: p.codeExamples,
            limitations: p.limitations,
            crawledAt: p.crawledAt
        }))
    };

    try {
        await Promise.all([
            s3Client.send(new PutObjectCommand({
                Bucket: ANALYSIS_BUCKET,
                Key: cacheKey,
                Body: cacheBody,
                ContentType: 'application/json'
            })),
            s3Client.send(new PutObjectCommand({
                Bucket: ANALYSIS_BUCKET,
                Key: semiKey,
                Body: JSON.stringify(semiPayload),
                ContentType: 'application/json'
            }))
        ]);
        console.log(`Stored llms-cache.json + llms-semi.json for ${domain} (${Math.round(cacheBody.length / 1024)}KB)`);
    } catch (err) {
        console.error(`Error writing cache for ${domain}:`, err);
    }
}

// ─── DynamoDB Page Knowledge Base ──────────────────────────────────────────────────

/**
 * Derive a safe domain key from a URL (e.g., "www.dotcms.com" → "dotcms-com").
 * Must stay in sync with page-summarizer.ts deriveSafeDomain().
 */
function deriveSafeDomainForKB(urlString: string): string {
    try {
        const urlObj = new URL(urlString);
        return urlObj.hostname
            .replace(/^www\./, '')
            .replace(/\./g, '-');
    } catch {
        return urlString.replace(/[^a-zA-Z0-9-]/g, '-');
    }
}

/**
 * Write summarized pages to DynamoDB Page Knowledge Base.
 * Runs alongside S3 writes (transitional — GH Issues analyzer will become fully agentic).
 */
async function writePagesToKB(domain: string, pages: CachedPage[]): Promise<void> {
    if (!PAGE_KB_TABLE || pages.length === 0) return;

    // Derive safe domain from first page URL, or from domain string
    const safeDomain = pages[0]?.url
        ? deriveSafeDomainForKB(pages[0].url)
        : domain.replace(/[^a-zA-Z0-9-]/g, '-');

    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400; // 7-day TTL
    const batchSize = 25;

    for (let i = 0; i < pages.length; i += batchSize) {
        const batch = pages.slice(i, i + batchSize);
        try {
            await docClient.send(new BatchWriteCommand({
                RequestItems: {
                    [PAGE_KB_TABLE]: batch.map(p => ({
                        PutRequest: {
                            Item: {
                                domain: safeDomain,
                                url: p.url,
                                title: p.title,
                                category: p.category,
                                topic: p.topic,
                                keyTerms: p.keyTerms,
                                covers: p.covers,
                                codeExamples: p.codeExamples,
                                limitations: p.limitations,
                                crawledAt: p.crawledAt,
                                source: 'github-issues',
                                expiresAt,
                            }
                        }
                    }))
                }
            }));
        } catch (err) {
            console.error(`[GH-Issues] Failed to batch write pages to KB (batch ${Math.floor(i / batchSize) + 1}):`, err);
        }
    }

    console.log(`[GH-Issues] Wrote ${pages.length} pages to DynamoDB KB for domain ${safeDomain}`);
}

// ─── Structured Summary Parser ──────────────────────────────────────────────────────

function parseSummaryFields(text: string, title: string): Pick<CachedPage, 'topic' | 'keyTerms' | 'covers' | 'codeExamples' | 'limitations'> {
    const topic = text.match(/^TOPIC:\s*(.+)$/m)?.[1]?.trim() || `Documentation page: ${title}`;
    const keyTermsRaw = text.match(/^KEY TERMS:\s*(.+)$/m)?.[1]?.trim() || title;
    const keyTerms = keyTermsRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
    const coversSection = text.match(/^COVERS:\n((?:[-*]\s*.+\n?)*)/m)?.[1] || '';
    const covers = coversSection
        .split('\n')
        .map((l: string) => l.replace(/^[-*]\s*/, '').trim())
        .filter((l: string) => l.length > 0);
    const codeExamples = text.match(/^CODE EXAMPLES:\s*(.+)$/m)?.[1]?.trim() || 'None';
    const limitations = text.match(/^LIMITATIONS:\s*(.+)$/m)?.[1]?.trim() || 'None noted';
    return { topic, keyTerms, covers: covers.length > 0 ? covers : [`Content about ${title}`], codeExamples, limitations };
}

// ─── HTTP Helper ─────────────────────────────────────────────────────────────

function makeRequest(url: string, headers: Record<string, string> = {}, method: string = 'GET', body?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        // Auto-inject GitHub auth token for all api.github.com requests
        const autoHeaders: Record<string, string> = {};
        if (GITHUB_TOKEN && parsedUrl.hostname === 'api.github.com' && !headers['Authorization']) {
            autoHeaders['Authorization'] = `token ${GITHUB_TOKEN}`;
        }

        const options: any = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method,
            headers: {
                'User-Agent': 'Lensy-GitHub-Analyzer/1.0',
                'Accept': 'application/vnd.github.v3+json',
                ...autoHeaders,
                ...headers
            }
        };

        if (body) {
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(body);
        }

        const req = https.request(options, (res) => {
            let data = '';
            // Follow redirects
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                makeRequest(res.headers.location, headers, method, body).then(resolve).catch(reject);
                return;
            }
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else if (res.statusCode === 403) {
                    const remaining = res.headers['x-ratelimit-remaining'];
                    if (remaining === '0') {
                        const resetTime = res.headers['x-ratelimit-reset'] as string | undefined;
                        const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000).toISOString() : 'unknown';
                        const limitType = GITHUB_TOKEN ? 'Authenticated limit is 5,000 requests/hour' : 'Unauthenticated limit is 60 requests/hour. Set GITHUB_TOKEN to increase to 5,000/hour';
                        reject(new Error(`RATE_LIMIT: GitHub API rate limit exceeded. Resets at ${resetDate}. ${limitType}.`));
                    } else {
                        reject(new Error(`HTTP 403: Access denied. ${data.substring(0, 300)}`));
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('Request timeout')); });
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

// ─── GitHub API Functions ────────────────────────────────────────────────────

// Fetch open issues CREATED in the last 2 weeks via GitHub Search API
// Uses created:> filter (not updated:>) so we only surface fresh, new issues
async function fetchRecentIssues(owner: string, repo: string): Promise<{ issues: GitHubIssue[]; totalFetched: number; dateRange: string }> {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const createdSince = twoWeeksAgo.toISOString().split('T')[0]; // YYYY-MM-DD
    const fromLabel = twoWeeksAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const toLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dateRange = `${fromLabel} – ${toLabel}`;

    // GitHub Search API: issues created in last 2 weeks, open, not PRs
    // Paginate up to 3 pages (300 max) in case of very active repos
    const allIssues: GitHubIssue[] = [];
    const MAX_PAGES = 3;

    for (let page = 1; page <= MAX_PAGES; page++) {
        const query = `repo:${owner}/${repo}+is:issue+is:open+created:>${createdSince}`;
        const url = `https://api.github.com/search/issues?q=${query}&sort=created&order=desc&per_page=100&page=${page}`;
        console.log(`Fetching issues page ${page} created since ${createdSince} in ${owner}/${repo}...`);

        const response = await makeRequest(url);
        const data: any = JSON.parse(response);
        const items: any[] = data.items || [];

        if (items.length === 0) break;

        allIssues.push(...items.map((issue: any) => ({
            number: issue.number,
            title: issue.title,
            body: issue.body || '',
            html_url: issue.html_url,
            labels: (issue.labels || []).map((l: any) => ({ name: l.name })),
            created_at: issue.created_at,
            comments: issue.comments || 0,
            reactions: issue.reactions,
            state: issue.state
        })));

        if (items.length < 100) break; // last page reached
    }

    console.log(`Fetched ${allIssues.length} open issues created in last 2 weeks (${dateRange})`);
    return { issues: allIssues, totalFetched: allIssues.length, dateRange };
}

async function fetchRepoFile(owner: string, repo: string, path: string): Promise<string | null> {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
        const response = await makeRequest(url);
        const data = JSON.parse(response);

        if (data.content && data.encoding === 'base64') {
            return Buffer.from(data.content, 'base64').toString('utf-8');
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchRepoDirectory(owner: string, repo: string, path: string): Promise<Array<{ path: string; type: string }>> {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
        const response = await makeRequest(url);
        const items = JSON.parse(response);
        if (Array.isArray(items)) {
            return items.map((item: any) => ({ path: item.path, type: item.type }));
        }
        return [];
    } catch {
        return [];
    }
}

// ─── Docs Context Fetcher ────────────────────────────────────────────────────

async function fetchDocsContext(owner: string, repo: string, docsUrl?: string): Promise<RepoDoc[]> {
    const docs: RepoDoc[] = [];

    console.log(`Fetching docs context for ${owner}/${repo}...`);

    // 0. Fetch user-provided docs GitHub repo (highest priority)
    // docsUrl is expected as "owner/repo" format (e.g., "drpasupuleti/vega-sample-docs-v1.0")
    if (docsUrl) {
        // Parse owner/repo — handle both "owner/repo" and "https://github.com/owner/repo"
        let docsOwner = '', docsRepo = '';
        if (docsUrl.includes('github.com')) {
            const parts = docsUrl.replace(/https?:\/\/(www\.)?github\.com\//, '').replace(/\/$/, '').split('/');
            docsOwner = parts[0] || '';
            docsRepo = parts[1]?.replace(/\.git$/, '') || '';
        } else if (docsUrl.includes('/')) {
            const parts = docsUrl.split('/');
            docsOwner = parts[0] || '';
            docsRepo = parts[1] || '';
        }

        if (docsOwner && docsRepo) {
            console.log(`  Fetching docs from GitHub repo: ${docsOwner}/${docsRepo}`);
            const repoDocs = await fetchDocsFromGitHubRepo(docsOwner, docsRepo);
            docs.push(...repoDocs);
        } else {
            console.log(`  ✗ Could not parse docsUrl as owner/repo: ${docsUrl}`);
        }
    }

    // 1. README
    const readme = await fetchRepoFile(owner, repo, 'README.md');
    if (readme) {
        docs.push({ path: 'README.md', content: readme.substring(0, 20000) });
        console.log(`  ✓ README.md (${readme.length} chars)`);
    }

    // 2. Common doc locations
    const searchPaths = ['SKILL.md', 'docs', 'skills', 'CONTRIBUTING.md', 'CHANGELOG.md'];

    for (const searchPath of searchPaths) {
        // Try as file first
        const fileContent = await fetchRepoFile(owner, repo, searchPath);
        if (fileContent) {
            docs.push({ path: searchPath, content: fileContent.substring(0, 20000) });
            console.log(`  ✓ ${searchPath} (${fileContent.length} chars)`);
            continue;
        }

        // Try as directory
        const dirItems = await fetchRepoDirectory(owner, repo, searchPath);
        if (dirItems.length > 0) {
            for (const item of dirItems) {
                if (item.type === 'file' && (item.path.endsWith('.md') || item.path.endsWith('.mdx'))) {
                    const content = await fetchRepoFile(owner, repo, item.path);
                    if (content) {
                        docs.push({ path: item.path, content: content.substring(0, 15000) });
                        console.log(`  ✓ ${item.path} (${content.length} chars)`);
                    }
                }
                // One level deeper for subdirectories
                if (item.type === 'dir') {
                    const subItems = await fetchRepoDirectory(owner, repo, item.path);
                    for (const subItem of subItems) {
                        if (subItem.type === 'file' && (subItem.path.endsWith('.md') || subItem.path.endsWith('.mdx'))) {
                            const content = await fetchRepoFile(owner, repo, subItem.path);
                            if (content) {
                                docs.push({ path: subItem.path, content: content.substring(0, 15000) });
                                console.log(`  ✓ ${subItem.path} (${content.length} chars)`);
                            }
                        }
                    }
                }
            }
        }

        // Rate limit protection
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 3. Try to fetch docs from external docs site (package.json homepage or README links)
    // Skip if user already provided a docsUrl
    if (docsUrl) {
        console.log('  Skipping package.json homepage lookup — user provided docsUrl');
    }
    try {
        const packageJson = !docsUrl ? await fetchRepoFile(owner, repo, 'package.json') : null;
        if (packageJson) {
            const pkg = JSON.parse(packageJson);
            const homepageUrl = pkg.homepage || '';
            if (homepageUrl && homepageUrl.includes('http')) {
                console.log(`  Found homepage: ${homepageUrl} — attempting to fetch docs site`);
                try {
                    const docsContent = await makeRequest(homepageUrl, { 'Accept': 'text/html' });
                    // Extract text content (basic HTML to text)
                    const textContent = docsContent
                        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (textContent.length > 100) {
                        docs.push({ path: `[docs-site] ${homepageUrl}`, content: textContent.substring(0, 20000) });
                        console.log(`  ✓ Docs site (${textContent.length} chars)`);
                    }
                } catch (fetchErr) {
                    console.log(`  ✗ Could not fetch docs site: ${fetchErr}`);
                }
            }
        }
    } catch {
        // package.json not found or not parseable, skip
    }

    console.log(`Total docs: ${docs.length} files, ${docs.reduce((s, d) => s + d.content.length, 0)} chars`);
    return docs;
}

// ─── LLM Classification (Haiku — batched, primary classifier) ───────────────
// Replaces keyword matching. Any issue — including bugs — may reveal a docs gap.

interface LLMClassification {
    score: number;        // 0–100 confidence
    categories: string[]; // e.g. ["missing-docs", "unclear-api"]
}

async function classifyWithLLM(issues: GitHubIssue[], progressPublisher?: ProgressPublisher): Promise<Map<number, LLMClassification>> {
    if (issues.length === 0) return new Map();

    const BATCH_SIZE = 50;
    const classifiedIssues = new Map<number, LLMClassification>();

    for (let i = 0; i < issues.length; i += BATCH_SIZE) {
        const batch = issues.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(issues.length / BATCH_SIZE);

        if (progressPublisher) {
            await progressPublisher.info(`Classifying issues ${i + 1}–${Math.min(i + BATCH_SIZE, issues.length)} of ${issues.length} with AI...`, { dimension: 'classification', processingTime: batchNum });
        }

        const issueList = batch.map(issue => ({
            number: issue.number,
            title: issue.title,
            labels: issue.labels.map(l => l.name),
            body: (issue.body || '').substring(0, 400) // truncate to keep token count reasonable
        }));

        const prompt = `You are analyzing GitHub issues to identify which ones reveal documentation problems or gaps.

An issue is docs-related if ANY of the following apply:
- It mentions missing, unclear, outdated, or incorrect documentation
- The described behavior doesn't match what's documented (even if labeled [bug])
- It's a usage question suggesting docs are insufficient or confusing
- It references broken links, missing examples, or unclear guides
- A developer is confused about how a feature/API works — a docs gap, not just a bug
- It explicitly requests docs improvements or additions

Do NOT exclude issues just because they are labeled bug, defect, or task — those can still have a documentation dimension.

For each docs-related issue, provide:
1. A confidence score (0–100) — how confident you are that this issue has a documentation dimension
2. One or more category tags from this list:
   - "missing-docs" — feature/API lacks documentation entirely
   - "unclear-docs" — docs exist but are confusing or ambiguous
   - "outdated-docs" — docs don't match current behavior
   - "broken-links" — dead links or missing references
   - "missing-examples" — needs code examples or tutorials
   - "api-confusion" — developer confused about API/SDK usage
   - "setup-guide" — installation/config docs gap
   - "error-handling" — unclear error messages or troubleshooting docs

Issues to classify:
${JSON.stringify(issueList, null, 2)}

Respond with ONLY valid JSON, no explanation:
{"docsRelated": [{"number": <issue_number>, "score": <0-100>, "categories": ["<tag1>", "<tag2>"]}]}`;

        try {
            const response = await bedrockClient.send(new InvokeModelCommand({
                modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
                body: JSON.stringify({
                    anthropic_version: 'bedrock-2023-05-31',
                    max_tokens: 2048,
                    messages: [{ role: 'user', content: prompt }]
                }),
                contentType: 'application/json',
                accept: 'application/json'
            }));

            const result = JSON.parse(new TextDecoder().decode(response.body));
            const text = result.content[0].text.trim();
            // Strip markdown code fences if Haiku wraps in ```json
            const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
            const parsed = JSON.parse(cleaned);
            (parsed.docsRelated || []).forEach((item: any) => {
                if (typeof item === 'number') {
                    // Backward compat: plain number array
                    classifiedIssues.set(item, { score: 75, categories: ['docs-related'] });
                } else if (item && typeof item.number === 'number') {
                    classifiedIssues.set(item.number, {
                        score: Math.min(100, Math.max(0, item.score || 75)),
                        categories: Array.isArray(item.categories) ? item.categories : ['docs-related']
                    });
                }
            });
            console.log(`LLM batch ${batchNum}/${totalBatches}: ${(parsed.docsRelated || []).length} docs-related from ${batch.length} issues`);
        } catch (err) {
            console.error(`LLM classification batch ${batchNum} failed, falling back to keyword:`, err);
            // Fallback: keyword classification for this batch
            batch.filter(classifyDocsRelatedFallback).forEach(issue => {
                classifiedIssues.set(issue.number, { score: 50, categories: ['docs-related'] });
            });
        }

        if (i + BATCH_SIZE < issues.length) {
            await new Promise(r => setTimeout(r, 200)); // brief pause between batches
        }
    }

    return classifiedIssues;
}

// ─── Keyword Classification (fallback only — used if LLM call fails) ─────────
// NOTE: No negative signals — a bug or defect issue can still have a docs gap.

function classifyDocsRelatedFallback(issue: GitHubIssue): boolean {
    const title = issue.title.toLowerCase();
    const body = (issue.body || '').toLowerCase();
    const combined = `${title} ${body}`;

    const strongSignals = [
        'documentation', 'docs ', 'docs.', 'readme', 'guide', 'tutorial',
        'not documented', 'undocumented', 'typo in doc', 'broken link',
        'api reference', 'developer guide', 'getting started',
        'changelog',
    ];

    const mediumSignals = [
        'unclear', 'confusing', 'misleading', 'incorrect example',
        'missing docs', 'missing documentation', 'missing example',
        'how to', 'how do i', 'where is the doc',
        'needs documentation', 'update documentation',
        'improve documentation', 'document this', 'not clear',
    ];

    // Docs label is always a strong signal
    const docsLabels = ['documentation', 'docs', 'doc', 'type: docs', 'area: docs', 'area: documentation'];
    if (issue.labels.some(l => docsLabels.includes(l.name.toLowerCase()))) return true;

    if (strongSignals.some(s => title.includes(s))) return true;
    if (strongSignals.some(s => body.includes(s))) return true;
    if (mediumSignals.some(s => combined.includes(s))) return true;

    return false;
}

// ─── LLM Analysis (Bedrock Claude) ──────────────────────────────────────────

async function analyzeIssueAgainstDocs(
    issue: GitHubIssue,
    docs: RepoDoc[]
): Promise<DocsGapResult> {
    const docsContext = docs.map(d => {
        const header = d.url || d.path;
        return `--- ${header} ---\n${d.content.substring(0, 8000)}`;
    }).join('\n\n');

    const prompt = `You are a documentation quality analyst. Analyze this GitHub issue to determine if it reveals a documentation gap, inaccuracy, or improvement opportunity.

## GitHub Issue #${issue.number}: ${issue.title}

${issue.body?.substring(0, 3000) || 'No description provided.'}

Labels: ${issue.labels.map(l => l.name).join(', ') || 'none'}

## Repository Documentation Context

${docsContext}

## Your Task

Analyze whether this GitHub issue reveals a documentation problem. You MUST provide the EXACT text that needs to change and the EXACT corrected replacement text — not summaries or descriptions.

Respond in this exact JSON format:

{
    "gapType": "missing-content" | "inaccurate-content" | "unclear-content" | "outdated-content",
    "confidence": 0-100,
    "affectedDocs": ["list of affected page URLs or file paths — use the EXACT URL or path from each --- header --- in the docs context above. Only include pages that actually contain text that needs changing."],
    "affectedDocsReason": "STRICTLY one sentence, max 20 words. State what is outdated and what it should be. NO background, NO elaboration. Example: 'Both pages reference Angular 17 which is upgrading to 20 with breaking component renames.'",
    "originalText": "Copy-paste the EXACT text from the PRIMARY affected page that is wrong or needs changing. This must be a verbatim quote from the docs context above, not a summary.",
    "correctedText": "The EXACT replacement text that should replace originalText. This is what the user will copy-paste into their docs.",
    "section": "The section heading or area where this text appears (e.g. 'Behavioral Guidelines', 'Installation', 'API Reference')",
    "lineContext": "Brief context about where in the document this text appears (e.g. 'Under the Email Client Limitations heading in SKILL.md')",
    "sourceReferences": [
        {
            "type": "docs-page" or "issue-body",
            "url": "URL of the docs page or GitHub issue that supports this recommendation",
            "excerpt": "Brief verbatim quote (under 50 words) from the source that proves this recommendation is grounded in real content"
        }
    ]
}

CRITICAL RULES:
- originalText MUST be a verbatim, COMPLETE quote from the docs context — the user needs it for find-and-replace. NEVER truncate or cut off mid-sentence.
- correctedText MUST be the complete replacement — the user will copy-paste it directly. NEVER truncate or cut off mid-sentence.
- Both originalText and correctedText must contain FULL, COMPLETE sentences/paragraphs — never cut them short.
- If the issue reveals MISSING content (not inaccurate), set originalText to the nearest relevant existing text and correctedText to an expanded version that includes the missing information
- Be precise: include enough surrounding text in originalText to make it uniquely findable in the document
- Include the FULL bullet point, paragraph, or section that needs changing — do not excerpt just a fragment
- affectedDocs MUST use the exact URL or file path from the "--- ... ---" header of each doc section. For website docs, this will be a full URL like "https://docs.example.com/docs/some-topic".
- affectedDocsReason MUST be exactly ONE short sentence under 20 words. State ONLY what is wrong and what it should be. Do NOT explain background or consequences. BAD: "The docs reference version 17 but the platform is upgrading to 20 with breaking changes including component renames so documentation needs updating." GOOD: "Both pages reference Angular 17 and PrimeNG 17, now upgrading to version 20."

GROUNDING & NO-HALLUCINATION RULES:
- NEVER invent features, capabilities, or functionality that are not explicitly described in either the docs context or the GitHub issue body.
- correctedText MUST only contain information that can be traced back to: (a) the existing docs context above, OR (b) the GitHub issue body above.
- If the issue describes a bug or missing feature, recommend documenting the CURRENT behavior or the gap — do NOT fabricate what the corrected behavior should be unless the issue explicitly states it.
- NEVER include URLs or links in correctedText that do not already exist in the docs context. If you need to reference a page, use ONLY URLs from the "--- ... ---" headers above.
- sourceReferences MUST include at least one entry proving the recommendation is grounded. Each entry must have a verbatim excerpt from either a docs page or the issue body.
- If you cannot ground a recommendation in the provided sources, lower the confidence score significantly and note this in affectedDocsReason.`;

    try {
        const command = new InvokeModelCommand({
            modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 4000,
                temperature: 0.3,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const text = responseBody.content?.[0]?.text || '';

        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            return {
                number: issue.number,
                title: issue.title,
                html_url: issue.html_url,
                docsGap: {
                    gapType: analysis.gapType || 'missing-content',
                    confidence: analysis.confidence || 50,
                    affectedDocs: analysis.affectedDocs || [],
                    affectedDocsReason: analysis.affectedDocsReason || '',
                    originalText: analysis.originalText || '',
                    correctedText: analysis.correctedText || '',
                    section: analysis.section || '',
                    lineContext: analysis.lineContext || '',
                    sourceReferences: Array.isArray(analysis.sourceReferences) ? analysis.sourceReferences : []
                }
            };
        }
    } catch (error) {
        console.error(`LLM analysis failed for issue #${issue.number}:`, error);
    }

    // Fallback
    return {
        number: issue.number,
        title: issue.title,
        html_url: issue.html_url,
        docsGap: {
            gapType: 'missing-content',
            confidence: 20,
            affectedDocs: [],
            affectedDocsReason: '',
            originalText: '',
            correctedText: '',
            section: '',
            lineContext: 'Could not complete LLM analysis. Manual review recommended.'
        }
    };
}

// ─── Docs Repo Discovery ─────────────────────────────────────────────────────

interface DiscoveredDocsRepo {
    name: string;
    fullName: string;
    description: string;
    hasDocsContent: boolean;       // true = repo has >=5 markdown docs files (real docs-as-code)
    contentFileCount: number;      // number of .md/.mdx files found in content directories
    codeFileCount: number;         // number of .ts/.tsx/.js/.jsx files in root (website code indicator)
    hasLlmsTxt: boolean;           // whether repo has llms.txt at root
}

async function discoverDocsRepos(owner: string, currentRepo: string): Promise<DiscoveredDocsRepo[]> {
    try {
        const url = `https://api.github.com/users/${owner}/repos?per_page=100&sort=updated`;
        const response = await makeRequest(url);
        const repos: any[] = JSON.parse(response);

        // Word-boundary matching to avoid false positives like "docker"
        // Match: docs, documentation, doc-site, api-docs, devsite, dev-portal, wiki, guide
        // Reject: docker, dockerfile, doc-pusher (not docs-related)
        const namePatterns = [
            /\bdocs\b/i,           // "docs", "my-docs", "api-docs"
            /\bdocumentation\b/i,  // "documentation"
            /\bdoc[-_]site\b/i,    // "doc-site", "doc_site"
            /dev[-_]?site\b/i,     // "devsite", "dev-site", "dev_site", "new-new-devsite"
            /dev[-_]?portal\b/i,   // "devportal", "dev-portal"
            /\bguide\b/i,          // "guide", "user-guide"
            /\bwiki\b/i,           // "wiki"
        ];
        const descPatterns = [
            /\bdocumentation\b/i,
            /\bdocs?\s+(site|portal|repo)/i,
            /\bdeveloper\s+(docs|portal|guide|site)\b/i,
            /\bdev\s+site\b/i,
            /\bapi\s+(docs|reference)\b/i,
        ];
        const topicPatterns = [
            /\bdocs\b/i,
            /\bdocumentation\b/i,
        ];

        const candidates = repos
            .filter(r => {
                if (r.name === currentRepo) return false;
                const name = r.name;
                const desc = r.description || '';
                const topics: string[] = r.topics || [];
                return namePatterns.some(re => re.test(name)) ||
                    descPatterns.some(re => re.test(desc)) ||
                    topics.some((t: string) => topicPatterns.some(re => re.test(t)));
            })
            .slice(0, 5);

        // Read README and check for docs content in each candidate
        const results: DiscoveredDocsRepo[] = [];
        for (const r of candidates) {
            let description = r.description || '';
            const repoOwner = r.owner?.login || owner;
            const repoName = r.name;

            try {
                // 1. Content Verification: Deep check for markdown files + code files
                const rootItems = await fetchRepoDirectory(repoOwner, repoName, '');
                const hasLlmsTxt = rootItems.some(i => i.type === 'file' && i.path.toLowerCase() === 'llms.txt');

                // Count code files in root (indicator of website/app code, not docs)
                const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];
                const codeFileCount = rootItems.filter(i =>
                    i.type === 'file' && codeExtensions.some(ext => i.path.toLowerCase().endsWith(ext))
                ).length;

                // Count markdown/content files
                let totalMdCount = 0;
                let hasDocsContent = false;

                if (hasLlmsTxt) {
                    // llms.txt presence is a strong signal — consider it docs
                    hasDocsContent = true;
                    totalMdCount = -1; // not counted, llms.txt overrides
                } else {
                    // Exclude boilerplate files (README, CONTRIBUTING, etc.) from docs content count
                    const boilerplateNames = ['readme.md', 'contributing.md', 'changelog.md', 'license.md', 'code_of_conduct.md', 'security.md'];
                    const rootMdFiles = rootItems.filter(i =>
                        i.type === 'file' &&
                        (i.path.toLowerCase().endsWith('.md') || i.path.toLowerCase().endsWith('.mdx')) &&
                        !boilerplateNames.includes(i.path.toLowerCase())
                    );
                    totalMdCount = rootMdFiles.length;

                    // Look for common content folders to check deeper
                    const contentFolders = rootItems.filter(i => i.type === 'dir' && ['docs', 'documentation', 'content', 'wiki'].includes(i.path.toLowerCase()));
                    for (const folder of contentFolders) {
                        const folderItems = await fetchRepoDirectory(repoOwner, repoName, folder.path);
                        const folderMdCount = folderItems.filter(i => i.type === 'file' && (i.path.toLowerCase().endsWith('.md') || i.path.toLowerCase().endsWith('.mdx'))).length;
                        totalMdCount += folderMdCount;
                    }

                    // Strict threshold: must have at least 5 non-boilerplate markdown files
                    hasDocsContent = totalMdCount >= 5;
                }

                if (!hasDocsContent) {
                    console.log(`  Candidate ${repoName}: hasDocsContent=false (mdCount=${totalMdCount}, codeFiles=${codeFileCount}) — included for human confirmation`);
                } else {
                    console.log(`  Candidate ${repoName}: hasDocsContent=true (mdCount=${totalMdCount}, codeFiles=${codeFileCount})`);
                }

                // 2. Fetch README for description
                const readme = await fetchRepoFile(repoOwner, repoName, 'README.md');
                if (readme) {
                    const lines = readme.split('\n')
                        .map((l: string) => l.replace(/^#+\s*/, '').trim())
                        .filter((l: string) => l.length > 20 && !l.startsWith('!') && !l.startsWith('[!') && !l.startsWith('<'));
                    if (lines.length > 0) {
                        description = lines[0].substring(0, 150);
                    }
                }

                results.push({
                    name: repoName,
                    fullName: r.full_name,
                    description,
                    hasDocsContent,
                    contentFileCount: totalMdCount,
                    codeFileCount,
                    hasLlmsTxt
                });
            } catch (err) {
                console.log(`  Error verifying content for candidate ${repoName}: ${err}`);
                continue;
            }
        }

        return results;
    } catch (err) {
        console.log(`  Could not discover docs repos for ${owner}: ${err}`);
        return [];
    }
}

async function fetchDocsFromGitHubRepo(docsOwner: string, docsRepo: string): Promise<RepoDoc[]> {
    const docs: RepoDoc[] = [];
    console.log(`  Fetching docs from GitHub repo: ${docsOwner}/${docsRepo}...`);

    // Fetch root-level MD/MDX files
    try {
        const rootItems = await fetchRepoDirectory(docsOwner, docsRepo, '');
        const mdFiles = rootItems.filter(item =>
            item.type === 'file' && (item.path.endsWith('.md') || item.path.endsWith('.mdx'))
        );

        for (const file of mdFiles.slice(0, 15)) { // Max 15 files
            const content = await fetchRepoFile(docsOwner, docsRepo, file.path);
            if (content && content.length > 50) {
                docs.push({ path: `${docsOwner}/${docsRepo}/${file.path}`, content: content.substring(0, 20000) });
                console.log(`    ✓ ${file.path} (${content.length} chars)`);
            }
            await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit
        }

        // Also check common subdirectories
        const subDirs = rootItems.filter(item =>
            item.type === 'dir' && ['docs', 'content', 'pages', 'src'].includes(item.path.toLowerCase())
        );

        for (const dir of subDirs) {
            try {
                const dirItems = await fetchRepoDirectory(docsOwner, docsRepo, dir.path);
                const subMdFiles = dirItems.filter(item =>
                    item.type === 'file' && (item.path.endsWith('.md') || item.path.endsWith('.mdx'))
                );
                for (const file of subMdFiles.slice(0, 10)) {
                    const content = await fetchRepoFile(docsOwner, docsRepo, file.path);
                    if (content && content.length > 50) {
                        docs.push({ path: `${docsOwner}/${docsRepo}/${file.path}`, content: content.substring(0, 15000) });
                        console.log(`    ✓ ${file.path} (${content.length} chars)`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            } catch { /* skip */ }
        }
    } catch (err) {
        console.log(`    ✗ Could not fetch docs from ${docsOwner}/${docsRepo}: ${err}`);
    }

    console.log(`  Total from docs repo: ${docs.length} files, ${docs.reduce((s, d) => s + d.content.length, 0)} chars`);
    return docs;
}

// ─── llms.txt Parser ─────────────────────────────────────────────────────────

interface LlmsTxtEntry {
    title: string;
    url: string;
    description?: string;
}

function parseLlmsTxt(content: string, baseUrl: string): LlmsTxtEntry[] {
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

// ─── LLM-based Doc Page Relevance Selector ──────────────────────────────────

async function selectRelevantDocsPages(
    entries: LlmsTxtEntry[],
    issues: Array<{ number: number; title: string; body: string }>
): Promise<LlmsTxtEntry[]> {
    // Build a compact list of available pages for the LLM
    const pageList = entries.map((e, i) => `${i}. ${e.title}${e.description ? ` — ${e.description}` : ''}`).join('\n');
    const issueList = issues.map(i => `- #${i.number}: ${i.title}\n  ${(i.body || '').substring(0, 200)}`).join('\n');

    const prompt = `You are a documentation expert. Given a list of documentation pages and a set of GitHub issues about documentation problems, select ALL documentation pages that are directly relevant to and affected by these issues.

Be precise — only include pages whose content would need to be reviewed or updated to address the issues. Do NOT pad the list. If only 2 pages are relevant, return 2. If 12 are relevant, return 12.

## Available Documentation Pages
${pageList}

## GitHub Issues (${issues.length} issue${issues.length > 1 ? 's' : ''})
${issueList}

## Task
Return ONLY a JSON array of page indices (numbers) for every page that is directly relevant to these issue(s). Only include pages whose content is actually related to or affected by the issues.

Example: [3, 7, 12]

Return ONLY the JSON array, nothing else.`;

    try {
        const command = new InvokeModelCommand({
            modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 500,
                temperature: 0.2,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const text = responseBody.content?.[0]?.text || '';

        // Parse JSON array from response
        const arrayMatch = text.match(/\[[\d,\s]+\]/);
        if (arrayMatch) {
            const indices: number[] = JSON.parse(arrayMatch[0]);
            const selected = indices
                .filter(i => i >= 0 && i < entries.length)
                .map(i => entries[i]);
            console.log(`  LLM selected ${selected.length} relevant pages: ${selected.map(s => s.title).join(', ')}`);
            return selected;
        }
    } catch (err) {
        console.log(`  LLM page selection failed: ${err}. Falling back to keyword matching.`);
    }

    // Fallback: keyword-based matching using issue titles
    const issueKeywords = issues
        .flatMap(i => `${i.title} ${(i.body || '').substring(0, 500)}`.toLowerCase().split(/\W+/))
        .filter(w => w.length > 3);
    const keywordSet = new Set(issueKeywords);

    const scored = entries.map(entry => {
        const entryText = `${entry.title} ${entry.description || ''}`.toLowerCase();
        const matchCount = [...keywordSet].filter(kw => entryText.includes(kw)).length;
        return { entry, matchCount };
    });

    scored.sort((a, b) => b.matchCount - a.matchCount);
    return scored.slice(0, 15).filter(s => s.matchCount > 0).map(s => s.entry);
}

// ─── Single Page Crawl ───────────────────────────────────────────────────────

async function crawlSinglePage(url: string): Promise<string> {
    const html = await makeRequest(url, { 'Accept': 'text/html' });
    // Strip scripts, styles, nav, footer, header — keep main content
    const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return textContent;
}

// ─── Haiku Page Summarizer ───────────────────────────────────────────────────

async function summarizePage(title: string, rawContent: string): Promise<string> {
    const truncated = rawContent.substring(0, 12000); // Haiku context is plenty for this
    const prompt = `Summarize this documentation page for a documentation quality auditor. The summary will be used to match this page against GitHub issues reporting documentation problems.

## Page Title: ${title}

## Page Content:
${truncated}

## Output Format (keep under 1500 characters total):

TOPIC: What this page documents (1 sentence)
KEY TERMS: keywords, feature names, config keys, API endpoints (comma-separated)
COVERS:
- Specific topic 1
- Specific topic 2
- Specific topic 3
CODE EXAMPLES: What examples exist (or "None")
LIMITATIONS: Caveats, known issues mentioned (or "None noted")`;

    try {
        const command = new InvokeModelCommand({
            modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 1000,
                temperature: 0.1,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        return responseBody.content?.[0]?.text || `TOPIC: ${title}\nKEY TERMS: ${title}\nCOVERS:\n- Page content\nCODE EXAMPLES: Unknown\nLIMITATIONS: None noted`;
    } catch (err) {
        console.error(`Summarization failed for "${title}":`, err);
        return `TOPIC: ${title}\nKEY TERMS: ${title}\nCOVERS:\n- Page content (summarization failed)\nCODE EXAMPLES: Unknown\nLIMITATIONS: None noted`;
    }
}

// ─── Batch Crawl All Pages ───────────────────────────────────────────────────

interface CrawledPage {
    title: string;
    url: string;
    rawContent: string;
}

async function crawlAllPages(
    entries: LlmsTxtEntry[],
    publisher?: ProgressPublisher
): Promise<CrawledPage[]> {
    const BATCH_SIZE = 10;
    const results: CrawledPage[] = [];
    const totalBatches = Math.ceil(entries.length / BATCH_SIZE);

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const batch = entries.slice(i, i + BATCH_SIZE);

        await publisher?.progress(
            `Crawling batch ${batchNum}/${totalBatches} (${batch.length} pages)...`,
            'url-processing',
            { processingTime: batchNum }
        );

        const batchResults = await Promise.allSettled(
            batch.map(async (entry) => {
                try {
                    const rawContent = await crawlSinglePage(entry.url);
                    if (rawContent.length > 100) {
                        return {
                            title: entry.title,
                            url: entry.url,
                            rawContent: rawContent.substring(0, 15000) // Truncate to 15K
                        };
                    }
                    return null;
                } catch (err) {
                    console.log(`  ✗ Failed to crawl ${entry.url}: ${err}`);
                    return null;
                }
            })
        );

        for (const result of batchResults) {
            if (result.status === 'fulfilled' && result.value) {
                results.push(result.value);
            }
        }

        console.log(`  Crawl batch ${batchNum}/${totalBatches}: ${results.length} pages total`);

        // Rate limit between batches
        if (i + BATCH_SIZE < entries.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    return results;
}

// ─── Batch Summarize All Pages ───────────────────────────────────────────────

async function summarizeAllPages(
    crawledPages: CrawledPage[],
    publisher?: ProgressPublisher
): Promise<CachedPage[]> {
    const BATCH_SIZE = 5; // Bedrock throttle safety
    const results: CachedPage[] = [];
    const totalBatches = Math.ceil(crawledPages.length / BATCH_SIZE);

    for (let i = 0; i < crawledPages.length; i += BATCH_SIZE) {
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const batch = crawledPages.slice(i, i + BATCH_SIZE);

        await publisher?.progress(
            `Summarizing batch ${batchNum}/${totalBatches} (${batch.length} pages)...`,
            'structure-detection',
            { processingTime: batchNum }
        );

        const batchResults = await Promise.allSettled(
            batch.map(async (page) => {
                const summary = await summarizePage(page.title, page.rawContent);
                const structured = parseSummaryFields(summary, page.title);
                return {
                    title: page.title,
                    url: page.url,
                    summary,
                    ...structured,  // topic, keyTerms, covers, codeExamples, limitations
                    rawContent: page.rawContent,
                    summaryLength: summary.length,
                    rawLength: page.rawContent.length,
                    crawledAt: new Date().toISOString()
                };
            })
        );

        for (const result of batchResults) {
            if (result.status === 'fulfilled') {
                results.push(result.value);
            }
        }

        console.log(`  Summarize batch ${batchNum}/${totalBatches}: ${results.length} pages total`);

        // Rate limit between batches (Bedrock throttle safety)
        if (i + BATCH_SIZE < crawledPages.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    return results;
}

// ─── Website Docs Crawler (llms.txt + S3 cache + Haiku summaries) ────────────

async function crawlDocsWebsite(
    siteUrl: string,
    issues?: Array<{ number: number; title: string; body: string }>,
    publisher?: ProgressPublisher
): Promise<RepoDoc[]> {
    const docs: RepoDoc[] = [];
    console.log(`  Crawling docs website: ${siteUrl}`);

    // Normalize URL — user provides domain (e.g., "docs.example.com")
    let baseUrl = siteUrl.replace(/\/$/, '');
    if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;

    // Extract domain for cache key
    const domain = baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    // Circuit breaker: 180s max for crawl+summarize
    const startTime = Date.now();
    const CIRCUIT_BREAKER_MS = 180000;

    // ─── Step 1: Try llms-full.txt first (richest, single-file source) ───
    try {
        const fullUrl = `${baseUrl}/llms-full.txt`;
        console.log(`  Trying llms-full.txt: ${fullUrl}`);
        const fullContent = await makeRequest(fullUrl, { 'Accept': 'text/plain' });
        if (fullContent && fullContent.length > 500) {
            const sections = fullContent.split(/(?=^#\s)/m).filter(s => s.trim().length > 100);
            for (const section of sections) {
                const firstLine = section.split('\n')[0].replace(/^#+\s*/, '').trim();
                docs.push({
                    path: `[website] ${firstLine || 'docs'}`,
                    content: section.substring(0, 15000)
                });
            }
            if (docs.length > 0) {
                console.log(`  ✓ Found llms-full.txt — loaded ${docs.length} inline doc sections (${docs.reduce((s, d) => s + d.content.length, 0)} chars)`);
                await publisher?.success(`Found llms-full.txt with ${docs.length} sections — using directly`, { contentType: 'llms-full.txt' });
                return docs;
            }
        }
    } catch { /* no llms-full.txt, that's fine */ }

    // ─── Step 2: Try llms.txt → cache → crawl+summarize ───
    let llmsTxtEntries: LlmsTxtEntry[] = [];

    try {
        const llmsTxtUrl = `${baseUrl}/llms.txt`;
        console.log(`  Trying llms.txt: ${llmsTxtUrl}`);
        const llmsTxtContent = await makeRequest(llmsTxtUrl, { 'Accept': 'text/plain' });

        if (llmsTxtContent && llmsTxtContent.length > 50) {
            llmsTxtEntries = parseLlmsTxt(llmsTxtContent, baseUrl);
            console.log(`  ✓ Found llms.txt with ${llmsTxtEntries.length} entries`);
            await publisher?.info(`Found llms.txt with ${llmsTxtEntries.length} documentation pages`, { contentType: 'llms.txt', contextPages: llmsTxtEntries.length });
        }
    } catch (err) {
        console.log(`  No llms.txt found: ${err}`);
    }

    if (llmsTxtEntries.length === 0) {
        // Fallback: try sitemap.xml
        await publisher?.info('No llms.txt found, falling back to sitemap.xml...');
        try {
            const sitemapUrl = `${baseUrl}/sitemap.xml`;
            console.log(`  Falling back to sitemap: ${sitemapUrl}`);
            const sitemapContent = await makeRequest(sitemapUrl, { 'Accept': 'text/xml,application/xml' });

            const urlMatches = sitemapContent.match(/<loc>(.*?)<\/loc>/gi) || [];
            const allUrls = urlMatches.map(m => m.replace(/<\/?loc>/gi, '').trim());

            const docsPatterns = [/\/docs\//i, /\/documentation\//i, /\/guide/i, /\/tutorial/i, /\/api\//i, /\/reference/i, /\/getting-started/i, /\/quickstart/i];
            let docsUrls = allUrls.filter(u => docsPatterns.some(p => p.test(u)));
            if (docsUrls.length === 0) {
                docsUrls = allUrls.filter(u =>
                    !u.match(/\.(jpg|png|gif|svg|css|js|pdf|zip|ico)$/i) &&
                    !u.includes('/tag/') && !u.includes('/category/')
                );
            }

            llmsTxtEntries = docsUrls.map(u => ({
                title: u.replace(baseUrl, '').replace(/^\//, '') || 'home',
                url: u
            }));
            console.log(`  Found ${llmsTxtEntries.length} URLs from sitemap`);
        } catch {
            console.log(`  No sitemap found, will crawl base URL directly`);
            llmsTxtEntries = [{ title: 'home', url: baseUrl }];
        }
    }

    // ─── Step 3: Check S3 cache ───
    let cachedPages: CachedPage[] | null = null;

    const existingCache = await getDomainCache(domain);
    if (existingCache) {
        await publisher?.cacheHit(`Cache hit! ${existingCache.pageCount} pages cached for ${domain}`, { cacheStatus: 'hit', contextPages: existingCache.pageCount });
        cachedPages = existingCache.pages;
    } else {
        // Cache miss — crawl all pages and generate summaries
        await publisher?.cacheMiss(`No cache for ${domain} — crawling and summarizing ${llmsTxtEntries.length} pages...`, { cacheStatus: 'miss', contextPages: llmsTxtEntries.length });

        // Phase 1: Crawl all pages in parallel batches of 10
        console.log(`  Phase 1: Crawling ${llmsTxtEntries.length} pages...`);
        const crawledPages = await crawlAllPages(llmsTxtEntries, publisher);
        console.log(`  Crawled ${crawledPages.length}/${llmsTxtEntries.length} pages`);

        // Circuit breaker check
        const elapsedMs = Date.now() - startTime;
        if (elapsedMs > CIRCUIT_BREAKER_MS) {
            console.log(`  ⚠ Circuit breaker: ${Math.round(elapsedMs / 1000)}s elapsed, using crawled pages without summaries`);
            await publisher?.info(`Circuit breaker at ${Math.round(elapsedMs / 1000)}s — using ${crawledPages.length} crawled pages without summaries`);
            // Return raw content directly
            return crawledPages.map(p => ({
                path: p.url,
                content: p.rawContent,
                url: p.url
            }));
        }

        // Phase 2: Summarize all crawled pages in batches of 5
        console.log(`  Phase 2: Summarizing ${crawledPages.length} pages with Haiku...`);
        const summarizedPages = await summarizeAllPages(crawledPages, publisher);
        console.log(`  Summarized ${summarizedPages.length} pages`);

        // Store in S3 cache
        const newCache: DomainDocsCache = {
            domain,
            createdAt: new Date().toISOString(),
            pageCount: summarizedPages.length,
            pages: summarizedPages
        };
        await putDomainCache(domain, newCache);

        // Also write to DynamoDB Page Knowledge Base (shared with Doc Audit mode)
        try {
            await writePagesToKB(domain, summarizedPages);
        } catch (err) {
            console.error(`[GH-Issues] DynamoDB KB write failed (non-fatal):`, err);
        }

        await publisher?.success(`Cached ${summarizedPages.length} pages for ${domain}`, { cacheStatus: 'miss', contextPages: summarizedPages.length });

        cachedPages = summarizedPages;
    }

    // ─── Step 4: Haiku selects relevant pages using title + summary ───
    if (issues && issues.length > 0 && cachedPages.length > 10) {
        await publisher?.progress('Selecting relevant pages for issue analysis...', 'structure-detection');

        // Build entries with keyTerms for Haiku selection (structured, not raw text)
        const entriesWithSummaries: LlmsTxtEntry[] = cachedPages.map(p => ({
            title: p.title,
            url: p.url,
            // Use structured fields if available, fall back to summary snippet
            description: p.keyTerms && p.keyTerms.length > 0
                ? `${p.topic || p.title} | ${p.keyTerms.join(', ')}`
                : p.summary.substring(0, 300)
        }));

        const selectedEntries = await selectRelevantDocsPages(entriesWithSummaries, issues);
        const selectedUrls = new Set(selectedEntries.map(e => e.url));

        // Return raw content of selected pages (Sonnet needs detail, not summaries)
        const selectedPages = cachedPages.filter(p => selectedUrls.has(p.url));

        if (selectedPages.length > 0) {
            console.log(`  Haiku selected ${selectedPages.length} relevant pages from ${cachedPages.length} cached`);
            await publisher?.success(`Selected ${selectedPages.length} relevant pages for analysis`, { selectedPages: selectedPages.length });

            return selectedPages.map(p => ({
                path: p.url,
                content: p.rawContent, // Use raw content for Sonnet gap analysis
                url: p.url
            }));
        }
        // Haiku returned 0 pages — fall through to return all pages below
        console.log('  Haiku selected 0 pages, falling back to returning all cached pages');
    }

    // If few pages or no issues, return all (with raw content)
    return cachedPages.map(p => ({
        path: p.url,
        content: p.rawContent,
        url: p.url
    }));
}

// ─── Lambda Handler ──────────────────────────────────────────────────────────

export const handler = async (event: any): Promise<any> => {
    console.log('GitHub Issues Analyzer invoked:', JSON.stringify(event, null, 2));

    const { mode, owner, repo, maxIssues, issues, docsUrl, crawlUrl, filePath, originalText, correctedText, issueNumber, issueTitle, gapType, confidence, sessionId } = typeof event.body === 'string'
        ? JSON.parse(event.body)
        : event;

    // Initialize progress publisher for WebSocket updates
    const publisher = sessionId ? new ProgressPublisher(sessionId) : undefined;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
        'Content-Type': 'application/json'
    };

    try {
        if (mode === 'fetch' || (!mode && !issues)) {
            // MODE 1: Fetch open issues from last 2 weeks and classify with LLM
            if (!owner || !repo) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'owner and repo are required' }) };
            }

            const { issues: allIssues, totalFetched, dateRange } = await fetchRecentIssues(owner, repo);

            // LLM classification (Haiku) — primary classifier, returns scores + categories
            let llmResults: Map<number, LLMClassification>;
            let classificationMethod: 'llm' | 'keyword' = 'llm';
            try {
                llmResults = await classifyWithLLM(allIssues, publisher);
            } catch (err) {
                console.error('LLM classification failed entirely, falling back to keyword:', err);
                classificationMethod = 'keyword';
                llmResults = new Map();
                allIssues.filter(classifyDocsRelatedFallback).forEach(i => {
                    llmResults.set(i.number, { score: 50, categories: ['docs-related'] });
                });
            }

            const classifiedIssues = allIssues.map(issue => {
                const classification = llmResults.get(issue.number);
                return {
                    ...issue,
                    isDocsRelated: !!classification,
                    docsConfidence: classification?.score ?? 0,
                    docsCategories: classification?.categories ?? []
                };
            });

            const docsRelatedCount = classifiedIssues.filter(i => i.isDocsRelated).length;
            console.log(`Classification complete (${classificationMethod}): ${docsRelatedCount}/${classifiedIssues.length} docs-related`);

            // Quick docs context check — see if repo has meaningful docs
            let docsFound: string[] = [];
            try {
                const readme = await fetchRepoFile(owner, repo, 'README.md');
                if (readme && readme.length > 500) docsFound.push('README.md');
            } catch { }
            try {
                const docsDir = await fetchRepoDirectory(owner, repo, 'docs');
                if (docsDir.length > 0) docsFound.push('docs/');
            } catch { }

            const hasSubstantialDocs = docsFound.length > 0 && docsFound.some(d => d !== 'README.md' || docsFound.length > 1);

            // Auto-discover docs repos under the same GitHub owner
            let suggestedDocsRepos: DiscoveredDocsRepo[] = [];
            if (!docsUrl) {
                console.log(`  Auto-discovering docs repos for ${owner}...`);
                suggestedDocsRepos = await discoverDocsRepos(owner, repo);
                if (suggestedDocsRepos.length > 0) {
                    console.log(`  Found ${suggestedDocsRepos.length} potential docs repos: ${suggestedDocsRepos.map(r => r.fullName).join(', ')}`);
                }
            }

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    issues: classifiedIssues,
                    totalIssues: classifiedIssues.length,
                    totalFetched,
                    dateRange,
                    classificationMethod,
                    docsRelatedCount,
                    repo: `${owner}/${repo}`,
                    docsContext: {
                        filesFound: docsFound,
                        hasSubstantialDocs,
                        hint: hasSubstantialDocs ? null : 'Limited documentation found in this repository.',
                        suggestedDocsRepos
                    }
                })
            };
        }

        if (mode === 'build-kb') {
            // MODE: Build Knowledge Base only — crawl + summarize + cache, no issue analysis
            if (!crawlUrl) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'crawlUrl is required for build-kb mode' }) };
            }

            await publisher?.info(`Building knowledge base from ${crawlUrl}...`);

            // crawlDocsWebsite with empty issues → runs full cache build (Steps 1-3), skips Haiku page selection (Step 4)
            const allPages = await crawlDocsWebsite(crawlUrl, [], publisher);

            const domain = crawlUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
            const kbResult = {
                status: 'kb-ready' as const,
                domain,
                pageCount: allPages.length,
                cachedAt: new Date().toISOString()
            };

            // Store result for polling
            if (sessionId && ANALYSIS_BUCKET) {
                await s3Client.send(new PutObjectCommand({
                    Bucket: ANALYSIS_BUCKET,
                    Key: `github-issues-results/${sessionId}.json`,
                    Body: JSON.stringify(kbResult),
                    ContentType: 'application/json'
                }));
                console.log(`KB result saved to S3: github-issues-results/${sessionId}.json`);
            }

            await publisher?.success(`Knowledge base ready! ${allPages.length} pages from ${domain}`, {
                contextPages: allPages.length
            });

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify(kbResult)
            };
        }

        if (mode === 'analyze' || issues) {
            // MODE 2: Deep analysis of selected issues against docs
            if (!owner || !repo || !issues || issues.length === 0) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'owner, repo, and issues array are required' }) };
            }

            // Cost guard: cap issues per session
            let issuesTruncated = false;
            let issuesToProcess = issues;
            if (issues.length > MAX_ISSUES_PER_SESSION) {
                console.log(`Truncating ${issues.length} issues to ${MAX_ISSUES_PER_SESSION} (MAX_ISSUES_PER_SESSION)`);
                issuesToProcess = issues.slice(0, MAX_ISSUES_PER_SESSION);
                issuesTruncated = true;
            }

            // Determine docs source: GitHub repo, website crawl, or repo-only
            let docs: RepoDoc[] = [];
            let docsSource: 'github' | 'website' | 'repo-only' = 'repo-only';

            if (crawlUrl) {
                // User chose to crawl their public docs website
                console.log(`Using website crawl for docs context: ${crawlUrl}`);
                await publisher?.info(`Starting docs analysis with website crawl: ${crawlUrl}`);
                const websiteDocs = await crawlDocsWebsite(crawlUrl, issues, publisher);
                docs.push(...websiteDocs);
                // Also fetch repo README for additional context
                const readme = await fetchRepoFile(owner, repo, 'README.md');
                if (readme) docs.push({ path: 'README.md', content: readme.substring(0, 20000) });
                docsSource = 'website';
            } else if (docsUrl) {
                // User confirmed a docs GitHub repo
                docs = await fetchDocsContext(owner, repo, docsUrl);

                // Check if the docs repo actually had docs content
                const docsRepoFiles = docs.filter(d => d.path.includes('/'));
                if (docsRepoFiles.length === 0) {
                    // Docs repo had no markdown — likely not docs-as-code
                    return {
                        statusCode: 200,
                        headers: corsHeaders,
                        body: JSON.stringify({
                            noDocsAsCode: true,
                            docsUrl,
                            message: `No documentation files found in ${docsUrl}. It looks like your docs aren't stored as code — they may be hosted in a CMS or rendered at runtime. Would you like to provide your public docs site URL so we can crawl it instead?`,
                            repo: `${owner}/${repo}`
                        })
                    };
                }
                docsSource = 'github';
            } else {
                docs = await fetchDocsContext(owner, repo);
                docsSource = 'repo-only';
            }

            // Analyze each issue against docs
            await publisher?.progress(`Analyzing ${issuesToProcess.length} issues against ${docs.length} docs pages...`, 'dimension-analysis');
            const analyses: DocsGapResult[] = [];
            for (let idx = 0; idx < issuesToProcess.length; idx++) {
                const issue = issuesToProcess[idx];
                console.log(`Analyzing issue #${issue.number}: ${issue.title}...`);
                await publisher?.progress(
                    `Analyzing issue ${idx + 1}/${issuesToProcess.length}: #${issue.number} ${issue.title.substring(0, 60)}`,
                    'dimension-analysis',
                    { dimension: `issue-${issue.number}` }
                );
                const result = await analyzeIssueAgainstDocs(issue, docs);
                analyses.push(result);

                // Small delay between LLM calls
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Sort by confidence (highest first)
            analyses.sort((a, b) => (b.docsGap?.confidence || 0) - (a.docsGap?.confidence || 0));

            const responsePayload = {
                analyses,
                docsContextFiles: docs.map(d => d.path),
                docsSource,
                repo: `${owner}/${repo}`,
                totalAnalyzed: analyses.length,
                ...(issuesTruncated && {
                    warning: `Only the first ${MAX_ISSUES_PER_SESSION} issues were analyzed to control costs. Deselect some issues to analyze others.`
                })
            };

            // If async (has sessionId), write results to S3 for polling
            if (sessionId && ANALYSIS_BUCKET) {
                await publisher?.progress('Saving results...', 'report-generation');
                try {
                    await s3Client.send(new PutObjectCommand({
                        Bucket: ANALYSIS_BUCKET,
                        Key: `github-issues-results/${sessionId}.json`,
                        Body: JSON.stringify(responsePayload),
                        ContentType: 'application/json'
                    }));
                    console.log(`Results saved to S3: github-issues-results/${sessionId}.json`);
                } catch (s3Err) {
                    console.error('Failed to save results to S3:', s3Err);
                }
                await publisher?.success(`Analysis complete! ${analyses.length} issues analyzed.`, { processingTime: Date.now() });
            }

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify(responsePayload)
            };
        }

        if (mode === 'create-pr') {
            // MODE 3: Create a real GitHub PR with the docs fix
            const githubToken = process.env.GITHUB_TOKEN;
            if (!githubToken) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'github_token_required', message: 'GitHub token not configured. Contact admin to set up GITHUB_TOKEN.' }) };
            }

            if (!owner || !repo || !filePath || !correctedText || !issueNumber) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'owner, repo, filePath, correctedText, and issueNumber are required' }) };
            }

            const authHeaders = { 'Authorization': `token ${githubToken}` };

            console.log(`Creating PR for issue #${issueNumber} in ${owner}/${repo}...`);

            // Step 1: Get default branch
            const repoData = JSON.parse(await makeRequest(`https://api.github.com/repos/${owner}/${repo}`, authHeaders));
            const defaultBranch = repoData.default_branch || 'main';
            console.log(`  Default branch: ${defaultBranch}`);

            // Step 2: Get latest commit SHA on default branch
            const refData = JSON.parse(await makeRequest(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, authHeaders));
            const baseSha = refData.object.sha;
            console.log(`  Base SHA: ${baseSha}`);

            // Step 3: Create a new branch
            const branchName = `lensy/fix-docs-${issueNumber}-${Date.now()}`;
            await makeRequest(
                `https://api.github.com/repos/${owner}/${repo}/git/refs`,
                authHeaders,
                'POST',
                JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha })
            );
            console.log(`  Created branch: ${branchName}`);

            // Step 4: Get current file content + SHA
            const cleanPath = filePath.replace(/^\//, '').replace(/^\[docs-site\]\s+.*$/, '');
            let fileContent = '';
            let fileSha = '';

            try {
                const fileData = JSON.parse(await makeRequest(
                    `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}?ref=${defaultBranch}`,
                    authHeaders
                ));
                fileContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
                fileSha = fileData.sha;
                console.log(`  Got file: ${cleanPath} (${fileContent.length} chars, sha: ${fileSha})`);
            } catch (fileErr) {
                // File doesn't exist — create it with the corrected text
                console.log(`  File not found, will create: ${cleanPath}`);
                fileContent = '';
                fileSha = '';
            }

            // Step 5: Apply find-and-replace if we have originalText, otherwise use correctedText as full content
            let updatedContent: string;
            if (originalText && fileContent && fileContent.includes(originalText)) {
                updatedContent = fileContent.replace(originalText, correctedText);
                console.log(`  Applied find-and-replace`);
            } else if (fileContent) {
                // Append the corrected text as a new section
                updatedContent = fileContent + '\n\n' + correctedText;
                console.log(`  Appended corrected text (original text not found for exact match)`);
            } else {
                updatedContent = correctedText;
                console.log(`  Using corrected text as new file content`);
            }

            // Step 6: Commit the updated file
            const commitMessage = `docs: fix #${issueNumber} — ${(issueTitle || 'documentation update').substring(0, 60)}`;
            const putBody: any = {
                message: commitMessage,
                content: Buffer.from(updatedContent).toString('base64'),
                branch: branchName
            };
            if (fileSha) {
                putBody.sha = fileSha;
            }

            await makeRequest(
                `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`,
                authHeaders,
                'PUT',
                JSON.stringify(putBody)
            );
            console.log(`  Committed to ${branchName}`);

            // Step 7: Create Pull Request
            const prTitle = `docs: fix #${issueNumber} — ${(issueTitle || 'documentation update').substring(0, 60)}`;
            const prBody = [
                `## Documentation Fix`,
                ``,
                `Fixes #${issueNumber}`,
                ``,
                `**Gap Type:** ${gapType || 'documentation improvement'}`,
                `**Confidence:** ${confidence || 'N/A'}%`,
                ``,
                `### Changes`,
                `Updated \`${cleanPath}\` based on analysis of GitHub issue [#${issueNumber}](https://github.com/${owner}/${repo}/issues/${issueNumber}).`,
                ``,
                `---`,
                `*Generated by [Lensy](https://console.perseveranceai.com) — AI Documentation Quality Auditor*`
            ].join('\n');

            const prResponse = JSON.parse(await makeRequest(
                `https://api.github.com/repos/${owner}/${repo}/pulls`,
                authHeaders,
                'POST',
                JSON.stringify({
                    title: prTitle,
                    body: prBody,
                    head: branchName,
                    base: defaultBranch
                })
            ));

            console.log(`  Created PR #${prResponse.number}: ${prResponse.html_url}`);

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    prUrl: prResponse.html_url,
                    prNumber: prResponse.number,
                    branchName
                })
            };
        }

        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid mode. Use fetch, analyze, or create-pr.' }) };

    } catch (error) {
        console.error('GitHub Issues Analyzer error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Detect rate limit errors and return 429
        if (errorMessage.includes('RATE_LIMIT')) {
            return {
                statusCode: 429,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'rate_limit',
                    message: 'GitHub API rate limit exceeded. Unauthenticated requests are limited to 60 per hour. Please wait a few minutes and try again.',
                    details: errorMessage
                })
            };
        }

        // Detect 404 — repo not found
        if (errorMessage.includes('HTTP 404')) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'not_found',
                    message: `Repository "${owner}/${repo}" not found. Please check the URL and make sure the repository exists and is public.`
                })
            };
        }

        // Detect 403 — access denied (private repo)
        if (errorMessage.includes('HTTP 403')) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'access_denied',
                    message: `Cannot access "${owner}/${repo}". The repository may be private. Only public repositories are supported.`
                })
            };
        }

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: `Analysis failed: ${errorMessage}` })
        };
    }
};
