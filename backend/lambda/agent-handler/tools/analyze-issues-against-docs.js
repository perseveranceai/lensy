"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeIssuesAgainstDocsTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const { invokeBedrockForJson } = require("../shared/bedrock-helpers");
const { createProgressHelper } = require("./publish-progress");

/**
 * Tool: Analyze Issues Against Docs
 * Uses Bedrock Sonnet to perform deep gap analysis of issues vs documentation.
 * Replaces: github-issues-analyzer analyzeIssueAgainstDocs() (lines 593-714)
 */

const SONNET_MODEL = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const MAX_ISSUES_PER_SESSION = parseInt(process.env.MAX_ISSUES_PER_SESSION || '15', 10);

exports.analyzeIssuesAgainstDocsTool = (0, tools_1.tool)(async (input) => {
    console.log(`[analyze_issues_against_docs] Analyzing ${input.issues.length} issues against ${input.docs.length} doc pages`);
    const publisher = createProgressHelper(input.sessionId);

    // Cost guard
    let issuesToProcess = input.issues;
    let issuesTruncated = false;
    if (issuesToProcess.length > MAX_ISSUES_PER_SESSION) {
        console.log(`Truncating ${issuesToProcess.length} to ${MAX_ISSUES_PER_SESSION}`);
        issuesToProcess = issuesToProcess.slice(0, MAX_ISSUES_PER_SESSION);
        issuesTruncated = true;
    }

    // Build docs context string (truncated to fit in prompt)
    const docsContext = input.docs.map(d =>
        `### ${d.path}\n${d.content.substring(0, 8000)}`
    ).join('\n\n---\n\n').substring(0, 80000);

    const analyses = [];

    for (let idx = 0; idx < issuesToProcess.length; idx++) {
        const issue = issuesToProcess[idx];
        console.log(`  Analyzing issue #${issue.number}: ${issue.title}`);
        await publisher.progress(
            `Analyzing issue ${idx + 1}/${issuesToProcess.length}: #${issue.number} ${issue.title.substring(0, 60)}`,
            'dimension-analysis',
            { dimension: `issue-${issue.number}` }
        );

        try {
            const result = await analyzeOneIssue(issue, docsContext);
            analyses.push(result);
        } catch (err) {
            console.error(`  Failed to analyze issue #${issue.number}:`, err);
            analyses.push({
                issueNumber: issue.number,
                issueTitle: issue.title,
                docsGap: null,
                error: err instanceof Error ? err.message : String(err)
            });
        }

        // Rate limit between LLM calls
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Sort by confidence (highest first)
    analyses.sort((a, b) => (b.docsGap?.confidence || 0) - (a.docsGap?.confidence || 0));

    const result = {
        success: true,
        analyses,
        docsContextFiles: input.docs.map(d => d.path),
        docsSource: input.docsSource || 'repo-only',
        totalAnalyzed: analyses.length,
        ...(issuesTruncated && {
            warning: `Only the first ${MAX_ISSUES_PER_SESSION} issues were analyzed to control costs.`
        })
    };

    console.log(`[analyze_issues_against_docs] Completed ${analyses.length} analyses`);
    return JSON.stringify(result);
}, {
    name: 'analyze_issues_against_docs',
    description: 'Performs deep gap analysis of GitHub issues against documentation content using Sonnet. Returns per-issue analysis with gap type, confidence, affected files, and suggested fixes.',
    schema: zod_1.z.object({
        issues: zod_1.z.array(zod_1.z.object({
            number: zod_1.z.number(),
            title: zod_1.z.string(),
            body: zod_1.z.string().optional().default(''),
            labels: zod_1.z.array(zod_1.z.string()).optional().default([])
        })).describe('Array of GitHub issues to analyze'),
        docs: zod_1.z.array(zod_1.z.object({
            path: zod_1.z.string(),
            content: zod_1.z.string()
        })).describe('Array of documentation files with path and content'),
        docsSource: zod_1.z.enum(['github', 'website', 'repo-only']).optional().default('repo-only'),
        sessionId: zod_1.z.string().describe('The analysis session ID')
    })
});

/**
 * Analyze a single issue against docs context using Sonnet.
 * Ported from: analyzeIssueAgainstDocs() (lines 593-714)
 */
async function analyzeOneIssue(issue, docsContext) {
    const prompt = `You are a documentation quality analyst. Analyze this GitHub issue to determine if it reveals a documentation gap, error, or improvement opportunity.

## GROUNDING RULES
- Only identify gaps that are **directly evidenced** by the issue text AND the documentation content below.
- Do NOT speculate about undocumented features, APIs, or behaviors unless the issue **explicitly** mentions them.
- If the issue is vague or lacks specific documentation references, lower your confidence accordingly.
- A "missing documentation" gap MUST reference a specific feature/API/concept that the user was looking for.

## GitHub Issue
**#${issue.number}: ${issue.title}**
Labels: ${(issue.labels || []).join(', ') || 'none'}

${(issue.body || '').substring(0, 3000)}

## Documentation Context
${docsContext}

## Required Output (JSON)
{
  "issueNumber": ${issue.number},
  "issueTitle": "${issue.title.replace(/"/g, '\\"')}",
  "docsGap": {
    "gapType": "missing-docs | outdated-docs | incorrect-docs | unclear-docs | missing-example | broken-example | missing-migration-guide | no-gap",
    "confidence": 0-100,
    "summary": "One-sentence description of the docs gap",
    "affectedFile": "path/to/affected/doc/file (or null)",
    "affectedSection": "section heading or description (or null)",
    "suggestedFix": "Specific suggestion for how to fix the documentation",
    "originalText": "The exact text that needs to be changed (or null for missing docs)",
    "correctedText": "The corrected/new text (be specific and actionable)",
    "evidence": "Quote from the issue that supports this gap analysis"
  }
}

If no documentation gap is found, set gapType to "no-gap" with confidence and a brief explanation.
Return ONLY valid JSON, nothing else.`;

    const result = await invokeBedrockForJson(prompt, {
        modelId: SONNET_MODEL,
        maxTokens: 2000,
        temperature: 0
    });

    return {
        issueNumber: result.issueNumber || issue.number,
        issueTitle: result.issueTitle || issue.title,
        docsGap: result.docsGap || null
    };
}
