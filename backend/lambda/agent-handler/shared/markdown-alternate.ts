/**
 * Markdown-alternate discovery.
 *
 * Many documentation platforms publish a markdown twin of each page. Some
 * advertise it via <link rel="alternate" type="text/markdown">; plenty serve
 * `{url}.md` without advertising anything.
 *
 * This matters because the content gate scores raw HTML. On a JS-rendered
 * portal the HTML carries no prose — the text arrives as hydration payload —
 * so the page is rejected as "not documentation" even when a complete,
 * clean markdown version is one request away.
 *
 * Measured against the top rejecting domains in the prod audit log (Sept 2026),
 * 8 of 22 sampled rejections have a usable markdown alternate, including
 * Amazon SP-API (19KB), PayNearMe (15KB), Palo Alto Cortex, Zoom, MuleSoft,
 * Pismo, Veeva and SambaNova. Only 4 of those 8 declare the link tag, which is
 * why the undeclared `{url}.md` convention is worth trying too.
 *
 * Cost control is structural rather than heuristic: callers invoke this only
 * at the moment they are about to reject a page. Healthy pages never reach
 * that branch, so they pay nothing, and there is no threshold to mis-tune.
 *
 * An earlier draft gated the lookup on "does this HTML look content-poor?".
 * That needed a threshold, and the threshold was wrong — Amazon SP-API has
 * 2,728 words of nav and boilerplate around a missing article body, so an
 * absolute word count called it healthy and skipped the lookup entirely.
 * Hanging this off the rejection path removes the guess: if the pipeline has
 * already concluded there is nothing to read, trying the markdown twin costs
 * one request and can only improve the outcome.
 */

const FETCH_TIMEOUT_MS = 4000;
const MIN_USEFUL_BYTES = 400;

export interface MarkdownAlternate {
    url: string;
    content: string;
    declared: boolean;
}

function declaredHref(html: string): string | null {
    const m = html.match(/<link[^>]*rel=["']alternate["'][^>]*type=["']text\/markdown["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<link[^>]*type=["']text\/markdown["'][^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
    return m ? m[1] : null;
}

async function fetchIfMarkdown(candidate: string): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(candidate, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Lensy/2.0; +https://perseveranceai.com/bot)' },
        });
        clearTimeout(timer);
        if (!res.ok) return null;

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('html')) return null;

        const text = await res.text();
        // Some servers answer .md with the SPA shell and a 200.
        if (/^\s*<(!doctype|html)/i.test(text)) return null;
        if (text.length < MIN_USEFUL_BYTES) return null;
        return text;
    } catch {
        return null;
    }
}

/**
 * Look for a markdown twin of `url`. Declared alternates are tried first
 * because they are authoritative; `{url}.md` second because it is common but
 * unadvertised. Returns null rather than throwing — callers fall back to HTML.
 */
export async function findMarkdownAlternate(url: string, html: string): Promise<MarkdownAlternate | null> {
    const candidates: Array<{ href: string; declared: boolean }> = [];

    const declared = declaredHref(html);
    if (declared) {
        try {
            candidates.push({ href: new URL(declared, url).toString(), declared: true });
        } catch { /* malformed href — fall through to the convention */ }
    }

    const conventional = url.replace(/[?#].*$/, '').replace(/\/$/, '') + '.md';
    if (!candidates.some(c => c.href === conventional)) {
        candidates.push({ href: conventional, declared: false });
    }

    for (const c of candidates) {
        const content = await fetchIfMarkdown(c.href);
        if (content) return { url: c.href, content, declared: c.declared };
    }
    return null;
}
