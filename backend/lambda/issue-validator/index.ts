import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import https from 'https';
import { URL } from 'url';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

interface DiscoveredIssue {
    id: string;
    title: string;
    category: string;
    description: string;
    frequency: number;
    sources: string[];
    lastSeen: string;
    severity: 'high' | 'medium' | 'low';
    relatedPages: string[];
}

interface IssueValidatorInput {
    issues: DiscoveredIssue[];
    domain: string;
    sessionId: string;
}

interface Evidence {
    pageUrl: string;
    pageTitle: string;
    hasRelevantContent: boolean;
    contentGaps: string[];
    codeExamples: number;
    productionGuidance: boolean;
}

interface GapAnalysis {
    gapType: 'potential-gap' | 'critical-gap' | 'resolved';
    pageUrl?: string;
    pageTitle?: string;
    missingContent: string[];
    reasoning: string;
    developerImpact: string;
}

interface ValidationResult {
    issueId: string;
    issueTitle: string;
    status: 'confirmed' | 'resolved' | 'potential-gap' | 'critical-gap';
    evidence: Evidence[];
    missingElements: string[];
    potentialGaps: GapAnalysis[];
    criticalGaps: string[];
    confidence: number;
    recommendations: string[];
}

interface IssueValidatorOutput {
    validationResults: ValidationResult[];
    summary: {
        totalIssues: number;
        confirmed: number;
        resolved: number;
        potentialGaps: number;
        criticalGaps: number;
    };
    processingTime: number;
}

/**
 * Extract keywords from issue for sitemap search
 */
function extractKeywords(issue: DiscoveredIssue): string[] {
    const text = `${issue.title} ${issue.description} ${issue.category}`.toLowerCase();

    // Common stop words to filter out
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can'];

    // Extract words (alphanumeric, 3+ chars)
    const words = text.match(/\b[a-z0-9]{3,}\b/g) || [];

    // Filter stop words and deduplicate
    const keywords = [...new Set(words.filter(word => !stopWords.includes(word)))];

    // Add category-specific keywords
    const categoryKeywords: Record<string, string[]> = {
        'deployment': ['deploy', 'production', 'environment', 'vercel', 'netlify', 'hosting'],
        'email-delivery': ['email', 'spam', 'deliverability', 'dns', 'spf', 'dkim', 'gmail'],
        'api-usage': ['api', 'endpoint', 'request', 'response', 'integration'],
        'authentication': ['auth', 'key', 'token', 'credential', 'permission'],
        'documentation': ['docs', 'guide', 'tutorial', 'example']
    };

    if (issue.category && categoryKeywords[issue.category]) {
        keywords.push(...categoryKeywords[issue.category]);
    }

    return [...new Set(keywords)];
}

/**
 * Fetch sitemap.xml and extract URLs
 */
async function fetchSitemap(domain: string): Promise<string[]> {
    const sitemapUrl = `https://${domain}/sitemap.xml`;

    console.log(`Fetching sitemap from: ${sitemapUrl}`);

    try {
        const xml = await makeHttpRequest(sitemapUrl);

        // Extract URLs from sitemap XML
        const urlMatches = xml.match(/<loc>(.*?)<\/loc>/g) || [];
        const urls = urlMatches.map(match => {
            const url = match.replace(/<\/?loc>/g, '');
            // Convert full URL to path
            try {
                const urlObj = new URL(url);
                return urlObj.pathname;
            } catch {
                return url;
            }
        });

        console.log(`Found ${urls.length} URLs in sitemap`);
        return urls;

    } catch (error) {
        console.error('Failed to fetch sitemap:', error);
        return [];
    }
}

/**
 * Search sitemap for relevant pages based on keywords
 */
function searchSitemapForRelevantPages(keywords: string[], sitemapUrls: string[]): string[] {
    const relevantPages: Array<{ url: string; score: number }> = [];

    for (const url of sitemapUrls) {
        const urlLower = url.toLowerCase();
        let score = 0;

        // Score based on keyword matches
        for (const keyword of keywords) {
            if (urlLower.includes(keyword)) {
                score += 1;
            }
        }

        // Boost score for /docs/ pages
        if (urlLower.includes('/docs/')) {
            score += 0.5;
        }

        if (score > 0) {
            relevantPages.push({ url, score });
        }
    }

    // Sort by score and return top 5
    relevantPages.sort((a, b) => b.score - a.score);
    const topPages = relevantPages.slice(0, 5).map(p => p.url);

    console.log(`Found ${topPages.length} relevant pages from sitemap:`, topPages);
    return topPages;
}

/**
 * Fetch page content
 */
async function fetchPageContent(domain: string, path: string): Promise<string> {
    const url = `https://${domain}${path}`;
    console.log(`Fetching page content from: ${url}`);

    try {
        const content = await makeHttpRequest(url);
        return content;
    } catch (error) {
        console.error(`Failed to fetch page ${url}:`, error);
        return '';
    }
}

/**
 * Analyze page content for relevance to issue
 */
function analyzePageContent(content: string, issue: DiscoveredIssue, pageUrl: string): Evidence {
    const contentLower = content.toLowerCase();
    const keywords = extractKeywords(issue);

    // Extract page title
    const titleMatch = content.match(/<title>(.*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1] : pageUrl;

    // Check for keyword matches
    const keywordMatches = keywords.filter(kw => contentLower.includes(kw));
    const hasRelevantContent = keywordMatches.length >= 2; // At least 2 keywords

    // Count code examples (code blocks, pre tags)
    const codeBlockMatches = content.match(/<code|<pre|```/gi) || [];
    const codeExamples = codeBlockMatches.length;

    // Check for production guidance keywords
    const productionKeywords = ['production', 'deploy', 'environment', 'configuration', 'setup'];
    const productionGuidance = productionKeywords.some(kw => contentLower.includes(kw));

    // Identify content gaps
    const contentGaps: string[] = [];

    if (codeExamples === 0) {
        contentGaps.push('Missing code examples');
    }

    if (!productionGuidance && issue.category === 'deployment') {
        contentGaps.push('Missing production deployment guidance');
    }

    if (!contentLower.includes('error') && !contentLower.includes('troubleshoot')) {
        contentGaps.push('Missing error handling and troubleshooting steps');
    }

    // Check for specific issue-related content
    if (issue.category === 'email-delivery') {
        if (!contentLower.includes('spam') && !contentLower.includes('deliverability')) {
            contentGaps.push('Missing spam/deliverability troubleshooting');
        }
        if (!contentLower.includes('dns') && !contentLower.includes('spf') && !contentLower.includes('dkim')) {
            contentGaps.push('Missing DNS configuration examples');
        }
    }

    if (issue.category === 'deployment') {
        if (!contentLower.includes('vercel') && !contentLower.includes('netlify') && issue.title.toLowerCase().includes('vercel')) {
            contentGaps.push('Missing platform-specific deployment examples (Vercel/Netlify)');
        }
        if (!contentLower.includes('environment variable') && !contentLower.includes('env')) {
            contentGaps.push('Missing environment variable configuration');
        }
    }

    return {
        pageUrl,
        pageTitle,
        hasRelevantContent,
        contentGaps,
        codeExamples,
        productionGuidance
    };
}

/**
 * Validate a single issue against documentation
 */
async function validateIssue(issue: DiscoveredIssue, domain: string): Promise<ValidationResult> {
    console.log(`\n=== Validating issue: ${issue.title} ===`);

    let pagesToCheck: string[] = [];
    let usedSitemapFallback = false;

    // Step 1: Try pre-curated pages first
    if (issue.relatedPages && issue.relatedPages.length > 0) {
        pagesToCheck = issue.relatedPages;
        console.log(`Using pre-curated pages:`, pagesToCheck);
    } else {
        // Step 2: Fallback to sitemap search
        console.log(`No pre-curated pages, falling back to sitemap search`);
        usedSitemapFallback = true;

        const sitemap = await fetchSitemap(domain);
        if (sitemap.length > 0) {
            const keywords = extractKeywords(issue);
            console.log(`Extracted keywords:`, keywords);
            pagesToCheck = searchSitemapForRelevantPages(keywords, sitemap);
        }
    }

    // Step 3: Validate each page
    const evidence: Evidence[] = [];
    const potentialGaps: GapAnalysis[] = [];
    const criticalGaps: string[] = [];
    const missingElements: string[] = [];

    if (pagesToCheck.length === 0) {
        // Critical gap: No relevant pages found
        console.log(`❌ CRITICAL GAP: No relevant pages found for issue`);

        criticalGaps.push(`No documentation page found addressing "${issue.title}"`);

        potentialGaps.push({
            gapType: 'critical-gap',
            missingContent: [
                'Complete documentation page missing',
                'Code examples needed',
                'Troubleshooting guide needed',
                'Production deployment guidance needed'
            ],
            reasoning: `Searched sitemap.xml but found no pages matching keywords: ${extractKeywords(issue).join(', ')}`,
            developerImpact: `${issue.frequency} developers affected - reporting this issue since ${issue.lastSeen}`
        });

        return {
            issueId: issue.id,
            issueTitle: issue.title,
            status: 'critical-gap',
            evidence,
            missingElements: ['Complete documentation page'],
            potentialGaps,
            criticalGaps,
            confidence: 95,
            recommendations: [
                `Create new documentation page addressing: ${issue.title}`,
                `Include code examples for ${issue.category}`,
                `Add troubleshooting section`,
                `Reference: ${issue.sources[0]}`
            ]
        };
    }

    // Fetch and analyze each page
    for (const pagePath of pagesToCheck) {
        const content = await fetchPageContent(domain, pagePath);

        if (!content) {
            console.log(`⚠️ Failed to fetch page: ${pagePath}`);
            continue;
        }

        const pageEvidence = analyzePageContent(content, issue, pagePath);
        evidence.push(pageEvidence);

        // Detect potential gaps
        if (!pageEvidence.hasRelevantContent || pageEvidence.contentGaps.length > 0) {
            console.log(`⚠️ POTENTIAL GAP: ${pagePath} exists but missing content`);

            potentialGaps.push({
                gapType: 'potential-gap',
                pageUrl: pagePath,
                pageTitle: pageEvidence.pageTitle,
                missingContent: pageEvidence.contentGaps,
                reasoning: `Page title/URL suggests relevance to "${issue.title}" but lacks specific content`,
                developerImpact: `Developers searching for "${issue.title}" would find this page but not get complete solution`
            });

            missingElements.push(...pageEvidence.contentGaps);
        }
    }

    // Determine overall status
    const hasCompleteContent = evidence.some(e => e.hasRelevantContent && e.contentGaps.length === 0);
    const hasSomeContent = evidence.some(e => e.hasRelevantContent);

    let status: ValidationResult['status'];
    let confidence: number;

    if (hasCompleteContent) {
        status = 'resolved';
        confidence = 90;
        console.log(`✅ RESOLVED: Issue appears to be addressed in documentation`);
    } else if (potentialGaps.length > 0) {
        status = 'potential-gap';
        confidence = 80;
        console.log(`⚠️ POTENTIAL GAP: Pages exist but content is incomplete`);
    } else if (hasSomeContent) {
        status = 'confirmed';
        confidence = 75;
        console.log(`❌ CONFIRMED: Issue exists, documentation is incomplete`);
    } else {
        status = 'critical-gap';
        confidence = 85;
        console.log(`❌ CRITICAL GAP: No relevant content found`);
    }

    // Generate recommendations
    const recommendations: string[] = [];

    if (status === 'potential-gap' || status === 'confirmed') {
        for (const gap of potentialGaps) {
            if (gap.pageUrl) {
                recommendations.push(`Update ${gap.pageUrl} to include: ${gap.missingContent.join(', ')}`);
            }
        }

        recommendations.push(`Add specific examples addressing: ${issue.title}`);
        recommendations.push(`Reference real developer issue: ${issue.sources[0]}`);
    }

    if (status === 'critical-gap') {
        recommendations.push(`Create comprehensive documentation page for: ${issue.title}`);
        recommendations.push(`Include code examples and troubleshooting guide`);
    }

    return {
        issueId: issue.id,
        issueTitle: issue.title,
        status,
        evidence,
        missingElements: [...new Set(missingElements)],
        potentialGaps,
        criticalGaps,
        confidence,
        recommendations
    };
}

/**
 * Make HTTP request
 */
async function makeHttpRequest(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Lensy-Documentation-Auditor/1.0'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

/**
 * Store validation results in S3
 */
async function storeValidationResults(sessionId: string, results: IssueValidatorOutput): Promise<void> {
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
        throw new Error('S3_BUCKET_NAME environment variable not set');
    }

    const key = `sessions/${sessionId}/issue-validation-results.json`;
    const content = JSON.stringify(results, null, 2);

    await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: content,
        ContentType: 'application/json'
    }));

    console.log(`Stored validation results in S3: ${key}`);
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const startTime = Date.now();

    try {
        console.log('IssueValidator Lambda started', { event: JSON.stringify(event) });

        // Parse input
        const input: IssueValidatorInput = typeof event.body === 'string'
            ? JSON.parse(event.body)
            : event.body as any;

        const { issues, domain, sessionId } = input;

        if (!issues || !domain || !sessionId) {
            throw new Error('Missing required parameters: issues, domain, and sessionId');
        }

        console.log(`Validating ${issues.length} issues for domain: ${domain}`);

        // Validate each issue
        const validationResults: ValidationResult[] = [];

        for (const issue of issues) {
            const result = await validateIssue(issue, domain);
            validationResults.push(result);
        }

        // Calculate summary
        const summary = {
            totalIssues: validationResults.length,
            confirmed: validationResults.filter(r => r.status === 'confirmed').length,
            resolved: validationResults.filter(r => r.status === 'resolved').length,
            potentialGaps: validationResults.filter(r => r.status === 'potential-gap').length,
            criticalGaps: validationResults.filter(r => r.status === 'critical-gap').length
        };

        const processingTime = Date.now() - startTime;

        const output: IssueValidatorOutput = {
            validationResults,
            summary,
            processingTime
        };

        // Store results in S3
        await storeValidationResults(sessionId, output);

        console.log(`IssueValidator completed in ${processingTime}ms`, summary);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(output)
        };

    } catch (error) {
        console.error('IssueValidator error:', error);

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Issue validation failed',
                message: error instanceof Error ? error.message : 'Unknown error',
                validationResults: [],
                summary: {
                    totalIssues: 0,
                    confirmed: 0,
                    resolved: 0,
                    potentialGaps: 0,
                    criticalGaps: 0
                },
                processingTime: Date.now() - startTime
            })
        };
    }
};
