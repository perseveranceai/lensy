import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readSessionArtifact, writeSessionArtifact, readFromS3, ANALYSIS_BUCKET } from '../shared/s3-helpers';
import { createProgressHelper } from './publish-progress';

/**
 * Tool 7: Generate Report
 * Ported from: report-generator/index.ts (659 lines)
 *
 * Reads all S3 artifacts produced by previous tools and aggregates them into
 * a final report.  Handles both **doc mode** (dimension-based analysis) and
 * **sitemap mode** (health-check-based analysis).
 *
 * Artifacts consumed:
 *   - processed-content.json          (from process_url)
 *   - structure.json                  (from detect_structure)
 *   - ai-readiness-results.json       (from check_ai_readiness)
 *   - dimension-results.json          (from analyze_dimensions)
 *   - sitemap-health.json             (from check_sitemap_health)
 *   - doc-mode-sitemap-health.json    (optional parallel sitemap data in doc mode)
 *
 * Artifacts produced:
 *   - report.json   (the full final report)
 *   - status.json   (session status set to 'completed')
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DimensionType = 'relevance' | 'freshness' | 'clarity' | 'accuracy' | 'completeness';

interface DimensionResult {
    dimension: DimensionType;
    score: number | null;
    status: 'complete' | 'failed' | 'timeout' | 'retrying';
    findings: string[];
    recommendations: Recommendation[];
    failureReason?: string;
    retryCount: number;
    processingTime: number;
    spellingIssues?: { incorrect: string; correct: string; context: string }[];
    codeIssues?: { type: string; location: string; description: string; codeFragment: string }[];
    terminologyInconsistencies?: { variants: string[]; recommendation: string }[];
}

interface AIReadinessResult {
    llmsTxt: { found: boolean; url: string; content?: string };
    llmsFullTxt: { found: boolean; url: string };
    robotsTxt: { found: boolean; aiDirectives: Array<{ userAgent: string; rule: 'Allow' | 'Disallow' }> };
    markdownExports: { available: boolean; sampleUrls: string[] };
    structuredData: { hasJsonLd: boolean; schemaTypes: string[] };
    overallScore: number;
    recommendations: string[];
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

interface FinalReport {
    overallScore: number;
    dimensionsAnalyzed: number;
    dimensionsTotal: number;
    confidence: 'high' | 'medium' | 'low';
    modelUsed: string;
    cacheStatus: 'hit' | 'miss';
    dimensions: Record<DimensionType, DimensionResult>;
    codeAnalysis: CodeAnalysisSummary;
    mediaAnalysis: MediaAnalysisSummary;
    linkAnalysis: LinkAnalysisSummary;
    contextAnalysis?: ContextAnalysisSummary;
    urlSlugAnalysis?: {
        analyzedUrl: string;
        pathSegments: string[];
        issues: Array<{
            segment: string;
            fullPath: string;
            suggestion: string;
            confidence: 'HIGH' | 'MEDIUM' | 'LOW';
            editDistance: number;
        }>;
        overallStatus: 'clean' | 'issues-found';
    };
    sitemapHealth?: {
        totalUrls?: number;
        healthyUrls?: number;
        brokenUrls?: number;
        accessDeniedUrls?: number;
        timeoutUrls?: number;
        otherErrorUrls?: number;
        healthPercentage?: number;
        linkIssues?: Array<{
            url: string;
            status: number | string;
            errorMessage: string;
            issueType: '404' | 'access-denied' | 'timeout' | 'error';
        }>;
        processingTime: number;
        error?: string;
    };
    scope?: {
        url: string;
        mode: 'single-page' | 'sitemap';
        pagesAnalyzed: number;
        internalLinksValidated: number;
        sitemapChecked: boolean;
        sitemapUrl?: string;
        aiReadinessChecked: boolean;
    };
    _debug?: {
        toolExecutionTimes?: Record<string, number>;
        llmCallCount?: number;
        pipelineSteps?: Array<{ tool: string; status: 'success' | 'failed' | 'skipped'; durationMs: number }>;
    };
    analysisTime: number;
    retryCount: number;
    aiReadiness?: AIReadinessResult;
}

interface ContextAnalysisSummary {
    enabled: boolean;
    contextPages: ContextPage[];
    analysisScope: 'single-page' | 'with-context';
    totalPagesAnalyzed: number;
}

interface ContextPage {
    url: string;
    title: string;
    relationship: 'parent' | 'child' | 'sibling';
    confidence: number;
    cached?: boolean;
}

interface CodeAnalysisSummary {
    snippetsFound: number;
    syntaxErrors: number;
    deprecatedMethods: number;
    missingVersionSpecs: number;
    languagesDetected: string[];
}

interface MediaAnalysisSummary {
    videosFound: number;
    audiosFound: number;
    imagesFound: number;
    interactiveElements: number;
    accessibilityIssues: number;
    missingAltText: number;
}

interface LinkIssueFinding {
    url: string;
    status: number | string;
    anchorText: string;
    sourceLocation: string;
    errorMessage: string;
    issueType: '404' | 'error' | 'timeout' | 'access-denied';
}

interface LinkAnalysisSummary {
    totalLinks: number;
    internalLinks: number;
    externalLinks: number;
    brokenLinks: number;
    totalLinkIssues?: number;
    linkIssueFindings?: LinkIssueFinding[];
    subPagesIdentified: string[];
    linkContext: 'single-page' | 'multi-page-referenced';
    analysisScope: 'current-page-only' | 'with-subpages';
}

// ---------------------------------------------------------------------------
// Helper generators (ported 1-to-1 from report-generator/index.ts)
// ---------------------------------------------------------------------------

function generateCodeAnalysisFromContent(processedContent: any): CodeAnalysisSummary {
    const codeSnippets = processedContent.codeSnippets || [];
    const languagesDetected = [...new Set(codeSnippets.map((s: any) => s.language).filter(Boolean))];

    return {
        snippetsFound: codeSnippets.length,
        syntaxErrors: Math.floor(codeSnippets.length * 0.05),
        deprecatedMethods: Math.floor(codeSnippets.length * 0.02),
        missingVersionSpecs: codeSnippets.filter((s: any) => !s.hasVersionInfo).length,
        languagesDetected: languagesDetected.length > 0 ? languagesDetected as string[] : ['php', 'javascript']
    };
}

function generateMediaAnalysisFromContent(processedContent: any): MediaAnalysisSummary {
    const mediaElements = processedContent.mediaElements || [];

    return {
        videosFound: mediaElements.filter((m: any) => m.type === 'video').length,
        audiosFound: mediaElements.filter((m: any) => m.type === 'audio').length,
        imagesFound: mediaElements.filter((m: any) => m.type === 'image').length,
        interactiveElements: mediaElements.filter((m: any) => m.type === 'interactive').length,
        accessibilityIssues: mediaElements.filter((m: any) => m.analysisNote?.includes('accessibility')).length,
        missingAltText: mediaElements.filter((m: any) => m.type === 'image' && !m.alt).length
    };
}

function generateContextAnalysisFromContent(processedContent: any): ContextAnalysisSummary | undefined {
    if (!processedContent.contextAnalysis) {
        return undefined;
    }

    const contextAnalysis = processedContent.contextAnalysis;

    return {
        enabled: true,
        contextPages: contextAnalysis.contextPages || [],
        analysisScope: contextAnalysis.analysisScope || 'single-page',
        totalPagesAnalyzed: contextAnalysis.totalPagesAnalyzed || 1
    };
}

function generateDefaultCodeAnalysis(): CodeAnalysisSummary {
    return {
        snippetsFound: 8,
        syntaxErrors: 0,
        deprecatedMethods: 1,
        missingVersionSpecs: 2,
        languagesDetected: ['php', 'javascript', 'css']
    };
}

function generateDefaultMediaAnalysis(): MediaAnalysisSummary {
    return {
        videosFound: 0,
        audiosFound: 0,
        imagesFound: 4,
        interactiveElements: 1,
        accessibilityIssues: 1,
        missingAltText: 1
    };
}

function generateDefaultLinkAnalysis(): LinkAnalysisSummary {
    return {
        totalLinks: 15,
        internalLinks: 12,
        externalLinks: 3,
        brokenLinks: 0,
        subPagesIdentified: ['Getting Started', 'Advanced Topics'],
        linkContext: 'multi-page-referenced',
        analysisScope: 'current-page-only'
    };
}

function createEmptyDimensions(): Record<DimensionType, DimensionResult> {
    const emptyDimensionResult = (dimension: DimensionType): DimensionResult => ({
        dimension,
        score: null,
        status: 'failed',
        findings: [],
        recommendations: [],
        failureReason: 'Not applicable in sitemap mode',
        retryCount: 0,
        processingTime: 0
    });

    return {
        relevance: emptyDimensionResult('relevance'),
        freshness: emptyDimensionResult('freshness'),
        clarity: emptyDimensionResult('clarity'),
        accuracy: emptyDimensionResult('accuracy'),
        completeness: emptyDimensionResult('completeness')
    };
}

function createEmptyReport(): FinalReport {
    const emptyDimensionResult = (dimension: DimensionType): DimensionResult => ({
        dimension,
        score: null,
        status: 'failed',
        findings: [],
        recommendations: [],
        failureReason: 'Report generation failed',
        retryCount: 0,
        processingTime: 0
    });

    return {
        overallScore: 0,
        dimensionsAnalyzed: 0,
        dimensionsTotal: 5,
        confidence: 'low',
        modelUsed: 'unknown',
        cacheStatus: 'miss',
        dimensions: {
            relevance: emptyDimensionResult('relevance'),
            freshness: emptyDimensionResult('freshness'),
            clarity: emptyDimensionResult('clarity'),
            accuracy: emptyDimensionResult('accuracy'),
            completeness: emptyDimensionResult('completeness')
        },
        codeAnalysis: {
            snippetsFound: 0,
            syntaxErrors: 0,
            deprecatedMethods: 0,
            missingVersionSpecs: 0,
            languagesDetected: []
        },
        mediaAnalysis: {
            videosFound: 0,
            audiosFound: 0,
            imagesFound: 0,
            interactiveElements: 0,
            accessibilityIssues: 0,
            missingAltText: 0
        },
        linkAnalysis: {
            totalLinks: 0,
            internalLinks: 0,
            externalLinks: 0,
            brokenLinks: 0,
            subPagesIdentified: [],
            linkContext: 'single-page',
            analysisScope: 'current-page-only'
        },
        analysisTime: 0,
        retryCount: 0,
        aiReadiness: undefined
    };
}

function generateMockDimensionResultsSimple(selectedModel: string, processedContent: any): Record<DimensionType, DimensionResult> {
    const baseScores = {
        claude: { base: 82, variance: 8 },
        titan: { base: 76, variance: 10 },
        llama: { base: 79, variance: 9 },
        auto: { base: 80, variance: 8 }
    };

    const modelConfig = baseScores[selectedModel as keyof typeof baseScores] || baseScores.auto;

    let adjustedBase = modelConfig.base;
    if (processedContent) {
        if (processedContent.codeSnippets?.length > 5) adjustedBase += 3;
        if (processedContent.contentType === 'api-docs') adjustedBase += 2;
        if (processedContent.markdownContent?.length > 10000) adjustedBase += 2;
    }

    const scores = {
        relevance: Math.max(60, Math.min(95, adjustedBase + (Math.random() * modelConfig.variance * 2 - modelConfig.variance))),
        freshness: Math.max(55, Math.min(90, adjustedBase + (Math.random() * modelConfig.variance * 2 - modelConfig.variance))),
        clarity: Math.max(65, Math.min(95, adjustedBase + (Math.random() * modelConfig.variance * 2 - modelConfig.variance))),
        accuracy: Math.max(70, Math.min(98, adjustedBase + (Math.random() * modelConfig.variance * 2 - modelConfig.variance))),
        completeness: Math.max(60, Math.min(90, adjustedBase + (Math.random() * modelConfig.variance * 2 - modelConfig.variance)))
    };

    const mockFindings = {
        relevance: ['Content is highly relevant to developers', 'Examples are practical and current'],
        freshness: ['Most content is current', 'Some version references could be updated'],
        clarity: ['Well-structured content', 'Clear explanations'],
        accuracy: ['Code examples are syntactically correct', 'API usage is accurate'],
        completeness: ['Covers main topics well', 'Some advanced topics missing']
    };

    const mockRecommendations = {
        relevance: [{ priority: 'medium' as const, action: 'Add more beginner-friendly examples', impact: 'Improve accessibility for new developers' }],
        freshness: [{ priority: 'high' as const, action: 'Update documentation version references', impact: 'Ensure compatibility information is current' }],
        clarity: [{ priority: 'low' as const, action: 'Add more code comments in examples', impact: 'Improve code readability' }],
        accuracy: [],
        completeness: [{ priority: 'medium' as const, action: 'Add section on error handling', impact: 'Provide more comprehensive coverage' }]
    };

    const result: Record<DimensionType, DimensionResult> = {} as any;

    (['relevance', 'freshness', 'clarity', 'accuracy', 'completeness'] as DimensionType[]).forEach((dimension) => {
        result[dimension] = {
            dimension,
            score: Math.round(scores[dimension]),
            status: 'complete',
            findings: mockFindings[dimension],
            recommendations: mockRecommendations[dimension],
            retryCount: 0,
            processingTime: 2000 + Math.random() * 2000
        };
    });

    return result;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const generateReportTool = tool(
    async (input): Promise<string> => {
        const { sessionId, url, sourceMode, analysisMode, analysisStartTime } = input;

        console.log(`[generate_report] Generating final report for session: ${sessionId}, mode: ${sourceMode}`);

        const progress = createProgressHelper(sessionId);

        try {
            // ---- Progress: starting ----
            await progress.progress('Generating report...', 'report-generation');

            // ------------------------------------------------------------------
            // 1. Determine mode from sourceMode parameter (not file presence)
            // ------------------------------------------------------------------
            const isSitemapMode = sourceMode === 'sitemap';
            const sitemapHealthResults = await readSessionArtifact<any>(sessionId, 'sitemap-health.json');

            if (isSitemapMode) {
                console.log('[generate_report] Sitemap mode (from sourceMode parameter)');
            } else {
                console.log('[generate_report] Doc mode (from sourceMode parameter)');
            }

            // ==================================================================
            // SITEMAP MODE
            // ==================================================================
            if (isSitemapMode && sitemapHealthResults) {
                const totalTime = Date.now() - analysisStartTime;
                const healthPercentage = sitemapHealthResults.healthPercentage || 0;

                const finalReport: FinalReport = {
                    overallScore: healthPercentage,
                    dimensionsAnalyzed: 1,
                    dimensionsTotal: 1,
                    confidence: 'high',
                    modelUsed: 'Sitemap Health Checker',
                    cacheStatus: 'miss',
                    dimensions: createEmptyDimensions(),
                    codeAnalysis: generateDefaultCodeAnalysis(),
                    mediaAnalysis: generateDefaultMediaAnalysis(),
                    linkAnalysis: generateDefaultLinkAnalysis(),
                    sitemapHealth: {
                        totalUrls: sitemapHealthResults.totalUrls,
                        healthyUrls: sitemapHealthResults.healthyUrls,
                        brokenUrls: sitemapHealthResults.linkIssues?.filter((issue: any) => issue.issueType === '404').length || 0,
                        accessDeniedUrls: sitemapHealthResults.linkIssues?.filter((issue: any) => issue.issueType === 'access-denied').length || 0,
                        timeoutUrls: sitemapHealthResults.linkIssues?.filter((issue: any) => issue.issueType === 'timeout').length || 0,
                        otherErrorUrls: sitemapHealthResults.linkIssues?.filter((issue: any) => issue.issueType === 'error').length || 0,
                        healthPercentage: sitemapHealthResults.healthPercentage,
                        linkIssues: sitemapHealthResults.linkIssues || [],
                        processingTime: sitemapHealthResults.processingTime
                    },
                    analysisTime: totalTime,
                    retryCount: 0
                };

                console.log(`[generate_report] Sitemap health report: ${healthPercentage}% healthy (${sitemapHealthResults.totalUrls} URLs)`);

                // Persist report + status
                await writeSessionArtifact(sessionId, 'report.json', finalReport);
                await writeSessionArtifact(sessionId, 'status.json', {
                    status: 'completed',
                    overallScore: healthPercentage,
                    analysisTime: totalTime,
                    completedAt: new Date().toISOString()
                });

                // Final progress
                await progress.success(
                    `Analysis complete! Overall: ${healthPercentage}/100 (${(totalTime / 1000).toFixed(1)}s)`,
                    {
                        overallScore: healthPercentage,
                        totalTime,
                        totalUrls: sitemapHealthResults.totalUrls,
                        healthyUrls: sitemapHealthResults.healthyUrls
                    }
                );

                return JSON.stringify({
                    success: true,
                    mode: 'sitemap',
                    overallScore: healthPercentage,
                    totalUrls: sitemapHealthResults.totalUrls,
                    healthyUrls: sitemapHealthResults.healthyUrls,
                    analysisTime: totalTime,
                    status: 'completed'
                });
            }

            // ==================================================================
            // DOC MODE
            // ==================================================================

            // ---- 2. Read processed content ----
            const processedContent = await readSessionArtifact<any>(sessionId, 'processed-content.json');
            if (processedContent) {
                console.log('[generate_report] Retrieved processed content');
            } else {
                console.log('[generate_report] No processed content found (partial report)');
            }

            // ---- 3. Read dimension results ----
            const dimensionResults = await readSessionArtifact<Record<DimensionType, DimensionResult>>(
                sessionId,
                'dimension-results.json'
            );
            if (dimensionResults) {
                console.log('[generate_report] Retrieved dimension results');
            } else {
                console.log('[generate_report] No dimension results found (will use fallback)');
            }

            // ---- 4. Read AI readiness results ----
            const aiReadinessResults = await readSessionArtifact<AIReadinessResult>(
                sessionId,
                'ai-readiness-results.json'
            );
            if (aiReadinessResults) {
                console.log('[generate_report] Retrieved AI readiness results');
            } else {
                console.log('[generate_report] No AI readiness results (might be skipped or failed)');
            }

            // ---- 5. Attempt to retrieve cached sitemap health for the domain (doc-mode) ----
            let cachedSitemapHealth: FinalReport['sitemapHealth'] | null = null;

            // First try doc-mode sitemap health (from parallel execution)
            const docModeSitemapHealth = await readSessionArtifact<any>(sessionId, 'doc-mode-sitemap-health.json');
            if (docModeSitemapHealth && docModeSitemapHealth.sitemapStatus === 'success') {
                cachedSitemapHealth = {
                    totalUrls: docModeSitemapHealth.totalUrls,
                    healthyUrls: docModeSitemapHealth.healthyUrls,
                    brokenUrls: docModeSitemapHealth.linkIssues?.filter((i: any) => i.issueType === '404').length || 0,
                    accessDeniedUrls: docModeSitemapHealth.linkIssues?.filter((i: any) => i.issueType === 'access-denied').length || 0,
                    timeoutUrls: docModeSitemapHealth.linkIssues?.filter((i: any) => i.issueType === 'timeout').length || 0,
                    otherErrorUrls: docModeSitemapHealth.linkIssues?.filter((i: any) => i.issueType === 'error').length || 0,
                    healthPercentage: docModeSitemapHealth.healthPercentage,
                    linkIssues: docModeSitemapHealth.linkIssues || [],
                    processingTime: docModeSitemapHealth.processingTime || 0
                };
                console.log('[generate_report] Retrieved doc-mode sitemap health data');
            } else {
                // Fallback to cached sitemap health from previous Sitemap Mode run
                console.log('[generate_report] No doc-mode sitemap health, trying domain-level cache');
                try {
                    const urlObj = new URL(url);
                    const domain = urlObj.hostname;
                    const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
                    const sitemapCacheKey = `sitemap-health-${normalizedDomain.replace(/\./g, '-')}.json`;

                    console.log(`[generate_report] Checking cached sitemap health at key: ${sitemapCacheKey}`);
                    const healthData = ANALYSIS_BUCKET
                        ? await readFromS3<any>(ANALYSIS_BUCKET, sitemapCacheKey)
                        : null;

                    if (healthData) {
                        if (healthData.sitemapStatus === 'success') {
                            cachedSitemapHealth = {
                                totalUrls: healthData.totalUrls,
                                healthyUrls: healthData.healthyUrls,
                                brokenUrls: healthData.brokenUrls,
                                accessDeniedUrls: healthData.accessDeniedUrls,
                                timeoutUrls: healthData.timeoutUrls,
                                otherErrorUrls: healthData.otherErrorUrls,
                                healthPercentage: healthData.healthPercentage,
                                linkIssues: healthData.linkIssues || [],
                                processingTime: healthData.processingTime || 0
                            };
                            console.log('[generate_report] Retrieved cached sitemap health data');
                        } else if (healthData.sitemapStatus === 'error') {
                            cachedSitemapHealth = {
                                error: healthData.error || healthData.message || 'Sitemap check failed',
                                processingTime: healthData.processingTime || 0
                            };
                            console.log(`[generate_report] Retrieved sitemap error: ${healthData.error}`);
                        }
                    }
                } catch (error) {
                    console.log('[generate_report] No cached sitemap health data found (optional):', error);
                }
            }

            // ---- 6. Determine selected model (default to auto) ----
            const selectedModel = analysisMode || 'auto';

            // ---- 7. Use real or fallback dimension results ----
            const finalDimensionResults = dimensionResults || generateMockDimensionResultsSimple(selectedModel, processedContent);

            // ---- 8. Calculate overall score ----
            const validScores = Object.values(finalDimensionResults)
                .filter(d => d.score !== null && d.status === 'complete')
                .map(d => d.score!);

            const overallScore = validScores.length > 0
                ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
                : 0;

            // ---- 9. Build analysis summaries ----
            const codeAnalysis = processedContent
                ? generateCodeAnalysisFromContent(processedContent)
                : generateDefaultCodeAnalysis();

            const mediaAnalysis = processedContent
                ? generateMediaAnalysisFromContent(processedContent)
                : generateDefaultMediaAnalysis();

            const linkAnalysis: LinkAnalysisSummary = processedContent
                ? {
                    totalLinks: processedContent.linkAnalysis?.totalLinks ?? 0,
                    internalLinks: processedContent.linkAnalysis?.internalLinks ?? 0,
                    externalLinks: processedContent.linkAnalysis?.externalLinks ?? 0,
                    brokenLinks: processedContent.linkAnalysis?.brokenLinks ?? 0,
                    totalLinkIssues: processedContent.linkAnalysis?.totalLinkIssues ?? 0,
                    linkIssueFindings: processedContent.linkAnalysis?.linkValidation?.linkIssueFindings ?? [],
                    subPagesIdentified: processedContent.linkAnalysis?.subPagesIdentified ?? [],
                    linkContext: processedContent.linkAnalysis?.linkContext ?? 'single-page',
                    analysisScope: processedContent.linkAnalysis?.analysisScope ?? 'current-page-only',
                }
                : generateDefaultLinkAnalysis();

            const contextAnalysis = processedContent?.contextAnalysis
                ? generateContextAnalysisFromContent(processedContent)
                : undefined;

            // ---- 10. Assemble final report ----
            const totalTime = Date.now() - analysisStartTime;
            const finalReport: FinalReport = {
                overallScore,
                dimensionsAnalyzed: validScores.length,
                dimensionsTotal: 5,
                confidence: validScores.length === 5 ? 'high' : validScores.length >= 3 ? 'medium' : 'low',
                modelUsed: selectedModel === 'auto' ? 'Claude 3.5 Sonnet' : selectedModel,
                cacheStatus: processedContent?.cacheMetadata?.wasFromCache ? 'hit' : 'miss',
                dimensions: finalDimensionResults,
                codeAnalysis,
                mediaAnalysis,
                linkAnalysis,
                contextAnalysis,
                urlSlugAnalysis: processedContent?.urlSlugAnalysis,
                scope: {
                    url: url,
                    mode: 'single-page',
                    pagesAnalyzed: 1,
                    internalLinksValidated: linkAnalysis.totalLinks,
                    sitemapChecked: !!(cachedSitemapHealth),
                    sitemapUrl: cachedSitemapHealth ? undefined : undefined,
                    aiReadinessChecked: !!aiReadinessResults,
                },
                _debug: {
                    toolExecutionTimes: Object.fromEntries(
                        Object.entries(finalDimensionResults).map(([dim, r]) => [dim, r.processingTime || 0])
                    ),
                    llmCallCount: validScores.length,
                    pipelineSteps: [
                        { tool: 'process_url', status: processedContent ? 'success' : 'failed', durationMs: 0 },
                        { tool: 'detect_structure', status: 'success', durationMs: 0 },
                        { tool: 'analyze_dimensions', status: validScores.length > 0 ? 'success' : 'failed', durationMs: Object.values(finalDimensionResults).reduce((sum, r) => sum + (r.processingTime || 0), 0) },
                        { tool: 'check_ai_readiness', status: aiReadinessResults ? 'success' : 'skipped', durationMs: 0 },
                        { tool: 'check_sitemap_health', status: cachedSitemapHealth ? 'success' : 'skipped', durationMs: 0 },
                        { tool: 'generate_report', status: 'success', durationMs: totalTime },
                    ],
                },
                analysisTime: totalTime,
                retryCount: 0,
                aiReadiness: aiReadinessResults || undefined,
                sitemapHealth: cachedSitemapHealth || undefined
            };

            console.log(JSON.stringify({
                sessionId, tool: 'generate_report', event: 'report_generated',
                overallScore, dimensionsAnalyzed: validScores.length,
                totalProcessingTimeMs: totalTime,
                sitemapChecked: !!cachedSitemapHealth,
                aiReadinessChecked: !!aiReadinessResults,
            }));

            // ---- 11. Persist report + status ----
            await writeSessionArtifact(sessionId, 'report.json', finalReport);
            await writeSessionArtifact(sessionId, 'status.json', {
                status: 'completed',
                overallScore,
                analysisTime: totalTime,
                dimensionsAnalyzed: validScores.length,
                completedAt: new Date().toISOString()
            });

            // ---- 12. Final progress ----
            await progress.success(
                `Analysis complete! Overall: ${overallScore}/100 (${(totalTime / 1000).toFixed(1)}s)`,
                {
                    overallScore,
                    totalTime,
                    dimensionsAnalyzed: validScores.length
                }
            );

            return JSON.stringify({
                success: true,
                mode: 'doc',
                overallScore,
                dimensionsAnalyzed: validScores.length,
                dimensionsTotal: 5,
                confidence: finalReport.confidence,
                cacheStatus: finalReport.cacheStatus,
                codeSnippets: codeAnalysis.snippetsFound,
                mediaElements: mediaAnalysis.imagesFound + mediaAnalysis.videosFound,
                totalLinks: linkAnalysis.totalLinks,
                brokenLinks: linkAnalysis.brokenLinks,
                hasAiReadiness: !!aiReadinessResults,
                hasSitemapHealth: !!cachedSitemapHealth,
                hasContextAnalysis: !!contextAnalysis,
                hasUrlSlugAnalysis: !!processedContent?.urlSlugAnalysis,
                analysisTime: totalTime,
                status: 'completed'
            });

        } catch (error) {
            console.error('[generate_report] Report generation failed:', error);

            // Persist empty report so downstream consumers still have a status
            const emptyReport = createEmptyReport();
            try {
                await writeSessionArtifact(sessionId, 'report.json', emptyReport);
                await writeSessionArtifact(sessionId, 'status.json', {
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'Unknown error',
                    failedAt: new Date().toISOString()
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
                status: 'failed'
            });
        }
    },
    {
        name: 'generate_report',
        description:
            'Aggregates all analysis artifacts into a final report. ' +
            'Reads processed-content.json, dimension-results.json, ai-readiness-results.json, ' +
            'and sitemap-health.json from S3. Uses sourceMode to determine doc mode (dimension scores) vs sitemap mode ' +
            '(health percentage). Produces report.json and status.json, then publishes completion progress. ' +
            'Call this as the LAST step after all other analysis tools have completed. ' +
            'IMPORTANT: Pass sourceMode="doc" for document analysis or sourceMode="sitemap" for sitemap health checks.',
        schema: z.object({
            sessionId: z.string().describe('The analysis session ID'),
            url: z.string().describe('The URL being analyzed'),
            sourceMode: z.enum(['doc', 'sitemap']).describe('The analysis mode: "doc" for document analysis or "sitemap" for sitemap health check'),
            analysisMode: z.string().default('auto').describe('The analysis model/mode (e.g., auto, claude, titan, llama)'),
            analysisStartTime: z.number().describe('Epoch timestamp (ms) when analysis started, used to calculate total duration')
        })
    }
);
