import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { parseString } from 'xml2js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { writeSessionArtifact, readFromS3, writeToS3, ANALYSIS_BUCKET } from '../shared/s3-helpers';
import { createProgressHelper } from './publish-progress';

/**
 * Tool: Check Sitemap Health
 * Merged from:
 *   - sitemap-parser/index.ts          (sitemap discovery & XML parsing)
 *   - sitemap-health-checker/index.ts   (bulk URL validation)
 *   - sitemap-health-for-doc-mode/index.ts (discovery, caching, orchestration)
 *
 * Single self-contained LangGraph tool that:
 *  1. Extracts the domain from the input URL
 *  2. Checks for a cached result in S3 (7-day TTL)
 *  3. Discovers the sitemap via robots.txt and common fallback paths
 *  4. Recursively parses XML sitemaps (max depth 3, handles sitemap indexes)
 *  5. Validates every discovered URL via HEAD requests (batches of 10, 8s timeout)
 *  6. Stores the health report at sessions/{sessionId}/sitemap-health.json
 *  7. Writes a domain-level cache for future reuse
 *  8. Returns a JSON summary
 */

// ─── Module-level S3 client (reused across invocations) ──────
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// ─── Constants ───────────────────────────────────────────────
const USER_AGENT = 'Mozilla/5.0 (compatible; Lensy Documentation Quality Auditor/1.0; +https://lensy.dev/bot)';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SITEMAP_DEPTH = 3;
const BATCH_SIZE = 10;
const URL_CHECK_TIMEOUT_MS = 8_000;
const SITEMAP_FETCH_TIMEOUT_MS = 10_000;
const DISCOVERY_TIMEOUT_MS = 5_000;
const MAX_URLS = 500;

// ─── Interfaces ──────────────────────────────────────────────

interface LinkIssue {
    url: string;
    status: number | string;
    errorMessage: string;
    issueType: '404' | 'access-denied' | 'timeout' | 'error';
}

interface SitemapHealthSummary {
    sitemapStatus: 'success' | 'not-found' | 'error';
    sitemapUrl: string | null;
    discoveryMethod: 'robots.txt' | 'direct' | 'fallback' | 'not-found';
    totalUrls: number;
    healthyUrls: number;
    brokenUrls: number;
    accessDeniedUrls: number;
    timeoutUrls: number;
    otherErrorUrls: number;
    linkIssues: LinkIssue[];
    healthPercentage: number;
    processingTime: number;
    timestamp: string;
}

interface ParsedSitemap {
    urlset?: {
        url: Array<{
            loc: any[];
            lastmod?: string[];
            priority?: string[];
            changefreq?: string[];
        }>;
    };
    sitemapindex?: {
        sitemap: Array<{
            loc: any[];
            lastmod?: string[];
        }>;
    };
}

interface ParseResult {
    urls: string[];
    nestedSitemaps: number;
}

// ─── Pure helpers ────────────────────────────────────────────

function normalizeDomain(hostname: string): string {
    return hostname.replace(/\./g, '-');
}

function isValidUrl(urlString: string): boolean {
    try {
        const u = new URL(urlString);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Extract a string value from an xml2js loc node.
 * Handles both namespace (object with `_` key) and plain-string formats.
 */
function extractLocValue(locNode: any): string {
    if (typeof locNode === 'string') return locNode.trim();
    if (locNode && typeof locNode._ === 'string') return locNode._.trim();
    return '';
}

// ─── Sitemap discovery ───────────────────────────────────────

interface DiscoveryResult {
    sitemapUrl: string | null;
    discoveryMethod: 'robots.txt' | 'direct' | 'fallback' | 'not-found';
    error: string | null;
    skippedGzipUrl: string | null;
}

async function discoverSitemap(domain: string): Promise<DiscoveryResult> {
    let sitemapUrl: string | null = null;
    let skippedGzipUrl: string | null = null;
    let lastError: string | null = null;
    let discoveryMethod: DiscoveryResult['discoveryMethod'] = 'not-found';

    // 1. Try robots.txt
    try {
        console.log(`Checking robots.txt at ${domain}/robots.txt`);
        const robotsResponse = await fetch(`${domain}/robots.txt`, {
            signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
        });

        if (robotsResponse.ok) {
            const robotsText = await robotsResponse.text();
            const sitemapMatch = robotsText.match(/Sitemap:\s*(https?:\/\/[^\s]+)/i);

            if (sitemapMatch) {
                const candidate = sitemapMatch[1].trim();

                if (candidate.endsWith('.gz')) {
                    // Gzipped sitemap -- check accessibility but track as skipped
                    console.log(`Found gzipped sitemap in robots.txt: ${candidate}`);
                    try {
                        const gzipCheck = await fetch(candidate, {
                            method: 'HEAD',
                            signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
                        });
                        if (gzipCheck.ok) {
                            lastError = `Sitemap at ${candidate} is accessible but has XML parsing issues (compressed/not well-formed). The sitemap may need to be regenerated in standard XML format.`;
                        } else {
                            lastError = `Access Denied (${gzipCheck.status}) at ${candidate}`;
                        }
                    } catch (gzErr) {
                        lastError = `Failed to access ${candidate}: ${gzErr instanceof Error ? gzErr.message : 'Unknown error'}`;
                    }
                    skippedGzipUrl = candidate;
                    // Fall through to direct paths
                } else {
                    sitemapUrl = candidate;
                    discoveryMethod = 'robots.txt';
                    console.log(`Found sitemap in robots.txt: ${sitemapUrl}`);
                }
            }
        }
    } catch (err) {
        console.log('Error fetching robots.txt:', err instanceof Error ? err.message : err);
    }

    // 2. Try common direct paths
    if (!sitemapUrl) {
        const directPaths = [
            `${domain}/sitemap.xml`,
            `${domain}/sitemap_index.xml`,
            `${domain}/sitemap/sitemap.xml`
        ];

        for (const path of directPaths) {
            try {
                console.log(`Trying direct path: ${path}`);
                const response = await fetch(path, {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(3_000)
                });

                if (response.ok) {
                    sitemapUrl = path;
                    discoveryMethod = 'direct';
                    console.log(`Found sitemap at: ${path}`);
                    break;
                } else if (response.status === 403 || response.status === 401) {
                    lastError = `Access Denied (${response.status}) at ${path}`;
                }
            } catch {
                console.log(`Path ${path} not accessible`);
                lastError = `Connection failed for ${path}`;
            }
        }
    }

    return { sitemapUrl, discoveryMethod, error: lastError, skippedGzipUrl };
}

// ─── Recursive sitemap parser ────────────────────────────────

async function parseSitemapRecursively(
    sitemapUrl: string,
    depth: number = 0,
    processedUrls: Set<string> = new Set()
): Promise<ParseResult> {
    if (depth > MAX_SITEMAP_DEPTH) {
        console.log(`Max depth ${MAX_SITEMAP_DEPTH} reached, skipping: ${sitemapUrl}`);
        return { urls: [], nestedSitemaps: 0 };
    }

    if (processedUrls.has(sitemapUrl)) {
        console.log(`Already processed: ${sitemapUrl}`);
        return { urls: [], nestedSitemaps: 0 };
    }
    processedUrls.add(sitemapUrl);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SITEMAP_FETCH_TIMEOUT_MS);

        const response = await fetch(sitemapUrl, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Read body -- gzipped sitemaps: attempt text read; log & skip on failure
        let xmlContent: string;
        try {
            xmlContent = await response.text();
        } catch (readErr) {
            console.warn(`Failed to read sitemap body (possibly gzipped): ${sitemapUrl}`, readErr);
            return { urls: [], nestedSitemaps: 0 };
        }

        // Parse XML
        const parsedXml: ParsedSitemap = await new Promise((resolve, reject) => {
            parseString(xmlContent, {
                explicitArray: true,
                ignoreAttrs: true,
                trim: true,
                xmlns: true
            }, (err: any, result: any) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        let allUrls: string[] = [];
        let nestedSitemapCount = 0;

        // Handle sitemap index (references to other sitemaps)
        if (parsedXml.sitemapindex?.sitemap) {
            for (const nested of parsedXml.sitemapindex.sitemap) {
                if (nested.loc?.[0]) {
                    const nestedUrl = extractLocValue(nested.loc[0]);
                    if (nestedUrl) {
                        console.log(`Processing nested sitemap: ${nestedUrl}`);
                        const nestedResult = await parseSitemapRecursively(nestedUrl, depth + 1, processedUrls);
                        allUrls.push(...nestedResult.urls);
                        nestedSitemapCount += 1 + nestedResult.nestedSitemaps;
                    }
                }
            }
        }

        // Handle regular URL set
        if (parsedXml.urlset?.url) {
            for (const urlEntry of parsedXml.urlset.url) {
                if (urlEntry.loc?.[0]) {
                    const url = extractLocValue(urlEntry.loc[0]);
                    if (url && isValidUrl(url)) {
                        allUrls.push(url);
                    }
                }
            }
        }

        // Deduplicate and cap at MAX_URLS
        const uniqueUrls = [...new Set(allUrls)].slice(0, MAX_URLS);
        return { urls: uniqueUrls, nestedSitemaps: nestedSitemapCount };
    } catch (error) {
        console.error(`Error parsing sitemap ${sitemapUrl}:`, error);
        return { urls: [], nestedSitemaps: 0 };
    }
}

// ─── Bulk URL health validation ──────────────────────────────

async function performBulkLinkValidation(
    urls: string[],
    progress: ReturnType<typeof createProgressHelper>
): Promise<{ linkIssues: LinkIssue[] }> {
    if (urls.length === 0) return { linkIssues: [] };

    const uniqueUrls = [...new Set(urls)];
    const linkIssues: LinkIssue[] = [];
    let processedCount = 0;

    for (let i = 0; i < uniqueUrls.length; i += BATCH_SIZE) {
        const batch = uniqueUrls.slice(i, i + BATCH_SIZE);

        const promises = batch.map(async (url) => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);

                const response = await fetch(url, {
                    method: 'HEAD',
                    headers: { 'User-Agent': USER_AGENT },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (response.status === 404) {
                    linkIssues.push({
                        url,
                        status: 404,
                        errorMessage: 'Page not found (404)',
                        issueType: '404'
                    });
                } else if (response.status === 401 || response.status === 403) {
                    linkIssues.push({
                        url,
                        status: response.status,
                        errorMessage: `Access denied (${response.status} ${response.status === 401 ? 'Unauthorized' : 'Forbidden'})`,
                        issueType: 'access-denied'
                    });
                } else if (response.status >= 400) {
                    linkIssues.push({
                        url,
                        status: response.status,
                        errorMessage: `HTTP ${response.status}: ${response.statusText}`,
                        issueType: 'error'
                    });
                }
                // 2xx / 3xx = healthy
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    linkIssues.push({
                        url,
                        status: 'timeout',
                        errorMessage: 'Request timeout (>8 seconds)',
                        issueType: 'timeout'
                    });
                } else {
                    linkIssues.push({
                        url,
                        status: 'error',
                        errorMessage: error instanceof Error ? error.message : 'Unknown error',
                        issueType: 'error'
                    });
                }
            }
        });

        await Promise.all(promises);
        processedCount += batch.length;

        // Periodic progress update every batch
        const pct = Math.round((processedCount / uniqueUrls.length) * 100);
        await progress.progress(
            `Health check progress: ${processedCount}/${uniqueUrls.length} URLs checked (${pct}%)`,
            'sitemap-health',
            { processedCount, totalUrls: uniqueUrls.length, progressPercentage: pct }
        );
    }

    return { linkIssues };
}

// ─── S3-based domain cache helpers ───────────────────────────

function cacheKeyForDomain(normalizedDomain: string): string {
    return `sitemap-health-cache/${normalizedDomain}.json`;
}

async function readDomainCache(normalizedDomain: string): Promise<SitemapHealthSummary | null> {
    const bucket = ANALYSIS_BUCKET;
    if (!bucket) return null;

    try {
        const cached = await readFromS3<SitemapHealthSummary>(bucket, cacheKeyForDomain(normalizedDomain));
        if (!cached) return null;

        const cachedTimestamp = new Date(cached.timestamp).getTime();
        const ageMs = Date.now() - cachedTimestamp;

        if (ageMs < CACHE_TTL_MS) {
            return cached;
        }

        console.log(`Domain cache expired (age: ${Math.floor(ageMs / (24 * 60 * 60 * 1000))}d), re-checking...`);
        return null;
    } catch (err: any) {
        if (err?.name !== 'NoSuchKey') {
            console.warn('Domain cache read failed:', err);
        }
        return null;
    }
}

async function writeDomainCache(normalizedDomain: string, summary: SitemapHealthSummary): Promise<void> {
    const bucket = ANALYSIS_BUCKET;
    if (!bucket) return;

    try {
        await writeToS3(bucket, cacheKeyForDomain(normalizedDomain), summary);
        console.log(`Cached sitemap health results to: ${cacheKeyForDomain(normalizedDomain)}`);
    } catch (err) {
        console.warn('Failed to cache domain-level health results:', err);
    }
}

// ─── The tool ────────────────────────────────────────────────

export const checkSitemapHealthTool = tool(
    async (input): Promise<string> => {
        const startTime = Date.now();
        console.log('check_sitemap_health: Starting for URL:', input.url);

        const progress = createProgressHelper(input.sessionId);

        try {
            // ── Step 1: Extract domain ───────────────────────────
            await progress.progress('Discovering sitemap URL...', 'sitemap-health');

            const urlObj = new URL(input.url);
            const domain = `${urlObj.protocol}//${urlObj.hostname}`;
            const normalizedDomain = normalizeDomain(urlObj.hostname);
            console.log(`Extracted domain: ${domain} (normalized: ${normalizedDomain})`);

            // ── Step 2: Check domain-level cache ─────────────────
            const cached = await readDomainCache(normalizedDomain);
            if (cached) {
                const ageMs = Date.now() - new Date(cached.timestamp).getTime();
                const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
                const ageHours = Math.floor((ageMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
                const ageLabel = ageDays > 0 ? `${ageDays}d ${ageHours}h` : `${ageHours}h`;

                console.log(`Using cached sitemap health results (age: ${ageLabel})`);

                await progress.cacheHit(
                    `Sitemap health (cached ${ageLabel} ago): ${cached.healthyUrls}/${cached.totalUrls} URLs healthy (${cached.healthPercentage}%)`,
                    { cached: true, cacheAge: ageLabel }
                );

                // Store in session for report generator
                await writeSessionArtifact(input.sessionId, 'sitemap-health.json', {
                    ...cached,
                    cached: true,
                    cacheAge: ageLabel
                });

                return JSON.stringify({
                    success: true,
                    sitemapFound: true,
                    sitemapUrl: cached.sitemapUrl,
                    totalUrls: cached.totalUrls,
                    healthPercentage: cached.healthPercentage,
                    brokenCount: cached.brokenUrls,
                    accessDeniedCount: cached.accessDeniedUrls,
                    cached: true,
                    cacheAge: ageLabel,
                    message: `Cached result (${ageLabel} old): ${cached.healthyUrls}/${cached.totalUrls} URLs healthy (${cached.healthPercentage}%)`
                });
            }

            await progress.cacheMiss('No cached sitemap health found, running fresh check', { cacheStatus: 'miss' });

            // ── Step 3: Discover sitemap (or use user-provided URL) ──
            let discovery: DiscoveryResult;
            if (input.sitemapUrl) {
                console.log(`Using user-provided sitemap URL: ${input.sitemapUrl}`);
                await progress.progress(`Using provided sitemap: ${input.sitemapUrl}`, 'sitemap-health');
                discovery = {
                    sitemapUrl: input.sitemapUrl,
                    discoveryMethod: 'direct',
                    error: null,
                    skippedGzipUrl: null
                };
            } else {
                await progress.progress('Searching for sitemap...', 'sitemap-health');
                discovery = await discoverSitemap(domain);
            }

            if (!discovery.sitemapUrl) {
                // Build descriptive message
                let message = 'No accessible sitemap found';
                let status: SitemapHealthSummary['sitemapStatus'] = 'not-found';

                if (discovery.skippedGzipUrl) {
                    status = 'error';
                    message = discovery.error?.includes('not accessible')
                        ? `Sitemap listed in robots.txt at ${discovery.skippedGzipUrl} -- permission issue: the file is not accessible.`
                        : `Sitemap listed in robots.txt at ${discovery.skippedGzipUrl} -- XML parsing issue: compressed/not well-formed.`;
                    await progress.progress(message, 'sitemap-health');
                } else if (discovery.error) {
                    status = 'error';
                    message = `Sitemap discovery failed: ${discovery.error}`;
                    await progress.progress(message, 'sitemap-health');
                } else {
                    await progress.progress('Sitemap not found for domain, skipping health check', 'sitemap-health');
                }

                // Store result so report generator knows the outcome
                await writeSessionArtifact(input.sessionId, 'sitemap-health.json', {
                    sitemapStatus: status,
                    sitemapUrl: null,
                    error: message,
                    discoveryMethod: 'not-found',
                    totalUrls: 0,
                    healthyUrls: 0,
                    brokenUrls: 0,
                    accessDeniedUrls: 0,
                    timeoutUrls: 0,
                    otherErrorUrls: 0,
                    linkIssues: [],
                    healthPercentage: 0,
                    processingTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                });

                return JSON.stringify({
                    success: true,
                    sitemapFound: false,
                    sitemapUrl: null,
                    totalUrls: 0,
                    healthPercentage: 0,
                    brokenCount: 0,
                    accessDeniedCount: 0,
                    message
                });
            }

            // ── Step 4: Parse sitemap ────────────────────────────
            await progress.progress(`Parsing sitemap: ${discovery.sitemapUrl}`, 'sitemap-health');

            const parseResult = await parseSitemapRecursively(discovery.sitemapUrl);
            const urls = parseResult.urls;

            await progress.progress(
                `Sitemap parsed: ${urls.length} URLs found${parseResult.nestedSitemaps > 0 ? ` (${parseResult.nestedSitemaps} nested sitemaps)` : ''}`,
                'sitemap-health'
            );

            if (urls.length === 0) {
                const emptySummary: SitemapHealthSummary = {
                    sitemapStatus: 'success',
                    sitemapUrl: discovery.sitemapUrl,
                    discoveryMethod: discovery.discoveryMethod,
                    totalUrls: 0,
                    healthyUrls: 0,
                    brokenUrls: 0,
                    accessDeniedUrls: 0,
                    timeoutUrls: 0,
                    otherErrorUrls: 0,
                    linkIssues: [],
                    healthPercentage: 100,
                    processingTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                };

                await writeSessionArtifact(input.sessionId, 'sitemap-health.json', emptySummary);

                return JSON.stringify({
                    success: true,
                    sitemapFound: true,
                    sitemapUrl: discovery.sitemapUrl,
                    totalUrls: 0,
                    healthPercentage: 100,
                    brokenCount: 0,
                    accessDeniedCount: 0,
                    message: 'Sitemap found but contains no URLs'
                });
            }

            // ── Step 5: Validate URLs ────────────────────────────
            const estimatedSeconds = Math.max(5, Math.ceil(urls.length / BATCH_SIZE) * 1.5);
            const estimateLabel = estimatedSeconds >= 60
                ? `~${Math.ceil(estimatedSeconds / 60)} min`
                : `~${estimatedSeconds}s`;

            await progress.progress(
                `Checking health of ${urls.length} sitemap URLs (est. ${estimateLabel})...`,
                'sitemap-health'
            );

            const { linkIssues } = await performBulkLinkValidation(urls, progress);

            // ── Step 6: Compute statistics ───────────────────────
            const brokenUrls = linkIssues.filter(i => i.issueType === '404').length;
            const accessDeniedUrls = linkIssues.filter(i => i.issueType === 'access-denied').length;
            const timeoutUrls = linkIssues.filter(i => i.issueType === 'timeout').length;
            const otherErrorUrls = linkIssues.filter(i => i.issueType === 'error').length;
            const healthyUrls = urls.length - linkIssues.length;
            const healthPercentage = urls.length > 0 ? Math.round((healthyUrls / urls.length) * 100) : 100;

            const healthSummary: SitemapHealthSummary = {
                sitemapStatus: 'success',
                sitemapUrl: discovery.sitemapUrl,
                discoveryMethod: discovery.discoveryMethod,
                totalUrls: urls.length,
                healthyUrls,
                brokenUrls,
                accessDeniedUrls,
                timeoutUrls,
                otherErrorUrls,
                linkIssues,
                healthPercentage,
                processingTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };

            // ── Step 7: Store session artifact ───────────────────
            await writeSessionArtifact(input.sessionId, 'sitemap-health.json', healthSummary);

            // ── Step 8: Cache at domain level ────────────────────
            await writeDomainCache(normalizedDomain, healthSummary);

            // ── Step 9: Final progress message ───────────────────
            await progress.success(
                `Sitemap health: ${healthyUrls}/${urls.length} URLs healthy (${healthPercentage}%)`,
                {
                    totalUrls: urls.length,
                    healthyUrls,
                    brokenUrls,
                    healthPercentage,
                    processingTime: Date.now() - startTime
                }
            );

            console.log(`Sitemap health check completed: ${healthyUrls}/${urls.length} URLs healthy`);

            return JSON.stringify({
                success: true,
                sitemapFound: true,
                sitemapUrl: discovery.sitemapUrl,
                discoveryMethod: discovery.discoveryMethod,
                totalUrls: urls.length,
                healthPercentage,
                brokenCount: brokenUrls,
                accessDeniedCount: accessDeniedUrls,
                timeoutCount: timeoutUrls,
                otherErrorCount: otherErrorUrls,
                healthyCount: healthyUrls,
                nestedSitemaps: parseResult.nestedSitemaps,
                message: `Health check complete: ${healthyUrls}/${urls.length} URLs healthy (${healthPercentage}%)`
            });

        } catch (error) {
            console.error('Sitemap health check failed:', error);
            const errMsg = error instanceof Error ? error.message : 'Unknown error';
            await progress.error(`Sitemap health check failed: ${errMsg}`);

            // Store error result so report generator knows it failed
            try {
                await writeSessionArtifact(input.sessionId, 'sitemap-health.json', {
                    sitemapStatus: 'error',
                    error: errMsg,
                    processingTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                });
            } catch (s3Err) {
                console.error('Failed to store error result in S3:', s3Err);
            }

            return JSON.stringify({
                success: false,
                sitemapFound: false,
                totalUrls: 0,
                healthPercentage: 0,
                brokenCount: 0,
                accessDeniedCount: 0,
                message: `Sitemap health check failed: ${errMsg}`
            });
        }
    },
    {
        name: 'check_sitemap_health',
        description:
            'Discovers the XML sitemap for a domain (via robots.txt and common paths), ' +
            'recursively parses it (handling sitemap indexes, max depth 3), validates every ' +
            'URL with HEAD requests (batches of 10, 8s timeout), and returns a health summary. ' +
            'Results are cached per-domain in S3 with a 7-day TTL and stored at ' +
            'sessions/{sessionId}/sitemap-health.json for report generation. ' +
            'Can run in parallel with other tools after process_url.',
        schema: z.object({
            url: z.string().describe('The documentation URL whose domain to check'),
            sessionId: z.string().describe('The analysis session ID'),
            sitemapUrl: z.string().optional().describe('User-provided sitemap URL. If provided, skip discovery and use this URL directly.')
        })
    }
);
