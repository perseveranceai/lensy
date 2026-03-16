"use strict";
/**
 * Shared Page Summarizer — used by both Doc Audit and GitHub Issues modes
 * to build and query the Page Knowledge Base (DynamoDB).
 *
 * Provides:
 * - summarizePage(): Haiku-powered structured summary of a doc page
 * - parseSummaryFields(): Extract structured fields from Haiku output
 * - writePageToKB() / queryKB(): DynamoDB read/write for page knowledge base
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizePage = summarizePage;
exports.parseSummaryFields = parseSummaryFields;
exports.deriveSafeDomain = deriveSafeDomain;
exports.queryKB = queryKB;
exports.writePageToKB = writePageToKB;
exports.writePagesToKB = writePagesToKB;
exports.summarizeAndParsePage = summarizeAndParsePage;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const bedrock_helpers_1 = require("./bedrock-helpers");
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const PAGE_KB_TABLE = process.env.PAGE_KB_TABLE || '';
const HAIKU_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
// ─── Summarization ───────────────────────────────────────────
/**
 * Use Haiku to generate a structured summary of a documentation page.
 * Returns the raw Haiku output text (parse with parseSummaryFields()).
 */
async function summarizePage(title, rawContent) {
    const truncated = rawContent.substring(0, 12000);
    const prompt = `Summarize this documentation page for a documentation quality auditor. The summary will be used to understand what this page covers and match it against related pages.

## Page Title: ${title}

## Page Content:
${truncated}

## Output Format (keep under 1500 characters total):

DOC TYPE: api-reference | tutorial | conceptual | how-to | reference | troubleshooting | overview | changelog | mixed
TOPIC: What this page documents (1 sentence)
KEY TERMS: keywords, feature names, config keys, API endpoints (comma-separated)
COVERS:
- Specific topic 1
- Specific topic 2
- Specific topic 3
CODE EXAMPLES: What examples exist (or "None")
LIMITATIONS: Caveats, known issues mentioned (or "None noted")`;
    try {
        const response = await (0, bedrock_helpers_1.invokeBedrockModel)(prompt, {
            modelId: HAIKU_MODEL_ID,
            maxTokens: 1000,
            temperature: 0.1,
        });
        return response || buildFallbackSummary(title);
    }
    catch (err) {
        console.error(`[PageSummarizer] Summarization failed for "${title}":`, err);
        return buildFallbackSummary(title);
    }
}
function buildFallbackSummary(title) {
    return `DOC TYPE: mixed\nTOPIC: ${title}\nKEY TERMS: ${title}\nCOVERS:\n- Page content\nCODE EXAMPLES: Unknown\nLIMITATIONS: None noted`;
}
/**
 * Parse structured fields from Haiku summarization output.
 */
function parseSummaryFields(text, title) {
    // Parse documentationType
    const docTypeRaw = text.match(/^DOC TYPE:\s*(.+)$/m)?.[1]?.trim()?.toLowerCase();
    const validDocTypes = ['api-reference', 'tutorial', 'conceptual', 'how-to', 'reference', 'troubleshooting', 'overview', 'changelog', 'mixed'];
    const documentationType = validDocTypes.includes(docTypeRaw)
        ? docTypeRaw
        : undefined;
    const topic = text.match(/^TOPIC:\s*(.+)$/m)?.[1]?.trim() || `Documentation page: ${title}`;
    const keyTermsRaw = text.match(/^KEY TERMS:\s*(.+)$/m)?.[1]?.trim() || title;
    const keyTerms = keyTermsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const coversSection = text.match(/^COVERS:\n((?:[-*]\s*.+\n?)*)/m)?.[1] || '';
    const covers = coversSection
        .split('\n')
        .map((l) => l.replace(/^[-*]\s*/, '').trim())
        .filter((l) => l.length > 0);
    const codeExamples = text.match(/^CODE EXAMPLES:\s*(.+)$/m)?.[1]?.trim() || 'None';
    const limitations = text.match(/^LIMITATIONS:\s*(.+)$/m)?.[1]?.trim() || 'None noted';
    return {
        documentationType,
        topic,
        keyTerms,
        covers: covers.length > 0 ? covers : [`Content about ${title}`],
        codeExamples,
        limitations
    };
}
// ─── DynamoDB Knowledge Base Operations ──────────────────────
/**
 * Derive a safe domain key from a URL (e.g., "www.dotcms.com" → "dotcms-com").
 * Strips subdomains so all subdomains share the same KB partition
 * (e.g., dev.dotcms.com and www.dotcms.com both → "dotcms-com").
 */
function deriveSafeDomain(urlString) {
    try {
        const urlObj = new URL(urlString);
        const hostname = urlObj.hostname.replace(/^www\./, '');
        // Extract registrable domain: keep last 2 parts (or 3 for country-code TLDs)
        const parts = hostname.split('.');
        const domain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
        return domain.replace(/\./g, '-');
    }
    catch {
        return urlString.replace(/[^a-zA-Z0-9-]/g, '-');
    }
}
/**
 * Query all page summaries for a domain from the Knowledge Base.
 */
async function queryKB(domain) {
    if (!PAGE_KB_TABLE) {
        console.log('[PageSummarizer] PAGE_KB_TABLE not set, skipping KB query');
        return [];
    }
    try {
        const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
            TableName: PAGE_KB_TABLE,
            KeyConditionExpression: '#domain = :domain',
            ExpressionAttributeNames: { '#domain': 'domain' },
            ExpressionAttributeValues: { ':domain': domain },
        }));
        return (result.Items || []);
    }
    catch (err) {
        console.error(`[PageSummarizer] Failed to query KB for domain ${domain}:`, err);
        return [];
    }
}
/**
 * Write a single page summary to the Knowledge Base.
 */
async function writePageToKB(domain, page, source) {
    if (!PAGE_KB_TABLE) {
        console.log('[PageSummarizer] PAGE_KB_TABLE not set, skipping KB write');
        return;
    }
    try {
        await docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: PAGE_KB_TABLE,
            Item: {
                domain,
                url: page.url,
                title: page.title,
                category: page.category,
                documentationType: page.documentationType,
                topic: page.topic,
                keyTerms: page.keyTerms,
                covers: page.covers,
                codeExamples: page.codeExamples,
                limitations: page.limitations,
                crawledAt: page.crawledAt,
                source,
                expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400, // 7-day TTL
            },
        }));
    }
    catch (err) {
        console.error(`[PageSummarizer] Failed to write page ${page.url} to KB:`, err);
    }
}
/**
 * Write multiple page summaries to the Knowledge Base in batches of 25.
 */
async function writePagesToKB(domain, pages, source) {
    if (!PAGE_KB_TABLE || pages.length === 0)
        return;
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400;
    const batchSize = 25;
    for (let i = 0; i < pages.length; i += batchSize) {
        const batch = pages.slice(i, i + batchSize);
        try {
            await docClient.send(new lib_dynamodb_1.BatchWriteCommand({
                RequestItems: {
                    [PAGE_KB_TABLE]: batch.map(p => ({
                        PutRequest: {
                            Item: {
                                domain,
                                url: p.url,
                                title: p.title,
                                category: p.category,
                                documentationType: p.documentationType,
                                topic: p.topic,
                                keyTerms: p.keyTerms,
                                covers: p.covers,
                                codeExamples: p.codeExamples,
                                limitations: p.limitations,
                                crawledAt: p.crawledAt,
                                source,
                                expiresAt,
                            }
                        }
                    }))
                }
            }));
        }
        catch (err) {
            console.error(`[PageSummarizer] Failed to batch write pages to KB (batch ${i / batchSize + 1}):`, err);
        }
    }
}
/**
 * Summarize a page and return a full PageSummary object.
 * Combines summarizePage() + parseSummaryFields().
 */
async function summarizeAndParsePage(url, title, rawContent, category) {
    const summaryText = await summarizePage(title, rawContent);
    const fields = parseSummaryFields(summaryText, title);
    return {
        url,
        title,
        category,
        ...fields,
        crawledAt: new Date().toISOString(),
    };
}
