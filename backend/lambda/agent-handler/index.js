"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const agent_1 = require("./agent");
const progress_publisher_1 = require("./shared/progress-publisher");
const s3_helpers_1 = require("./shared/s3-helpers");
const handler = async (event) => {
    console.log('[Handler] Received event:', JSON.stringify(event, null, 2));
    console.log('[Handler] Lensy Pipeline v2.0.0 — Direct Orchestration');
    const { url, sessionId, selectedModel = 'claude', analysisStartTime = Date.now(), contextAnalysis, cacheControl, sitemapUrl, llmsTxtUrl, ipHash, skipCitations, citationsOnly, } = event;
    // Validate required fields
    if (!url || !sessionId) {
        console.error('[Handler] Missing required fields: url and sessionId');
        return;
    }
    // Initialize progress publisher for status updates
    const progress = new progress_publisher_1.ProgressPublisher(sessionId);
    // Write initial status to S3 so frontend knows analysis started
    await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
        status: 'running',
        sessionId,
        url,
        startTime: analysisStartTime,
        engine: 'pipeline',
        message: 'Analysis pipeline started'
    });
    // Set up a watchdog timer (12 minutes — Lambda timeout is 15 min)
    const watchdogTimeout = setTimeout(async () => {
        console.error('[Handler] Watchdog timeout triggered at 12 minutes');
        await progress.error('Analysis timed out after 12 minutes');
        await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
            status: 'failed',
            sessionId,
            url,
            startTime: analysisStartTime,
            endTime: Date.now(),
            engine: 'pipeline',
            error: 'Analysis timed out after 12 minutes'
        });
    }, 12 * 60 * 1000);
    try {
        // ── Citations-only mode: just run Perplexity discoverability check ──
        if (citationsOnly) {
            await progress.info('Running AI citation check...');
            const { checkAIDiscoverabilityTool } = await import('./tools/check-ai-discoverability.js');
            const citationResult = await checkAIDiscoverabilityTool.invoke({ url, sessionId });
            clearTimeout(watchdogTimeout);
            console.log(`[Handler] Citations-only complete for session: ${sessionId}`);
            return;
        }
        await progress.info('Starting AI readiness analysis...', {
            toolName: 'pipeline',
        });
        const agentInput = {
            url,
            sessionId,
            selectedModel,
            analysisStartTime,
            contextAnalysis,
            cacheControl,
            sitemapUrl,
            llmsTxtUrl,
            ipHash,
            skipCitations,
        };
        // Run the direct analysis pipeline
        const result = await (0, agent_1.runAgent)(agentInput);
        clearTimeout(watchdogTimeout);
        console.log('[Handler] Pipeline completed successfully');
        console.log('[Handler] Result preview:', result.substring(0, 500));
        // The generate_report tool writes report.json on success.
        // Check before marking as completed.
        const reportExists = await (0, s3_helpers_1.readSessionArtifact)(sessionId, 'report.json');
        if (reportExists) {
            await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
                status: 'completed',
                sessionId,
                url,
                startTime: analysisStartTime,
                endTime: Date.now(),
                duration: Date.now() - analysisStartTime,
                engine: 'pipeline',
                message: 'Analysis completed successfully'
            });
        }
        else {
            // Check if status was already set to 'rejected' by the content gate
            const existingStatus = await (0, s3_helpers_1.readSessionArtifact)(sessionId, 'status.json');
            // readSessionArtifact already returns a parsed object — no need for JSON.parse
            const alreadyRejected = existingStatus && existingStatus.status === 'rejected';
            if (!alreadyRejected) {
                console.log('[Handler] Pipeline completed but no report.json found — marking as failed');
                await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
                    status: 'failed',
                    sessionId,
                    url,
                    startTime: analysisStartTime,
                    endTime: Date.now(),
                    engine: 'pipeline',
                    error: 'Analysis was stopped before report generation. Check progress messages for details.'
                });
            }
            else {
                console.log('[Handler] Pipeline completed with rejection — preserving existing rejected status');
            }
        }
    }
    catch (error) {
        clearTimeout(watchdogTimeout);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Handler] Pipeline failed:', errorMessage);
        console.error('[Handler] Stack:', error instanceof Error ? error.stack : '');
        // Publish error to frontend
        await progress.error(`Analysis failed: ${errorMessage}`);
        // Write failed status to S3
        await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
            status: 'failed',
            sessionId,
            url,
            startTime: analysisStartTime,
            endTime: Date.now(),
            engine: 'pipeline',
            error: errorMessage
        });
    }
};
exports.handler = handler;
