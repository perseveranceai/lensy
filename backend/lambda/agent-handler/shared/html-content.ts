/**
 * Turning raw HTML into what a crawler or agent actually reads.
 *
 * Ported from docs/two-score-readiness/prototype.mjs (the reference the
 * scoring tests compare against). Keep the regexes in step with it.
 */

/**
 * Drop scripts, styles, nav, sidebars and footers. A <header> is only dropped
 * when it is site chrome (contains a nav or is a banner); article headers often
 * hold the page's H1 (Docusaurus, React). REG-20.
 */
export function stripNonContent(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<(nav|aside|footer)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<header\b([^>]*)>([\s\S]*?)<\/header>/gi, (_all, attrs: string, inner: string) =>
            (/role=["']banner|navbar|site-header/i.test(attrs) || /<nav\b/i.test(inner)) ? ' ' : inner);
}

/** Visible text of the content, whitespace collapsed. */
export function textOf(html: string): string {
    return stripNonContent(html)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Content as rough Markdown: H2/H3 become "## " lines, so sections can be measured without a .md version. */
export function htmlAsMd(html: string): string {
    return stripNonContent(html)
        .replace(/<h([23])\b[^>]*>/gi, '\n## ')
        .replace(/<\/h[23]>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ');
}

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

export interface Heading { level: number; text: string; id?: boolean }

export function headingsFromHtml(html: string): Heading[] {
    const out: Heading[] = [];
    const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
    const content = stripNonContent(html);
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
        const t = m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/​/g, '').trim();
        if (t) out.push({ level: +m[1], text: t, id: /\bid=/.test(m[2]) });
    }
    return out;
}

export function headingsFromMd(md: string): Heading[] {
    const out: Heading[] = [];
    let inFence = false;
    for (const line of md.split('\n')) {
        if (/^\s*```/.test(line)) inFence = !inFence;
        if (inFence) continue;
        const m = line.match(/^(#{1,6})\s+(.+)/);
        if (m) out.push({ level: m[1].length, text: m[2].trim() });
    }
    return out;
}

/** Number of heading-level skips (an H2 followed by an H4 is one). */
export const headingSkips = (hs: Heading[]) => hs.filter((h, i) => i > 0 && h.level > hs[i - 1].level + 1).length;

/** Words in each H2/H3 section of htmlAsMd output. */
export const sectionWords = (text: string) => text.split(/\n(?=#{2,3} )/).slice(1).map(p => p.split(/\s+/).length);

/** Is this response real Markdown (not an HTML page served under a .md name)? */
export function looksMarkdown(r: { ok: boolean; contentType: string; body: string }): boolean {
    return r.ok && /markdown|text\/plain/.test(r.contentType) && !/^\s*<(!doctype|html)/i.test(r.body) && /(^|\n)#{1,3} |\]\(/.test(r.body);
}

/** An HTML page returned where a text file was expected: a soft 404. */
export const looksLikeHtml = (body: string) => /^\s*<(!doctype|html)/i.test(body);
