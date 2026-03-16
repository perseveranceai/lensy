import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'crypto';
import { readSessionArtifact, writeSessionArtifact, readFromS3, writeToS3, ANALYSIS_BUCKET } from '../shared/s3-helpers';
import { invokeBedrockModel, getModelId, bedrockClient } from '../shared/bedrock-helpers';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { createProgressHelper } from './publish-progress';

/**
 * Tool 5: Analyze Dimensions
 * Ported from: dimension-analyzer/index.ts (920 lines)
 *
 * Performs 5-dimension documentation quality analysis (relevance, freshness, clarity, accuracy, completeness)
 * using PARALLEL Bedrock calls. Supports content-type-aware weighting, spelling issue detection,
 * terminology inconsistency detection, code issue detection, URL slug penalty, and DynamoDB caching.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DocumentationType =
    | 'api-reference'
    | 'tutorial'
    | 'conceptual'
    | 'how-to'
    | 'reference'
    | 'troubleshooting'
    | 'overview'
    | 'changelog'
    | 'product-guide'
    | 'mixed';

type DimensionType = 'relevance' | 'freshness' | 'clarity' | 'accuracy' | 'completeness';

interface ContentTypeWeights {
    relevance: number;
    freshness: number;
    clarity: number;
    accuracy: number;
    completeness: number;
}

interface Recommendation {
    priority: 'high' | 'medium' | 'low';
    action: string;
    location?: string;
    impact: string;
    evidence?: string;
    codeExample?: string;
    mediaReference?: string;
}

interface SpellingIssue {
    incorrect: string;
    correct: string;
    context: string;
}

interface TerminologyInconsistency {
    variants: string[];
    recommendation: string;
}

interface CodeIssue {
    type: string;
    location: string;
    description: string;
    codeFragment: string;
}

interface DimensionResult {
    dimension: DimensionType;
    score: number | null;
    originalScore?: number;
    contentTypeWeight?: number;
    contentType?: DocumentationType;
    status: 'complete' | 'failed' | 'timeout' | 'retrying';
    findings: string[];
    recommendations: Recommendation[];
    failureReason?: string;
    retryCount: number;
    processingTime: number;
    spellingIssues?: SpellingIssue[];
    codeIssues?: CodeIssue[];
    terminologyInconsistencies?: TerminologyInconsistency[];
}

// ---------------------------------------------------------------------------
// Content-type-specific scoring weights (must sum to 1.0)
// ---------------------------------------------------------------------------

const CONTENT_TYPE_WEIGHTS: Record<DocumentationType, ContentTypeWeights> = {
    'api-reference': {
        relevance: 0.15,
        freshness: 0.25,
        clarity: 0.20,
        accuracy: 0.30,
        completeness: 0.10
    },
    'tutorial': {
        relevance: 0.20,
        freshness: 0.20,
        clarity: 0.30,
        accuracy: 0.20,
        completeness: 0.10
    },
    'conceptual': {
        relevance: 0.25,
        freshness: 0.10,
        clarity: 0.35,
        accuracy: 0.20,
        completeness: 0.10
    },
    'how-to': {
        relevance: 0.25,
        freshness: 0.15,
        clarity: 0.25,
        accuracy: 0.25,
        completeness: 0.10
    },
    'overview': {
        relevance: 0.30,
        freshness: 0.15,
        clarity: 0.30,
        accuracy: 0.15,
        completeness: 0.10
    },
    'reference': {
        relevance: 0.15,
        freshness: 0.20,
        clarity: 0.20,
        accuracy: 0.35,
        completeness: 0.10
    },
    'troubleshooting': {
        relevance: 0.25,
        freshness: 0.20,
        clarity: 0.25,
        accuracy: 0.25,
        completeness: 0.05
    },
    'changelog': {
        relevance: 0.20,
        freshness: 0.35,
        clarity: 0.20,
        accuracy: 0.20,
        completeness: 0.05
    },
    'product-guide': {
        relevance: 0.20,
        freshness: 0.15,
        clarity: 0.35,
        accuracy: 0.20,
        completeness: 0.10
    },
    'mixed': {
        relevance: 0.20,
        freshness: 0.20,
        clarity: 0.25,
        accuracy: 0.25,
        completeness: 0.10
    }
};

const DIMENSIONS: DimensionType[] = ['relevance', 'freshness', 'clarity', 'accuracy', 'completeness'];

// ---------------------------------------------------------------------------
// Module-level DynamoDB client
// ---------------------------------------------------------------------------

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

// ---------------------------------------------------------------------------
// URL normalization & cache key helpers
// ---------------------------------------------------------------------------

function normalizeUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        urlObj.hash = '';
        const params = new URLSearchParams(urlObj.search);
        const sortedParams = new URLSearchParams();
        Array.from(params.keys()).sort().forEach(key => {
            sortedParams.set(key, params.get(key) || '');
        });
        urlObj.search = sortedParams.toString();
        if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
            urlObj.pathname = urlObj.pathname.slice(0, -1);
        }
        urlObj.hostname = urlObj.hostname.toLowerCase();
        return urlObj.toString();
    } catch (error) {
        console.warn('Failed to normalize URL, using original:', url);
        return url;
    }
}

/**
 * Generate consistent session ID based on URL and context setting.
 * Must match the function in URL processor exactly.
 */
function generateConsistentSessionId(url: string, contextualSetting: string): string {
    const normalizedUrl = normalizeUrl(url);
    const input = `${normalizedUrl}#${contextualSetting}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return `session-${hash.substring(0, 12)}`;
}

// ---------------------------------------------------------------------------
// DynamoDB dimension cache — check
// ---------------------------------------------------------------------------

async function checkDimensionCache(
    bucketName: string,
    processedContent: any,
    contextualSetting: string,
    _selectedModel: string
): Promise<Record<DimensionType, DimensionResult> | null> {
    try {
        const tableName = process.env.PROCESSED_CONTENT_TABLE;
        if (!tableName) {
            console.log('No cache table configured, skipping dimension cache check');
            return null;
        }

        const cleanUrl = normalizeUrl(processedContent.url);

        const response = await dynamoClient.send(new GetItemCommand({
            TableName: tableName,
            Key: marshall({
                url: cleanUrl,
                contextualSetting: contextualSetting
            })
        }));

        if (!response.Item) {
            console.log('No cache entry found for dimension analysis');
            return null;
        }

        const cacheEntry = unmarshall(response.Item);
        console.log('Found cache entry, checking for dimension results...');

        const contentS3Path = cacheEntry.s3Location; // e.g. sessions/session-abc123/processed-content.json
        const sessionPath = contentS3Path.replace('/processed-content.json', '');
        const dimensionS3Path = `${sessionPath}/dimension-results.json`;

        try {
            const dimensionResults = await readFromS3<Record<DimensionType, DimensionResult>>(
                bucketName,
                dimensionS3Path
            );

            if (dimensionResults) {
                console.log(`Found cached dimension results at: ${dimensionS3Path}`);
                return dimensionResults;
            }
            console.log(`No cached dimension results found at: ${dimensionS3Path}`);
            return null;
        } catch (s3Error) {
            console.log(`No cached dimension results found at: ${dimensionS3Path}`);
            return null;
        }
    } catch (error) {
        console.error('Error checking dimension cache:', error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// DynamoDB dimension cache — store
// ---------------------------------------------------------------------------

async function cacheDimensionResults(
    bucketName: string,
    processedContent: any,
    contextualSetting: string,
    _selectedModel: string,
    dimensionResults: Record<DimensionType, DimensionResult>
): Promise<void> {
    try {
        const consistentSessionId = generateConsistentSessionId(processedContent.url, contextualSetting);
        const dimensionS3Path = `sessions/${consistentSessionId}/dimension-results.json`;

        await writeToS3(bucketName, dimensionS3Path, dimensionResults);

        console.log(`Cached dimension results at: ${dimensionS3Path}`);
    } catch (error) {
        console.error('Failed to cache dimension results:', error);
        // Don't throw — caching failure shouldn't break the main flow
    }
}

// ---------------------------------------------------------------------------
// Pre-computed structural signals — objective metrics for prompt anchoring
// ---------------------------------------------------------------------------

interface StructuralSignals {
    headingCount: number;
    maxHeadingDepth: number;
    headingHierarchyValid: boolean;
    sectionCount: number;
    avgSectionWordCount: number;
    maxSectionWordCount: number;

    paragraphCount: number;
    listItemCount: number;
    tableCount: number;
    structureRatio: number;

    codeBlockCount: number;
    codeBlocksWithLangTag: number;

    internalLinkCount: number;
    externalLinkCount: number;

    hasTldrOrSummary: boolean;
    frontLoadedAnswer: boolean;
    avgParagraphLength: number;
    longParagraphCount: number;
    definedTermCount: number;
    totalWordCount: number;
}

function computeStructuralSignals(processedContent: any): StructuralSignals {
    const md: string = processedContent.markdownContent || '';
    const pageUrl: string = processedContent.url || '';

    // --- Headings ---
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings: { level: number; text: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = headingRegex.exec(md)) !== null) {
        headings.push({ level: match[1].length, text: match[2].trim() });
    }
    const headingCount = headings.length;
    const maxHeadingDepth = headings.length > 0 ? Math.max(...headings.map(h => h.level)) : 0;

    // Check hierarchy validity (no skipped levels, e.g., h1 → h3 with no h2)
    let headingHierarchyValid = true;
    const levelsUsed = new Set(headings.map(h => h.level));
    if (levelsUsed.size > 1) {
        const sorted = Array.from(levelsUsed).sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] - sorted[i - 1] > 1) {
                headingHierarchyValid = false;
                break;
            }
        }
    }

    // --- Sections (text between headings) ---
    const sectionSplits = md.split(/^#{1,6}\s+/m).filter(s => s.trim().length > 0);
    const sectionWordCounts = sectionSplits.map(s => s.split(/\s+/).filter(Boolean).length);
    const sectionCount = sectionSplits.length;
    const avgSectionWordCount = sectionCount > 0
        ? Math.round(sectionWordCounts.reduce((a, b) => a + b, 0) / sectionCount)
        : 0;
    const maxSectionWordCount = sectionWordCounts.length > 0 ? Math.max(...sectionWordCounts) : 0;

    // --- Strip code blocks for paragraph/list analysis ---
    const mdNoCode = md.replace(/```[\s\S]*?```/g, '');

    // --- Paragraphs ---
    const paragraphs = mdNoCode.split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0 && !p.startsWith('#') && !p.startsWith('|') && !p.match(/^[-*+]\s|^\d+\.\s/));
    const paragraphCount = paragraphs.length;
    const paragraphWordCounts = paragraphs.map(p => p.split(/\s+/).filter(Boolean).length);
    const avgParagraphLength = paragraphCount > 0
        ? Math.round(paragraphWordCounts.reduce((a, b) => a + b, 0) / paragraphCount)
        : 0;
    const longParagraphCount = paragraphWordCounts.filter(wc => wc > 150).length;

    // --- Lists ---
    const listItemRegex = /^[\s]*[-*+]\s|^[\s]*\d+\.\s/gm;
    const listItemCount = (mdNoCode.match(listItemRegex) || []).length;

    // --- Tables ---
    const tableRowRegex = /^\|.+\|$/gm;
    const tableRows = (mdNoCode.match(tableRowRegex) || []).length;
    // Estimate table count: groups of consecutive table rows separated by non-table lines
    const tableCount = processedContent.mediaElements?.filter?.((m: any) => m.type === 'table')?.length
        || (tableRows > 0 ? Math.max(1, Math.floor(tableRows / 3)) : 0);

    // --- Structure ratio ---
    const totalBlocks = paragraphCount + listItemCount + tableCount;
    const structureRatio = totalBlocks > 0 ? (listItemCount + tableCount) / totalBlocks : 0;

    // --- Code blocks ---
    const codeBlockRegex = /```(\w*)/g;
    let codeBlockCount = 0;
    let codeBlocksWithLangTag = 0;
    while ((match = codeBlockRegex.exec(md)) !== null) {
        codeBlockCount++;
        if (match[1] && match[1].length > 0) {
            codeBlocksWithLangTag++;
        }
    }

    // --- Links ---
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let internalLinkCount = 0;
    let externalLinkCount = 0;
    let pageDomain = '';
    try { pageDomain = new URL(pageUrl).hostname; } catch { /* ignore */ }
    while ((match = linkRegex.exec(md)) !== null) {
        const href = match[2];
        if (href.startsWith('#') || href.startsWith('/') || (pageDomain && href.includes(pageDomain))) {
            internalLinkCount++;
        } else if (href.startsWith('http')) {
            externalLinkCount++;
        }
    }

    // --- TL;DR / Summary detection ---
    const firstHeading = headings.length > 0 ? headings[0].text.toLowerCase() : '';
    const hasTldrOrSummary = /summary|overview|tl;?dr|introduction|at a glance|quick start/i.test(firstHeading);

    // --- Front-loaded answer ---
    const firstParagraph = paragraphs.length > 0 ? paragraphs[0].toLowerCase() : '';
    const pageTitle = (processedContent.title || '').toLowerCase();
    const titleWords = pageTitle.split(/\s+/).filter((w: string) => w.length > 3);
    const frontLoadedAnswer = titleWords.length > 0 && titleWords.some((w: string) => firstParagraph.includes(w));

    // --- Defined terms (bold-colon pattern: **Term**: definition) ---
    const definedTermRegex = /\*\*[^*]+\*\*\s*[:–—]/g;
    const definedTermCount = (md.match(definedTermRegex) || []).length;

    // --- Total word count ---
    const totalWordCount = md.split(/\s+/).filter(Boolean).length;

    return {
        headingCount,
        maxHeadingDepth,
        headingHierarchyValid,
        sectionCount,
        avgSectionWordCount,
        maxSectionWordCount,
        paragraphCount,
        listItemCount,
        tableCount,
        structureRatio,
        codeBlockCount,
        codeBlocksWithLangTag,
        internalLinkCount,
        externalLinkCount,
        hasTldrOrSummary,
        frontLoadedAnswer,
        avgParagraphLength,
        longParagraphCount,
        definedTermCount,
        totalWordCount,
    };
}

// ---------------------------------------------------------------------------
// Calibrated scoring rubric
// ---------------------------------------------------------------------------

const SCORING_RUBRIC = `
CALIBRATED SCORING RUBRIC — You MUST use this rubric. Scores MUST differentiate.

95-100: EXEMPLARY. Zero issues found. Could serve as a model for other pages.
        Use this score ONLY if you genuinely cannot find a single improvement.
80-94:  GOOD. Minor issues that most readers would not notice.
        Solid fundamentals, small polish items only.
60-79:  ADEQUATE. Noticeable gaps or structural issues that affect usability.
        A competent reader can work around them but should not have to.
40-59:  NEEDS WORK. Significant problems that impede comprehension or
        make the page unreliable. Multiple sections need revision.
20-39:  POOR. Major structural or content failures. The page fails its
        primary purpose for most readers.
0-19:   BROKEN. The page is fundamentally unusable.

ANTI-CLUSTERING RULES:
- You MUST NOT score between 80-89 by default. Justify any score in that range.
- If MEASURED FACTS show issues (e.g., structureRatio < 0.1, no headings,
  long paragraphs), the score MUST reflect them — not be explained away.
- Anchor your score to MEASURED FACTS first, then adjust for content quality.
`;

// ---------------------------------------------------------------------------
// Content-type-aware scoring weights
// ---------------------------------------------------------------------------

function applyContentTypeWeights(
    dimensionResults: Record<DimensionType, DimensionResult>,
    contentType: DocumentationType
): Record<DimensionType, DimensionResult> {
    const weights = CONTENT_TYPE_WEIGHTS[contentType];
    const weightedResults = { ...dimensionResults };

    Object.keys(weightedResults).forEach(dimension => {
        const dim = dimension as DimensionType;
        const result = weightedResults[dim];

        if (result.score !== null) {
            result.originalScore = result.score;
            result.contentTypeWeight = weights[dim];
            result.contentType = contentType;

            result.findings.unshift(`Content type: ${contentType} (weight: ${Math.round(weights[dim] * 100)}%)`);
        }
    });

    console.log(`Applied weights for ${contentType}:`, weights);
    return weightedResults;
}

// ---------------------------------------------------------------------------
// Single dimension analysis via Bedrock
// ---------------------------------------------------------------------------

async function analyzeDimension(
    dimension: DimensionType,
    processedContent: any,
    selectedModel: string,
    signals: StructuralSignals
): Promise<DimensionResult> {
    const prompt = buildPromptForDimension(dimension, processedContent, signals);
    const modelId = getModelId(selectedModel);

    // Different models use different API formats
    let requestBody: any;
    let responseParser: (responseBody: any) => string;

    if (selectedModel === 'llama') {
        requestBody = {
            prompt: prompt,
            max_gen_len: 2000,
            temperature: 0.1,
            top_p: 0.9
        };
        responseParser = (responseBody) => responseBody.generation;
    } else if (selectedModel === 'titan') {
        requestBody = {
            inputText: prompt,
            textGenerationConfig: {
                maxTokenCount: 2000,
                temperature: 0.1,
                topP: 0.9
            }
        };
        responseParser = (responseBody) => responseBody.results[0].outputText;
    } else {
        // Claude uses Messages API format
        requestBody = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2000,
            temperature: 0.1,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ]
        };
        responseParser = (responseBody) => responseBody.content[0].text;
    }

    const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody)
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const textContent = responseParser(responseBody);

    // Parse JSON from the response
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    return {
        dimension,
        score: analysis.score,
        status: 'complete',
        findings: analysis.findings || [],
        recommendations: analysis.recommendations || [],
        retryCount: 0,
        processingTime: 0, // Will be set by caller
        spellingIssues: analysis.spellingIssues,
        codeIssues: analysis.codeIssues,
        terminologyInconsistencies: analysis.terminologyInconsistencies
    };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPromptForDimension(dimension: DimensionType, processedContent: any, signals: StructuralSignals): string {
    const contentType = (processedContent.contentType as DocumentationType) || 'mixed';
    const weights = CONTENT_TYPE_WEIGHTS[contentType];
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const baseContext = `
Analysis Date: ${today}
URL: ${processedContent.url}
Content Type: ${contentType} (${dimension} weight: ${Math.round(weights[dimension] * 100)}%)

PAGE CONTENT:
${processedContent.markdownContent?.slice(0, 50000) || ''}
`;

    // Context analysis information — with rich KB data when available
    let contextInfo = '';
    if (processedContent.contextAnalysis && processedContent.contextAnalysis.contextPages?.length > 0) {
        const hasKBData = processedContent.contextAnalysis.contextPages.some((page: any) => page.topic);

        if (hasKBData) {
            contextInfo = `
KNOWLEDGE BASE — RELATED PAGES:
The following pages are linked from or related to the target page. Each entry shows
what that page covers, based on prior analysis.

${processedContent.contextAnalysis.contextPages.map((page: any) => {
    if (page.topic) {
        return `- ${page.relationship.toUpperCase()}: "${page.title}" [${page.url}]
  Type: ${page.documentationType || 'unknown'}
  Topic: ${page.topic}
  Covers: ${page.covers?.join(', ') || 'unknown'}
  Code Examples: ${page.codeExamples || 'None'}`;
    } else {
        return `- ${page.relationship.toUpperCase()}: "${page.title}" [${page.url}]
  (No detailed analysis available for this page)`;
    }
}).join('\n\n')}

GROUNDING RULES FOR RECOMMENDATIONS:
1. Before recommending "add X" to this page, CHECK the Knowledge Base above.
   If a related page already covers X, do NOT recommend adding it here.
2. Instead, evaluate whether the TARGET PAGE adequately LINKS TO or REFERENCES
   that related page.
3. Frame recommendations as structural, not additive:
   WRONG: "Add version compatibility information and system requirements"
   RIGHT: "Version info is covered on the linked 'Current Releases' page.
          Consider adding a cross-reference link or brief summary pointer."
4. If the target page is a TOC/overview, evaluate navigation completeness —
   not whether each topic is fully explained inline.
5. Always cite which related page covers the topic when deferring to it.
`;
        } else {
            contextInfo = `
CONTEXT ANALYSIS ENABLED:
Related Pages Discovered:
${processedContent.contextAnalysis.contextPages.map((page: any) =>
                `- ${page.relationship.toUpperCase()}: "${page.title}" [${page.url}]`
            ).join('\n')}

Consider this broader documentation context when evaluating the target page.
`;
        }
    } else {
        contextInfo = `
CONTEXT ANALYSIS: Single page analysis (no related pages discovered)
`;
    }

    const contentTypeGuidance = getContentTypeGuidance(contentType, dimension);

    const constraints = `
CONSTRAINTS:
- Only reference issues observable in the provided content above.
- Do NOT suggest checking console errors, network requests, runtime behavior, or browser developer tools.
- Do NOT recommend actions that require running code, visiting the page, or testing interactively.
- This system analyzes static HTML content only. All recommendations must be actionable from the content alone.
- Every recommendation MUST include an "evidence" field with an exact quote or specific element from the content that triggered it.
- Every finding MUST reference a specific section heading or content area — no generic praise.`;

    const jsonFormat = `
Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1 — must reference specific section", "finding 2"],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action referencing a section or element",
      "impact": "expected impact on readers and AI consumers",
      "evidence": "exact quote or element from content that triggered this",
      "location": "heading or section where the issue appears"
    }
  ]
}`;

    const jsonFormatClarity = `
Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1 — must reference specific section", "finding 2"],
  "spellingIssues": [
    {"incorrect": "word", "correct": "word", "context": "surrounding text snippet"}
  ],
  "terminologyInconsistencies": [
    {"variants": ["term1", "term2"], "recommendation": "Use 'term1' consistently"}
  ],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action referencing a section or element",
      "impact": "expected impact on readers and AI consumers",
      "evidence": "exact quote or element from content that triggered this",
      "location": "heading or section where the issue appears"
    }
  ]
}`;

    const jsonFormatAccuracy = `
Respond in JSON format:
{
  "score": 0-100,
  "findings": ["finding 1 — must reference specific section", "finding 2"],
  "codeIssues": [
    {
      "type": "json-syntax|config-incomplete|missing-import|other",
      "location": "description of location",
      "description": "what is wrong",
      "codeFragment": "snippet"
    }
  ],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action referencing a section or element",
      "impact": "expected impact on readers and AI consumers",
      "evidence": "exact quote or element from content that triggered this",
      "location": "heading or section where the issue appears"
    }
  ]
}`;

    const dimensionPrompts: Record<DimensionType, string> = {
        relevance: `Analyze the STRUCTURE & PARSABILITY of this documentation page.

${baseContext}
${contextInfo}

MEASURED FACTS (computed from the page — do NOT dispute these numbers):
- Heading count: ${signals.headingCount}
- Max heading depth: H${signals.maxHeadingDepth || 'none'}
- Heading hierarchy valid (no skipped levels): ${signals.headingHierarchyValid}
- Section count: ${signals.sectionCount}
- Avg section word count: ${signals.avgSectionWordCount}
- Max section word count: ${signals.maxSectionWordCount}
- Structure ratio (lists+tables / total blocks): ${signals.structureRatio.toFixed(2)}
- Table count: ${signals.tableCount}
- Total word count: ${signals.totalWordCount}

CONTENT TYPE GUIDANCE: ${contentTypeGuidance}

HUMAN LENS — evaluate:
1. Does the heading hierarchy create a logical outline? Cite any skipped heading levels
   (e.g., "jumps from H2 to H4 under 'Authentication Methods'").
2. Are sections balanced in length, or are some bloated while others are stubs?
   Name the longest section (${signals.maxSectionWordCount} words) and whether it should be split.
3. Can a reader find what they need from headings alone (without reading body text)?
4. Does the page follow consistent structural patterns (e.g., every method has same
   subsections like Parameters/Returns/Example)?

AI/LLM LENS — evaluate:
5. Could an LLM retrieve a single section and have it make sense without the rest
   of the page? (self-contained sections for RAG retrieval)
6. Are sections chunked at appropriate granularity for AI retrieval (300-800 words ideal)?
   Sections over 800 words should be flagged.
7. Does each heading accurately describe its section content? (heading-content alignment)
8. Are there consistent patterns an LLM could learn to parse?

SCORING ANCHORS (apply these BEFORE subjective assessment):
- headingCount == 0 → score CANNOT exceed 50
- headingHierarchyValid == false → deduct 10 points
- maxSectionWordCount > 1000 → deduct 5 points (bloated section)
- avgSectionWordCount < 50 → deduct 5 points (stub sections)

${SCORING_RUBRIC}
${constraints}
${jsonFormat}`,

        freshness: `Analyze the FRESHNESS & CURRENCY of this documentation page.

${baseContext}
${contextInfo}

MEASURED FACTS:
- Code blocks found: ${signals.codeBlockCount}
- Code blocks with language tags: ${signals.codeBlocksWithLangTag}
- Version-referencing snippets: ${processedContent.codeSnippets?.filter((s: any) => s.hasVersionInfo).length || 0}
- Analysis date: ${today}

Code Snippets with Version Info:
${processedContent.codeSnippets?.filter((s: any) => s.hasVersionInfo).map((s: any) => s.code.slice(0, 200)).join('\n---\n') || 'None'}

CONTENT TYPE GUIDANCE: ${contentTypeGuidance}

HUMAN LENS — evaluate:
1. Does the page reference specific version numbers? LIST EACH ONE found and whether
   it appears current as of ${today}. If none found, flag as a major gap.
2. Are there deprecated APIs, methods, or patterns in code examples? NAME each one
   with the specific code block where it appears.
3. Does the page contain date markers ("last updated", "since v3.2", "added in 2024")?
   If none, flag as "no temporal signals."
4. Are there references to technologies or standards that have been superseded?
   Name each with its modern replacement.

AI/LLM LENS — evaluate:
5. Would an LLM trained on current data produce DIFFERENT answers than what this page
   shows? Identify specific areas of conflict risk.
6. Are version constraints explicit enough that an LLM could determine applicability?
   (e.g., "Works with Node 18+" is good; "Works with Node" is vague)
7. Could an LLM distinguish current vs. legacy content on this page, or are they mixed
   without clear markers?

SCORING ANCHORS:
- No version numbers or dates found anywhere → score CANNOT exceed 60
- Deprecated patterns found without deprecation notice → deduct 10 per instance
- No "last updated" or temporal marker → deduct 5 points

IMPORTANT: Today's date is ${today}. Do NOT flag dates as "future-dated" if they are on or before today.

${SCORING_RUBRIC}
${constraints}
${jsonFormat}`,

        clarity: `Analyze the CLARITY & SCANNABILITY of this documentation page.

${baseContext}
${contextInfo}

MEASURED FACTS (computed from the page — do NOT dispute these numbers):
- Average paragraph length: ${signals.avgParagraphLength} words
- Long paragraphs (>150 words): ${signals.longParagraphCount}
- List items: ${signals.listItemCount}
- Table count: ${signals.tableCount}
- Structure ratio (lists+tables / total blocks): ${signals.structureRatio.toFixed(2)}
- Has TL;DR or summary at top: ${signals.hasTldrOrSummary}
- Front-loaded answer: ${signals.frontLoadedAnswer}
- Defined terms (bold-colon pattern): ${signals.definedTermCount}
- Total word count: ${signals.totalWordCount}

CONTENT TYPE GUIDANCE: ${contentTypeGuidance}

HUMAN LENS — evaluate:
1. SPELLING & TYPOS: Scan the ENTIRE content. List every misspelled word with surrounding context.
2. TERMINOLOGY CONSISTENCY: Are the same concepts called different names?
   (e.g., "Agent" vs "Bot", "endpoint" vs "route") List each pair found.
3. SCANNABILITY: Can a reader get the key takeaway from each section in under
   10 seconds? If not, NAME which sections are wall-of-text.
4. VISUAL HIERARCHY: Are lists, tables, and callouts used where they would
   improve comprehension? Name specific paragraphs that SHOULD be tables or lists.
5. PROGRESSIVE DISCLOSURE: Does the page front-load the most important information,
   or bury it after background context?

AI/LLM LENS — evaluate:
6. Are key facts expressed as structured data (tables, lists, key-value pairs)
   rather than buried in prose? An LLM extracts facts from tables far more
   reliably than from mid-paragraph mentions.
7. Does the page use consistent formatting patterns (bold for terms, code font
   for values) that help an LLM distinguish identifiers from prose?
8. Are there ambiguous pronouns ("it", "this", "that") that would confuse an LLM
   parsing a single section out of context?

SCORING ANCHORS (apply these BEFORE subjective assessment):
- structureRatio < 0.10 → score CANNOT exceed 65 (all prose, no structured elements)
- avgParagraphLength > 120 words → deduct 10 points (wall-of-text)
- longParagraphCount > 3 → deduct 5 points per additional long paragraph beyond 3
- hasTldrOrSummary == false AND totalWordCount > 500 → deduct 5 points
- Each spelling error found → deduct 2 points

${SCORING_RUBRIC}
${constraints}
${jsonFormatClarity}`,

        accuracy: `Analyze the ACCURACY & CODE VALIDITY of this documentation page.

${baseContext}
${contextInfo}

MEASURED FACTS:
- Code blocks: ${signals.codeBlockCount}
- Code blocks with language tags: ${signals.codeBlocksWithLangTag} (${signals.codeBlockCount > 0 ? Math.round((signals.codeBlocksWithLangTag / signals.codeBlockCount) * 100) : 'N/A'}%)
- Languages detected: ${processedContent.codeSnippets?.map((s: any) => s.language).filter(Boolean).join(', ') || 'None'}

IMPORTANT: Today's date is ${today}. Do NOT flag dates as "future-dated" if they are on or before today.

Code Snippets:
${processedContent.codeSnippets?.map((s: any) => `Language: ${s.language}\n${s.code.slice(0, 300)}`).join('\n---\n') || 'None'}

CONTENT TYPE GUIDANCE: ${contentTypeGuidance}

HUMAN LENS — evaluate:
1. CODE SYNTAX: Are code examples syntactically valid? Check for:
   - Missing semicolons, unclosed brackets, wrong method signatures
   - JSON with trailing commas or unquoted keys
   - Shell commands with wrong flags or nonexistent subcommands
   Name each issue with the EXACT code fragment.
2. PLACEHOLDER MARKING: Are placeholder values (API keys, URLs, tokens) clearly
   marked with angle brackets, ALL_CAPS, or explicit labels?
   List any bare placeholders like "abc123" that look like real values.
3. CONFIGURATION COMPLETENESS: Are config examples complete enough to actually use?
   Or are critical fields omitted (auth, required headers, environment variables)?
4. API ACCURACY: Do described parameters, return types, and endpoints match
   the code examples shown?

AI/LLM LENS — evaluate:
5. CODE LANGUAGE TAGS: Do code blocks have language identifiers?
   (${signals.codeBlocksWithLangTag}/${signals.codeBlockCount} tagged)
   Untagged blocks are harder for LLMs to interpret correctly.
6. COPY-PASTE READINESS: Could an LLM extract a code example and produce a working
   snippet? Or are there implicit imports, missing context, or assumed setup steps?
7. Are code examples self-contained (have imports, variable declarations) or do they
   assume context from previous examples on the page?

SCORING ANCHORS:
- codeBlockCount > 0 AND codeBlocksWithLangTag/codeBlockCount < 0.5 → deduct 10 points
- Each confirmed syntax error in code → deduct 5 points
- Bare placeholders (look like real values) → deduct 3 points each

${SCORING_RUBRIC}
${constraints}
${jsonFormatAccuracy}`,

        completeness: `Analyze the COMPLETENESS & SELF-CONTAINEDNESS of this documentation page.

${baseContext}
${contextInfo}

MEASURED FACTS:
- Total word count: ${signals.totalWordCount}
- Internal links: ${signals.internalLinkCount}
- External links: ${signals.externalLinkCount}
- Section count: ${signals.sectionCount}
- Defined terms (bold-colon pattern): ${signals.definedTermCount}
- Code blocks: ${signals.codeBlockCount}

Sub-pages Referenced: ${processedContent.linkAnalysis?.subPagesIdentified?.join(', ') || 'None'}

CONTENT TYPE GUIDANCE: ${contentTypeGuidance}

HUMAN LENS — evaluate:
1. PREREQUISITE GAPS: Does the page assume knowledge that it does not define or link to?
   Name each assumed concept and say whether a link exists.
2. MISSING WORKFLOW STEPS: For procedural content, are any steps missing?
   Can a reader complete the task from start to finish using only this page?
3. ERROR HANDLING: Does the page explain what to do when things go wrong?
   Are common error messages documented?
4. EDGE CASES: Does the page address boundary conditions, limitations, or
   platform-specific differences?
5. CROSS-REFERENCES: Are related pages linked where a reader would need them?
   Or does the page assume the reader knows where else to look?

AI/LLM LENS — evaluate:
6. QUERYABILITY: If a user asked an LLM "How do I [primary task of this page]?",
   would this page contain a complete answer? Or would the LLM need to combine
   this page with others?
7. CONTEXT INDEPENDENCE: Could each major section be retrieved independently
   and still provide a useful answer? Or do sections depend heavily on earlier
   sections for context?
8. GLOSSARY COVERAGE: Are technical terms defined on this page or linked to
   definitions? An LLM serving a novice user needs these definitions nearby.

SCORING ANCHORS:
- internalLinkCount == 0 → deduct 10 points (no cross-references)
- totalWordCount < 200 → deduct 10 points (stub page)
- No error handling section for procedural/how-to content → deduct 5 points

IMPORTANT: When context pages are available (KNOWLEDGE BASE section above),
do NOT recommend adding information that already exists on a linked page.
Instead, evaluate whether this page adequately cross-references that information.

${SCORING_RUBRIC}
${constraints}
${jsonFormat}`
    };

    return dimensionPrompts[dimension];
}

// ---------------------------------------------------------------------------
// Content-type-specific evaluation guidance (dual-lens)
// ---------------------------------------------------------------------------

function getContentTypeGuidance(contentType: DocumentationType, dimension: DimensionType): string {
    const guidance: Record<DocumentationType, Record<DimensionType, string>> = {
        'api-reference': {
            relevance: 'API reference (15% weight): Check if parameters, returns, and examples follow consistent, repeatable templates. AI lens: Each method section should be independently retrievable — description, parameters, returns, example, errors in every section.',
            freshness: 'API reference (25% weight): APIs change frequently. Every endpoint should show its API version. AI lens: Version constraints must be explicit enough for an LLM to determine applicability.',
            clarity: 'API reference (20% weight): Parameters need clear types and descriptions. AI lens: Tables for parameters are far more AI-parseable than inline prose descriptions.',
            accuracy: 'API reference (30% weight — CRITICAL): Wrong API info breaks developer code. Verify every parameter name, type, and return value. AI lens: Code examples must be copy-paste ready with all imports.',
            completeness: 'API reference (10% weight): Focus on core API info. AI lens: Each endpoint needs enough context to use independently without reading the full page.'
        },
        'tutorial': {
            relevance: 'Tutorial (20% weight): Must solve real developer problems with practical examples. AI lens: Steps should be numbered and self-contained for LLM extraction.',
            freshness: 'Tutorial (20% weight): Outdated tutorials mislead learners. Verify current practices and dependencies. AI lens: Dependency versions must be explicit.',
            clarity: 'Tutorial (30% weight — CRITICAL): Must be easy to follow step-by-step. AI lens: Each step should be a discrete, retrievable unit with clear input/output.',
            accuracy: 'Tutorial (20% weight): Wrong steps break the learning experience. Every code block must be runnable. AI lens: Code must include all imports and setup.',
            completeness: 'Tutorial (10% weight): Can focus on specific learning objectives. AI lens: Prerequisites must be explicitly listed, not assumed.'
        },
        'conceptual': {
            relevance: 'Conceptual (25% weight): Must address real understanding needs with clear mental models. AI lens: Concepts should be defined with explicit relationships to other concepts.',
            freshness: 'Conceptual (10% weight): Concepts change slowly. Focus on timeless principles. AI lens: Mark any time-dependent statements explicitly.',
            clarity: 'Conceptual (35% weight — CRITICAL): Must explain complex ideas clearly. AI lens: Use analogies, diagrams (described in text), and structured comparisons that an LLM can reference.',
            accuracy: 'Conceptual (20% weight): Wrong concepts mislead understanding. AI lens: Definitions must be precise enough for an LLM to use as ground truth.',
            completeness: 'Conceptual (10% weight): Can focus on specific conceptual aspects. AI lens: Each concept should be fully defined without requiring external context.'
        },
        'how-to': {
            relevance: 'How-to (25% weight): Must solve specific, real problems. AI lens: The page title should map directly to a user query an LLM would receive.',
            freshness: 'How-to (15% weight): Methods evolve. Check for current best practices. AI lens: Flag if multiple approaches are shown without indicating which is current.',
            clarity: 'How-to (25% weight): Procedural steps must be crystal clear. AI lens: Steps should be numbered, each with a single action and expected result.',
            accuracy: 'How-to (25% weight): Wrong steps break workflows. AI lens: Every command and config should be copy-paste ready with expected output shown.',
            completeness: 'How-to (10% weight): Can be task-focused. AI lens: Must include error handling for the happy path — "what to do when step X fails."'
        },
        'overview': {
            relevance: 'Overview (30% weight — CRITICAL): Must provide valuable high-level perspective. AI lens: Should serve as a navigation hub — LLMs use overviews to route users to specific pages.',
            freshness: 'Overview (15% weight): Overviews change moderately. AI lens: Links to sub-pages must be current and working.',
            clarity: 'Overview (30% weight — CRITICAL): Must be accessible to newcomers. AI lens: Should provide a mental model or taxonomy that an LLM can use to categorize sub-topics.',
            accuracy: 'Overview (15% weight): High-level accuracy important. AI lens: Summary descriptions of sub-topics must match what those pages actually contain.',
            completeness: 'Overview (10% weight): Intentionally high-level. AI lens: Every major sub-topic should be linked — an LLM needs a complete map of the doc surface.'
        },
        'reference': {
            relevance: 'Reference (15% weight): Inherently relevant to its domain. AI lens: Should be organized for lookup, not reading — tables and structured lists are essential.',
            freshness: 'Reference (20% weight): Reference data must be current. AI lens: Each entry should show its applicable version range.',
            clarity: 'Reference (20% weight): Must be scannable for quick lookup. AI lens: Key-value patterns, consistent formatting, and tables make reference docs AI-friendly.',
            accuracy: 'Reference (35% weight — CRITICAL): Must be completely accurate. AI lens: An LLM will treat reference content as authoritative — any error propagates to all AI users.',
            completeness: 'Reference (10% weight): Focus on scope coverage. AI lens: Missing entries mean an LLM cannot answer questions about those items.'
        },
        'product-guide': {
            relevance: 'Product guide (20% weight): Must help users achieve goals. AI lens: Task-oriented headings (verbs) are more queryable than feature-oriented ones (nouns).',
            freshness: 'Product guide (15% weight): Check if described UI matches current version. AI lens: UI element names must match what users see, so LLMs can give accurate instructions.',
            clarity: 'Product guide (35% weight — CRITICAL): Check for TYPOS, spelling errors, jargon. Must be crystal clear. AI lens: Instructions should reference exact UI labels in code font.',
            accuracy: 'Product guide (20% weight): Validate all commands and configs. AI lens: Every path described should be complete enough for an LLM to walk a user through it.',
            completeness: 'Product guide (10% weight): Focus on happy-path task completion. AI lens: Include "what you\'ll need" prerequisites and expected outcomes.'
        },
        'troubleshooting': {
            relevance: 'Troubleshooting (25% weight): Must address real, common problems. AI lens: Error messages should be exact strings — LLMs match on these.',
            freshness: 'Troubleshooting (20% weight): Solutions evolve. AI lens: Solutions must specify which versions they apply to.',
            clarity: 'Troubleshooting (25% weight): Problem-solution pairs must be clear. AI lens: Each problem should be a self-contained section with symptom → cause → fix.',
            accuracy: 'Troubleshooting (25% weight): Wrong solutions waste time. AI lens: Commands and fixes must be copy-paste ready.',
            completeness: 'Troubleshooting (5% weight): Can focus on specific issues. AI lens: Related issues should be cross-linked.'
        },
        'changelog': {
            relevance: 'Changelog (20% weight): Changes must be relevant to target audience. AI lens: Each entry should clearly state what changed and who it affects.',
            freshness: 'Changelog (35% weight — CRITICAL): Must be current. AI lens: Date formats should be consistent and machine-parseable.',
            clarity: 'Changelog (20% weight): Changes must be clearly categorized. AI lens: Use consistent labels (Added/Changed/Deprecated/Removed/Fixed) per keepachangelog.com.',
            accuracy: 'Changelog (20% weight): Must accurately describe changes. AI lens: Version numbers and dates must be precise.',
            completeness: 'Changelog (5% weight): Can be incremental. AI lens: Each entry should link to related docs for migration guidance.'
        },
        'mixed': {
            relevance: 'Mixed content (20% weight): Evaluate whether different content types are clearly separated. AI lens: Each section should be identifiable by type for targeted retrieval.',
            freshness: 'Mixed content (20% weight): Consider freshness needs of each section type. AI lens: Mark which sections are time-sensitive vs. evergreen.',
            clarity: 'Mixed content (25% weight): Clear organization is critical when mixing content types. AI lens: Headings should indicate content type (e.g., "Tutorial: Setting Up" vs. "Reference: API Endpoints").',
            accuracy: 'Mixed content (25% weight): Accuracy important across all sections. AI lens: Cross-references between sections must be consistent.',
            completeness: 'Mixed content (10% weight): Varied completeness needs. AI lens: Each content type section should be independently useful.'
        }
    };

    return guidance[contentType]?.[dimension] || 'Apply standard evaluation criteria for this dimension.';
}

// ---------------------------------------------------------------------------
// The LangGraph tool
// ---------------------------------------------------------------------------

export const analyzeDimensionsTool = tool(
    async (input): Promise<string> => {
        console.log('analyze_dimensions: Starting for session:', input.sessionId);

        const progress = createProgressHelper(input.sessionId);

        try {
            const bucketName = ANALYSIS_BUCKET;
            if (!bucketName) {
                throw new Error('ANALYSIS_BUCKET environment variable not set');
            }

            // ---------------------------------------------------------------
            // 1. Retrieve processed content from S3
            // ---------------------------------------------------------------
            const processedContent = await readSessionArtifact(input.sessionId, 'processed-content.json');
            if (!processedContent) {
                return JSON.stringify({
                    success: false,
                    error: 'No processed content found. Run process_url first.'
                });
            }

            console.log('Retrieved processed content from S3');

            // ---------------------------------------------------------------
            // 2. Check DynamoDB / S3 cache (if caching is enabled)
            // ---------------------------------------------------------------
            const cacheEnabled = input.cacheEnabled !== false;
            const contextualSetting = processedContent.contextAnalysis?.contextPages?.length > 0
                ? 'with-context'
                : 'without-context';

            let cachedResults: Record<DimensionType, DimensionResult> | null = null;
            if (cacheEnabled) {
                cachedResults = await checkDimensionCache(bucketName, processedContent, contextualSetting, input.selectedModel);
            } else {
                console.log('Cache disabled by user - skipping dimension cache check');
            }

            if (cachedResults) {
                console.log('Dimension analysis cache hit! Using cached results');

                await progress.cacheHit('Retrieved: 5/5 dimensions from cache');

                // Store cached results in this session's location
                await writeSessionArtifact(input.sessionId, 'dimension-results.json', cachedResults);

                // Compute summary from cached results
                return buildSummaryJson(cachedResults, input.selectedModel, true);
            }

            console.log('Dimension analysis cache miss - running fresh analysis');

            // ---------------------------------------------------------------
            // 3. Structure detection progress message
            // ---------------------------------------------------------------
            await progress.success('Structure detected: Topics identified', {
                phase: 'structure-detection'
            });

            // ---------------------------------------------------------------
            // 4. Run all 5 dimensions IN PARALLEL
            // ---------------------------------------------------------------
            console.log('Starting parallel dimension analysis...');

            // Pre-compute structural signals (pure string parsing, no LLM call)
            const structuralSignals = computeStructuralSignals(processedContent);
            console.log(JSON.stringify({
                sessionId: input.sessionId, tool: 'analyze_dimensions', event: 'structural_signals_computed',
                headingCount: structuralSignals.headingCount, sectionCount: structuralSignals.sectionCount,
                structureRatio: structuralSignals.structureRatio, codeBlockCount: structuralSignals.codeBlockCount,
                totalWordCount: structuralSignals.totalWordCount, avgParagraphLength: structuralSignals.avgParagraphLength,
            }));

            const dimensionPromises = DIMENSIONS.map(async (dimension, index) => {
                const startTime = Date.now();
                console.log(`Starting ${dimension} analysis`);

                await progress.progress(
                    `Analyzing ${dimension.charAt(0).toUpperCase() + dimension.slice(1)} (${index + 1}/5)...`,
                    'dimension-analysis',
                    { dimension }
                );

                try {
                    const result = await analyzeDimension(dimension, processedContent, input.selectedModel, structuralSignals);
                    const processingTime = Date.now() - startTime;
                    console.log(JSON.stringify({
                        sessionId: input.sessionId, tool: 'analyze_dimensions', event: 'dimension_scored',
                        dimension, score: result.score, findingCount: result.findings?.length || 0,
                        recommendationCount: result.recommendations?.length || 0, durationMs: processingTime,
                    }));

                    await progress.success(
                        `${dimension.charAt(0).toUpperCase() + dimension.slice(1)}: ${result.score}/100 (${(processingTime / 1000).toFixed(1)}s)`,
                        { dimension, score: result.score || undefined, processingTime }
                    );

                    return {
                        dimension,
                        result: { ...result, processingTime }
                    };
                } catch (error) {
                    console.error(`${dimension} failed:`, error);

                    await progress.error(
                        `${dimension.charAt(0).toUpperCase() + dimension.slice(1)} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        { dimension }
                    );

                    return {
                        dimension,
                        result: {
                            dimension,
                            score: null,
                            status: 'failed' as const,
                            findings: [],
                            recommendations: [],
                            failureReason: error instanceof Error ? error.message : 'Unknown error',
                            retryCount: 0,
                            processingTime: Date.now() - startTime
                        } as DimensionResult
                    };
                }
            });

            const results = await Promise.all(dimensionPromises);

            // ---------------------------------------------------------------
            // 5. Convert to record and apply content-type weights
            // ---------------------------------------------------------------
            const dimensionResults: Record<DimensionType, DimensionResult> = {} as any;
            results.forEach(({ dimension, result }) => {
                dimensionResults[dimension] = result;
            });

            const contentType = (processedContent.contentType as DocumentationType) || 'mixed';
            let weightedResults = applyContentTypeWeights(dimensionResults, contentType);

            // ---------------------------------------------------------------
            // 6. URL slug penalty: -5 per HIGH confidence typo (max -25)
            // ---------------------------------------------------------------
            if (processedContent.urlSlugAnalysis?.issues?.length > 0 && weightedResults.clarity) {
                const issues = processedContent.urlSlugAnalysis.issues;
                let penalty = 0;

                issues.forEach((issue: any) => {
                    if (issue.confidence === 'HIGH') penalty += 5;
                    else if (issue.confidence === 'MEDIUM') penalty += 3;
                });

                const finalPenalty = Math.min(25, penalty);

                if (finalPenalty > 0 && weightedResults.clarity.score !== null) {
                    const originalClarity = weightedResults.clarity.score;
                    weightedResults.clarity.score = Math.max(0, originalClarity - finalPenalty);

                    weightedResults.clarity.findings.push(
                        `URL slug penalty: Clarity score reduced by ${finalPenalty} points due to ${issues.length} URL slug quality issues (typos detected).`
                    );

                    console.log(`Applied URL slug penalty: -${finalPenalty} points to Clarity (from ${originalClarity} to ${weightedResults.clarity.score})`);
                }
            }

            console.log(`Applied content-type-aware weights for: ${contentType}`);
            console.log('All dimensions analyzed in parallel');

            // ---------------------------------------------------------------
            // 7. Persist results to session S3 path
            // ---------------------------------------------------------------
            await writeSessionArtifact(input.sessionId, 'dimension-results.json', weightedResults);

            // ---------------------------------------------------------------
            // 8. Cache results for future use
            // ---------------------------------------------------------------
            if (cacheEnabled) {
                await cacheDimensionResults(bucketName, processedContent, contextualSetting, input.selectedModel, weightedResults);
            } else {
                console.log('Cache disabled - skipping dimension cache storage');
            }

            console.log('Dimension analysis completed and stored in S3');

            // ---------------------------------------------------------------
            // 9. Return summary JSON
            // ---------------------------------------------------------------
            return buildSummaryJson(weightedResults, input.selectedModel, false);

        } catch (error) {
            console.error('Dimension analysis failed:', error);
            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    },
    {
        name: 'analyze_dimensions',
        description:
            'Performs a 5-dimension quality analysis (relevance, freshness, clarity, accuracy, completeness) on documentation content using parallel Bedrock calls. ' +
            'Reads processed content from S3, checks DynamoDB cache, scores each dimension 0-100 with content-type-aware weighting, and detects spelling issues, ' +
            'terminology inconsistencies, and code issues. Stores results at sessions/{sessionId}/dimension-results.json. Must be called AFTER process_url.',
        schema: z.object({
            url: z.string().describe('The documentation URL being analyzed'),
            sessionId: z.string().describe('The analysis session ID'),
            selectedModel: z.string().default('claude').describe('The AI model to use (claude, titan, llama, auto)'),
            cacheEnabled: z.boolean().optional().default(true).describe('Whether to use DynamoDB caching (default: true)')
        })
    }
);

// ---------------------------------------------------------------------------
// Build a JSON summary for the tool return value
// ---------------------------------------------------------------------------

function buildSummaryJson(
    dimensionResults: Record<DimensionType, DimensionResult>,
    selectedModel: string,
    fromCache: boolean
): string {
    // Compute overall weighted score
    const completed = DIMENSIONS.filter(d => dimensionResults[d]?.score !== null);
    const overallScore = completed.length > 0
        ? Math.round(
            completed.reduce((sum, d) => {
                const r = dimensionResults[d];
                const weight = r.contentTypeWeight ?? 0.20;
                return sum + (r.score ?? 0) * weight;
            }, 0) / completed.reduce((sum, d) => sum + (dimensionResults[d].contentTypeWeight ?? 0.20), 0)
        )
        : null;

    // Collect key findings across all dimensions
    const keyFindings: string[] = [];
    const allSpellingIssues: SpellingIssue[] = [];
    const allCodeIssues: CodeIssue[] = [];
    const allTerminologyInconsistencies: TerminologyInconsistency[] = [];

    DIMENSIONS.forEach(dim => {
        const r = dimensionResults[dim];
        if (!r) return;

        // Top findings (skip the weight metadata line)
        r.findings
            .filter(f => !f.startsWith('Content type:'))
            .slice(0, 2)
            .forEach(f => keyFindings.push(`[${dim}] ${f}`));

        if (r.spellingIssues?.length) allSpellingIssues.push(...r.spellingIssues);
        if (r.codeIssues?.length) allCodeIssues.push(...r.codeIssues);
        if (r.terminologyInconsistencies?.length) allTerminologyInconsistencies.push(...r.terminologyInconsistencies);
    });

    const dimensionScores: Record<string, number | null> = {};
    DIMENSIONS.forEach(d => {
        dimensionScores[d] = dimensionResults[d]?.score ?? null;
    });

    return JSON.stringify({
        success: true,
        fromCache,
        model: selectedModel,
        overallScore,
        dimensionScores,
        contentType: dimensionResults[DIMENSIONS[0]]?.contentType || 'mixed',
        keyFindings: keyFindings.slice(0, 10),
        spellingIssuesCount: allSpellingIssues.length,
        codeIssuesCount: allCodeIssues.length,
        terminologyInconsistenciesCount: allTerminologyInconsistencies.length,
        message: fromCache
            ? `Dimension analysis completed using cached results (${selectedModel})`
            : `Dimension analysis completed using ${selectedModel}`
    });
}
