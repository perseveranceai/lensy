"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyDocsIssuesTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const { invokeBedrockForJson } = require("../shared/bedrock-helpers");

/**
 * Tool: Classify Docs Issues
 * Uses Bedrock Haiku to classify issues as docs-related or not.
 * Replaces: github-issues-analyzer classifyWithLLM() (lines 460-555)
 */

const HAIKU_MODEL = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

exports.classifyDocsIssuesTool = (0, tools_1.tool)(async (input) => {
    console.log(`[classify_docs_issues] Classifying ${input.issues.length} issues`);

    const issues = input.issues;
    if (!issues || issues.length === 0) {
        return JSON.stringify({ success: true, classifiedIssues: [], classificationMethod: 'none' });
    }

    // Process in batches of 50 (matching legacy behavior)
    const BATCH_SIZE = 50;
    const allResults = new Map();
    let classificationMethod = 'llm';

    for (let i = 0; i < issues.length; i += BATCH_SIZE) {
        const batch = issues.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        console.log(`  Batch ${batchNum}: classifying ${batch.length} issues`);

        const issuesList = batch.map(issue =>
            `#${issue.number}: ${issue.title}\nLabels: ${(issue.labels || []).join(', ') || 'none'}\nBody: ${(issue.body || '').substring(0, 500)}`
        ).join('\n---\n');

        const prompt = `You are a documentation issue classifier. For each GitHub issue below, determine if it is related to documentation quality problems.

Documentation-related issues include:
- Incorrect/outdated docs
- Missing documentation
- Confusing/unclear instructions
- Broken code examples
- Missing API references
- Installation/setup guide issues
- Wrong parameter descriptions
- Deprecated features still documented
- Missing migration guides

NOT documentation-related:
- Feature requests (unless requesting better docs)
- Pure code bugs (unless caused by wrong docs)
- Performance issues
- CI/CD issues
- Dependency updates

For each issue, respond with a JSON object containing:
- "number": the issue number
- "score": 0-100 confidence score (100 = definitely docs-related)
- "categories": array of categories like ["outdated-docs", "missing-docs", "broken-example", "unclear-instructions", "wrong-api-reference", "missing-migration-guide"]

## Issues
${issuesList}

Respond ONLY with a JSON array of objects. Example:
[{"number": 123, "score": 85, "categories": ["outdated-docs"]}, {"number": 456, "score": 10, "categories": []}]`;

        try {
            const result = await invokeBedrockForJson(prompt, {
                modelId: HAIKU_MODEL,
                maxTokens: 2000,
                temperature: 0.1
            });

            const classifications = Array.isArray(result) ? result : [];
            for (const c of classifications) {
                if (c.number && c.score !== undefined) {
                    allResults.set(c.number, { score: c.score, categories: c.categories || [] });
                }
            }
        } catch (err) {
            console.error(`  Batch ${batchNum} LLM classification failed:`, err);
            // Fallback: keyword-based classification for this batch
            classificationMethod = 'keyword';
            for (const issue of batch) {
                if (isDocsRelatedByKeyword(issue)) {
                    allResults.set(issue.number, { score: 50, categories: ['docs-related'] });
                }
            }
        }
    }

    // Merge classification results back into issues
    const classifiedIssues = issues.map(issue => {
        const classification = allResults.get(issue.number);
        return {
            ...issue,
            isDocsRelated: !!classification && classification.score >= 30,
            docsConfidence: classification?.score ?? 0,
            docsCategories: classification?.categories ?? []
        };
    });

    const docsRelatedCount = classifiedIssues.filter(i => i.isDocsRelated).length;
    console.log(`[classify_docs_issues] ${docsRelatedCount}/${classifiedIssues.length} docs-related (${classificationMethod})`);

    return JSON.stringify({
        success: true,
        classifiedIssues,
        classificationMethod,
        docsRelatedCount,
        totalClassified: classifiedIssues.length
    });
}, {
    name: 'classify_docs_issues',
    description: 'Classifies GitHub issues as documentation-related or not using LLM (Haiku). Returns issues with isDocsRelated, docsConfidence, and docsCategories fields.',
    schema: zod_1.z.object({
        issues: zod_1.z.array(zod_1.z.object({
            number: zod_1.z.number(),
            title: zod_1.z.string(),
            body: zod_1.z.string().optional().default(''),
            labels: zod_1.z.array(zod_1.z.string()).optional().default([])
        })).describe('Array of GitHub issues to classify'),
        sessionId: zod_1.z.string().describe('The analysis session ID')
    })
});

/**
 * Keyword-based fallback classifier
 * Matches: github-issues-analyzer classifyDocsRelatedFallback() (lines 560-589)
 */
function isDocsRelatedByKeyword(issue) {
    const text = `${issue.title} ${issue.body || ''} ${(issue.labels || []).join(' ')}`.toLowerCase();
    const docKeywords = [
        'documentation', 'docs', 'readme', 'typo', 'example',
        'tutorial', 'guide', 'api reference', 'getting started',
        'installation', 'setup', 'migration', 'changelog',
        'broken link', 'dead link', 'outdated', 'incorrect',
        'missing doc', 'wrong doc', 'doc bug', 'doc fix',
        'unclear', 'confusing', 'misleading'
    ];
    return docKeywords.some(kw => text.includes(kw));
}
