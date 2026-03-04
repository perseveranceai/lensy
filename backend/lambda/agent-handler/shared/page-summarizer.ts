/**
 * Shared Page Summarizer — used by both Doc Audit and GitHub Issues modes
 * to build and query the Page Knowledge Base (DynamoDB).
 *
 * Provides:
 * - summarizePage(): Haiku-powered structured summary of a doc page
 * - parseSummaryFields(): Extract structured fields from Haiku output
 * - writePageToKB() / queryKB(): DynamoDB read/write for page knowledge base
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { invokeBedrockModel } from './bedrock-helpers';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const PAGE_KB_TABLE = process.env.PAGE_KB_TABLE || '';

const HAIKU_MODEL_ID = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

// ─── Types ───────────────────────────────────────────────────

export type DocumentationType =
    | 'api-reference'
    | 'tutorial'
    | 'conceptual'
    | 'how-to'
    | 'reference'
    | 'troubleshooting'
    | 'overview'
    | 'changelog'
    | 'mixed';

export interface PageSummary {
    url: string;
    title: string;
    category?: string;
    documentationType?: DocumentationType;
    topic: string;
    keyTerms: string[];
    covers: string[];
    codeExamples: string;
    limitations: string;
    crawledAt: string;
}

export interface KBPageEntry extends PageSummary {
    domain: string;
    source: 'doc-audit' | 'github-issues';
    expiresAt: number; // TTL: epoch seconds
}

// ─── Summarization ───────────────────────────────────────────

/**
 * Use Haiku to generate a structured summary of a documentation page.
 * Returns the raw Haiku output text (parse with parseSummaryFields()).
 */
export async function summarizePage(title: string, rawContent: string): Promise<string> {
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
        const response = await invokeBedrockModel(prompt, {
            modelId: HAIKU_MODEL_ID,
            maxTokens: 1000,
            temperature: 0.1,
        });
        return response || buildFallbackSummary(title);
    } catch (err) {
        console.error(`[PageSummarizer] Summarization failed for "${title}":`, err);
        return buildFallbackSummary(title);
    }
}

function buildFallbackSummary(title: string): string {
    return `DOC TYPE: mixed\nTOPIC: ${title}\nKEY TERMS: ${title}\nCOVERS:\n- Page content\nCODE EXAMPLES: Unknown\nLIMITATIONS: None noted`;
}

/**
 * Parse structured fields from Haiku summarization output.
 */
export function parseSummaryFields(text: string, title: string): Pick<PageSummary, 'documentationType' | 'topic' | 'keyTerms' | 'covers' | 'codeExamples' | 'limitations'> {
    // Parse documentationType
    const docTypeRaw = text.match(/^DOC TYPE:\s*(.+)$/m)?.[1]?.trim()?.toLowerCase();
    const validDocTypes: DocumentationType[] = ['api-reference', 'tutorial', 'conceptual', 'how-to', 'reference', 'troubleshooting', 'overview', 'changelog', 'mixed'];
    const documentationType = validDocTypes.includes(docTypeRaw as DocumentationType)
        ? (docTypeRaw as DocumentationType)
        : undefined;

    const topic = text.match(/^TOPIC:\s*(.+)$/m)?.[1]?.trim() || `Documentation page: ${title}`;
    const keyTermsRaw = text.match(/^KEY TERMS:\s*(.+)$/m)?.[1]?.trim() || title;
    const keyTerms = keyTermsRaw.split(',').map((s: string) => s.trim()).filter(Boolean);

    const coversSection = text.match(/^COVERS:\n((?:[-*]\s*.+\n?)*)/m)?.[1] || '';
    const covers = coversSection
        .split('\n')
        .map((l: string) => l.replace(/^[-*]\s*/, '').trim())
        .filter((l: string) => l.length > 0);

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
 */
export function deriveSafeDomain(urlString: string): string {
    try {
        const urlObj = new URL(urlString);
        return urlObj.hostname
            .replace(/^www\./, '')
            .replace(/\./g, '-');
    } catch {
        return urlString.replace(/[^a-zA-Z0-9-]/g, '-');
    }
}

/**
 * Query all page summaries for a domain from the Knowledge Base.
 */
export async function queryKB(domain: string): Promise<KBPageEntry[]> {
    if (!PAGE_KB_TABLE) {
        console.log('[PageSummarizer] PAGE_KB_TABLE not set, skipping KB query');
        return [];
    }

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: PAGE_KB_TABLE,
            KeyConditionExpression: '#domain = :domain',
            ExpressionAttributeNames: { '#domain': 'domain' },
            ExpressionAttributeValues: { ':domain': domain },
        }));

        return (result.Items || []) as KBPageEntry[];
    } catch (err) {
        console.error(`[PageSummarizer] Failed to query KB for domain ${domain}:`, err);
        return [];
    }
}

/**
 * Write a single page summary to the Knowledge Base.
 */
export async function writePageToKB(
    domain: string,
    page: PageSummary,
    source: 'doc-audit' | 'github-issues'
): Promise<void> {
    if (!PAGE_KB_TABLE) {
        console.log('[PageSummarizer] PAGE_KB_TABLE not set, skipping KB write');
        return;
    }

    try {
        await docClient.send(new PutCommand({
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
    } catch (err) {
        console.error(`[PageSummarizer] Failed to write page ${page.url} to KB:`, err);
    }
}

/**
 * Write multiple page summaries to the Knowledge Base in batches of 25.
 */
export async function writePagesToKB(
    domain: string,
    pages: PageSummary[],
    source: 'doc-audit' | 'github-issues'
): Promise<void> {
    if (!PAGE_KB_TABLE || pages.length === 0) return;

    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400;
    const batchSize = 25;

    for (let i = 0; i < pages.length; i += batchSize) {
        const batch = pages.slice(i, i + batchSize);
        try {
            await docClient.send(new BatchWriteCommand({
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
        } catch (err) {
            console.error(`[PageSummarizer] Failed to batch write pages to KB (batch ${i / batchSize + 1}):`, err);
        }
    }
}

/**
 * Summarize a page and return a full PageSummary object.
 * Combines summarizePage() + parseSummaryFields().
 */
export async function summarizeAndParsePage(
    url: string,
    title: string,
    rawContent: string,
    category?: string
): Promise<PageSummary> {
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
