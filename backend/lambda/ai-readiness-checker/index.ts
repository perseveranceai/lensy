import { Handler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { URL } from 'url';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

interface AIReadinessResult {
    llmsTxt: { found: boolean; url: string; content?: string };
    llmsFullTxt: { found: boolean; url: string };
    robotsTxt: { found: boolean; aiDirectives: Array<{ userAgent: string; rule: 'Allow' | 'Disallow' }> };
    markdownExports: { available: boolean; sampleUrls: string[] };
    structuredData: { hasJsonLd: boolean; schemaTypes: string[] };
    overallScore: number;
    recommendations: string[];
}

export const handler: Handler = async (event) => {
    console.log('AI Readiness Checker received event:', JSON.stringify(event, null, 2));
    const { url, sessionId } = event;

    try {
        const domain = new URL(url).hostname;
        const bucketName = process.env.ANALYSIS_BUCKET;
        if (!bucketName) throw new Error('ANALYSIS_BUCKET not set');

        console.log(`Checking AI readiness for domain: ${domain}`);

        const results = await checkAIReadiness(domain);

        // Store results in S3
        const key = `sessions/${sessionId}/ai-readiness-results.json`;
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: JSON.stringify(results),
            ContentType: 'application/json'
        }));

        return { success: true, results };

    } catch (error) {
        console.error('AI Readiness Check failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
};

async function checkAIReadiness(domain: string): Promise<AIReadinessResult> {
    const baseUrl = `https://${domain}`;
    const recommendations: string[] = [];
    let score = 0;

    // 1. Check llms.txt
    const llmsTxtUrl = `${baseUrl}/llms.txt`;
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
                // Simple heuristic check
                const allowMatch = content.match(new RegExp(`User-agent:\\s*${ua}[\\s\\S]*?Allow:`, 'i'));
                if (allowMatch) {
                    aiDirectives.push({ userAgent: ua, rule: 'Allow' });
                } else if (content.match(new RegExp(`User-agent:\\s*${ua}[\\s\\S]*?Disallow:`, 'i'))) {
                    aiDirectives.push({ userAgent: ua, rule: 'Disallow' });
                }
            }
        });
    }

    // Score robots.txt
    if (aiDirectives.some(d => d.rule === 'Allow')) {
        score += 20;
    } else if (aiDirectives.length === 0) {
        recommendations.push('Explicitly allow AI bots (GPTBot, Claude-Web) in robots.txt.');
    }

    // 4. Check Markdown Exports & Structured Data (fetch homepage)
    let hasJsonLd = false;
    let schemaTypes: string[] = [];
    let markdownAvailable = false;
    let sampleMdUrls: string[] = [];

    try {
        const homeRes = await fetch(baseUrl);
        if (homeRes.ok) {
            const html = await homeRes.text();

            // Structured Data
            if (html.includes('application/ld+json')) {
                hasJsonLd = true;
                score += 15;
                // Simple regex to guess types
                const types = html.match(/"@type":\s*"([^"]+)"/g);
                if (types) {
                    schemaTypes = [...new Set(types.map(t => t.match(/"@type":\s*"([^"]+)"/)![1]))];
                }
            } else {
                recommendations.push('Add JSON-LD structured data to help semantic understanding.');
            }

            // Markdown Links (heuristic: links ending in .md or mentions of "markdown export")
            if (html.includes('.md"') || html.toLowerCase().includes('export as markdown')) {
                markdownAvailable = true;
                score += 15;
                sampleMdUrls.push(`${baseUrl}/example.md`); // Mock for now
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
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

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
