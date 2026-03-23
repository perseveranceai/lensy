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

const ARTICLE_FILE = path.join(__dirname, '..', 'src', 'pages', 'ArticlePage.tsx');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EDUCATION_DIR = path.join(PUBLIC_DIR, 'education');

// Determine base URL from env
const baseUrl = (process.env.REACT_APP_BASE_URL || 'https://perseveranceai.com').replace(/\/$/, '');
const today = new Date().toISOString().split('T')[0];

// ── Parse article content from ArticlePage.tsx ──
function extractArticles() {
    const source = fs.readFileSync(ARTICLE_FILE, 'utf-8');

    const startMarker = 'const articleContent: Record<string, ArticleContent> = {';
    const startIdx = source.indexOf(startMarker);
    if (startIdx === -1) {
        console.error('Could not find articleContent in ArticlePage.tsx');
        process.exit(1);
    }

    let braceCount = 0;
    let objStart = source.indexOf('{', startIdx);
    let i = objStart;
    for (; i < source.length; i++) {
        if (source[i] === '{') braceCount++;
        if (source[i] === '}') braceCount--;
        if (braceCount === 0) break;
    }

    const objSource = source.substring(objStart, i + 1);

    const articles = {};
    const slugRegex = /'([a-z0-9-]+)':\s*\{/g;
    let match;
    const slugPositions = [];

    while ((match = slugRegex.exec(objSource)) !== null) {
        slugPositions.push({ slug: match[1], pos: match.index });
    }

    for (let s = 0; s < slugPositions.length; s++) {
        const { slug, pos } = slugPositions[s];
        const endPos = s + 1 < slugPositions.length ? slugPositions[s + 1].pos : objSource.length;
        const block = objSource.substring(pos, endPos);

        const titleMatch = block.match(/title:\s*'([^']+)'/);
        const categoryMatch = block.match(/category:\s*'([^']+)'/);
        const readTimeMatch = block.match(/readTime:\s*'([^']+)'/);
        const dateMatch = block.match(/publishedDate:\s*'([^']+)'/);

        const sections = [];
        const sectionRegex = /\{\s*(?:heading:\s*'([^']*)',\s*)?paragraphs:\s*\[([\s\S]*?)\](?:,\s*bulletPoints:\s*\[([\s\S]*?)\])?\s*,?\s*\}/g;
        let secMatch;

        while ((secMatch = sectionRegex.exec(block)) !== null) {
            const heading = secMatch[1] || null;
            const paragraphsRaw = secMatch[2];
            const bulletsRaw = secMatch[3] || null;

            const paragraphs = [];
            const pRegex = /'((?:[^'\\]|\\.)*)'/g;
            let pMatch;
            while ((pMatch = pRegex.exec(paragraphsRaw)) !== null) {
                paragraphs.push(pMatch[1].replace(/\\'/g, "'"));
            }

            const bulletPoints = [];
            if (bulletsRaw) {
                const bRegex = /'((?:[^'\\]|\\.)*)'/g;
                let bMatch;
                while ((bMatch = bRegex.exec(bulletsRaw)) !== null) {
                    bulletPoints.push(bMatch[1].replace(/\\'/g, "'"));
                }
            }

            sections.push({ heading, paragraphs, bulletPoints });
        }

        articles[slug] = {
            title: titleMatch ? titleMatch[1].replace(/\\'/g, "'") : slug,
            category: categoryMatch ? categoryMatch[1] : '',
            readTime: readTimeMatch ? readTimeMatch[1] : '',
            publishedDate: dateMatch ? dateMatch[1] : '',
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
