/**
 * MCP Tool: create_pr
 *
 * Creates a GitHub PR with improved documentation content.
 * Pure API call — no LLM involved.
 */

import { createPr as githubCreatePr, type CreatePrInput, type CreatePrResult } from '../github-client.js';

export { type CreatePrInput, type CreatePrResult };

export async function createPr(input: CreatePrInput): Promise<CreatePrResult> {
    console.error(`[create_pr] Creating PR on ${input.repoOwner}/${input.repoName}`);
    console.error(`  File: ${input.filePath}`);
    console.error(`  Base: ${input.baseBranch}`);

    const result = await githubCreatePr(input);

    console.error(`[create_pr] PR #${result.prNumber} created: ${result.prUrl}`);

    return result;
}
