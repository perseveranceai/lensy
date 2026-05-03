/**
 * Lensy HTTP API client.
 *
 * Calls POST /analyze to start a scan, then polls GET /status/{sessionId}
 * until the report is ready. Returns a simplified LensyReport that the
 * Writer Agent prompt can consume directly.
 *
 * IMPORTANT: The Lensy API requires the CLIENT to generate the sessionId.
 * This matches the frontend behavior (crypto.randomUUID() before POST).
 */

const LENSY_API_BASE = process.env.LENSY_API_URL || 'https://api.perseveranceai.com';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 180_000; // 3 minutes

// ── Public types ────────────────────────────────────────────────────────

export interface LensyFinding {
    category: string;
    priority: 'high' | 'medium' | 'low' | 'best-practice';
    issue: string;
    fix: string;
    codeSnippet?: string;
}

export interface LensyReport {
    sessionId: string;
    overallScore: number;
    letterGrade: string;
    scoreBreakdown: {
        discoverability: number;
        consumability: number;
        structuredData: number;
        aiDiscoverability: number;
    };
    recommendations: LensyFinding[];
    detection: {
        site: {
            llmsTxt: string;        // evidence status
            llmsFullTxt: string;
            agentsMd: string;
            mcpJson: string;
            blockedAiCrawlers: string[];
            allowedAiCrawlers: string[];
        };
        page: {
            markdown: string;
            llmsTxtMapping: string;
            contentNegotiation: string;
        };
    } | null;
    aiDiscoverability: {
        citationRate: string;
        queriesTested: number;
        citedCount: number;
        totalQueries: number;
    } | null;
}

// ── Main entry point ────────────────────────────────────────────────────

export async function scanWithLensy(url: string): Promise<LensyReport> {
    const sessionId = crypto.randomUUID();

    console.error(`[lensy-client] Starting scan for: ${url}`);
    console.error(`[lensy-client] Session ID: ${sessionId}`);

    // Step 1: POST /analyze
    const startRes = await fetch(`${LENSY_API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url,
            sessionId,
            selectedModel: 'claude',
            useAgent: true,
        }),
    });

    if (!startRes.ok) {
        const errBody = await startRes.text();
        throw new Error(`Lensy POST /analyze failed (${startRes.status}): ${errBody}`);
    }

    const startData = await startRes.json() as { sessionId: string; status: string };
    console.error(`[lensy-client] Analysis started: ${startData.status}`);

    // Step 2: Poll GET /status/{sessionId}
    const deadline = Date.now() + MAX_POLL_MS;
    let lastStatus = '';

    while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);

        const statusRes = await fetch(`${LENSY_API_BASE}/status/${sessionId}`);

        if (!statusRes.ok) {
            console.error(`[lensy-client] Status poll returned ${statusRes.status}, retrying...`);
            continue;
        }

        const statusData = await statusRes.json() as {
            sessionId: string;
            status: string;
            report?: any;
            error?: string;
        };

        if (statusData.status !== lastStatus) {
            lastStatus = statusData.status;
            console.error(`[lensy-client] Status: ${statusData.status}`);
        }

        if (statusData.status === 'completed' && statusData.report) {
            console.error(`[lensy-client] Scan complete. Score: ${statusData.report.overallScore}`);
            return transformReport(sessionId, statusData.report);
        }

        if (statusData.status === 'failed' || statusData.status === 'rejected') {
            throw new Error(`Lensy analysis ${statusData.status}: ${statusData.error || 'unknown reason'}`);
        }

        const elapsed = Math.round((Date.now() - (deadline - MAX_POLL_MS)) / 1000);
        console.error(`[lensy-client] Waiting... (${elapsed}s)`);
    }

    throw new Error(`Lensy analysis timed out after ${MAX_POLL_MS / 1000}s`);
}

// ── Transform Lensy's raw report into our simplified shape ──────────────

function transformReport(sessionId: string, raw: any): LensyReport {
    const recs: LensyFinding[] = (raw.recommendations || []).map((r: any) => ({
        category: r.category,
        priority: r.priority || 'medium',
        issue: r.issue,
        fix: r.fix,
        codeSnippet: r.codeSnippet,
    }));

    const breakdown = raw.scoreBreakdown || {};
    const categories = raw.categories || {};
    const aiDisc = raw.aiDiscoverability || null;

    // Build detection summary from categories (not a separate detection field)
    const disc = categories.discoverability || {};
    const cons = categories.consumability || {};
    const botAccess = categories.botAccess || {};

    const detectionSummary = {
        site: {
            llmsTxt: disc.llmsTxt?.found ? 'verified' : 'not_verified',
            llmsFullTxt: disc.llmsFullTxt?.found ? 'verified' : 'not_verified',
            agentsMd: 'not_verified' as string,  // checked via recommendations
            mcpJson: 'not_verified' as string,
            blockedAiCrawlers: botAccess.bots?.filter((b: any) => b.blocked).map((b: any) => b.name) || [],
            allowedAiCrawlers: botAccess.bots?.filter((b: any) => !b.blocked).map((b: any) => b.name) || [],
        },
        page: {
            markdown: cons.markdownAvailable?.found
                ? (cons.markdownAvailable.discoverable ? 'verified' : 'advertised')
                : 'not_verified',
            llmsTxtMapping: checkPageInLlmsTxt(disc.llmsTxt?.fullContent, raw.scope?.url),
            contentNegotiation: 'not_verified' as string,
        },
    };

    // Check recommendations for experimental signals
    for (const rec of recs) {
        if (rec.issue.includes('AGENTS.md detected')) detectionSummary.site.agentsMd = 'experimental';
        if (rec.issue.includes('MCP Config detected')) detectionSummary.site.mcpJson = 'experimental';
    }

    let aiDiscSummary = null;
    if (aiDisc) {
        aiDiscSummary = {
            citationRate: aiDisc.citationRate || 'unknown',
            queriesTested: aiDisc.queriesTested || 0,
            citedCount: aiDisc.citedCount || 0,
            totalQueries: aiDisc.totalQueries || 0,
        };
    }

    return {
        sessionId,
        overallScore: raw.overallScore || 0,
        letterGrade: raw.letterGrade || 'N/A',
        scoreBreakdown: {
            discoverability: breakdown.discoverability || 0,
            consumability: breakdown.consumability || 0,
            structuredData: breakdown.structuredData || 0,
            aiDiscoverability: breakdown.aiDiscoverability || 0,
        },
        recommendations: recs,
        detection: detectionSummary,
        aiDiscoverability: aiDiscSummary,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check if a page URL appears in llms.txt content */
function checkPageInLlmsTxt(llmsTxtContent: string | undefined, targetUrl: string | undefined): string {
    if (!llmsTxtContent || !targetUrl) return 'not_verified';

    // Normalize: lowercase domain, strip trailing slash
    const normalize = (url: string): string => {
        try {
            const parsed = new URL(url);
            return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`;
        } catch {
            return url.replace(/\/$/, '').toLowerCase();
        }
    };

    const normalizedTarget = normalize(targetUrl);

    // Search llms.txt line by line for markdown link URLs
    for (const line of llmsTxtContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) continue;

        const linkMatch = trimmed.match(/\[([^\]]*)\]\(([^)]+)\)/);
        const url = linkMatch ? linkMatch[2] : (trimmed.startsWith('http') ? trimmed.split(/\s/)[0] : null);
        if (!url) continue;

        const normalizedUrl = normalize(url);
        const normalizedUrlBase = normalizedUrl.replace(/\.(md|html|htm|mdx)$/, '');
        const normalizedTargetBase = normalizedTarget.replace(/\.(md|html|htm|mdx)$/, '');

        if (normalizedUrl === normalizedTarget
            || normalizedUrl === normalizedTarget + '/'
            || normalizedUrlBase === normalizedTargetBase) {
            return 'mapped';
        }
    }

    return 'not_verified';
}
