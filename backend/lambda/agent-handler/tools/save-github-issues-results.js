"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveGithubIssuesResultsTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const { writeToS3 } = require("../shared/s3-helpers");

/**
 * Tool: Save GitHub Issues Results
 * Writes analysis results to S3 for frontend polling.
 * Uses the same key format as legacy: github-issues-results/{sessionId}.json
 */

const ANALYSIS_BUCKET = process.env.ANALYSIS_BUCKET || '';

exports.saveGithubIssuesResultsTool = (0, tools_1.tool)(async (input) => {
    console.log(`[save_github_issues_results] Saving results for session ${input.sessionId}`);

    if (!ANALYSIS_BUCKET) {
        return JSON.stringify({ success: false, error: 'ANALYSIS_BUCKET not configured' });
    }

    try {
        const s3Key = `github-issues-results/${input.sessionId}.json`;
        const data = typeof input.results === 'string' ? JSON.parse(input.results) : input.results;

        await writeToS3(ANALYSIS_BUCKET, s3Key, data);
        console.log(`[save_github_issues_results] Written to s3://${ANALYSIS_BUCKET}/${s3Key}`);

        return JSON.stringify({
            success: true,
            s3Key,
            bucket: ANALYSIS_BUCKET
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[save_github_issues_results] Error: ${msg}`);
        return JSON.stringify({ success: false, error: msg });
    }
}, {
    name: 'save_github_issues_results',
    description: 'Saves GitHub Issues analysis results to S3 for frontend polling. The frontend polls GET /github-issues/results/{sessionId} to retrieve these results.',
    schema: zod_1.z.object({
        sessionId: zod_1.z.string().describe('The analysis session ID'),
        results: zod_1.z.any().describe('The results object to save (analyses, KB status, etc.)')
    })
});
