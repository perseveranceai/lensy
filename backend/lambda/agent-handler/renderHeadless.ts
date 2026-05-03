/**
 * renderHeadless.ts — Browserless.io headless rendering fallback
 *
 * Used when static fetch returns an SPA shell (empty JS-rendered page).
 * Calls the Browserless /content endpoint to get fully-rendered HTML.
 *
 * Feature flag: LENSY_HEADLESS_FALLBACK_ENABLED
 * API key:      BROWSERLESS_API_KEY
 * Endpoint:     BROWSERLESS_ENDPOINT (default: https://chrome.browserless.io)
 */

import https from 'https';

export interface HeadlessFetchResult {
    ok: boolean;
    html?: string;
    error?: string;
    durationMs: number;
}

/** Hard timeout for the Browserless call — leaves budget for downstream LLM + DynamoDB within Lambda's 15 min limit */
const BROWSERLESS_TIMEOUT_MS = 8000;

/**
 * Fetch fully-rendered HTML for a URL via Browserless.
 * Returns { ok: false } on any error — never throws.
 */
export async function fetchRendered(url: string): Promise<HeadlessFetchResult> {
    const apiKey = process.env.BROWSERLESS_API_KEY;
    const endpoint = process.env.BROWSERLESS_ENDPOINT ?? 'https://chrome.browserless.io';

    if (!apiKey) {
        return { ok: false, error: 'BROWSERLESS_API_KEY not configured', durationMs: 0 };
    }

    const start = Date.now();

    const requestBody = JSON.stringify({
        url,
        gotoOptions: {
            waitUntil: 'networkidle2',
            timeout: BROWSERLESS_TIMEOUT_MS - 1000,
        },
        waitFor: 2000,
        // Skip binary resources — ~3-5x faster, content unchanged
        rejectResourceTypes: ['image', 'media', 'font'],
        setExtraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
        // Return whatever we have if the page times out
        bestAttempt: true,
    });

    try {
        const html = await new Promise<string>((resolve, reject) => {
            const req = https.request(
                `${endpoint}/content?token=${apiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache',
                        'Content-Length': Buffer.byteLength(requestBody),
                    },
                    timeout: BROWSERLESS_TIMEOUT_MS,
                },
                (res) => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Browserless returned HTTP ${res.statusCode}`));
                        return;
                    }
                    let data = '';
                    res.setEncoding('utf-8');
                    res.on('data', (chunk) => (data += chunk));
                    res.on('end', () => resolve(data));
                }
            );

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Browserless timed out after ${BROWSERLESS_TIMEOUT_MS}ms`));
            });

            req.on('error', reject);
            req.write(requestBody);
            req.end();
        });

        return { ok: true, html, durationMs: Date.now() - start };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - start,
        };
    }
}
