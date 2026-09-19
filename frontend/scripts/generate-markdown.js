#!/usr/bin/env node
/**
 * generate-markdown.js
 *
 * Build-time generator for AI-consumable assets. Runs before every build.
 * Any new article added to ArticlePage.tsx is automatically included.
 *
 * Output:
 *   public/education/{slug}.md   — markdown version of each article
 *   public/llms.txt              — table of contents for AI coding tools
 *   public/sitemap.xml           — full sitemap including education articles
 *   public/robots.txt            — AI bot directives with correct URLs
 */

const fs = require('fs');
const path = require('path');

// N-11: the live articles now live in the ARTICLES array in AppRoutes.tsx (JSX
// bodies), NOT the old src/pages/ArticlePage.tsx (which is dead/decoupled). Parse
// the live source so generated .md / llms.txt / sitemap.xml can't drift.
const ARTICLE_FILE = path.join(__dirname, '..', 'src', 'AppRoutes.tsx');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EDUCATION_DIR = path.join(PUBLIC_DIR, 'education');

// Determine base URL from env
const baseUrl = (process.env.REACT_APP_BASE_URL || 'https://perseveranceai.com').replace(/\/$/, '');
const today = new Date().toISOString().split('T')[0];

// Strip inline JSX tags (<code>, <a>, <em>, <strong>…) from prose, keeping text.
function stripInlineTags(html) {
    return html
        .replace(/<[^>]+>/g, '')      // drop remaining tags
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Parse the live ARTICLES array from AppRoutes.tsx ──
// The bodies are JSX (<Prose><p>…</p><h2>…</h2><TlDr items={[…]} />). We pull the
// metadata fields and flatten the JSX body into markdown-friendly sections.
function extractArticles() {
    const source = fs.readFileSync(ARTICLE_FILE, 'utf-8');

    const startMarker = 'const ARTICLES: ArticleData[] = [';
    const startIdx = source.indexOf(startMarker);
    if (startIdx === -1) {
        console.error('Could not find ARTICLES array in AppRoutes.tsx');
        process.exit(1);
    }

    // Walk the array with bracket matching so we grab exactly the ARTICLES literal.
    // Start from the opening `[` of the array itself (the one at the end of the
    // marker), NOT the `[]` inside the `ArticleData[]` type annotation.
    let arrStart = startIdx + startMarker.length - 1;
    let depth = 0;
    let i = arrStart;
    for (; i < source.length; i++) {
        if (source[i] === '[') depth++;
        if (source[i] === ']') { depth--; if (depth === 0) break; }
    }
    const arrSource = source.substring(arrStart, i + 1);

    // Split into per-article blocks by the `slug:` field position.
    const slugRegex = /slug:\s*"([a-z0-9-]+)"/g;
    const slugPositions = [];
    let match;
    while ((match = slugRegex.exec(arrSource)) !== null) {
        slugPositions.push({ slug: match[1], pos: match.index });
    }

    const articles = {};
    for (let s = 0; s < slugPositions.length; s++) {
        const { slug, pos } = slugPositions[s];
        const endPos = s + 1 < slugPositions.length ? slugPositions[s + 1].pos : arrSource.length;
        const block = arrSource.substring(pos, endPos);

        const titleMatch = block.match(/title:\s*"((?:[^"\\]|\\.)*)"/);
        const tagMatch = block.match(/tag:\s*"([^"]+)"/);
        const readTimeMatch = block.match(/readTime:\s*"([^"]+)"/);
        const descMatch = block.match(/description:\s*"((?:[^"\\]|\\.)*)"/);

        // Body: everything after `body:` — extract headings, paragraphs, and TlDr bullets in order.
        const bodyIdx = block.indexOf('body:');
        const body = bodyIdx !== -1 ? block.substring(bodyIdx) : '';
        const sections = [];
        let current = { heading: null, paragraphs: [], bulletPoints: [] };
        const pushCurrent = () => {
            if (current.heading || current.paragraphs.length || current.bulletPoints.length) sections.push(current);
        };

        // Tokenize <h2>, <p>, and TlDr items in document order.
        const tokenRegex = /<h2>([\s\S]*?)<\/h2>|<p>([\s\S]*?)<\/p>|<TlDr\s+items=\{\[([\s\S]*?)\]\}/g;
        let tok;
        while ((tok = tokenRegex.exec(body)) !== null) {
            if (tok[1] !== undefined) {
                // New H2 — start a new section.
                pushCurrent();
                current = { heading: stripInlineTags(tok[1]), paragraphs: [], bulletPoints: [] };
            } else if (tok[2] !== undefined) {
                const text = stripInlineTags(tok[2]);
                if (text) current.paragraphs.push(text);
            } else if (tok[3] !== undefined) {
                // TlDr bullet list — string items in an array.
                const bRegex = /"((?:[^"\\]|\\.)*)"/g;
                let b;
                while ((b = bRegex.exec(tok[3])) !== null) {
                    current.bulletPoints.push(b[1].replace(/\\"/g, '"'));
                }
            }
        }
        pushCurrent();

        articles[slug] = {
            title: titleMatch ? titleMatch[1].replace(/\\"/g, '"') : slug,
            category: tagMatch ? tagMatch[1] : '',
            readTime: (readTimeMatch ? readTimeMatch[1] : '').replace(/\s*read$/i, ''),
            publishedDate: today,
            description: descMatch ? descMatch[1].replace(/\\"/g, '"') : '',
            sections,
        };
    }

    return articles;
}

// ── Convert article to Markdown ──
function articleToMarkdown(slug, article) {
    const lines = [];

    lines.push(`# ${article.title}`);
    lines.push('');
    lines.push(`> ${article.category} | ${article.readTime} read | Published ${article.publishedDate}`);
    lines.push('');

    for (const section of article.sections) {
        if (section.heading) {
            lines.push(`## ${section.heading}`);
            lines.push('');
        }

        for (const p of section.paragraphs) {
            lines.push(p);
            lines.push('');
        }

        if (section.bulletPoints && section.bulletPoints.length > 0) {
            for (const bp of section.bulletPoints) {
                lines.push(`- ${bp}`);
            }
            lines.push('');
        }
    }

    lines.push('---');
    lines.push('');
    lines.push(`Check your documentation's AI readiness at [${baseUrl}](${baseUrl})`);
    lines.push('');

    return lines.join('\n');
}

// ── Generate llms.txt ──
function generateLlmsTxt(articles) {
    const lines = [];

    lines.push('# Perseverance AI');
    lines.push('');
    lines.push('> AI readiness analysis for developer documentation. Check if AI search engines can find, read, and cite your docs.');
    lines.push('');
    lines.push('## Main Pages');
    lines.push('');
    lines.push(`- [Home](${baseUrl}/): AI readiness scanner for documentation pages`);
    lines.push(`- [Education](${baseUrl}/education): Guides on optimizing docs for AI search`);
    lines.push(`- [About](${baseUrl}/about): About Perseverance AI`);
    lines.push(`- [Contact / Waitlist](${baseUrl}/contact): Join the waitlist for early access`);
    lines.push('');
    lines.push('## Education Articles');
    lines.push('');

    for (const [slug, article] of Object.entries(articles)) {
        lines.push(`- [${article.title}](${baseUrl}/education/${slug}): ${article.category} | ${article.readTime} read`);
    }

    lines.push('');

    return lines.join('\n');
}

// ── Generate sitemap.xml ──
function generateSitemap(articles) {
    const staticPages = [
        { loc: '/', priority: '1.0', changefreq: 'weekly' },
        { loc: '/education', priority: '0.9', changefreq: 'weekly' },
        { loc: '/about', priority: '0.8', changefreq: 'monthly' },
        { loc: '/contact', priority: '0.8', changefreq: 'monthly' },
        { loc: '/terms', priority: '0.3', changefreq: 'yearly' },
        { loc: '/privacy', priority: '0.3', changefreq: 'yearly' },
    ];

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    for (const page of staticPages) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}${page.loc}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
        xml += `    <priority>${page.priority}</priority>\n`;
        xml += `  </url>\n`;
    }

    // Education article pages + their markdown alternates
    for (const [slug, article] of Object.entries(articles)) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/education/${slug}</loc>\n`;
        xml += `    <lastmod>${article.publishedDate || today}</lastmod>\n`;
        xml += `    <changefreq>monthly</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n`;
    }

    xml += '</urlset>\n';
    return xml;
}

// ── Generate robots.txt ──
function generateRobotsTxt() {
    const lines = [
        'User-agent: *',
        'Allow: /',
        '',
        'User-agent: GPTBot',
        'Allow: /',
        '',
        'User-agent: ClaudeBot',
        'Allow: /',
        '',
        'User-agent: PerplexityBot',
        'Allow: /',
        '',
        'User-agent: Bytespider',
        'Allow: /',
        '',
        'User-agent: CCBot',
        'Allow: /',
        '',
        'User-agent: Google-Extended',
        'Allow: /',
        '',
        `Sitemap: ${baseUrl}/sitemap.xml`,
        '',
        '# LLM-readable company information',
        '# See https://llmstxt.org for specification',
        `# LLMs-Txt: ${baseUrl}/llms.txt`,
        '',
    ];
    return lines.join('\n');
}

// ── Main ──
function main() {
    console.log(`Generating AI assets for ${baseUrl}...`);

    const articles = extractArticles();
    const slugs = Object.keys(articles);
    console.log(`Found ${slugs.length} articles: ${slugs.join(', ')}`);

    // Ensure output directories exist
    if (!fs.existsSync(EDUCATION_DIR)) {
        fs.mkdirSync(EDUCATION_DIR, { recursive: true });
    }

    // Generate .md files
    for (const [slug, article] of Object.entries(articles)) {
        const md = articleToMarkdown(slug, article);
        const outPath = path.join(EDUCATION_DIR, `${slug}.md`);
        fs.writeFileSync(outPath, md, 'utf-8');
        console.log(`  ✓ education/${slug}.md`);
    }

    // Generate llms.txt
    const llmsTxt = generateLlmsTxt(articles);
    fs.writeFileSync(path.join(PUBLIC_DIR, 'llms.txt'), llmsTxt, 'utf-8');
    console.log('  ✓ llms.txt');

    // Generate sitemap.xml
    const sitemap = generateSitemap(articles);
    fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), sitemap, 'utf-8');
    console.log('  ✓ sitemap.xml');

    // Generate robots.txt
    const robots = generateRobotsTxt();
    fs.writeFileSync(path.join(PUBLIC_DIR, 'robots.txt'), robots, 'utf-8');
    console.log('  ✓ robots.txt');

    console.log('Done.');
}

main();
