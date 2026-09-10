"use strict";
/**
 * Gamma-only JS-render fallback via Jina Reader.
 *
 * This helper is deliberately return-or-null: recoverable request, timeout,
 * and response failures never escape into the scan pipeline. Successful HTML
 * remains subject to the caller's existing documentation-confidence checks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWithJina = renderWithJina;
const crypto_1 = require("crypto");
const JINA_READER_PREFIX = 'https://r.jina.ai/';
const JINA_API_KEY_ENV = 'JINA_API_KEY';
const RENDER_TIMEOUT_MS = 30000;
const JINA_WAIT_SECONDS = 25;
const MIN_USEFUL_BYTES = 400;
const MAX_RETRIES = 1;
const DEFAULT_RETRY_AFTER_MS = 1000;
const MAX_RETRY_AFTER_MS = 5000;
const LOG_PREFIX = '[JinaFallback]';
/**
 * Correlate events for one target without logging its path, query, fragment,
 * credentials, or page content. The short digest is observability metadata,
 * used only to correlate render events for the same target.
 */
function targetContext(url) {
    return {
        targetId: (0, crypto_1.createHash)('sha256').update(url).digest('hex').slice(0, 12),
        urlLength: url.length,
    };
}
function logEvent(level, event, details = {}) {
    const message = `${LOG_PREFIX} ${JSON.stringify({ event, ...details })}`;
    if (level === 'warn') {
        console.warn(message);
    }
    else {
        console.log(message);
    }
}
function eligibility() {
    const environment = process.env.LENSY_ENV || 'unset';
    if (environment !== 'gamma') {
        return { eligible: false, environment, reason: 'environment-not-gamma' };
    }
    const apiKey = process.env[JINA_API_KEY_ENV];
    if (!apiKey || apiKey.trim().length === 0) {
        return { eligible: false, environment, reason: 'api-key-missing' };
    }
    return { eligible: true, environment, apiKey };
}
/** Parse Retry-After delta-seconds or HTTP-date values into milliseconds. */
function parseRetryAfterMs(headerValue) {
    if (!headerValue)
        return null;
    const trimmed = headerValue.trim();
    if (/^\d+$/.test(trimmed))
        return parseInt(trimmed, 10) * 1000;
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
        return Math.max(0, dateMs - Date.now());
    }
    return null;
}
function buildHeaders(apiKey) {
    return {
        'x-respond-with': 'html',
        'x-timeout': String(JINA_WAIT_SECONDS),
        Accept: 'text/html, text/plain;q=0.9, */*;q=0.8',
        Authorization: `Bearer ${apiKey}`,
    };
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function classifyRequestError(error) {
    if (error instanceof Error && error.name === 'AbortError')
        return 'timeout';
    if (error instanceof TypeError)
        return 'network-or-fetch-error';
    return 'request-error';
}
async function requestJinaRender(url, apiKey) {
    const requestUrl = `${JINA_READER_PREFIX}${url}`;
    const context = targetContext(url);
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const attemptNumber = attempt + 1;
        const start = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
        logEvent('info', 'request-attempt-start', {
            ...context,
            attempt: attemptNumber,
            timeoutMs: RENDER_TIMEOUT_MS,
        });
        try {
            const response = await fetch(requestUrl, {
                signal: controller.signal,
                headers: buildHeaders(apiKey),
            });
            if (response.status === 429 && attempt < MAX_RETRIES) {
                const requestedDelayMs = parseRetryAfterMs(response.headers.get('retry-after'));
                const retryDelayMs = Math.min(requestedDelayMs ?? DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS);
                logEvent('warn', 'rate-limited-retry', {
                    ...context,
                    attempt: attemptNumber,
                    status: response.status,
                    retryAfterMs: requestedDelayMs,
                    retryDelayMs,
                });
                clearTimeout(timeoutId);
                await sleep(retryDelayMs);
                continue;
            }
            if (!response.ok) {
                logEvent('warn', 'terminal-http-failure', {
                    ...context,
                    attempt: attemptNumber,
                    status: response.status,
                    latencyMs: Date.now() - start,
                });
                return null;
            }
            const html = await response.text();
            const latencyMs = Date.now() - start;
            const htmlBytes = Buffer.byteLength(html, 'utf8');
            if (htmlBytes < MIN_USEFUL_BYTES) {
                logEvent('warn', 'invalid-response', {
                    ...context,
                    attempt: attemptNumber,
                    status: response.status,
                    reason: 'empty-or-too-short',
                    bytes: htmlBytes,
                    latencyMs,
                });
                return null;
            }
            logEvent('info', 'render-success', {
                ...context,
                attempt: attemptNumber,
                source: 'jina',
                status: response.status,
                bytes: htmlBytes,
                latencyMs,
            });
            return { html, source: 'jina', latencyMs };
        }
        catch (error) {
            const classification = classifyRequestError(error);
            logEvent('warn', 'request-failure', {
                ...context,
                attempt: attemptNumber,
                classification,
                latencyMs: Date.now() - start,
            });
            return null;
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    return null;
}
/**
 * Render directly through Jina. This exported boundary independently enforces
 * gamma-plus-key eligibility so it cannot be bypassed by another caller.
 */
async function renderWithJina(url) {
    const context = targetContext(url);
    const gate = eligibility();
    logEvent('info', 'entry', { ...context, operation: 'render-direct' });
    logEvent(gate.eligible ? 'info' : 'warn', 'eligibility', {
        ...context,
        eligible: gate.eligible,
        environment: gate.environment,
        reason: gate.reason,
        apiKeyConfigured: Boolean(gate.apiKey),
    });
    if (!gate.eligible || !gate.apiKey)
        return null;
    return requestJinaRender(url, gate.apiKey);
}
