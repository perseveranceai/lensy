import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ProgressPublisher } from '../shared/progress-publisher';

/**
 * Tool 8: Publish Progress
 * Thin wrapper around existing ProgressPublisher.
 *
 * Sends real-time WebSocket progress updates to the frontend.
 * The agent calls this after each major tool execution.
 */

// Cache publishers per session to reuse connections
const publisherCache = new Map<string, ProgressPublisher>();

function getPublisher(sessionId: string): ProgressPublisher {
    if (!publisherCache.has(sessionId)) {
        publisherCache.set(sessionId, new ProgressPublisher(sessionId));
    }
    return publisherCache.get(sessionId)!;
}

export const publishProgressTool = tool(
    async (input): Promise<string> => {
        const publisher = getPublisher(input.sessionId);

        const metadata: Record<string, any> = {
            toolName: input.toolName || 'agent'
        };

        if (input.score !== undefined) metadata.score = input.score;
        if (input.dimension) metadata.dimension = input.dimension;

        switch (input.type) {
            case 'info':
                await publisher.info(input.message, metadata);
                break;
            case 'success':
                await publisher.success(input.message, metadata);
                break;
            case 'error':
                await publisher.error(input.message, metadata);
                break;
            case 'progress':
                await publisher.progress(input.message, input.phase as any, metadata);
                break;
            case 'cache-hit':
                await publisher.cacheHit(input.message, metadata);
                break;
            case 'cache-miss':
                await publisher.cacheMiss(input.message, metadata);
                break;
            default:
                await publisher.info(input.message, metadata);
        }

        return JSON.stringify({ success: true, sent: true });
    },
    {
        name: 'publish_progress',
        description: 'Sends a real-time progress update to the frontend via WebSocket. Call this after each major step to keep the user informed about analysis progress.',
        schema: z.object({
            sessionId: z.string().describe('The analysis session ID'),
            message: z.string().describe('The progress message to display'),
            type: z.enum(['info', 'success', 'error', 'progress', 'cache-hit', 'cache-miss']).default('progress').describe('Message type'),
            phase: z.string().optional().describe('Current phase: url-processing, structure-detection, dimension-analysis, report-generation, input-detection, ai-readiness, sitemap-health'),
            toolName: z.string().optional().describe('Name of the tool that triggered this progress'),
            score: z.number().optional().describe('Optional score value'),
            dimension: z.string().optional().describe('Optional dimension name (e.g., relevance, clarity)')
        })
    }
);

/**
 * Helper function for tools to publish progress directly without going through the agent.
 * Used inside tool implementations for mid-tool progress updates.
 */
export function createProgressHelper(sessionId: string) {
    return getPublisher(sessionId);
}
