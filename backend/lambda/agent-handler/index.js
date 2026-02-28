"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const agent_1 = require("./agent");
const progress_publisher_1 = require("./shared/progress-publisher");
const s3_helpers_1 = require("./shared/s3-helpers");

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Content-Type': 'application/json'
};

const handler = async (event) => {
    console.log('[AgentHandler] Received event:', JSON.stringify(event, null, 2));
    console.log('[AgentHandler] Lensy Agent v2.0.0 — LangGraph + Bedrock + MCP');

    const mode = event.mode || 'doc-analysis';

    if (mode === 'github-issues') {
        return handleGithubIssues(event);
    }

    // Default: doc-analysis mode (unchanged)
    return handleDocAnalysis(event);
};
exports.handler = handler;

// ─── Doc Analysis Mode (unchanged) ──────────────────────────

async function handleDocAnalysis(event) {
    const { url, sessionId, selectedModel = 'claude', analysisStartTime = Date.now(), contextAnalysis, cacheControl } = event;

    if (!url || !sessionId) {
        console.error('[AgentHandler] Missing required fields: url and sessionId');
        return;
    }

    const progress = new progress_publisher_1.ProgressPublisher(sessionId);

    await (0, s3_helpers_1.writeSessionArtifact)(sessionId, 'status.json', {
        status: 'running',
        sessionId,
        url,
        startTime: analysisStartTime,
        engine: 'agent',
        message: 'Agent analysis started'
    });

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
        await progress.info('Starting documentation analysis with AI agent...', { toolName: 'agent' });

        const agentInput = {
            mode: 'doc-analysis',
            url,
            sessionId,
            selectedModel,
            analysisStartTime,
            contextAnalysis,
            cacheControl,
        };

        const result = await (0, agent_1.runAgent)(agentInput);
        clearTimeout(watchdogTimeout);

        console.log('[AgentHandler] Agent completed successfully');
        console.log('[AgentHandler] Result preview:', result.substring(0, 500));

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
    } catch (error) {
        clearTimeout(watchdogTimeout);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[AgentHandler] Agent failed:', errorMessage);
        console.error('[AgentHandler] Stack:', error instanceof Error ? error.stack : '');
        await progress.error(`Analysis failed: ${errorMessage}`);
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
}

// ─── GitHub Issues Mode ─────────────────────────────────────

async function handleGithubIssues(event) {
    const {
        operation, owner, repo, issues, docsUrl, crawlUrl,
        filePath, originalText, correctedText, issueNumber, issueTitle,
        gapType, confidence, sessionId
    } = event;

    console.log(`[AgentHandler] GitHub Issues mode: operation=${operation}, owner=${owner}, repo=${repo}`);

    // Determine if this is sync or async
    // Sync: fetch, create-pr (return response directly)
    // Async: analyze with crawlUrl, build-kb (write to S3, frontend polls)
    const isAsync = (operation === 'build-kb') ||
                    (operation === 'analyze' && crawlUrl);

    const progress = sessionId ? new progress_publisher_1.ProgressPublisher(sessionId) : null;

    // For async operations, set up watchdog and S3 status
    let watchdogTimeout;
    if (isAsync && sessionId) {
        await (0, s3_helpers_1.writeToS3)(
            process.env.ANALYSIS_BUCKET,
            `github-issues-results/${sessionId}.json`,
            { status: 'running', operation, startTime: Date.now() }
        );

        watchdogTimeout = setTimeout(async () => {
            console.error('[AgentHandler] GitHub Issues watchdog timeout at 12 minutes');
            if (progress) await progress.error('Operation timed out after 12 minutes');
            await (0, s3_helpers_1.writeToS3)(
                process.env.ANALYSIS_BUCKET,
                `github-issues-results/${sessionId}.json`,
                { status: 'failed', operation, error: 'Timed out after 12 minutes' }
            );
        }, 12 * 60 * 1000);
    }

    try {
        const agentInput = {
            mode: 'github-issues',
            operation,
            owner,
            repo,
            issues,
            docsUrl,
            crawlUrl,
            filePath,
            originalText,
            correctedText,
            issueNumber,
            issueTitle,
            gapType,
            confidence,
            sessionId,
        };

        const result = await (0, agent_1.runAgent)(agentInput);

        if (watchdogTimeout) clearTimeout(watchdogTimeout);
        console.log('[AgentHandler] GitHub Issues agent completed');
        console.log('[AgentHandler] Result preview:', result.substring(0, 500));

        // Try to parse the agent's text response as JSON
        let responseBody;
        try {
            // Agent may wrap JSON in markdown code blocks
            const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
            const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();
            responseBody = JSON.parse(jsonStr);
        } catch {
            // If not valid JSON, wrap the text response
            responseBody = { result: result };
        }

        // For sync operations, return as Lambda response
        if (!isAsync) {
            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify(responseBody)
            };
        }

        // For async operations, the agent's tools already saved to S3
        // Just ensure completion status
        if (sessionId) {
            await (0, s3_helpers_1.writeToS3)(
                process.env.ANALYSIS_BUCKET,
                `github-issues-results/${sessionId}.json`,
                responseBody
            );
        }

    } catch (error) {
        if (watchdogTimeout) clearTimeout(watchdogTimeout);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[AgentHandler] GitHub Issues agent failed:', errorMessage);
        console.error('[AgentHandler] Stack:', error instanceof Error ? error.stack : '');

        if (progress) await progress.error(`Operation failed: ${errorMessage}`);

        // Detect specific error types
        let statusCode = 500;
        let errorType = 'internal_error';
        if (errorMessage.includes('rate limit') || errorMessage.includes('RATE_LIMIT')) {
            statusCode = 429;
            errorType = 'rate_limit';
        } else if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
            statusCode = 404;
            errorType = 'not_found';
        } else if (errorMessage.includes('403')) {
            statusCode = 403;
            errorType = 'access_denied';
        }

        const errorPayload = {
            error: errorType,
            message: errorMessage
        };

        if (isAsync && sessionId) {
            await (0, s3_helpers_1.writeToS3)(
                process.env.ANALYSIS_BUCKET,
                `github-issues-results/${sessionId}.json`,
                { status: 'failed', ...errorPayload }
            );
        }

        return {
            statusCode,
            headers: CORS_HEADERS,
            body: JSON.stringify(errorPayload)
        };
    }
}
