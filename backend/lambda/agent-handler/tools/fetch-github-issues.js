"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchGithubIssuesTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const { findMcpTool } = require("../shared/mcp-client");

/**
 * Tool: Fetch GitHub Issues
 * Uses MCP search_issues to fetch recent open issues from a GitHub repo.
 * Replaces: github-issues-analyzer fetchRecentIssues() (lines 260-302)
 */
exports.fetchGithubIssuesTool = (0, tools_1.tool)(async (input) => {
    console.log(`[fetch_github_issues] Fetching issues from ${input.owner}/${input.repo}`);

    try {
        const searchTool = await findMcpTool('search_issues');

        // Build search query: open issues from last 14 days
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const query = `repo:${input.owner}/${input.repo} is:issue is:open created:>=${twoWeeksAgo}`;

        // MCP search_issues returns paginated results
        // Fetch up to 3 pages of 100 (matching legacy behavior)
        const maxPages = 3;
        const perPage = 100;
        let allIssues = [];

        for (let page = 1; page <= maxPages; page++) {
            const searchQuery = `${query} per_page:${perPage} page:${page}`;
            console.log(`  Page ${page}: ${searchQuery}`);

            const result = await searchTool.invoke({ query: searchQuery });
            let parsed;
            try {
                parsed = typeof result === 'string' ? JSON.parse(result) : result;
            } catch {
                console.log(`  Page ${page} returned non-JSON, stopping pagination`);
                break;
            }

            // MCP search_issues returns items array
            const items = parsed.items || parsed;
            if (!Array.isArray(items) || items.length === 0) break;

            allIssues.push(...items);
            console.log(`  Page ${page}: ${items.length} issues (total: ${allIssues.length})`);

            if (items.length < perPage) break; // Last page
        }

        // Normalize to our standard format
        const issues = allIssues.map(issue => ({
            number: issue.number,
            title: issue.title,
            body: (issue.body || '').substring(0, 2000),
            state: issue.state,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            labels: (issue.labels || []).map(l => typeof l === 'string' ? l : l.name),
            html_url: issue.html_url,
            user: issue.user?.login || 'unknown',
            comments: issue.comments || 0
        }));

        const result = {
            success: true,
            issues,
            totalFetched: issues.length,
            dateRange: {
                from: twoWeeksAgo,
                to: new Date().toISOString().split('T')[0]
            },
            repo: `${input.owner}/${input.repo}`
        };

        console.log(`[fetch_github_issues] Fetched ${issues.length} issues`);
        return JSON.stringify(result);

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[fetch_github_issues] Error: ${msg}`);

        // Detect rate limit
        if (msg.includes('rate limit') || msg.includes('403')) {
            return JSON.stringify({
                success: false,
                error: 'rate_limit',
                message: 'GitHub API rate limit exceeded. Please wait and try again.'
            });
        }

        // Detect 404
        if (msg.includes('404') || msg.includes('Not Found')) {
            return JSON.stringify({
                success: false,
                error: 'not_found',
                message: `Repository "${input.owner}/${input.repo}" not found or is private.`
            });
        }

        return JSON.stringify({
            success: false,
            error: msg
        });
    }
}, {
    name: 'fetch_github_issues',
    description: 'Fetches recent open GitHub issues from a repository using MCP. Returns issues from the last 14 days with metadata.',
    schema: zod_1.z.object({
        owner: zod_1.z.string().describe('GitHub repository owner (e.g., "vercel")'),
        repo: zod_1.z.string().describe('GitHub repository name (e.g., "next.js")'),
        sessionId: zod_1.z.string().describe('The analysis session ID')
    })
});
