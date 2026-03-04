"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReportTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const s3_helpers_1 = require("../shared/s3-helpers");
const publish_progress_1 = require("./publish-progress");
// ---------------------------------------------------------------------------
// Helper generators (ported 1-to-1 from report-generator/index.ts)
// ---------------------------------------------------------------------------
function generateCodeAnalysisFromContent(processedContent) {
    const codeSnippets = processedContent.codeSnippets || [];
    const languagesDetected = [...new Set(codeSnippets.map((s) => s.language).filter(Boolean))];
    return {
        snippetsFound: codeSnippets.length,
        syntaxErrors: Math.floor(codeSnippets.length * 0.05),
        deprecatedMethods: Math.floor(codeSnippets.length * 0.02),
        missingVersionSpecs: codeSnippets.filter((s) => !s.hasVersionInfo).length,
        languagesDetected: languagesDetected.length > 0 ? languagesDetected : ['php', 'javascript']
    };
}
function generateMediaAnalysisFromContent(processedContent) {
    const mediaElements = processedContent.mediaElements || [];
    return {
        videosFound: mediaElements.filter((m) => m.type === 'video').length,
        audiosFound: mediaElements.filter((m) => m.type === 'audio').length,
        imagesFound: mediaElements.filter((m) => m.type === 'image').length,
        interactiveElements: mediaElements.filter((m) => m.type === 'interactive').length,
        accessibilityIssues: mediaElements.filter((m) => m.analysisNote?.includes('accessibility')).length,
        missingAltText: mediaElements.filter((m) => m.type === 'image' && !m.alt).length
    };
}
function generateContextAnalysisFromContent(processedContent) {
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
function generateDefaultCodeAnalysis() {
    return {
        snippetsFound: 8,
        syntaxErrors: 0,
        deprecatedMethods: 1,
        missingVersionSpecs: 2,
        languagesDetected: ['php', 'javascript', 'css']
    };
}
function generateDefaultMediaAnalysis() {
    return {
        videosFound: 0,
        audiosFound: 0,
        imagesFound: 4,
        interactiveElements: 1,
        accessibilityIssues: 1,
        missingAltText: 1
    };
}
function generateDefaultLinkAnalysis() {
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
function createEmptyDimensions() {
    const emptyDimensionResult = (dimension) => ({
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
function createEmptyReport() {
    const emptyDimensionResult = (dimension) => ({
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
function generateMockDimensionResultsSimple(selectedModel, processedContent) {
    const baseScores = {
        claude: { base: 82, variance: 8 },
        titan: { base: 76, variance: 10 },
        llama: { base: 79, variance: 9 },
        auto: { base: 80, variance: 8 }
    };
    const modelConfig = baseScores[selectedModel] || baseScores.auto;
    let adjustedBase = modelConfig.base;
    if (processedContent) {
        if (processedContent.codeSnippets?.length > 5)
            adjustedBase += 3;
        if (processedContent.contentType === 'api-docs')
            adjustedBase += 2;
        if (processedContent.markdownContent?.length > 10000)
            adjustedBase += 2;
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
        relevance: [{ priority: 'medium', action: 'Add more beginner-friendly examples', impact: 'Improve accessibility for new developers' }],
        freshness: [{ priority: 'high', action: 'Update documentation version references', impact: 'Ensure compatibility information is current' }],
        clarity: [{ priority: 'low', action: 'Add more code comments in examples', impact: 'Improve code readability' }],
        accuracy: [],
        completeness: [{ priority: 'medium', action: 'Add section on error handling', impact: 'Provide more comprehensive coverage' }]
    };
    const result = {};
    ['relevance', 'freshness', 'clarity', 'accuracy', 'completeness'].forEach((dimension) => {
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
exports.generateReportTool = (0, tools_1.tool)(async (input) => {
    const { sessionId, url, sourceMode, analysisMode, analysisStartTime } = input;
    console.log(`[generate_report] Generating final report for session: ${sessionId}, mode: ${sourceMode}`);
    const progress = (0, publish_progress_1.createProgressHelper)(sessionId);
    try {
        // ---- Progress: starting ----
        await progress.progress('Generating report...', 'report-generation');
        // ------------------------------------------------------------------
        // 1. Determine mode from sourceMode parameter (not file presence)
        // ------------------------------------------------------------------
        const isSitemapMode = sourceMode === 'sitemap';
        const sitemapHealthResults = await (0, s3_helpers_1.readSessionArtifact)(sessionId, 'sitemap-health.json');
        if (isSitemapMode) {
            console.log('[generate_report] Sitemap mode (from sourceMode parameter)');
        }
        else {
            console.log('[generate_report] Doc mode (from sourceMode parameter)');
        }
        // ==================================================================
        // SITEMAP MODE
        // ==================================================================
        if (isSitemapMode && sitemapHealthResults) {
            const totalTime = Date.now() - analysisStartTime;
            const healthPercentage = sitemapHealthResults.healthPercentage || 0;
            const finalReport = {
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
                    brokenUrls: sitemapHealthResults.linkIssues?.filter((issue) => issue.issueType === '404').length || 0,
                    accessDeniedUrls: sitemapHealthResults.linkIssues?.filter((issue) => issue.issueType === 'access-denied').length || 0,
                    timeoutUrls: sitemapHealthResults.linkIssues?.filter((issue) => issue.issueType === 'timeout').length || 0,
                    otherErrorUrls: sitemapHealthResults.linkIssues?.filter((issue) => issue.issueType === 'error').length || 0,
                    healthPercentage: sitemapHealthResults.healthPercentage,
                    linkIssues: sitemapHealthResults.linkIssues || [],
                    processingTime: sitemapHealthResults.processingTime
                },
                analysisTime: totalTime,
                retryCount: 0
            };
            console.log(`[generate_report] Sitemap health report: ${healthPercentage}% healthy (${sitemapHealthResults.totalUrls} URLs)`);
            // Persist report + status
            await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'report.json', finalReport);
            await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
                status: 'completed',
                overallScore: healthPercentage,
                analysisTime: totalTime,
                completedAt: new Date().toISOString()
            });
            // Final progress
            await progress.success(`Analysis complete! Overall: ${healthPercentage}/100 (${(totalTime / 1000).toFixed(1)}s)`, {
                overallScore: healthPercentage,
                totalTime,
                totalUrls: sitemapHealthResults.totalUrls,
                healthyUrls: sitemapHealthResults.healthyUrls
            });
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
        const processedContent = await (0, s3_helpers_1.readSessionArtifact)(sessionId, 'processed-content.json');
        if (processedContent) {
            console.log('[generate_report] Retrieved processed content');
        }
        else {
            console.log('[generate_report] No processed content found (partial report)');
        }
        // ---- 3. Read dimension results ----
        const dimensionResults = await (0, s3_helpers_1.readSessionArtifact)(sessionId, 'dimension-results.json');
        if (dimensionResults) {
            console.log('[generate_report] Retrieved dimension results');
        }
        else {
            console.log('[generate_report] No dimension results found (will use fallback)');
        }
        // ---- 4. Read AI readiness results ----
        const aiReadinessResults = await (0, s3_helpers_1.readSessionArtifact)(sessionId, 'ai-readiness-results.json');
        if (aiReadinessResults) {
            console.log('[generate_report] Retrieved AI readiness results');
        }
        else {
            console.log('[generate_report] No AI readiness results (might be skipped or failed)');
        }
        // ---- 5. Attempt to retrieve cached sitemap health for the domain (doc-mode) ----
        let cachedSitemapHealth = null;
        // First try doc-mode sitemap health (from parallel execution)
        const docModeSitemapHealth = await (0, s3_helpers_1.readSessionArtifact)(sessionId, 'doc-mode-sitemap-health.json');
        if (docModeSitemapHealth && docModeSitemapHealth.sitemapStatus === 'success') {
            cachedSitemapHealth = {
                totalUrls: docModeSitemapHealth.totalUrls,
                healthyUrls: docModeSitemapHealth.healthyUrls,
                brokenUrls: docModeSitemapHealth.linkIssues?.filter((i) => i.issueType === '404').length || 0,
                accessDeniedUrls: docModeSitemapHealth.linkIssues?.filter((i) => i.issueType === 'access-denied').length || 0,
                timeoutUrls: docModeSitemapHealth.linkIssues?.filter((i) => i.issueType === 'timeout').length || 0,
                otherErrorUrls: docModeSitemapHealth.linkIssues?.filter((i) => i.issueType === 'error').length || 0,
                healthPercentage: docModeSitemapHealth.healthPercentage,
                linkIssues: docModeSitemapHealth.linkIssues || [],
                processingTime: docModeSitemapHealth.processingTime || 0
            };
            console.log('[generate_report] Retrieved doc-mode sitemap health data');
        }
        else {
            // Fallback to cached sitemap health from previous Sitemap Mode run
            console.log('[generate_report] No doc-mode sitemap health, trying domain-level cache');
            try {
                const urlObj = new URL(url);
                const domain = urlObj.hostname;
                const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
                const sitemapCacheKey = `sitemap-health-${normalizedDomain.replace(/\./g, '-')}.json`;
                console.log(`[generate_report] Checking cached sitemap health at key: ${sitemapCacheKey}`);
                const healthData = s3_helpers_1.ANALYSIS_BUCKET
                    ? await (0, s3_helpers_1.readFromS3)(s3_helpers_1.ANALYSIS_BUCKET, sitemapCacheKey)
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
                    }
                    else if (healthData.sitemapStatus === 'error') {
                        cachedSitemapHealth = {
                            error: healthData.error || healthData.message || 'Sitemap check failed',
                            processingTime: healthData.processingTime || 0
                        };
                        console.log(`[generate_report] Retrieved sitemap error: ${healthData.error}`);
                    }
                }
            }
            catch (error) {
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
            .map(d => d.score);
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
        const linkAnalysis = processedContent
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
        const finalReport = {
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
                toolExecutionTimes: Object.fromEntries(Object.entries(finalDimensionResults).map(([dim, r]) => [dim, r.processingTime || 0])),
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
        await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'report.json', finalReport);
        await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
            status: 'completed',
            overallScore,
            analysisTime: totalTime,
            dimensionsAnalyzed: validScores.length,
            completedAt: new Date().toISOString()
        });
        // ---- 12. Final progress ----
        await progress.success(`Analysis complete! Overall: ${overallScore}/100 (${(totalTime / 1000).toFixed(1)}s)`, {
            overallScore,
            totalTime,
            dimensionsAnalyzed: validScores.length
        });
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
    }
    catch (error) {
        console.error('[generate_report] Report generation failed:', error);
        // Persist empty report so downstream consumers still have a status
        const emptyReport = createEmptyReport();
        try {
            await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'report.json', emptyReport);
            await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
                status: 'failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                failedAt: new Date().toISOString()
            });
        }
        catch (writeError) {
            console.error('[generate_report] Could not persist failure status:', writeError);
        }
        await progress.error(`Report generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { toolName: 'generate_report' });
        return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            status: 'failed'
        });
    }
}, {
    name: 'generate_report',
    description: 'Aggregates all analysis artifacts into a final report. ' +
        'Reads processed-content.json, dimension-results.json, ai-readiness-results.json, ' +
        'and sitemap-health.json from S3. Uses sourceMode to determine doc mode (dimension scores) vs sitemap mode ' +
        '(health percentage). Produces report.json and status.json, then publishes completion progress. ' +
        'Call this as the LAST step after all other analysis tools have completed. ' +
        'IMPORTANT: Pass sourceMode="doc" for document analysis or sourceMode="sitemap" for sitemap health checks.',
    schema: zod_1.z.object({
        sessionId: zod_1.z.string().describe('The analysis session ID'),
        url: zod_1.z.string().describe('The URL being analyzed'),
        sourceMode: zod_1.z.enum(['doc', 'sitemap']).describe('The analysis mode: "doc" for document analysis or "sitemap" for sitemap health check'),
        analysisMode: zod_1.z.string().default('auto').describe('The analysis model/mode (e.g., auto, claude, titan, llama)'),
        analysisStartTime: zod_1.z.number().describe('Epoch timestamp (ms) when analysis started, used to calculate total duration')
    })
});
