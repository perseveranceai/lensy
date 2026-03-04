import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { writeSessionArtifact } from '../shared/s3-helpers';
import { URL } from 'url';

/**
 * Tool 4: Check AI Readiness
 * Ported from: ai-readiness-checker/index.ts (165 lines)
 *
 * Checks if a domain is AI-friendly by looking for:
 * - /llms.txt, /llms-full.txt
 * - robots.txt AI bot directives
 * - JSON-LD structured data
 * - Markdown export links
 */
export const checkAIReadinessTool = tool(
    async (input): Promise<string> => {
        console.log('check_ai_readiness: Checking domain:', input.url);

        try {
            const domain = new URL(input.url).hostname;
            const results = await checkAIReadiness(domain, input.llmsTxtUrl);

            // Store results in S3
            await writeSessionArtifact(input.sessionId, 'ai-readiness-results.json', results);

            return JSON.stringify({
                success: true,
                score: results.overallScore,
                hasLlmsTxt: results.llmsTxt.found,
                hasLlmsFullTxt: results.llmsFullTxt.found,
                hasJsonLd: results.structuredData.hasJsonLd,
                aiDirectivesCount: results.robotsTxt.aiDirectives.length,
                recommendationCount: results.recommendations.length,
                message: `AI readiness score: ${results.overallScore}/100`
            });

        } catch (error) {
            console.error('AI readiness check failed:', error);
            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    },
    {
        name: 'check_ai_readiness',
        description: 'Checks if the domain is AI-friendly by looking for llms.txt, robots.txt AI directives, JSON-LD structured data, and markdown exports. Returns an AI readiness score (0-100). Can run in parallel with other tools after process_url.',
        schema: z.object({
            url: z.string().describe('The URL to check AI readiness for'),
            sessionId: z.string().describe('The analysis session ID'),
            llmsTxtUrl: z.string().optional().describe('User-provided llms.txt URL. If provided, check this URL directly instead of auto-discovering.')
        })
    }
);

interface AIReadinessResult {
    llmsTxt: { found: boolean; url: string; content?: string };
    llmsFullTxt: { found: boolean; url: string };
    robotsTxt: { found: boolean; aiDirectives: Array<{ userAgent: string; rule: 'Allow' | 'Disallow' }> };
    markdownExports: { available: boolean; sampleUrls: string[] };
    structuredData: { hasJsonLd: boolean; schemaTypes: string[] };
    overallScore: number;
    recommendations: string[];
}

async function checkAIReadiness(domain: string, explicitLlmsTxtUrl?: string): Promise<AIReadinessResult> {
    const baseUrl = `https://${domain}`;
    const recommendations: string[] = [];
    let score = 0;

    // 1. Check llms.txt (use explicit URL if provided)
    const llmsTxtUrl = explicitLlmsTxtUrl || `${baseUrl}/llms.txt`;
    const llmsTxt = await checkUrl(llmsTxtUrl, true);
    if (llmsTxt.found) {
        score += 30;
    } else {
        recommendations.push('Add /llms.txt to help AI agents discover your documentation.');
    }

    // 2. Check llms-full.txt
    const llmsFullTxtUrl = `${baseUrl}/llms-full.txt`;
    const llmsFullTxt = await checkUrl(llmsFullTxtUrl);
    if (llmsFullTxt.found) {
        score += 20;
    } else {
        recommendations.push('Create /llms-full.txt with full documentation export for RAG/Training.');
    }

    // 3. Check robots.txt
    const robotsTxtUrl = `${baseUrl}/robots.txt`;
    const robotsCheck = await checkUrl(robotsTxtUrl, true);
    const aiDirectives: Array<{ userAgent: string; rule: 'Allow' | 'Disallow' }> = [];

    if (robotsCheck.found && robotsCheck.content) {
        const content = robotsCheck.content;
        const userAgents = ['GPTBot', 'Claude-Web', 'CCBot', 'Google-Extended'];

        userAgents.forEach(ua => {
            if (content.includes(ua)) {
                const allowMatch = content.match(new RegExp(`User-agent:\\s*${ua}[\\s\\S]*?Allow:`, 'i'));
                if (allowMatch) {
                    aiDirectives.push({ userAgent: ua, rule: 'Allow' });
                } else if (content.match(new RegExp(`User-agent:\\s*${ua}[\\s\\S]*?Disallow:`, 'i'))) {
                    aiDirectives.push({ userAgent: ua, rule: 'Disallow' });
                }
            }
        });
    }

    if (aiDirectives.some(d => d.rule === 'Allow')) {
        score += 20;
    } else if (aiDirectives.length === 0) {
        recommendations.push('Explicitly allow AI bots (GPTBot, Claude-Web) in robots.txt.');
    }

    // 4. Check homepage for structured data & markdown links
    let hasJsonLd = false;
    let schemaTypes: string[] = [];
    let markdownAvailable = false;
    let sampleMdUrls: string[] = [];

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const homeRes = await fetch(baseUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (homeRes.ok) {
            const html = await homeRes.text();

            // Structured Data (JSON-LD)
            if (html.includes('application/ld+json')) {
                hasJsonLd = true;
                score += 15;
                const types = html.match(/"@type":\s*"([^"]+)"/g);
                if (types) {
                    schemaTypes = [...new Set(types.map(t => t.match(/"@type":\s*"([^"]+)"/)![1]))];
                }
            } else {
                recommendations.push('Add JSON-LD structured data to help semantic understanding.');
            }

            // Markdown links
            if (html.includes('.md"') || html.toLowerCase().includes('export as markdown')) {
                markdownAvailable = true;
                score += 15;
                sampleMdUrls.push(`${baseUrl}/example.md`);
            } else {
                recommendations.push('Consider offering references to .md versions of your pages.');
            }
        }
    } catch (e) {
        console.warn('Failed to fetch homepage:', e);
    }

    return {
        llmsTxt: { found: llmsTxt.found, url: llmsTxtUrl, content: llmsTxt.content?.slice(0, 200) },
        llmsFullTxt: { found: llmsFullTxt.found, url: llmsFullTxtUrl },
        robotsTxt: { found: robotsCheck.found, aiDirectives },
        markdownExports: { available: markdownAvailable, sampleUrls: sampleMdUrls },
        structuredData: { hasJsonLd, schemaTypes },
        overallScore: Math.min(100, score),
        recommendations
    };
}

async function checkUrl(url: string, returnContent = false): Promise<{ found: boolean; content?: string }> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const content = returnContent ? await res.text() : undefined;
            return { found: true, content };
        }
        return { found: false };
    } catch (e) {
        console.log(`Failed to fetch ${url}: ${(e as Error).message}`);
        return { found: false };
    }
}
