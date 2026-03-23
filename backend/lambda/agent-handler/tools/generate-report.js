"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReportTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const s3_helpers_1 = require("../shared/s3-helpers");
const publish_progress_1 = require("./publish-progress");
const bedrock_helpers_1 = require("../shared/bedrock-helpers");
/**
 * Tool: Generate Report (AI Readiness Pivot)
 *
 * Reads AI readiness + discoverability artifacts, computes a 0-100 score,
 * generates LLM-powered contextual suggestions, and assembles the final report.
 *
 * Artifacts consumed:
 *   - ai-readiness-results.json       (from check_ai_readiness — 4 categories)
 *   - ai-discoverability-results.json  (from check_ai_discoverability — search engine testing)
 *
 * Artifacts produced:
 *   - report.json   (the full final report)
 *   - status.json   (session status set to 'completed')
 */
// Use Haiku 4.5 for contextual suggestions — fast, cheap
const SUGGESTION_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
// ── Score Weights ─────────────────────────────────────────────────────────
// AI Readiness = what doc owners control (70 raw points, rescaled to 0-100).
// AI Citations (discoverability) is shown separately — it's an observation, not a readiness signal.
const WEIGHTS = {
    botAccess: 15, // Out of 15 — are AI crawlers allowed?
    discoverability: 20, // Out of 20 — llms.txt, sitemap, canonical, meta robots
    consumability: 45, // Out of 45 — headings, word count, markdown, code, links
    structuredData: 20, // Out of 20 — JSON-LD, schema, OpenGraph, breadcrumbs
    // Total readiness = 100 points
};
// AI Citations weight (separate from readiness score)
const AI_CITATION_WEIGHT = 30;
// ── Tool Definition ───────────────────────────────────────────────────────
exports.generateReportTool = (0, tools_1.tool)(async (input) => {
    const { sessionId, url, sourceMode, analysisStartTime } = input;
    console.log(`[generate_report] Generating AI readiness report for session: ${sessionId}`);
    const progress = (0, publish_progress_1.createProgressHelper)(sessionId);
    try {
        await progress.progress('Assembling AI readiness report...', 'report-generation');
        // ── 1. Read analysis artifacts ──────────────────────────
        const [readinessResults, discoverabilityResults] = await Promise.all([
            (0, s3_helpers_1.readSessionArtifact)(sessionId, 'ai-readiness-results.json'),
            (0, s3_helpers_1.readSessionArtifact)(sessionId, 'ai-discoverability-results.json'),
        ]);
        if (!readinessResults) {
            console.warn('[generate_report] No AI readiness results found — generating minimal report');
        }
        if (!discoverabilityResults) {
            console.warn('[generate_report] No AI discoverability results found — scoring without it');
        }
        // ── 2. Calculate score breakdown ─────────────────────────
        const scoreBreakdown = calculateScores(readinessResults, discoverabilityResults);
        // AI Readiness = only what doc owners control (excludes citations)
        const overallScore = Math.round(scoreBreakdown.botAccess +
            scoreBreakdown.discoverability +
            scoreBreakdown.consumability +
            scoreBreakdown.structuredData);
        const letterGrade = getLetterGrade(overallScore);
        console.log(`[generate_report] Score breakdown:`, scoreBreakdown, `Overall: ${overallScore} (${letterGrade}), Citations: ${scoreBreakdown.aiDiscoverability}`);
        // ── 3. Merge recommendations ─────────────────────────────
        const recommendations = [
            ...(readinessResults?.recommendations || []),
            ...(discoverabilityResults?.recommendations?.map(r => ({
                category: 'AI Discoverability',
                priority: r.priority,
                issue: r.issue,
                fix: r.fix,
            })) || []),
        ];
        // Sort by priority: high → medium → low
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
        // ── 4. Contextual suggestions skipped — saves ~5s LLM call ──
        // Rule-based recommendations already provide actionable fixes.
        // LLM-powered suggestions can be added async later if needed.
        const contextualSuggestions = [];
        // ── 5. Assemble final report ─────────────────────────────
        const totalTime = Date.now() - analysisStartTime;
        const enginesTested = discoverabilityResults
            ? Object.values(discoverabilityResults.engines).filter(e => e?.available).length
            : 0;
        const finalReport = {
            overallScore,
            letterGrade,
            scoreBreakdown,
            categories: readinessResults?.categories || {
                botAccess: { robotsTxtFound: false, bots: [], allowedCount: 0, blockedCount: 0 },
                discoverability: {
                    llmsTxt: { found: false, url: '' },
                    llmsFullTxt: { found: false, url: '' },
                    sitemapXml: { found: false, referencedInRobotsTxt: false },
                    openGraph: { found: false, tags: {} },
                    canonical: { found: false },
                    metaRobots: { found: false, blocksIndexing: false },
                },
                consumability: {
                    markdownAvailable: { found: false, urls: [], discoverable: false },
                    textToHtmlRatio: { ratio: 0, textBytes: 0, htmlBytes: 0, status: 'very-low' },
                    jsRendered: false,
                    headingHierarchy: { h1Count: 0, h2Count: 0, h3Count: 0, hasProperNesting: false, headings: [] },
                    codeBlocks: { count: 0, withLanguageHints: 0, hasCode: false },
                    internalLinkDensity: { count: 0, perKWords: 0, status: 'sparse' },
                    wordCount: 0,
                    pageType: 'general',
                },
                structuredData: {
                    jsonLd: { found: false, types: [], isValidSchemaType: false },
                    schemaCompleteness: { status: 'missing', missingFields: [] },
                    openGraphCompleteness: { score: 'missing', missingTags: [] },
                    breadcrumbs: { found: false },
                },
            },
            aiDiscoverability: discoverabilityResults || null,
            recommendations,
            contextualSuggestions,
            scope: {
                url,
                mode: 'ai-readiness',
                categoriesAnalyzed: readinessResults ? 4 : 0,
                aiSearchEnginesTested: enginesTested,
                queriesGenerated: discoverabilityResults?.queries?.length || 0,
            },
            analysisTime: totalTime,
            dimensions: {}, // Legacy compat
        };
        // ── 6. Persist report + status ───────────────────────────
        await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'report.json', finalReport);
        await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
            status: 'completed',
            overallScore,
            analysisTime: totalTime,
            completedAt: new Date().toISOString(),
        });
        // ── 7. Publish final score to frontend ───────────────────
        await progress.categoryResult('overallScore', {
            overallScore,
            letterGrade,
            scoreBreakdown,
            recommendationCount: recommendations.length,
            contextualSuggestionCount: contextualSuggestions.length,
        }, `AI Readiness: ${letterGrade} (${overallScore}/100)`);
        await progress.success(`Analysis complete! AI Readiness: ${overallScore}/100 (${(totalTime / 1000).toFixed(1)}s)`, { overallScore, totalTime });
        return JSON.stringify({
            success: true,
            mode: 'ai-readiness',
            overallScore,
            scoreBreakdown,
            recommendationCount: recommendations.length,
            contextualSuggestionCount: contextualSuggestions.length,
            aiSearchEnginesTested: enginesTested,
            queriesGenerated: discoverabilityResults?.queries?.length || 0,
            analysisTime: totalTime,
            status: 'completed',
        });
    }
    catch (error) {
        console.error('[generate_report] Report generation failed:', error);
        try {
            await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
                status: 'failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                failedAt: new Date().toISOString(),
            });
        }
        catch (writeError) {
            console.error('[generate_report] Could not persist failure status:', writeError);
        }
        await progress.error(`Report generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { toolName: 'generate_report' });
        return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            status: 'failed',
        });
    }
}, {
    name: 'generate_report',
    description: 'Assembles the final AI readiness report by reading ai-readiness-results.json and ' +
        'ai-discoverability-results.json from S3. Computes a 0-100 score across 5 weighted categories, ' +
        'generates LLM-powered contextual improvement suggestions, and persists report.json + status.json. ' +
        'Call this as the LAST step after check_ai_readiness and check_ai_discoverability have completed.',
    schema: zod_1.z.object({
        sessionId: zod_1.z.string().describe('The analysis session ID'),
        url: zod_1.z.string().describe('The URL being analyzed'),
        sourceMode: zod_1.z.enum(['doc', 'sitemap', 'ai-readiness']).describe('The analysis mode — use "ai-readiness" for AI readiness analysis'),
        analysisStartTime: zod_1.z.number().describe('Epoch timestamp (ms) when analysis started'),
    })
});
// ── Score Calculation ─────────────────────────────────────────────────────
function calculateScores(readiness, discoverability) {
    return {
        botAccess: calculateBotAccessScore(readiness),
        discoverability: calculateDiscoverabilityScore(readiness),
        consumability: calculateConsumabilityScore(readiness),
        structuredData: calculateStructuredDataScore(readiness),
        aiDiscoverability: calculateAIDiscoverabilityScore(discoverability),
    };
}
function getLetterGrade(score) {
    if (score >= 95)
        return 'A+';
    if (score >= 90)
        return 'A';
    if (score >= 85)
        return 'B+';
    if (score >= 75)
        return 'B';
    if (score >= 60)
        return 'C';
    if (score >= 40)
        return 'D';
    return 'F';
}
function calculateBotAccessScore(r) {
    if (!r)
        return 0;
    const { allowedCount, blockedCount } = r.categories.botAccess;
    const total = allowedCount + blockedCount;
    if (total === 0)
        return WEIGHTS.botAccess * 0.7; // No robots.txt = default allow, partial credit
    // Scale: all 10 allowed = full score, blocked bots reduce score proportionally
    return Math.round((allowedCount / 10) * WEIGHTS.botAccess);
}
function calculateDiscoverabilityScore(r) {
    if (!r)
        return 0;
    const d = r.categories.discoverability;
    let points = 0;
    const maxPoints = WEIGHTS.discoverability;
    // llms.txt: 10 points (helps AI coding tools consume docs at inference time)
    if (d.llmsTxt.found)
        points += 10;
    // sitemap.xml: 5 points
    if (d.sitemapXml.found)
        points += 5;
    // Canonical: 5 points
    if (d.canonical.found)
        points += 5;
    // Meta robots: only penalize if actively blocking (not scoring the default)
    if (d.metaRobots.blocksIndexing)
        points -= 5;
    return Math.min(Math.round(points), maxPoints);
}
function calculateConsumabilityScore(r) {
    if (!r)
        return 0;
    const c = r.categories.consumability;
    let points = 0;
    const maxPoints = WEIGHTS.consumability;
    // Heading hierarchy: 18 points (primary signal per DeepRead/GraphSkill research — agents use headings 87-98% of the time)
    if (c.headingHierarchy.h1Count === 1)
        points += 10;
    else if (c.headingHierarchy.h1Count > 0)
        points += 4;
    if (c.headingHierarchy.hasProperNesting)
        points += 8;
    // Not JS-rendered: 10 points
    if (!c.jsRendered)
        points += 10;
    // Markdown available & discoverable: 8 points
    if (c.markdownAvailable.found && c.markdownAvailable.discoverable)
        points += 8;
    else if (c.markdownAvailable.found)
        points += 4;
    // Word count: 5 points (research: 500-2000 words = 2-3x more AI citations)
    if (c.wordCount >= 500 && c.wordCount <= 2000)
        points += 5;
    else if (c.wordCount >= 300)
        points += 3;
    // Internal link density: 4 points
    if (c.internalLinkDensity.status === 'good')
        points += 4;
    return Math.min(Math.round(points), maxPoints);
}
function calculateStructuredDataScore(r) {
    if (!r)
        return 0;
    const s = r.categories.structuredData;
    let points = 0;
    const maxPoints = WEIGHTS.structuredData;
    // JSON-LD with valid type: 7 points
    if (s.jsonLd.found && s.jsonLd.isValidSchemaType)
        points += 7;
    else if (s.jsonLd.found)
        points += 4;
    // Schema completeness: 4 points
    if (s.schemaCompleteness.status === 'complete')
        points += 4;
    else if (s.schemaCompleteness.status === 'partial')
        points += 2;
    // OpenGraph completeness: 5 points
    if (s.openGraphCompleteness.score === 'complete')
        points += 5;
    else if (s.openGraphCompleteness.score === 'partial')
        points += 3;
    // Breadcrumbs: 4 points
    if (s.breadcrumbs.found)
        points += 4;
    return Math.min(Math.round(points), maxPoints);
}
function calculateAIDiscoverabilityScore(d) {
    if (!d)
        return 0;
    const maxPoints = AI_CITATION_WEIGHT; // Separate from readiness score
    const availableEngines = Object.values(d.engines).filter(e => e?.available);
    if (availableEngines.length === 0)
        return 0;
    // Average found rate across engines
    const avgFoundRate = availableEngines.reduce((sum, e) => sum + (e?.foundRate || 0), 0) / availableEngines.length;
    // Proportional: score = foundRate * maxPoints (100% cited = full score)
    return Math.round(avgFoundRate * maxPoints);
}
// ── Contextual Suggestions (LLM-generated) ────────────────────────────────
async function generateContextualSuggestions(url, readiness, discoverability) {
    if (!readiness && !discoverability)
        return [];
    // Build a concise summary for the LLM
    const parts = [];
    parts.push(`URL analyzed: ${url}`);
    if (readiness) {
        const ba = readiness.categories.botAccess;
        const blocked = ba.bots.filter(b => b.status === 'blocked').map(b => b.name);
        parts.push(`Bot Access: ${ba.allowedCount}/10 bots allowed${blocked.length > 0 ? ` (blocked: ${blocked.join(', ')})` : ''}`);
        const disc = readiness.categories.discoverability;
        parts.push(`llms.txt: ${disc.llmsTxt.found ? 'found' : 'NOT found'}`);
        parts.push(`sitemap.xml: ${disc.sitemapXml.found ? 'found' : 'NOT found'}`);
        parts.push(`Text-to-HTML ratio: ${(readiness.categories.consumability.textToHtmlRatio.ratio * 100).toFixed(1)}%`);
        parts.push(`JS-rendered: ${readiness.categories.consumability.jsRendered ? 'YES (problem)' : 'No (good)'}`);
        parts.push(`JSON-LD: ${readiness.categories.structuredData.jsonLd.found ? `found (${readiness.categories.structuredData.jsonLd.types.join(', ')})` : 'NOT found'}`);
    }
    if (discoverability) {
        const foundQueries = discoverability.queries?.filter((q, i) => {
            return Object.values(discoverability.engines).some(e => e?.results?.[i]?.cited);
        }) || [];
        const missedQueries = discoverability.queries?.filter((q, i) => {
            return !Object.values(discoverability.engines).some(e => e?.results?.[i]?.cited);
        }) || [];
        if (foundQueries.length > 0) {
            parts.push(`\nQueries that FOUND this page: ${foundQueries.map(q => `"${q}"`).join(', ')}`);
        }
        if (missedQueries.length > 0) {
            parts.push(`Queries that did NOT find this page: ${missedQueries.map(q => `"${q}"`).join(', ')}`);
        }
        parts.push(`Overall discoverability: ${discoverability.overallDiscoverability}`);
    }
    const prompt = `You are an AI search readiness expert. A documentation page was analyzed for its visibility to AI search engines (Perplexity, ChatGPT, Claude Search, Gemini).

Here are the results:
${parts.join('\n')}

Based on these results, generate 3-5 specific, actionable improvement suggestions. Each suggestion should:
- Reference a specific finding from the analysis
- Explain WHY it matters for AI search visibility
- Give a concrete action the user can take

Focus on the highest-impact improvements first. If queries missed the page, suggest content changes that would help for those specific query intents.

Return a JSON array of strings. Each string is one suggestion (1-2 sentences).`;
    const suggestions = await (0, bedrock_helpers_1.invokeBedrockForJson)(prompt, {
        modelId: SUGGESTION_MODEL,
        maxTokens: 1024,
        temperature: 0.3,
    });
    if (Array.isArray(suggestions)) {
        return suggestions.filter(s => typeof s === 'string' && s.length > 10).slice(0, 5);
    }
    return [];
}
