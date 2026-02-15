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

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

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
}

interface RepoDoc {
    path: string;
    content: string;
}

interface DocsGapResult {
    number: number;
    title: string;
    html_url: string;
    docsGap: {
        gapType: 'missing-content' | 'inaccurate-content' | 'unclear-content' | 'outdated-content';
        confidence: number;
        affectedDocs: string[];
        originalText: string;
        correctedText: string;
        section: string;
        lineContext: string;
    };
}

// ─── HTTP Helper ─────────────────────────────────────────────────────────────

function makeRequest(url: string, headers: Record<string, string> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Lensy-GitHub-Analyzer/1.0',
                'Accept': 'application/vnd.github.v3+json',
                ...headers
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            // Follow redirects
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                makeRequest(res.headers.location, headers).then(resolve).catch(reject);
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
                        reject(new Error(`RATE_LIMIT: GitHub API rate limit exceeded. Resets at ${resetDate}. Unauthenticated limit is 60 requests/hour.`));
                    } else {
                        reject(new Error(`HTTP 403: Access denied. ${data.substring(0, 300)}`));
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
        req.end();
    });
}

// ─── GitHub API Functions ────────────────────────────────────────────────────

async function fetchIssues(owner: string, repo: string, maxIssues: number = 30): Promise<GitHubIssue[]> {
    const perPage = Math.min(maxIssues, 100);
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&sort=updated&direction=desc&per_page=${perPage}`;

    console.log(`Fetching issues from ${owner}/${repo}...`);
    const response = await makeRequest(url);
    const items: any[] = JSON.parse(response);

    // Filter out PRs (GitHub API returns PRs in issues endpoint)
    const issues = items.filter(item => !item.pull_request);
    console.log(`Found ${issues.length} open issues (filtered ${items.length - issues.length} PRs)`);

    return issues.map(issue => ({
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        html_url: issue.html_url,
        labels: (issue.labels || []).map((l: any) => ({ name: l.name })),
        created_at: issue.created_at,
        comments: issue.comments || 0,
        reactions: issue.reactions,
        state: issue.state
    }));
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

async function fetchDocsContext(owner: string, repo: string): Promise<RepoDoc[]> {
    const docs: RepoDoc[] = [];

    console.log(`Fetching docs context for ${owner}/${repo}...`);

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
    try {
        const packageJson = await fetchRepoFile(owner, repo, 'package.json');
        if (packageJson) {
            const pkg = JSON.parse(packageJson);
            const docsUrl = pkg.homepage || '';
            if (docsUrl && docsUrl.includes('http')) {
                console.log(`  Found homepage: ${docsUrl} — attempting to fetch docs site`);
                try {
                    const docsContent = await makeRequest(docsUrl, { 'Accept': 'text/html' });
                    // Extract text content (basic HTML to text)
                    const textContent = docsContent
                        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (textContent.length > 100) {
                        docs.push({ path: `[docs-site] ${docsUrl}`, content: textContent.substring(0, 20000) });
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

// ─── Local Classification (fast, no LLM needed) ─────────────────────────────

function classifyDocsRelated(issue: GitHubIssue): boolean {
    const combined = `${issue.title} ${issue.body}`.toLowerCase();

    const docsSignals = [
        'documentation', 'docs', 'readme', 'guide', 'tutorial', 'example',
        'unclear', 'confusing', 'misleading', 'incorrect', 'wrong', 'inaccurate',
        'outdated', 'missing', 'how to', 'how do i', 'skill.md', 'skill',
        'not documented', 'undocumented', 'typo', 'broken link',
        'factually', 'guideline', 'media quer' // specific to react-email #2958
    ];

    const hasSignal = docsSignals.some(s => combined.includes(s));

    // Also check labels
    const docsLabels = ['documentation', 'docs', 'type: bug', 'good first issue'];
    const hasLabel = issue.labels.some(l => docsLabels.includes(l.name.toLowerCase()));

    return hasSignal || hasLabel;
}

// ─── LLM Analysis (Bedrock Claude) ──────────────────────────────────────────

async function analyzeIssueAgainstDocs(
    issue: GitHubIssue,
    docs: RepoDoc[]
): Promise<DocsGapResult> {
    const docsContext = docs.map(d => `--- ${d.path} ---\n${d.content.substring(0, 8000)}`).join('\n\n');

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
    "affectedDocs": ["list of affected file paths from the docs context"],
    "originalText": "Copy-paste the EXACT text from the documentation that is wrong or needs changing. This must be a verbatim quote from the docs context above, not a summary.",
    "correctedText": "The EXACT replacement text that should replace originalText. This is what the user will copy-paste into their docs.",
    "section": "The section heading or area where this text appears (e.g. 'Behavioral Guidelines', 'Installation', 'API Reference')",
    "lineContext": "Brief context about where in the document this text appears (e.g. 'Under the Email Client Limitations heading in SKILL.md')"
}

CRITICAL RULES:
- originalText MUST be a verbatim, COMPLETE quote from the docs context — the user needs it for find-and-replace. NEVER truncate or cut off mid-sentence.
- correctedText MUST be the complete replacement — the user will copy-paste it directly. NEVER truncate or cut off mid-sentence.
- Both originalText and correctedText must contain FULL, COMPLETE sentences/paragraphs — never cut them short.
- If the issue reveals MISSING content (not inaccurate), set originalText to the nearest relevant existing text and correctedText to an expanded version that includes the missing information
- Be precise: include enough surrounding text in originalText to make it uniquely findable in the document
- Include the FULL bullet point, paragraph, or section that needs changing — do not excerpt just a fragment`;

    try {
        const command = new InvokeModelCommand({
            modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
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
                    originalText: analysis.originalText || '',
                    correctedText: analysis.correctedText || '',
                    section: analysis.section || '',
                    lineContext: analysis.lineContext || ''
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
            originalText: '',
            correctedText: '',
            section: '',
            lineContext: 'Could not complete LLM analysis. Manual review recommended.'
        }
    };
}

// ─── Lambda Handler ──────────────────────────────────────────────────────────

export const handler = async (event: any): Promise<any> => {
    console.log('GitHub Issues Analyzer invoked:', JSON.stringify(event, null, 2));

    const { mode, owner, repo, maxIssues, issues } = typeof event.body === 'string'
        ? JSON.parse(event.body)
        : event;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
        'Content-Type': 'application/json'
    };

    try {
        if (mode === 'fetch' || (!mode && !issues)) {
            // MODE 1: Fetch and classify issues
            if (!owner || !repo) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'owner and repo are required' }) };
            }

            const allIssues = await fetchIssues(owner, repo, maxIssues || 30);

            // Classify each issue
            const classifiedIssues = allIssues.map(issue => ({
                ...issue,
                isDocsRelated: classifyDocsRelated(issue)
            }));

            const docsRelatedCount = classifiedIssues.filter(i => i.isDocsRelated).length;
            console.log(`Classification complete: ${docsRelatedCount}/${classifiedIssues.length} docs-related`);

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    issues: classifiedIssues,
                    totalIssues: classifiedIssues.length,
                    docsRelatedCount,
                    repo: `${owner}/${repo}`
                })
            };
        }

        if (mode === 'analyze' || issues) {
            // MODE 2: Deep analysis of selected issues against docs
            if (!owner || !repo || !issues || issues.length === 0) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'owner, repo, and issues array are required' }) };
            }

            // Fetch docs context
            const docs = await fetchDocsContext(owner, repo);

            // Analyze each issue against docs
            const analyses: DocsGapResult[] = [];
            for (const issue of issues) {
                console.log(`Analyzing issue #${issue.number}: ${issue.title}...`);
                const result = await analyzeIssueAgainstDocs(issue, docs);
                analyses.push(result);

                // Small delay between LLM calls
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Sort by confidence (highest first)
            analyses.sort((a, b) => (b.docsGap?.confidence || 0) - (a.docsGap?.confidence || 0));

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    analyses,
                    docsContextFiles: docs.map(d => d.path),
                    repo: `${owner}/${repo}`,
                    totalAnalyzed: analyses.length
                })
            };
        }

        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid mode. Use fetch or analyze.' }) };

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
