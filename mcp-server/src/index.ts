#!/usr/bin/env node

/**
 * Perseverance Writer Agent — MCP Server
 *
 * stdio transport. 3 tools: analyze_doc, improve_doc, create_pr.
 * The IDE spawns this process and communicates via JSON-RPC over stdin/stdout.
 *
 * CRITICAL: Use console.error() for ALL debug output.
 * console.log() corrupts the MCP JSON-RPC protocol on stdout.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { analyzeDoc } from './tools/analyze-doc.js';
import { improveDoc } from './tools/improve-doc.js';
import { createPr } from './tools/create-pr.js';
import 'dotenv/config';

const server = new McpServer({
    name: 'perseverance-writer',
    version: '0.1.0',
});

// ── Tool 1: analyze_doc ─────────────────────────────────────────────────
server.tool(
    'analyze_doc',
    'Scan a documentation page for AI-readiness issues using Lensy. Returns structured findings with scores, recommendations, and detection signals. Takes 30-90 seconds (Lensy runs a full scan).',
    {
        url: z.string().url().describe('The full URL of the documentation page to analyze (e.g. https://directus.io/docs/guides/connect/sdk)'),
    },
    async ({ url }) => {
        try {
            const result = await analyzeDoc(url);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        } catch (err: any) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ error: err.message }),
                }],
                isError: true,
            };
        }
    }
);

// ── Tool 2: improve_doc ─────────────────────────────────────────────────
server.tool(
    'improve_doc',
    'Rewrite a local markdown file to fix AI-readiness gaps identified by Lensy. Reads the file from the developer\'s workspace, rewrites via Claude, and returns improved markdown with a change summary. Call analyze_doc first to get findings.',
    {
        url: z.string().url().describe('The documentation page URL (used for context in the rewrite prompt)'),
        findings: z.string().describe('JSON string of the LensyReport object returned by analyze_doc'),
        repo_path: z.string().describe('Absolute path to the local docs repo (e.g. /Users/dev/directus-docs)'),
        file_path: z.string().describe('Relative path to the .md file within the repo (e.g. content/guides/connect/sdk.md)'),
    },
    async ({ url, findings, repo_path, file_path }) => {
        try {
            let parsedFindings;
            try {
                parsedFindings = JSON.parse(findings);
            } catch {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ error: 'Invalid JSON in findings parameter. Pass the exact JSON output from analyze_doc.' }),
                    }],
                    isError: true,
                };
            }

            const result = await improveDoc({
                url,
                findings: parsedFindings,
                repoPath: repo_path,
                filePath: file_path,
            });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        } catch (err: any) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ error: err.message }),
                }],
                isError: true,
            };
        }
    }
);

// ── Tool 3: create_pr ───────────────────────────────────────────────────
server.tool(
    'create_pr',
    'Create a GitHub Pull Request with improved documentation. Commits the changed file to a new branch and opens a PR. Requires GITHUB_TOKEN env var with repo scope.',
    {
        repo_owner: z.string().describe('GitHub repo owner (e.g. directus)'),
        repo_name: z.string().describe('GitHub repo name (e.g. docs)'),
        file_path: z.string().describe('Path to the file in the repo (e.g. content/guides/connect/sdk.md)'),
        new_content: z.string().describe('The improved markdown content to commit'),
        title: z.string().describe('PR title (e.g. "docs: improve AI-readiness for SDK guide")'),
        body: z.string().describe('PR description with summary of changes made'),
        base_branch: z.string().default('main').describe('Base branch to PR against (default: main)'),
    },
    async ({ repo_owner, repo_name, file_path, new_content, title, body, base_branch }) => {
        try {
            const result = await createPr({
                repoOwner: repo_owner,
                repoName: repo_name,
                filePath: file_path,
                newContent: new_content,
                title,
                body,
                baseBranch: base_branch,
            });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        } catch (err: any) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ error: err.message }),
                }],
                isError: true,
            };
        }
    }
);

// ── Start ───────────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[perseverance-mcp] Server started on stdio');
    console.error(`[perseverance-mcp] LENSY_API_URL: ${process.env.LENSY_API_URL || '(default: https://api.perseveranceai.com)'}`);
    console.error(`[perseverance-mcp] AWS_REGION: ${process.env.AWS_REGION || 'us-east-1'}`);
    console.error(`[perseverance-mcp] GITHUB_TOKEN: ${process.env.GITHUB_TOKEN ? 'set' : 'NOT SET'}`);
}

main().catch((err) => {
    console.error('[perseverance-mcp] Fatal error:', err);
    process.exit(1);
});
