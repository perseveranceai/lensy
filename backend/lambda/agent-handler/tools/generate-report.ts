import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readSessionArtifact, writeSessionArtifact } from '../shared/s3-helpers';
import { createProgressHelper } from './publish-progress';

import type { AIReadinessResult } from './check-ai-readiness';
import { scoreCodingAgents, scoreAiSearch, gateState, tipsV2, ScoreResult, GateResult, Tip } from './scoring-v2';
import type { SignalsV2 } from './collect-signals-v2';
import type { AIDiscoverabilityResult } from './check-ai-discoverability';

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
    discoverability: 40,    // Out of 40 — llms.txt, sitemap, canonical, meta robots, markdown availability
    consumability: 40,      // Out of 40 — headings, word count, code, links, JS rendering
    structuredData: 20,     // Out of 20 — JSON-LD, schema, OpenGraph, breadcrumbs
    // Total readiness = 100 points (bot access is a prerequisite, not scored)
};

// AI Citations weight (separate from readiness score)
const AI_CITATION_WEIGHT = 30;

/**
 * Per-signal impact tiers, emitted in the report so the frontend renders a
 * consistent impact chip on every signal.
 *
 * Scoring v2 (docs/two-score-readiness/spec.md §4): tiers come from the points
 * each check carries, by the same rule as before: >= 10 pts high, 5-9 medium,
 * < 5 low. The check ids (C1-C6, S1-S6) are the v2 signal ids; the older keys
 * are the legacy rows the current report UI still renders, re-tiered by the
 * v2 check they now feed (spec §4.5). Signals v2 dropped or made tips are low.
 */
const SIGNAL_IMPACT: Record<string, 'high' | 'medium' | 'low'> = {
    // Coding agents (100)
    'C1': 'high',   // content without JavaScript, 20
    'C2': 'high',   // Markdown on request, 15
    'C3': 'high',   // .md version discoverable, 15
    'C4': 'high',   // llms.txt usable, 20
    'C5': 'high',   // page fits one fetch, 15
    'C6': 'high',   // sections findable, 15
    // AI search (100)
    'S1': 'high',   // AI search bots allowed, 20
    'S2': 'high',   // content without JavaScript, 20
    'S3': 'high',   // indexable, 25
    'S4': 'high',   // freshness declared, 15
    'S5': 'high',   // answer-ready sections, 15
    'S6': 'medium', // JSON-LD, 5
    // Legacy rows
    'llms.txt': 'high',            // C4, 20
    'llms-full.txt': 'low',        // not scored
    'sitemap': 'medium',           // in S3, 8
    'canonical url': 'medium',     // in S3, 7
    'meta robots': 'high',         // noindex zeroes S3
    'indexing directive': 'high',  // noindex zeroes S3
    'page markdown': 'high',       // C3, 15
    'page in llms.txt': 'high',    // advertises the .md (C3)
    'content negotiation': 'high', // C2, 15
    'agents.md': 'low',            // tip, not scored
    'mcp config': 'low',           // tip, not scored
    'json-ld': 'medium',           // S6, 5
    'opengraph': 'low',            // tip only (social previews)
    'breadcrumbs': 'low',          // dropped
    'client-side rendered': 'high', // C1 and S2, 20 each
    'text-to-html': 'medium',      // folded into C5
    'headings': 'high',            // C6 and S5
    'word count': 'low',           // dropped (tip for very thin pages)
    'code blocks': 'low',          // tip
    'links': 'low',                // dropped
};

// ── Report Types ──────────────────────────────────────────────────────────

/** "What an agent receives" preview under the Coding agents card (spec §8.2). */
export interface AgentPreview {
    format: 'markdown' | 'html';
    chars: number;
    approxTokens: number;
    /** Share of the page a 100K-character fetch window covers (1 = all of it). */
    windowShare: number;
    url: string;
}

/** The v2 part of report.json (spec §6.1). Absent on reports scored before v2. */
export interface ScoringV2Fields {
    scoringVersion: 2;
    scores: { codingAgents: ScoreResult; aiSearch: ScoreResult };
    gate: GateResult;
    tips: Tip[];
    agentPreview: AgentPreview;
}

const AGENT_WINDOW_CHARS = 100000;

export function buildScoringV2(signals: SignalsV2): ScoringV2Fields {
    const r = signals.received;
    return {
        scoringVersion: 2,
        scores: { codingAgents: scoreCodingAgents(signals), aiSearch: scoreAiSearch(signals) },
        gate: gateState(signals),
        tips: tipsV2(signals),
        agentPreview: {
            format: r.format,
            chars: r.chars,
            approxTokens: Math.round(r.chars / 4),
            windowShare: r.chars <= AGENT_WINDOW_CHARS ? 1 : Math.round((AGENT_WINDOW_CHARS / r.chars) * 100) / 100,
            url: r.format === 'markdown' ? (signals.contentNegotiation.ok ? signals.finalUrl : signals.markdownUrl.url) : signals.finalUrl,
        },
    };
}

interface AIReadinessReport extends Partial<ScoringV2Fields> {
    /** AI search score when scoringVersion is 2 (kept for legacy readers until the UI migrates); else the v1 total. */
    overallScore: number;
    letterGrade: string;  // A+, A, B+, B, C, D, F
    botAccessState: 'js_blocked' | 'fully_blocked' | 'partially_blocked' | 'accessible';
    scoreBreakdown: {
        botAccess: number;          // always 0 — kept for backward compat, bot access is now a prerequisite
        discoverability: number;
        consumability: number;
        structuredData: number;
        aiDiscoverability: number;  // kept for backward compat, separate from readiness
    };
    categories: AIReadinessResult['categories'];
    aiDiscoverability: AIDiscoverabilityResult | null;
    /** v2 evidence-aware detection report (site-level + page-level signals) — powers the frontend evidence badges. */
    detection?: AIReadinessResult['detection'];
    recommendations: Array<{
        category: string;
        priority: 'high' | 'medium' | 'low' | 'best-practice';
        issue: string;
        fix: string;
        codeSnippet?: string;
    }>;
    /**
     * Per-signal impact rating, keyed by a stable signal id, derived from the
     * same point weights the scoring functions use (see SIGNAL_IMPACT). Lets the
     * frontend show a consistent impact chip on EVERY signal instead of
     * hardcoding it for a couple. High/medium/low mirror the scoring weight tiers.
     */
    signalImpact: Record<string, 'high' | 'medium' | 'low'>;
    contextualSuggestions: string[];  // LLM-generated improvement suggestions
    scope: {
        url: string;
        mode: 'ai-readiness';
        categoriesAnalyzed: number;
        aiSearchEnginesTested: number;
        queriesGenerated: number;
    };
    analysisTime: number;
    /** When this report was generated (ISO 8601, UTC). Printed as the scan time in report downloads (H-001). */
    generatedAt: string;
    // Legacy compat — frontend won't crash during rollout
    dimensions: Record<string, never>;
}

// ── Tool Definition ───────────────────────────────────────────────────────

export const generateReportTool = tool(
    async (input): Promise<string> => {
        const { sessionId, url, sourceMode, analysisStartTime } = input;

        console.log(`[generate_report] Generating AI readiness report for session: ${sessionId}`);

        const progress = createProgressHelper(sessionId);

        try {
            await progress.progress('Assembling AI readiness report...', 'report-generation');

            // ── 1. Read analysis artifacts ──────────────────────────
            const [readinessResults, discoverabilityResults] = await Promise.all([
                readSessionArtifact<AIReadinessResult>(sessionId, 'ai-readiness-results.json'),
                readSessionArtifact<AIDiscoverabilityResult>(sessionId, 'ai-discoverability-results.json'),
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
            const v1Score = Math.round(
                scoreBreakdown.discoverability +
                scoreBreakdown.consumability +
                scoreBreakdown.structuredData
            );
            // Scoring v2: two scores. overallScore carries the AI search score so
            // legacy readers and the audit log keep working (spec §6.1).
            let v2: ScoringV2Fields | null = null;
            if (readinessResults?.signalsV2) {
                try {
                    v2 = buildScoringV2(readinessResults.signalsV2);
                } catch (e) {
                    console.warn('[generate_report] scoring v2 failed, writing a v1 report:', (e as Error).message);
                }
            }
            const overallScore = v2 ? v2.scores.aiSearch.score : v1Score;
            const letterGrade = getLetterGrade(overallScore);
            if (v2) console.log(`[generate_report] v2 scores: coding ${v2.scores.codingAgents.score}, search ${v2.scores.aiSearch.score}, gate ${v2.gate.state} (v1 total ${v1Score})`);

            console.log(`[generate_report] Score breakdown:`, scoreBreakdown, `Overall: ${overallScore} (${letterGrade}), Citations: ${scoreBreakdown.aiDiscoverability}`);

            // ── 3. Merge recommendations ─────────────────────────────
            const recommendations: Array<{ category: string; priority: 'high' | 'medium' | 'low' | 'best-practice'; issue: string; fix: string }> = [
                ...(readinessResults?.recommendations || []),
                ...(discoverabilityResults?.recommendations?.map(r => ({
                    category: 'AI Discoverability',
                    priority: r.priority as 'high' | 'medium' | 'low',
                    issue: r.issue,
                    fix: r.fix,
                })) || []),
            ];

            // Sort by priority: high → medium → low
            const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2, 'best-practice': 3 };
            recommendations.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));

            // ── 3b. Generate best-practice recommendations from detection notes ──
            const detection = readinessResults?.detection;
            if (detection) {
                const bestPractices: Array<{ category: string; priority: 'best-practice'; issue: string; fix: string }> = [];

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

                // Experimental signals actually FOUND (AGENTS.md, MCP).
                // N-10: classifyExperimental returns status:'experimental' even
                // when the probe 404'd (no file), so filtering on status alone
                // produced false "AGENTS.md detected / MCP Config detected"
                // recommendations on sites that have neither. Require a
                // validatedUrl (the URL that returned HTTP 200) — the same gate
                // the frontend already uses to decide whether to render them.
                const experimentalSignals = [
                    { name: 'AGENTS.md', signal: detection.site.agentsMd },
                    { name: 'MCP Config', signal: detection.site.mcpJson },
                ].filter(s => s.signal.status === 'experimental' && Boolean(s.signal.validatedUrl));

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
            const contextualSuggestions: string[] = [];

            // ── 5. Assemble final report ─────────────────────────────
            const totalTime = Date.now() - analysisStartTime;

            const enginesTested = discoverabilityResults
                ? Object.values(discoverabilityResults.engines).filter(e => e?.available).length
                : 0;

            const finalReport: AIReadinessReport = {
                ...(v2 || {}),
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
                        textToHtmlRatio: { ratio: 0, textBytes: 0, htmlBytes: 0, status: 'very-low' as const },
                        jsRendered: false,
                        originRequiresJavaScript: undefined,
                        renderedContentRecovered: undefined,
                        headingHierarchy: { h1Count: 0, h2Count: 0, h3Count: 0, hasProperNesting: false, headings: [] },
                        codeBlocks: { count: 0, withLanguageHints: 0, hasCode: false },
                        internalLinkDensity: { count: 0, perKWords: 0, status: 'sparse' as const },
                        wordCount: 0,
                        pageType: 'general' as const,
                    },
                    structuredData: {
                        jsonLd: { found: false, types: [], isValidSchemaType: false },
                        schemaCompleteness: { status: 'missing', missingFields: [] },
                        openGraphCompleteness: { score: 'missing', missingTags: [] },
                        breadcrumbs: { found: false },
                    },
                },
                aiDiscoverability: discoverabilityResults || null,
                // Include the evidence-aware detection report so the frontend can
                // render Verified/Not-verified badges, audience tags, and the
                // detection-only signals (Content Negotiation, AGENTS.md, MCP, etc.)
                // when a persisted report.json is reloaded — not just during a live scan.
                detection: readinessResults?.detection,
                recommendations,
                signalImpact: SIGNAL_IMPACT,
                contextualSuggestions,
                scope: {
                    url,
                    mode: 'ai-readiness',
                    categoriesAnalyzed: readinessResults ? 4 : 0,
                    aiSearchEnginesTested: enginesTested,
                    queriesGenerated: discoverabilityResults?.queries?.length || 0,
                },
                analysisTime: totalTime,
                generatedAt: new Date().toISOString(),
                dimensions: {} as Record<string, never>,  // Legacy compat
            };

            // ── 6. Persist report + status ───────────────────────────
            await writeSessionArtifact(sessionId, 'report.json', finalReport);
            await writeSessionArtifact(sessionId, 'status.json', {
                status: 'completed',
                overallScore,
                ...(v2 ? { scoringVersion: 2, codingScore: v2.scores.codingAgents.score, searchScore: v2.scores.aiSearch.score } : {}),
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

            await progress.success(
                `Analysis complete! AI Readiness: ${overallScore}/100 (${(totalTime / 1000).toFixed(1)}s)`,
                { overallScore, totalTime }
            );

            return JSON.stringify({
                success: true,
                mode: 'ai-readiness',
                overallScore,
                scoreBreakdown,
                ...(v2 ? { scoringVersion: 2, codingScore: v2.scores.codingAgents.score, searchScore: v2.scores.aiSearch.score, gateState: v2.gate.state } : {}),
                recommendationCount: recommendations.length,
                contextualSuggestionCount: contextualSuggestions.length,
                aiSearchEnginesTested: enginesTested,
                queriesGenerated: discoverabilityResults?.queries?.length || 0,
                analysisTime: totalTime,
                status: 'completed',
            });

        } catch (error) {
            console.error('[generate_report] Report generation failed:', error);

            try {
                await writeSessionArtifact(sessionId, 'status.json', {
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'Unknown error',
                    failedAt: new Date().toISOString(),
                });
            } catch (writeError) {
                console.error('[generate_report] Could not persist failure status:', writeError);
            }

            await progress.error(
                `Report generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                { toolName: 'generate_report' }
            );

            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                status: 'failed',
            });
        }
    },
    {
        name: 'generate_report',
        description:
            'Assembles the final AI readiness report by reading ai-readiness-results.json and ' +
            'ai-discoverability-results.json from S3. Computes a 0-100 score across 5 weighted categories, ' +
            'generates LLM-powered contextual improvement suggestions, and persists report.json + status.json. ' +
            'Call this as the LAST step after check_ai_readiness and check_ai_discoverability have completed.',
        schema: z.object({
            sessionId: z.string().describe('The analysis session ID'),
            url: z.string().describe('The URL being analyzed'),
            sourceMode: z.enum(['doc', 'sitemap', 'ai-readiness']).describe('The analysis mode — use "ai-readiness" for AI readiness analysis'),
            analysisStartTime: z.number().describe('Epoch timestamp (ms) when analysis started'),
        })
    }
);

// ── Score Calculation ─────────────────────────────────────────────────────

function calculateScores(
    readiness: AIReadinessResult | null,
    discoverability: AIDiscoverabilityResult | null
): AIReadinessReport['scoreBreakdown'] {
    return {
        botAccess: 0,  // No longer scored — bot access is a prerequisite, not a category
        discoverability: calculateDiscoverabilityScore(readiness),
        consumability: calculateConsumabilityScore(readiness),
        structuredData: calculateStructuredDataScore(readiness),
        aiDiscoverability: calculateAIDiscoverabilityScore(discoverability),
    };
}

function getLetterGrade(score: number): string {
    if (score >= 95) return 'A+';
    if (score >= 90) return 'A';
    if (score >= 85) return 'B+';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

function determineBotAccessState(r: AIReadinessResult | null): AIReadinessReport['botAccessState'] {
    if (!r) return 'accessible';  // No data = assume accessible
    if (r.categories.consumability.originRequiresJavaScript) return 'js_blocked';

    const { allowedCount, blockedCount } = r.categories.botAccess;
    const total = allowedCount + blockedCount;
    if (total === 0) return 'accessible';  // No robots.txt = bots allowed by default
    if (allowedCount === 0) return 'fully_blocked';
    if (blockedCount > 0) return 'partially_blocked';
    return 'accessible';
}

function calculateDiscoverabilityScore(r: AIReadinessResult | null): number {
    if (!r) return 0;
    const d = r.categories.discoverability;
    let points = 0;
    const maxPoints = WEIGHTS.discoverability;

    // llms.txt: 15 points (primary signal — helps AI coding tools consume docs at inference time)
    if (d.llmsTxt.found) points += 15;
    // sitemap.xml: 8 points
    if (d.sitemapXml.found) points += 8;
    // Canonical: 5 points
    if (d.canonical.found) points += 5;
    // Meta robots: only penalize if actively blocking (not scoring the default)
    if (d.metaRobots.blocksIndexing) points -= 5;

    // Markdown availability: 12 points (discoverability signal — can AI tools find a markdown version?)
    const c = r.categories.consumability;
    if (c.markdownAvailable.found && c.markdownAvailable.discoverable) points += 12;
    else if (c.markdownAvailable.found) points += 8;

    return Math.min(Math.round(points), maxPoints);
}

function calculateConsumabilityScore(r: AIReadinessResult | null): number {
    if (!r) return 0;
    const c = r.categories.consumability;
    let points = 0;
    const maxPoints = WEIGHTS.consumability;

    // Heading hierarchy: 20 points (primary signal per DeepRead/GraphSkill research — agents use headings 87-98% of the time)
    if (c.headingHierarchy.h1Count === 1) points += 12;
    else if (c.headingHierarchy.h1Count > 0) points += 4;
    if (c.headingHierarchy.hasProperNesting) points += 8;

    // Not JS-rendered: 10 points
    // (If the page was originally an SPA, deny these points even if Jina rendered it)
    const requiresJs = c.originRequiresJavaScript ?? c.jsRendered;
    if (!requiresJs) points += 10;

    // Word count: 6 points (research: 500-2000 words = 2-3x more AI citations)
    if (c.wordCount >= 500 && c.wordCount <= 2000) points += 6;
    else if (c.wordCount >= 300) points += 3;

    // Internal link density: 4 points
    if (c.internalLinkDensity.status === 'good') points += 4;

    return Math.min(Math.round(points), maxPoints);
}

function calculateStructuredDataScore(r: AIReadinessResult | null): number {
    if (!r) return 0;
    const s = r.categories.structuredData;
    let points = 0;
    const maxPoints = WEIGHTS.structuredData;

    // JSON-LD with valid type: 5 points (secondary signal — helpful for AI search, not a coding-agent blocker)
    if (s.jsonLd.found && s.jsonLd.isValidSchemaType) points += 5;
    else if (s.jsonLd.found) points += 3;

    // Schema completeness: 2 points (low impact)
    if (s.schemaCompleteness.status === 'complete') points += 2;
    else if (s.schemaCompleteness.status === 'partial') points += 1;

    // OpenGraph completeness: 10 points (important for AI search previews and content understanding)
    if (s.openGraphCompleteness.score === 'complete') points += 10;
    else if (s.openGraphCompleteness.score === 'partial') points += 6;

    // Breadcrumbs: 3 points (secondary signal — useful for hierarchy, not critical)
    if (s.breadcrumbs.found) points += 3;

    return Math.min(Math.round(points), maxPoints);
}

function calculateAIDiscoverabilityScore(d: AIDiscoverabilityResult | null): number {
    if (!d) return 0;
    const maxPoints = AI_CITATION_WEIGHT;  // Separate from readiness score

    const availableEngines = Object.values(d.engines).filter(e => e?.available);
    if (availableEngines.length === 0) return 0;

    // Average found rate across engines
    const avgFoundRate = availableEngines.reduce((sum, e) => sum + (e?.foundRate || 0), 0) / availableEngines.length;

    // Proportional: score = foundRate * maxPoints (100% cited = full score)
    return Math.round(avgFoundRate * maxPoints);
}

// ── Contextual Suggestions — removed: rule-based recs are sufficient ──
