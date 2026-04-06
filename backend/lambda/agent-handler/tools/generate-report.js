"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReportTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const s3_helpers_1 = require("../shared/s3-helpers");
const publish_progress_1 = require("./publish-progress");
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
// ── Score Weights ─────────────────────────────────────────────────────────
// AI Readiness = what doc owners control (70 raw points, rescaled to 0-100).
// AI Citations (discoverability) is shown separately — it's an observation, not a readiness signal.
const WEIGHTS = {
    discoverability: 40, // Out of 40 — llms.txt, sitemap, canonical, meta robots, markdown availability
    consumability: 40, // Out of 40 — headings, word count, code, links, JS rendering
    structuredData: 20, // Out of 20 — JSON-LD, schema, OpenGraph, breadcrumbs
    // Total readiness = 100 points (bot access is a prerequisite, not scored)
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
        const botAccessState = determineBotAccessState(readinessResults);
        // AI Readiness = only what doc owners control (excludes citations and bot access prerequisite)
        const overallScore = Math.round(scoreBreakdown.discoverability +
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
        const priorityOrder = { high: 0, medium: 1, low: 2, 'best-practice': 3 };
        recommendations.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
        // ── 3b. Generate best-practice recommendations from detection notes ──
        const detection = readinessResults?.detection;
        if (detection) {
            const bestPractices = [];
            // Link header mismatch: advertised at one URL, found at another
            if (detection.site.llmsTxt.status === 'verified' && detection.site.llmsTxt.note) {
                bestPractices.push({
                    category: 'Discoverability',
                    priority: 'best-practice',
                    issue: `Link header mismatch: ${detection.site.llmsTxt.note}`,
                    fix: 'Update your HTTP Link header to point to the correct llms.txt path. AI tools that trust the Link header directly (without fallback probing) will miss your llms.txt.',
                });
            }
            // llms.txt advertised but not found
            if (detection.site.llmsTxt.status === 'advertised') {
                bestPractices.push({
                    category: 'Discoverability',
                    priority: 'best-practice',
                    issue: `llms.txt advertised but not found — ${detection.site.llmsTxt.note || 'header pointed to a URL that returned 404'}`,
                    fix: 'Your server advertises an llms.txt via HTTP headers but the file is missing. Either create the file at the advertised path or remove the Link header to avoid misleading AI tools.',
                });
            }
            // llms-full.txt advertised but not found
            if (detection.site.llmsFullTxt.status === 'advertised' && detection.site.llmsFullTxt.note) {
                bestPractices.push({
                    category: 'Discoverability',
                    priority: 'best-practice',
                    issue: `llms-full.txt advertised but not validated — ${detection.site.llmsFullTxt.note}`,
                    fix: 'Your llms-full.txt is referenced but the direct probe failed. Ensure the file is accessible at the expected URL.',
                });
            }
            // Markdown advertised but not found
            if (detection.page.markdown.status === 'advertised' && detection.page.markdown.note) {
                bestPractices.push({
                    category: 'Discoverability',
                    priority: 'best-practice',
                    issue: `Markdown version advertised but not accessible — ${detection.page.markdown.note}`,
                    fix: 'Your page advertises a markdown version (via Link header or <link rel="alternate">) but the URL returned an error. Ensure the markdown endpoint is accessible.',
                });
            }
            // Experimental signals found (AGENTS.md, MCP)
            const experimentalSignals = [
                { name: 'AGENTS.md', signal: detection.site.agentsMd },
                { name: 'MCP Config', signal: detection.site.mcpJson },
            ].filter(s => s.signal.status === 'experimental');
            for (const exp of experimentalSignals) {
                bestPractices.push({
                    category: 'Discoverability',
                    priority: 'best-practice',
                    issue: `${exp.name} detected — emerging standard`,
                    fix: `Your site has a ${exp.name} file, which is an emerging standard for AI agent interoperability. While not yet scored, this shows forward-thinking adoption. Keep it maintained as the standard evolves.`,
                });
            }
            // llms.txt verified with note about hint URL mismatch for llms-full.txt
            if (detection.site.llmsFullTxt.status === 'verified' && detection.site.llmsFullTxt.note) {
                bestPractices.push({
                    category: 'Discoverability',
                    priority: 'best-practice',
                    issue: `llms-full.txt: ${detection.site.llmsFullTxt.note}`,
                    fix: 'Update your HTTP Link header to point to the correct llms-full.txt path for consistency.',
                });
            }
            recommendations.push(...bestPractices);
        }
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
            botAccessState,
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
            botAccessState,
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
        botAccess: 0, // No longer scored — bot access is a prerequisite, not a category
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
function determineBotAccessState(r) {
    if (!r)
        return 'accessible'; // No data = assume accessible
    const { allowedCount, blockedCount } = r.categories.botAccess;
    const total = allowedCount + blockedCount;
    if (total === 0)
        return 'accessible'; // No robots.txt = bots allowed by default
    if (allowedCount === 0)
        return 'fully_blocked';
    if (blockedCount > 0)
        return 'partially_blocked';
    return 'accessible';
}
function calculateDiscoverabilityScore(r) {
    if (!r)
        return 0;
    const d = r.categories.discoverability;
    let points = 0;
    const maxPoints = WEIGHTS.discoverability;
    // llms.txt: 15 points (primary signal — helps AI coding tools consume docs at inference time)
    if (d.llmsTxt.found)
        points += 15;
    // sitemap.xml: 8 points
    if (d.sitemapXml.found)
        points += 8;
    // Canonical: 5 points
    if (d.canonical.found)
        points += 5;
    // Meta robots: only penalize if actively blocking (not scoring the default)
    if (d.metaRobots.blocksIndexing)
        points -= 5;
    // Markdown availability: 12 points (discoverability signal — can AI tools find a markdown version?)
    const c = r.categories.consumability;
    if (c.markdownAvailable.found && c.markdownAvailable.discoverable)
        points += 12;
    else if (c.markdownAvailable.found)
        points += 8;
    return Math.min(Math.round(points), maxPoints);
}
function calculateConsumabilityScore(r) {
    if (!r)
        return 0;
    const c = r.categories.consumability;
    let points = 0;
    const maxPoints = WEIGHTS.consumability;
    // Heading hierarchy: 20 points (primary signal per DeepRead/GraphSkill research — agents use headings 87-98% of the time)
    if (c.headingHierarchy.h1Count === 1)
        points += 12;
    else if (c.headingHierarchy.h1Count > 0)
        points += 4;
    if (c.headingHierarchy.hasProperNesting)
        points += 8;
    // Not JS-rendered: 10 points
    if (!c.jsRendered)
        points += 10;
    // Word count: 6 points (research: 500-2000 words = 2-3x more AI citations)
    if (c.wordCount >= 500 && c.wordCount <= 2000)
        points += 6;
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
    // JSON-LD with valid type: 5 points (secondary signal — helpful for AI search, not a coding-agent blocker)
    if (s.jsonLd.found && s.jsonLd.isValidSchemaType)
        points += 5;
    else if (s.jsonLd.found)
        points += 3;
    // Schema completeness: 2 points (low impact)
    if (s.schemaCompleteness.status === 'complete')
        points += 2;
    else if (s.schemaCompleteness.status === 'partial')
        points += 1;
    // OpenGraph completeness: 10 points (important for AI search previews and content understanding)
    if (s.openGraphCompleteness.score === 'complete')
        points += 10;
    else if (s.openGraphCompleteness.score === 'partial')
        points += 6;
    // Breadcrumbs: 3 points (secondary signal — useful for hierarchy, not critical)
    if (s.breadcrumbs.found)
        points += 3;
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
// ── Contextual Suggestions — removed: rule-based recs are sufficient ──
