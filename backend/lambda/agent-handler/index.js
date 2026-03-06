"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const agent_1 = require("./agent");
const progress_publisher_1 = require("./shared/progress-publisher");
const s3_helpers_1 = require("./shared/s3-helpers");
// Enable LangSmith tracing when API key is available
if (process.env.LANGSMITH_API_KEY) {
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_PROJECT = `lensy-${process.env.LENSY_ENV || 'prod'}`;
}
const handler = async (event) => {
    console.log('[AgentHandler] Received event:', JSON.stringify(event, null, 2));
    console.log('[AgentHandler] Lensy Agent v1.0.0 — LangGraph + Bedrock');
    const { url, sessionId, selectedModel = 'claude', analysisStartTime = Date.now(), contextAnalysis, cacheControl, sitemapUrl, llmsTxtUrl } = event;
    // Validate required fields
    if (!url || !sessionId) {
        console.error('[AgentHandler] Missing required fields: url and sessionId');
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
        engine: 'agent',
        message: 'Agent analysis started'
    });
    // Set up a watchdog timer (12 minutes — Lambda timeout is 15 min)
    const watchdogTimeout = setTimeout(async () => {
        console.error('[AgentHandler] Watchdog timeout triggered at 12 minutes');
        await progress.error('Analysis timed out after 12 minutes');
        await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
            status: 'failed',
            sessionId,
            url,
            startTime: analysisStartTime,
            endTime: Date.now(),
            engine: 'agent',
            error: 'Analysis timed out after 12 minutes'
        });
    }, 12 * 60 * 1000);
    try {
        await progress.info('🚀 Starting documentation analysis with AI agent...', {
            toolName: 'agent',
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
        };
        // Run the LangGraph agent
        const result = await (0, agent_1.runAgent)(agentInput);
        clearTimeout(watchdogTimeout);
        console.log('[AgentHandler] Agent completed successfully');
        console.log('[AgentHandler] Result preview:', result.substring(0, 500));
        // The agent's generate_report tool writes report.json on success.
        // But if the content gate stopped the pipeline, report.json won't exist.
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
                engine: 'agent',
                message: 'Analysis completed successfully'
            });
        }
        else {
            // Agent finished without generating a report (e.g., content gate rejection)
            console.log('[AgentHandler] Agent completed but no report.json found — marking as failed');
            await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
                status: 'failed',
                sessionId,
                url,
                startTime: analysisStartTime,
                endTime: Date.now(),
                engine: 'agent',
                error: 'Analysis was stopped before report generation. Check progress messages for details.'
            });
        }
    }
    catch (error) {
        clearTimeout(watchdogTimeout);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[AgentHandler] Agent failed:', errorMessage);
        console.error('[AgentHandler] Stack:', error instanceof Error ? error.stack : '');
        // Publish error to frontend
        await progress.error(`Analysis failed: ${errorMessage}`);
        // Write failed status to S3
        await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
            status: 'failed',
            sessionId,
            url,
            startTime: analysisStartTime,
            endTime: Date.now(),
            engine: 'agent',
            error: errorMessage
        });
    }
};
exports.handler = handler;
