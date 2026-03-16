/**
 * Lensy Analysis Pipeline — Direct Orchestration
 *
 * Replaces the LangGraph agent loop with direct tool calls.
 * The execution order is 100% deterministic (no LLM decisions needed),
 * so we skip the ~20s of Bedrock Sonnet round-trips and run
 * readiness + discoverability checks in parallel.
 *
 * Performance improvement: ~60-70% faster than the LangGraph agent loop.
 *
 * Pipeline:
 *   1. detect_input_type (inline — trivial)
 *   2. check_ai_readiness + check_ai_discoverability (PARALLEL)
 *   3. generate_report
 */

import { ProgressPublisher } from './shared/progress-publisher';

// Import tools for direct invocation
import { checkAIReadinessTool } from './tools/check-ai-readiness';
import { checkAIDiscoverabilityTool } from './tools/check-ai-discoverability';
import { generateReportTool } from './tools/generate-report';

// ─── Public API ──────────────────────────────────────────────

export interface AgentRunInput {
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
    sitemapUrl?: string;
    llmsTxtUrl?: string;
}

/**
 * Run the Lensy AI readiness analysis pipeline (direct orchestration).
 *
 * Instead of using LangGraph's agent loop (8+ LLM round-trips at ~2.5s each),
 * we call tools directly in a deterministic sequence. Readiness and discoverability
 * checks run in parallel since they are independent.
 */
export async function runAgent(input: AgentRunInput): Promise<string> {
    const { url, sessionId, analysisStartTime, llmsTxtUrl } = input;
    const progress = new ProgressPublisher(sessionId);

    console.log(`[Pipeline] Starting direct analysis for URL: ${url}, session: ${sessionId}`);
    const pipelineStart = Date.now();

    try {
        // ── Step 1: Detect input type (inline — no tool call needed) ──
        const inputType = url.toLowerCase().includes('sitemap.xml') ? 'sitemap' : 'doc';
        console.log(`[Pipeline] Input type: ${inputType}`);

        // ── Step 2: Run readiness + discoverability in PARALLEL ──
        await progress.info('Analyzing AI readiness and search discoverability in parallel...');

        const readinessInput = llmsTxtUrl ? { url, sessionId, llmsTxtUrl } : { url, sessionId };

        const [readinessResult, discoverabilityResult] = await Promise.allSettled([
            checkAIReadinessTool.invoke(readinessInput),
            checkAIDiscoverabilityTool.invoke({ url, sessionId }),
        ]);

        // Log results (tools write artifacts to S3 internally)
        if (readinessResult.status === 'fulfilled') {
            console.log(`[Pipeline] AI readiness complete: ${String(readinessResult.value).substring(0, 200)}`);
        } else {
            console.error(`[Pipeline] AI readiness FAILED:`, readinessResult.reason);
            await progress.error(`AI readiness check failed: ${readinessResult.reason}`);
        }

        if (discoverabilityResult.status === 'fulfilled') {
            console.log(`[Pipeline] AI discoverability complete: ${String(discoverabilityResult.value).substring(0, 200)}`);
        } else {
            console.error(`[Pipeline] AI discoverability FAILED:`, discoverabilityResult.reason);
            await progress.error(`AI discoverability check failed: ${discoverabilityResult.reason}`);
        }

        const parallelTime = Date.now() - pipelineStart;
        console.log(`[Pipeline] Parallel checks completed in ${parallelTime}ms`);

        // ── Step 3: Generate report ──
        await progress.info('Generating report...');

        const reportResult = await generateReportTool.invoke({
            sessionId,
            url,
            sourceMode: 'ai-readiness',
            analysisStartTime,
        });

        const totalTime = Date.now() - pipelineStart;
        console.log(`[Pipeline] Report generated. Total pipeline time: ${totalTime}ms`);

        // Parse report result to extract score for the final message
        let overallScore = 0;
        try {
            const parsed = JSON.parse(reportResult);
            overallScore = parsed.overallScore || 0;
        } catch { }

        await progress.success(
            `Analysis complete! AI Readiness: ${overallScore}/100 (${(totalTime / 1000).toFixed(1)}s)`
        );

        return reportResult;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Pipeline] Fatal error:`, errorMessage);
        await progress.error(`Analysis failed: ${errorMessage}`);
        throw error;
    }
}
