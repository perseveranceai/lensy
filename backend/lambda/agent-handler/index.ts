import { Handler } from 'aws-lambda';
import { runAgent, AgentRunInput } from './agent';
import { ProgressPublisher } from './shared/progress-publisher';
import { writeSessionArtifact } from './shared/s3-helpers';

/**
 * Lensy Agent Handler — Lambda entry point
 *
 * Invoked asynchronously (InvocationType: Event) by the API handler
 * when USE_AGENT=true. Runs the LangGraph agent to analyze a URL
 * and stores results in S3.
 *
 * The API handler's GET /status endpoint reads S3 directly,
 * so no response is needed back to the caller.
 */

interface AgentHandlerEvent {
    url: string;
    sessionId: string;
    selectedModel: string;
    analysisStartTime: number;
    contextAnalysis?: {
        enabled: boolean;
        maxContextPages?: number;
    };
    cacheControl?: {
        enabled: boolean;
    };
}

export const handler: Handler<AgentHandlerEvent, void> = async (event) => {
    console.log('[AgentHandler] Received event:', JSON.stringify(event, null, 2));
    console.log('[AgentHandler] Lensy Agent v1.0.0 — LangGraph + Bedrock');

    const {
        url,
        sessionId,
        selectedModel = 'claude',
        analysisStartTime = Date.now(),
        contextAnalysis,
        cacheControl
    } = event;

    // Validate required fields
    if (!url || !sessionId) {
        console.error('[AgentHandler] Missing required fields: url and sessionId');
        return;
    }

    // Initialize progress publisher for status updates
    const progress = new ProgressPublisher(sessionId);

    // Write initial status to S3 so frontend knows analysis started
    await writeSessionArtifact(sessionId, 'status.json', {
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
        await writeSessionArtifact(sessionId, 'status.json', {
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

        const agentInput: AgentRunInput = {
            url,
            sessionId,
            selectedModel,
            analysisStartTime,
            contextAnalysis,
            cacheControl,
        };

        // Run the LangGraph agent
        const result = await runAgent(agentInput);

        clearTimeout(watchdogTimeout);

        console.log('[AgentHandler] Agent completed successfully');
        console.log('[AgentHandler] Result preview:', result.substring(0, 500));

        // The agent's generate_report tool already writes report.json and status.json
        // But let's verify status was written
        await writeSessionArtifact(sessionId, 'status.json', {
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

        // Publish error to frontend
        await progress.error(`Analysis failed: ${errorMessage}`);

        // Write failed status to S3
        await writeSessionArtifact(sessionId, 'status.json', {
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
