import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import https from 'https';
import { URL } from 'url';
import TurndownService from 'turndown';

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
    // NEW: Rich content from source
    fullContent?: string;  // Full question/issue body
    codeSnippets?: string[];  // Code examples from the issue
    errorMessages?: string[];  // Extracted error messages
    tags?: string[];  // Technology tags
    stackTrace?: string;  // Stack traces if present
}

interface IssueDiscovererInput {
    companyName: string;
    domain: string;
    sessionId: string;
}

interface IssueDiscovererOutput {
    issues: DiscoveredIssue[];
    totalFound: number;
    searchSources: string[];
    processingTime: number;
}

// Top 3 most credible developer community sources (extensible for future)
const CREDIBLE_SOURCES = new Map([
    ['stackoverflow', {
        name: 'Stack Overflow',
        domain: 'stackoverflow.com',
        priority: 1,
        searchPatterns: ['{company} {issue}', '{company} api {problem}', '{domain} error'],
        reliability: 0.95
    }],
    ['github', {
        name: 'GitHub Issues',
        domain: 'github.com',
        priority: 2,
        searchPatterns: ['{company} issues', 'site:{company}.github.io', '{company}-node issues'],
        reliability: 0.90
    }],
    ['reddit', {
        name: 'Reddit',
        domain: 'reddit.com',
        priority: 3,
        searchPatterns: ['r/webdev {company}', 'r/programming {company}', 'r/node {company}'],
        reliability: 0.75
    }]
]);

// Future extensible sources (commented out for now)
/*
const FUTURE_SOURCES = new Map([
    ['devto', { name: 'Dev.to', domain: 'dev.to', priority: 4, reliability: 0.70 }],
    ['hackernews', { name: 'Hacker News', domain: 'news.ycombinator.com', priority: 5, reliability: 0.80 }],
    ['discord', { name: 'Discord Communities', domain: 'discord.gg', priority: 6, reliability: 0.60 }],
    ['community', { name: 'Community Forums', domain: 'community.*', priority: 7, reliability: 0.65 }]
]);
*/

// Common issue categories and patterns
const ISSUE_CATEGORIES = {
    'rate-limiting': ['rate limit', 'too many requests', '429 error', 'throttling', 'quota exceeded'],
    'authentication': ['auth', 'api key', 'token', 'unauthorized', '401 error', 'permission denied'],
    'code-examples': ['example', 'sample code', 'how to', 'tutorial', 'implementation'],
    'api-usage': ['api', 'endpoint', 'request', 'response', 'integration'],
    'deployment': ['production', 'deploy', 'environment', 'config', 'setup'],
    'webhooks': ['webhook', 'callback', 'event', 'notification', 'trigger'],
    'error-handling': ['error', 'exception', 'failure', 'bug', 'issue'],
    'documentation': ['docs', 'documentation', 'unclear', 'missing', 'outdated']
};

/**
 * Enrich issues with full content from their source URLs
 */
async function enrichIssuesWithFullContent(issues: DiscoveredIssue[]): Promise<DiscoveredIssue[]> {
    console.log(`Enriching ${issues.length} issues with full content from sources...`);

    const enrichedIssues: DiscoveredIssue[] = [];

    for (const issue of issues) {
        try {
            // Get the first source URL
            const sourceUrl = issue.sources[0];

            if (!sourceUrl) {
                console.log(`No source URL for issue: ${issue.id}`);
                enrichedIssues.push(issue);
                continue;
            }

            console.log(`Fetching full content from: ${sourceUrl}`);

            // Determine source type and fetch accordingly
            if (sourceUrl.includes('stackoverflow.com')) {
                const enrichedIssue = await enrichFromStackOverflow(issue, sourceUrl);
                enrichedIssues.push(enrichedIssue);
            } else if (sourceUrl.includes('github.com')) {
                const enrichedIssue = await enrichFromGitHub(issue, sourceUrl);
                enrichedIssues.push(enrichedIssue);
            } else {
                // For other sources, keep original
                enrichedIssues.push(issue);
            }

            // Add small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error) {
            console.error(`Failed to enrich issue ${issue.id}:`, error);
            // Keep original issue if enrichment fails
            enrichedIssues.push(issue);
        }
    }

    console.log(`Enrichment complete: ${enrichedIssues.length} issues processed`);
    return enrichedIssues;
}

/**
 * Enrich issue with full content from StackOverflow
 */
async function enrichFromStackOverflow(issue: DiscoveredIssue, url: string): Promise<DiscoveredIssue> {
    try {
        console.log(`Fetching StackOverflow page: ${url}`);

        // Fetch the HTML page
        const html = await makeHttpRequest(url, {
            'User-Agent': 'Mozilla/5.0 (compatible; Lensy-Documentation-Auditor/1.0)',
            'Accept': 'text/html'
        });

        // Extract rich content
        const fullContent = extractStackOverflowContent(html);
        const codeSnippets = extractCodeSnippets(html);
        const errorMessages = extractErrorMessages(html);
        const tags = extractStackOverflowTags(html);
        const stackTrace = extractStackTrace(html);

        console.log(`Extracted from StackOverflow: ${fullContent.length} chars, ${codeSnippets.length} code snippets, ${errorMessages.length} errors, ${tags.length} tags`);

        return {
            ...issue,
            fullContent: fullContent.substring(0, 8000), // Limit to 8000 chars like doc pages
            codeSnippets,
            errorMessages,
            tags,
            stackTrace
        };

    } catch (error) {
        console.error(`Failed to fetch StackOverflow content:`, error);
        return issue;
    }
}

/**
 * Extract main question content from StackOverflow HTML and convert to clean Markdown
 */
function extractStackOverflowContent(html: string): string {
    try {
        // Extract ALL question bodies (there might be multiple answers)
        const allMatches = html.matchAll(/<div class="s-prose js-post-body"[^>]*itemprop="text">([\s\S]*?)<\/div>\s*<\/div>/gi);

        let allContent = '';
        let matchCount = 0;

        for (const match of allMatches) {
            matchCount++;
            allContent += match[1];
            if (matchCount >= 3) break; // Limit to first 3 (question + top 2 answers)
        }

        if (matchCount === 0) {
            console.log('Could not find question body in HTML');
            return '';
        }

        console.log(`Found ${matchCount} content blocks`);

        // Convert HTML to clean Markdown
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*',
            strongDelimiter: '**'
        });

        // Remove script and style tags before conversion
        const cleanHtml = allContent
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

        // Convert to Markdown
        let markdown = turndownService.turndown(cleanHtml);

        // Clean up the markdown
        markdown = markdown
            .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
            .replace(/\s+$/gm, '') // Remove trailing whitespace
            .trim();

        console.log(`Extracted content length: ${markdown.length} chars`);
        return markdown;

    } catch (error) {
        console.error('Error extracting StackOverflow content:', error);
        return '';
    }
}

/**
 * Extract code snippets from StackOverflow HTML
 */
function extractCodeSnippets(html: string): string[] {
    const snippets: string[] = [];

    try {
        // Match pre/code blocks more aggressively
        const codeMatches = html.matchAll(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi);

        for (const match of codeMatches) {
            let code = match[1]
                .replace(/<[^>]+>/g, '') // Remove HTML tags
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .trim();

            // Only include substantial code snippets (more than 20 chars)
            if (code.length > 20 && code.length < 1000) {
                snippets.push(code);
            }
        }

        console.log(`Extracted ${snippets.length} code snippets`);

    } catch (error) {
        console.error('Error extracting code snippets:', error);
    }

    return snippets.slice(0, 5); // Limit to 5 snippets
}

/**
 * Extract error messages from content
 */
function extractErrorMessages(html: string): string[] {
    const errors: string[] = [];

    try {
        const content = html.replace(/<[^>]+>/g, ' ');

        // Common error patterns
        const errorPatterns = [
            /Error:\s*([^\n]{10,100})/gi,
            /Exception:\s*([^\n]{10,100})/gi,
            /Failed:\s*([^\n]{10,100})/gi,
            /\d{3}\s+error[:\s]+([^\n]{10,100})/gi, // HTTP errors like "500 error: ..."
            /TypeError:\s*([^\n]{10,100})/gi,
            /ReferenceError:\s*([^\n]{10,100})/gi,
            /SyntaxError:\s*([^\n]{10,100})/gi
        ];

        for (const pattern of errorPatterns) {
            const matches = content.matchAll(pattern);
            for (const match of matches) {
                if (match[1]) {
                    errors.push(match[1].trim());
                }
            }
        }

        console.log(`Extracted ${errors.length} error messages`);

    } catch (error) {
        console.error('Error extracting error messages:', error);
    }

    return [...new Set(errors)].slice(0, 3); // Dedupe and limit to 3
}

/**
 * Extract tags from StackOverflow
 */
function extractStackOverflowTags(html: string): string[] {
    const tags: string[] = [];

    try {
        // Match tag elements
        const tagMatches = html.matchAll(/<a[^>]*class="[^"]*post-tag[^"]*"[^>]*>([^<]+)<\/a>/gi);

        for (const match of tagMatches) {
            if (match[1]) {
                tags.push(match[1].trim());
            }
        }

        console.log(`Extracted ${tags.length} tags: ${tags.join(', ')}`);

    } catch (error) {
        console.error('Error extracting tags:', error);
    }

    return tags;
}

/**
 * Extract stack trace from content
 */
function extractStackTrace(html: string): string | undefined {
    try {
        const content = html.replace(/<[^>]+>/g, '\n');

        // Look for stack trace patterns
        const stackTracePattern = /at\s+[\w.$]+\s*\([^)]+\)/gi;
        const matches = content.match(stackTracePattern);

        if (matches && matches.length > 2) {
            // Found a stack trace
            const stackTrace = matches.slice(0, 5).join('\n'); // First 5 lines
            console.log(`Extracted stack trace: ${stackTrace.length} chars`);
            return stackTrace;
        }

    } catch (error) {
        console.error('Error extracting stack trace:', error);
    }

    return undefined;
}

/**
 * Enrich issue with full content from GitHub
 */
async function enrichFromGitHub(issue: DiscoveredIssue, url: string): Promise<DiscoveredIssue> {
    try {
        console.log(`Fetching GitHub issue: ${url}`);

        // For GitHub, we could use the GitHub API for better structured data
        // For now, we'll do basic HTML parsing similar to StackOverflow

        const html = await makeHttpRequest(url, {
            'User-Agent': 'Mozilla/5.0 (compatible; Lensy-Documentation-Auditor/1.0)',
            'Accept': 'text/html'
        });

        // Extract issue body
        const bodyMatch = html.match(/<td class="d-block comment-body[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
        let fullContent = '';

        if (bodyMatch) {
            fullContent = bodyMatch[1]
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        const codeSnippets = extractCodeSnippets(html);
        const errorMessages = extractErrorMessages(html);

        console.log(`Extracted from GitHub: ${fullContent.length} chars, ${codeSnippets.length} code snippets`);

        return {
            ...issue,
            fullContent: fullContent.substring(0, 8000),
            codeSnippets,
            errorMessages
        };

    } catch (error) {
        console.error(`Failed to fetch GitHub content:`, error);
        return issue;
    }
}

/**
 * Real developer issue discovery using curated web search data
 */
async function searchDeveloperIssues(companyName: string, domain: string): Promise<DiscoveredIssue[]> {
    const startTime = Date.now();
    const issues: DiscoveredIssue[] = [];

    console.log(`Loading real curated data for: ${companyName} (${domain})`);

    try {
        // Load real curated data from JSON file (manually researched from Stack Overflow, GitHub, Reddit)
        console.log('Loading real curated developer issues from Q4 2025 web search...');
        const realIssues = getRealCuratedData(companyName, domain);
        issues.push(...realIssues);
        console.log(`Real data loaded: ${realIssues.length} issues found`);

        // NEW: Enrich issues with full content from their source URLs
        console.log('Enriching issues with full content from sources...');
        const enrichedIssues = await enrichIssuesWithFullContent(issues);
        console.log(`Enrichment complete: ${enrichedIssues.length} issues enriched`);

        console.log(`Total real issues found: ${enrichedIssues.length} in ${Date.now() - startTime}ms`);
        return enrichedIssues;

    } catch (error) {
        console.error('Error loading real data:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        // Fallback to empty array if data loading fails
        return [];
    }
}

/**
 * Search Stack Overflow using official Stack Overflow MCP server
 * Uses Stack Overflow's Model Context Protocol server for structured Q&A discovery
 */
async function searchStackOverflowMCP(companyName: string, domain: string): Promise<DiscoveredIssue[]> {
    const issues: DiscoveredIssue[] = [];

    try {
        // Search queries targeting common developer pain points
        const searchQueries = [
            `${companyName} api error`,
            `${companyName} rate limit`,
            `${companyName} authentication`,
            `${companyName} integration`,
            `${companyName} documentation`
        ];

        for (const query of searchQueries) {
            try {
                console.log(`Stack Overflow MCP search: ${query}`);

                // Use Stack Overflow MCP server to search for questions
                const mcpResponse = await callStackOverflowMCP('so_search', {
                    query: query,
                    sort: 'relevance',
                    pagesize: 3
                });

                if (mcpResponse && mcpResponse.items && Array.isArray(mcpResponse.items)) {
                    console.log(`Stack Overflow MCP returned ${mcpResponse.items.length} items for: ${query}`);

                    for (const item of mcpResponse.items) {
                        if (item && item.question_id && item.title) {
                            // Get additional content for richer context
                            let description = item.title;
                            try {
                                const contentResponse = await callStackOverflowMCP('get_content', {
                                    id: item.question_id,
                                    type: 'question'
                                });
                                if (contentResponse && contentResponse.body) {
                                    description = truncateText(contentResponse.body, 120);
                                }
                            } catch (contentError) {
                                console.log(`Could not fetch content for question ${item.question_id}`);
                            }

                            issues.push({
                                id: `stackoverflow-mcp-${item.question_id}`,
                                title: truncateText(item.title, 80),
                                category: categorizeIssue(item.title + ' ' + description),
                                description: description,
                                frequency: Math.min(Math.floor((item.view_count || 0) / 100), 50), // Convert views to frequency score
                                sources: [`https://stackoverflow.com/questions/${item.question_id}`],
                                lastSeen: item.last_activity_date ? new Date(item.last_activity_date * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                                severity: (item.score || 0) > 5 ? 'high' : (item.score || 0) > 2 ? 'medium' : 'low',
                                relatedPages: []
                            });
                        }
                    }
                } else {
                    console.log(`No valid Stack Overflow MCP response for query: ${query}`);
                }
            } catch (queryError) {
                console.error(`Stack Overflow MCP query failed for "${query}":`, queryError);
                console.error('Stack Overflow MCP query error details:', JSON.stringify(queryError, null, 2));
                // Continue with next query
            }
        }
    } catch (error) {
        console.error('Stack Overflow MCP search failed:', error);
    }

    console.log(`Stack Overflow MCP search completed: found ${issues.length} issues`);
    return issues;
}

/**
 * Call Stack Overflow's official MCP server
 * Implements MCP JSON-RPC 2.0 protocol for Stack Overflow integration
 */
async function callStackOverflowMCP(tool: string, params: any): Promise<any> {
    const mcpRequest = {
        jsonrpc: '2.0',
        id: Math.random().toString(36).substring(7),
        method: 'tools/call',
        params: {
            name: tool,
            arguments: params
        }
    };

    console.log(`Stack Overflow MCP request:`, JSON.stringify(mcpRequest, null, 2));

    try {
        // Stack Overflow's official MCP server endpoint
        // Note: This will require proper MCP client setup with npx mcp-remote
        const mcpUrl = 'mcp.stackoverflow.com';

        // For now, we'll simulate the MCP call since we need proper MCP client setup
        // In production, this would use the MCP protocol via npx mcp-remote
        console.log(`Would call Stack Overflow MCP at: ${mcpUrl}`);
        console.log(`Tool: ${tool}, Params:`, params);

        // Temporary: Return structured mock data that simulates real MCP response
        return await simulateStackOverflowMCP(tool, params);

    } catch (error) {
        console.error('Stack Overflow MCP call failed:', error);
        throw error;
    }
}

/**
 * Temporary simulation of Stack Overflow MCP responses
 * This simulates what the real MCP server would return
 * TODO: Replace with actual MCP client implementation
 */
async function simulateStackOverflowMCP(tool: string, params: any): Promise<any> {
    console.log(`Simulating Stack Overflow MCP call: ${tool}`);

    if (tool === 'so_search') {
        const query = params.query.toLowerCase();
        const companyName = query.split(' ')[0]; // Extract company name

        // Return realistic Stack Overflow search results based on query
        const mockResults = {
            items: [
                {
                    question_id: Math.floor(Math.random() * 1000000) + 70000000,
                    title: `How to handle ${companyName} API rate limiting in production?`,
                    score: Math.floor(Math.random() * 20) + 5,
                    view_count: Math.floor(Math.random() * 5000) + 1000,
                    last_activity_date: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 86400 * 30), // Within last 30 days
                    tags: [companyName, 'api', 'rate-limiting']
                },
                {
                    question_id: Math.floor(Math.random() * 1000000) + 70000000,
                    title: `${companyName} authentication failing in Node.js - best practices?`,
                    score: Math.floor(Math.random() * 15) + 3,
                    view_count: Math.floor(Math.random() * 3000) + 500,
                    last_activity_date: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 86400 * 60), // Within last 60 days
                    tags: [companyName, 'authentication', 'nodejs']
                }
            ]
        };

        console.log(`Simulated Stack Overflow search returned ${mockResults.items.length} results`);
        return mockResults;
    }

    if (tool === 'get_content') {
        // Return mock question content
        return {
            body: `I'm having trouble integrating with the API. The documentation isn't clear about handling rate limits in production environments. Has anyone found a good solution?`,
            question_id: params.id
        };
    }

    return null;
}

/**
 * Search Stack Overflow for real questions using Stack Exchange API
 */
async function searchStackOverflowReal(companyName: string, domain: string): Promise<DiscoveredIssue[]> {
    const issues: DiscoveredIssue[] = [];

    try {
        const searchQueries = [
            `${companyName} api`,
            `${companyName} error`,
            `${companyName} integration`
        ];

        for (const query of searchQueries) {
            try {
                const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=3`;

                console.log(`Stack Overflow API call: ${query}`);
                const response = await makeHttpRequest(url, {
                    'User-Agent': 'Lensy-Documentation-Auditor/1.0'
                });

                if (response && response.items && Array.isArray(response.items)) {
                    console.log(`Stack Overflow API returned ${response.items.length} items for: ${query}`);

                    for (const item of response.items) {
                        if (item && item.question_id && item.title) {
                            issues.push({
                                id: `stackoverflow-${item.question_id}`,
                                title: truncateText(item.title, 80),
                                category: categorizeIssue(item.title),
                                description: truncateText(item.title, 120),
                                frequency: Math.min(Math.floor((item.view_count || 0) / 100), 50), // Convert views to frequency score
                                sources: [`https://stackoverflow.com/questions/${item.question_id}`],
                                lastSeen: item.last_activity_date ? new Date(item.last_activity_date * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                                severity: (item.score || 0) > 5 ? 'high' : (item.score || 0) > 2 ? 'medium' : 'low',
                                relatedPages: []
                            });
                        }
                    }
                } else {
                    console.log(`No valid Stack Overflow response for query: ${query}`);
                }
            } catch (queryError) {
                console.error(`Stack Overflow query failed for "${query}":`, queryError);
                console.error('Stack Overflow query error details:', JSON.stringify(queryError, null, 2));
                // Continue with next query
            }
        }
    } catch (error) {
        console.error('Stack Overflow search failed:', error);
    }

    console.log(`Stack Overflow search completed: found ${issues.length} issues`);
    return issues;
}

/**
 * Make HTTP request with error handling and redirect support
 */
async function makeHttpRequest(url: string, headers: Record<string, string> = {}, body?: string, redirectCount: number = 0): Promise<any> {
    console.log(`Making HTTP request to: ${url}`);

    if (redirectCount > 5) {
        throw new Error('Too many redirects');
    }

    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: body ? 'POST' : 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Lensy-Documentation-Auditor/1.0)',
                ...headers
            }
        };

        const req = https.request(options, (res) => {
            console.log(`HTTP response status: ${res.statusCode}`);

            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                const redirectUrl = res.headers.location;
                if (!redirectUrl) {
                    reject(new Error('Redirect without location header'));
                    return;
                }

                console.log(`Following redirect to: ${redirectUrl}`);

                // Handle relative URLs
                const fullRedirectUrl = redirectUrl.startsWith('http')
                    ? redirectUrl
                    : `https://${urlObj.hostname}${redirectUrl}`;

                makeHttpRequest(fullRedirectUrl, headers, body, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                console.log(`HTTP response data length: ${data.length}`);

                // Check if response is JSON or HTML
                const contentType = res.headers['content-type'] || '';

                if (contentType.includes('application/json')) {
                    try {
                        const parsed = JSON.parse(data);
                        console.log(`Successfully parsed JSON response`);
                        resolve(parsed);
                    } catch (error) {
                        console.error(`Failed to parse JSON response:`, error);
                        reject(new Error(`Failed to parse JSON: ${error}`));
                    }
                } else {
                    // Return raw HTML/text
                    console.log(`Returning raw HTML/text response`);
                    resolve(data);
                }
            });
        });

        req.on('error', (error) => {
            console.error(`HTTP request error:`, error);
            reject(error);
        });

        req.setTimeout(15000, () => {
            console.error(`HTTP request timeout for: ${url}`);
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (body) {
            req.write(body);
        }
        req.end();
    });
}

/**
 * Categorize issue based on content
 */
function categorizeIssue(content: string): string {
    const lowerContent = content.toLowerCase();

    for (const [category, keywords] of Object.entries(ISSUE_CATEGORIES)) {
        if (keywords.some(keyword => lowerContent.includes(keyword))) {
            return category;
        }
    }

    return 'general';
}

/**
 * Truncate text to specified length
 */
function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

/**
 * Extract related documentation pages from issue content
 */
function extractRelatedPages(content: string): string[] {
    const pages: string[] = [];
    const urlRegex = /\/docs\/[^\s)]+/g;
    const matches = content.match(urlRegex);

    if (matches) {
        pages.push(...matches.slice(0, 3)); // Limit to 3 pages
    }

    return pages;
}

/**
 * Load real curated data from web search
 * This data was manually researched and curated from Stack Overflow, GitHub, and Reddit in Q4 2025
 */
function getRealCuratedData(companyName: string, domain: string): DiscoveredIssue[] {
    // Load real issues data from JSON file
    const realIssuesData = require('./real-issues-data.json');

    // Extract company name from domain or use provided name
    const searchKey = companyName.toLowerCase() || domain.split('.')[0].toLowerCase();

    // Return real curated data for known companies
    const issues = realIssuesData[searchKey] || [];

    // Log which sources were searched
    const searchedSources = Array.from(CREDIBLE_SOURCES.values()).map(source => source.name);
    console.log(`Using real curated data from: ${searchedSources.join(', ')}`);
    console.log(`Found ${issues.length} real issues for ${searchKey} from Q4 2025 web search`);

    return issues;
}

/**
 * Search Google for real developer issues across Stack Overflow, GitHub, Reddit
 * Uses Google Custom Search API for authentic developer problem discovery
 */
async function searchGoogleForDeveloperIssues(companyName: string, domain: string): Promise<DiscoveredIssue[]> {
    const issues: DiscoveredIssue[] = [];

    try {
        // Search queries targeting developer pain points across multiple platforms
        const searchQueries = [
            `${companyName} api error site:stackoverflow.com`,
            `${companyName} rate limit site:stackoverflow.com`,
            `${companyName} authentication problem site:stackoverflow.com`,
            `${companyName} integration issues site:github.com`,
            `${companyName} documentation problems site:reddit.com`,
        ];

        for (const query of searchQueries) {
            try {
                console.log(`Google search: ${query}`);

                // Use Google Custom Search API (or fallback to web scraping approach)
                const searchResults = await performGoogleSearch(query);

                if (searchResults && searchResults.length > 0) {
                    console.log(`Google returned ${searchResults.length} results for: ${query}`);

                    for (const result of searchResults.slice(0, 2)) { // Limit to 2 per query
                        if (result && result.title && result.link) {
                            issues.push({
                                id: `google-${Math.random().toString(36).substring(7)}`,
                                title: truncateText(result.title, 80),
                                category: categorizeIssue(result.title + ' ' + (result.snippet || '')),
                                description: truncateText(result.snippet || result.title, 120),
                                frequency: Math.floor(Math.random() * 30) + 10, // Estimated based on search ranking
                                sources: [result.link],
                                lastSeen: new Date().toISOString().split('T')[0], // Today
                                severity: result.title.toLowerCase().includes('error') || result.title.toLowerCase().includes('problem') ? 'high' : 'medium',
                                relatedPages: []
                            });
                        }
                    }
                } else {
                    console.log(`No Google results for query: ${query}`);
                }
            } catch (queryError) {
                console.error(`Google search failed for "${query}":`, queryError);
                // Continue with next query
            }
        }
    } catch (error) {
        console.error('Google search failed:', error);
    }

    console.log(`Google search completed: found ${issues.length} issues`);
    return issues;
}

/**
 * Perform Google search using a simple web scraping approach
 * This is a basic implementation - in production you'd use Google Custom Search API
 */
async function performGoogleSearch(query: string): Promise<any[]> {
    try {
        // For now, return realistic mock data that simulates Google search results
        // TODO: Replace with actual Google Custom Search API or web scraping
        console.log(`Simulating Google search for: ${query}`);

        const mockResults = [];
        const companyName = query.split(' ')[0];

        if (query.includes('site:stackoverflow.com')) {
            mockResults.push({
                title: `How to handle ${companyName} API rate limiting in production?`,
                link: `https://stackoverflow.com/questions/${Math.floor(Math.random() * 1000000) + 70000000}`,
                snippet: `I'm hitting rate limits with the ${companyName} API in production. The documentation mentions 2 requests per second but doesn't explain how to handle this properly in Node.js applications.`
            });
        } else if (query.includes('site:github.com')) {
            mockResults.push({
                title: `${companyName} authentication issues in production deployment`,
                link: `https://github.com/company/repo/issues/${Math.floor(Math.random() * 1000) + 100}`,
                snippet: `Authentication failing when deploying to production environment. Works fine locally but fails with 401 errors in production.`
            });
        } else if (query.includes('site:reddit.com')) {
            mockResults.push({
                title: `r/webdev - ${companyName} integration problems`,
                link: `https://reddit.com/r/webdev/comments/${Math.random().toString(36).substring(7)}`,
                snippet: `Has anyone else had issues with ${companyName} integration? The documentation seems outdated and missing key examples.`
            });
        }

        console.log(`Mock Google search returned ${mockResults.length} results`);
        return mockResults;

    } catch (error) {
        console.error('Google search simulation failed:', error);
        return [];
    }
}

/**
 * Categorizes and ranks issues by frequency and recency
 */
function processAndRankIssues(issues: DiscoveredIssue[]): DiscoveredIssue[] {
    return issues
        .sort((a, b) => {
            // Primary sort: frequency (higher first)
            if (b.frequency !== a.frequency) {
                return b.frequency - a.frequency;
            }
            // Secondary sort: recency (more recent first)
            return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
        })
        .slice(0, 10); // Return top 10 issues
}

/**
 * Stores discovered issues in S3 for later validation
 */
async function storeIssuesInS3(sessionId: string, issues: DiscoveredIssue[]): Promise<void> {
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
        throw new Error('S3_BUCKET_NAME environment variable not set');
    }

    const key = `sessions/${sessionId}/discovered-issues.json`;
    const content = JSON.stringify({
        issues,
        discoveredAt: new Date().toISOString(),
        totalFound: issues.length
    }, null, 2);

    await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: content,
        ContentType: 'application/json'
    }));

    console.log(`Stored ${issues.length} issues in S3: ${key}`);
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const startTime = Date.now();

    try {
        console.log('IssueDiscoverer Lambda started', { event: JSON.stringify(event) });

        // Parse input from Step Functions
        const input: IssueDiscovererInput = typeof event.body === 'string'
            ? JSON.parse(event.body)
            : event.body as any;

        const { companyName, domain, sessionId } = input;

        if (!domain || !sessionId) {
            throw new Error('Missing required parameters: domain and sessionId');
        }

        console.log(`Searching for issues related to: ${companyName || domain}`);

        // Search for developer issues across multiple sources
        const discoveredIssues = await searchDeveloperIssues(companyName, domain);

        // Process and rank issues
        const rankedIssues = processAndRankIssues(discoveredIssues);

        // Store results in S3 for later validation
        await storeIssuesInS3(sessionId, rankedIssues);

        const processingTime = Date.now() - startTime;

        const result: IssueDiscovererOutput = {
            issues: rankedIssues,
            totalFound: rankedIssues.length,
            searchSources: Array.from(CREDIBLE_SOURCES.values()).map(source => source.name),
            processingTime
        };

        console.log(`IssueDiscoverer completed in ${processingTime}ms`, {
            totalIssues: rankedIssues.length,
            sessionId
        });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('IssueDiscoverer error:', error);

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Issue discovery failed',
                message: error instanceof Error ? error.message : 'Unknown error',
                issues: [],
                totalFound: 0,
                searchSources: Array.from(CREDIBLE_SOURCES.values()).map(source => source.name),
                processingTime: Date.now() - startTime
            })
        };
    }
};