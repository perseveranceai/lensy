#!/usr/bin/env node
/**
 * prerender.js: runs after `react-scripts build`.
 *
 * Crawlers and coding agents mostly don't run JavaScript, so a client-rendered
 * page reaches them as an empty <div id="root">. This script opens every route
 * of the finished build in a headless browser and saves what it renders:
 *
 *   <path>/index.html   each page's own HTML, head included (index.html for /)
 *   <path>.md           a Markdown copy of each content page (index.md for /)
 *   404.html            the Not found page, served with status 404
 *   llms.txt            every page, in sections (Product, Docs, Checks, Learn, Company)
 *   docs/llms.txt       the docs alone (the llms.txt proposal allows one per folder)
 *   llms-full.txt       the Markdown of every docs page in one file, for agents that want one fetch
 *   sitemap.xml, robots.txt
 *
 * Routes come from src/site-pages.json. Articles are found from the links on
 * /learn and check pages from the links on /docs/checks, so a new article or
 * check needs no change here. Elements marked data-md-skip="true" (widget
 * labels, diagrams) are left out of the Markdown copies. The saved HTML is
 * hydrated by src/index.tsx, so the page doesn't re-render when scripts load.
 *
 * Request routing on gamma and prod (backend/cloudfront/site-router.js) maps
 * /docs/cli to /docs/cli/index.html and answers moved pages with a 301, and
 * scripts/serve-build.js does the same locally.
 *
 * The build fails if a content page has no single H1, a wrong canonical, or a
 * link in llms.txt that has no file behind it.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('@playwright/test');

const SITE_PAGES = require('../src/site-pages.json');

const BUILD_DIR = path.resolve(__dirname, '..', process.env.BUILD_PATH || 'build');
const BASE_URL = (process.env.REACT_APP_BASE_URL || 'https://perseveranceai.com').replace(/\/$/, '');
const NOT_FOUND_PROBE = '/prerender-not-found-probe';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.woff2': 'font/woff2',
};

const log = (...args) => console.log('[Prerender]', ...args);

function fail(message) {
  console.error(`[Prerender] FAILED: ${message}`);
  process.exit(1);
}

const absolute = (p) => (p === '/' ? `${BASE_URL}/` : `${BASE_URL}${p}`);
const mdPath = (p) => (p === '/' ? '/index.md' : `${p.replace(/\/+$/, '')}.md`);
const htmlFile = (p) => path.join(BUILD_DIR, p === '/' ? 'index.html' : path.join(p, 'index.html'));

function write(rel, content) {
  const file = path.join(BUILD_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

// This site's readiness history (written daily by .github/workflows/site-readiness.yml,
// kept out of the build). Pages are rendered with the live copy so their saved HTML
// shows this week's scores. If it can't be read, pages use src/readiness-seed.json.
async function liveHistory() {
  const url = process.env.READINESS_HISTORY_URL || `${BASE_URL}/readiness/history.json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'lensy-prerender' } });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/json/.test(type)) { log(`no readiness history at ${url} (HTTP ${res.status}); using the seed`); return null; }
    const text = await res.text();
    JSON.parse(text);
    log(`readiness history from ${url}`);
    return text;
  } catch (e) {
    log(`readiness history not read from ${url} (${e.message}); using the seed`);
    return null;
  }
}

// Serves the build as a plain SPA: real files when they exist, the original
// shell for every route. Only used while rendering.
function startServer(shell, history) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (pathname === '/readiness/history.json' && history) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(history);
        return;
      }
      const file = path.join(BUILD_DIR, pathname);
      if (file.startsWith(BUILD_DIR) && pathname !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES['.html'] });
      res.end(shell);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Shell for routes that aren't content: scanner screens and old redirects.
function shellFor(shell, page) {
  let html = shell.replace(/<meta name="robots" content="[^"]*"\s*\/?>/, '<meta name="robots" content="noindex">');
  if (page.kind === 'redirect') html = html.replace('</head>', '<meta http-equiv="refresh" content="0; url=/"></head>');
  return html;
}

/* Runs in the page. Prepares the DOM so React can hydrate it, then returns the
   HTML, the Markdown of <main>, and the head facts the build checks. */
function snapshot({ baseUrl }) {
  const root = document.getElementById('root');
  const origin = window.location.origin;

  // ---- Markdown of <main>, taken before the DOM is touched ----
  const absUrl = (href) => {
    try {
      const u = new URL(href, window.location.href);
      return u.origin === origin ? baseUrl + u.pathname + u.search + u.hash : u.href;
    } catch (e) { return href; }
  };
  // Navigation and side panels aren't page content (crawlers drop them too).
  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'svg', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'NOSCRIPT', 'TEMPLATE', 'NAV', 'ASIDE']);
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'ASIDE', 'UL', 'OL', 'LI', 'PRE',
    'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'FORM', 'FIGURE', 'DL', 'DT', 'DD', 'HR', 'DETAILS', 'SUMMARY']);
  const hidden = (el) => el.getAttribute('aria-hidden') === 'true' || el.hidden || el.getAttribute('data-md-skip') === 'true';
  const isBlock = (el) => BLOCK.has(el.tagName) || (el.tagName === 'A' && Array.from(el.children).some((c) => BLOCK.has(c.tagName)));

  function inline(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.tagName) || hidden(node)) return '';
    if (node.tagName === 'BUTTON') return node.hasAttribute('aria-expanded') ? node.textContent.trim() : '';
    if (node.tagName === 'BR') return ' ';
    const inner = Array.from(node.childNodes).map(inline).join('');
    const text = inner.trim();
    switch (node.tagName) {
      case 'A': {
        const href = node.getAttribute('href');
        return text && href ? `[${text}](${absUrl(href)})` : inner;
      }
      case 'CODE': return text ? (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``) : '';
      case 'STRONG': case 'B': return text ? `**${text}**` : '';
      case 'EM': case 'I': return text ? `*${text}*` : '';
      case 'IMG': return node.alt ? `![${node.alt}](${absUrl(node.getAttribute('src'))})` : '';
      default: return inner;
    }
  }

  function blocks(el, ctx) {
    const out = [];
    let run = [];
    let lastWasElement = false;
    const flush = () => {
      const text = run.join('').replace(/\s+/g, ' ').trim();
      if (text) out.push(text);
      run = [];
      lastWasElement = false;
    };
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && (SKIP.has(child.tagName) || hidden(child))) continue;
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'BUTTON' && child.hasAttribute('aria-expanded')) {
        flush();
        const q = child.textContent.trim();
        if (q) out.push(`**${q}**`);
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE && isBlock(child)) {
        flush();
        out.push(...block(child, ctx));
      } else {
        const isElement = child.nodeType === Node.ELEMENT_NODE;
        // Two side-by-side elements (a label and a count in a flex row) read as
        // separate words, even with no space between them in the HTML.
        if (isElement && lastWasElement) run.push(' ');
        run.push(inline(child));
        lastWasElement = isElement;
      }
    }
    flush();
    return out;
  }

  function block(el, ctx) {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const text = inline(el).replace(/\s+/g, ' ').trim();
      if (!text) return [];
      const label = ctx.href ? `[${text}](${ctx.href})` : text;
      return [`${'#'.repeat(Number(tag[1]))} ${label}`];
    }
    if (tag === 'PRE') return ['```\n' + el.textContent.replace(/\n+$/, '') + '\n```'];
    if (tag === 'HR') return ['---'];
    if (tag === 'UL' || tag === 'OL') {
      const items = Array.from(el.children).filter((c) => c.tagName === 'LI' && !hidden(c));
      return [items.map((li, i) => {
        const parts = blocks(li, ctx);
        const marker = tag === 'OL' ? `${i + 1}.` : '-';
        return parts.map((p, j) => (j === 0 ? `${marker} ${p}` : p.split('\n').map((l) => `   ${l}`).join('\n'))).join('\n');
      }).join('\n')];
    }
    if (tag === 'TABLE') {
      const rows = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((c) => inline(c).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')));
      if (!rows.length) return [];
      const head = `| ${rows[0].join(' | ')} |`;
      const sep = `| ${rows[0].map(() => '---').join(' | ')} |`;
      return [[head, sep, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n')];
    }
    if (tag === 'BLOCKQUOTE') return [blocks(el, ctx).map((p) => p.split('\n').map((l) => `> ${l}`).join('\n')).join('\n>\n')];
    if (tag === 'A') {
      const href = el.getAttribute('href');
      return blocks(el, { ...ctx, href: href ? absUrl(href) : ctx.href });
    }
    return blocks(el, ctx);
  }

  const main = document.querySelector('main');
  const parts = main ? blocks(main, {}) : [];
  // Back links and labels above the H1 are navigation; the copy starts at the title.
  const firstH1 = parts.findIndex((p) => p.startsWith('# '));
  if (firstH1 > 0) parts.splice(0, firstH1);
  const h1Index = parts.findIndex((p) => p.startsWith('# '));
  const ld = document.getElementById('page-jsonld');
  let dateModified = null;
  try { dateModified = ld ? (JSON.parse(ld.textContent)['@graph'] || []).find((n) => n.dateModified)?.dateModified || null : null; } catch (e) { /* checked below */ }
  const preface = [`> Part of [Lensy by Perseverance AI](${baseUrl}/). The index of every page for AI agents is at [${baseUrl}/llms.txt](${baseUrl}/llms.txt).`];
  if (dateModified) preface.push(`Last updated: ${dateModified}`);
  if (h1Index >= 0) parts.splice(h1Index + 1, 0, ...preface);
  const markdown = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

  // ---- Facts the build checks ----
  const facts = {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') || '',
    h1Count: main ? main.querySelectorAll('h1').length : 0,
    dateModified,
    links: Array.from(document.querySelectorAll('main a[href^="/"]')).map((a) => a.getAttribute('href')),
  };

  // ---- Make the DOM match what React's first render will produce ----
  // The theme script in index.html sets these again before first paint.
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  // MUI's emotion styles are inserted at runtime with insertRule, so these tags
  // are empty here. Left in, emotion would treat its styles as already present.
  document.querySelectorAll('style[data-emotion]').forEach((s) => s.remove());
  // React marks a finished <Suspense> boundary with <!--$--> ... <!--/$-->, and
  // separates adjacent text nodes with <!-- -->. Saved HTML merges adjacent
  // text, so put the separators back for hydration to line up.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const t of texts) {
    if (t.previousSibling && t.previousSibling.nodeType === Node.TEXT_NODE) t.parentNode.insertBefore(document.createComment(' '), t);
  }
  root.insertBefore(document.createComment('$'), root.firstChild);
  root.appendChild(document.createComment('/$'));
  // Save the readiness history this page was drawn with, so the browser's first
  // render draws the same (src/readiness.tsx reads this tag).
  delete document.documentElement.dataset.readiness;
  if (window.__lensyReadiness) {
    const tag = document.createElement('script');
    tag.id = 'readiness-data';
    tag.type = 'application/json';
    tag.textContent = JSON.stringify(window.__lensyReadiness).replace(/</g, '\\u003c');
    document.head.appendChild(tag);
  }

  return { html: '<!DOCTYPE html>' + document.documentElement.outerHTML, markdown, facts };
}

async function render(context, origin, route, { content }) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(origin + route, { waitUntil: 'load' });
  await page.waitForSelector('main h1', { timeout: 30_000 });
  if (content) await page.waitForSelector('script#page-jsonld', { state: 'attached', timeout: 30_000 });
  else await page.waitForFunction(() => document.querySelector('meta[name="robots"]')?.getAttribute('content') === 'noindex');
  // Pages with the score chart wait until its history has loaded.
  await page.waitForFunction(() => !document.querySelector('[data-testid="score-chart"]') || document.documentElement.dataset.readiness === 'ready', null, { timeout: 15_000 });
  // Let effects settle (route fade, scroll reveal, head updates).
  await page.waitForTimeout(400);
  const result = await page.evaluate(snapshot, { baseUrl: BASE_URL });
  await page.close();
  if (consoleErrors.length) fail(`${route} threw while rendering: ${consoleErrors.join('; ')}`);
  return result;
}

function checkContent(route, facts) {
  if (facts.h1Count !== 1) fail(`${route} has ${facts.h1Count} H1 elements in <main>, expected 1`);
  if (facts.canonical !== absolute(route)) fail(`${route} canonical is ${facts.canonical}, expected ${absolute(route)}`);
  if (/noindex/.test(facts.robots)) fail(`${route} is marked noindex`);
  if (!facts.description) fail(`${route} has no meta description`);
  if (!facts.dateModified) fail(`${route} has no dateModified in its JSON-LD`);
}

// llms.txt sections, by folder.
const SECTIONS = ['Product', 'Docs', 'Checks', 'Learn', 'Company', 'Optional'];
function sectionOf(p) {
  if (p === '/') return 'Product';
  if (p.startsWith('/docs/checks/')) return 'Checks';
  if (p === '/docs' || p.startsWith('/docs/')) return 'Docs';
  if (p === '/learn' || p.startsWith('/learn/') || p === '/changelog') return 'Learn';
  if (p.startsWith('/legal/')) return 'Optional';
  return 'Company';
}

const llmsLine = (e) => `- [${e.title}](${BASE_URL}${mdPath(e.path)}): ${e.description}`;

function llmsTxt(entries) {
  const section = (title) => {
    const list = entries.filter((e) => sectionOf(e.path) === title);
    return list.length ? [`## ${title}`, '', ...list.map(llmsLine), ''] : [];
  };
  return [
    '# Lensy by Perseverance AI',
    '',
    '> Lensy checks whether a documentation page is ready for AI search engines and coding agents. It gives the page two scores out of 100, Coding agents and AI search, and lists the fixes worth the most points. It runs on perseveranceai.com and as the open source `lensy` command line tool.',
    '',
    `Every link below is the Markdown copy of a page. The HTML page is at the same address without \`.md\` (the home page is ${BASE_URL}/). The docs alone are indexed at ${BASE_URL}/docs/llms.txt, and all of them are in one file at ${BASE_URL}/llms-full.txt.`,
    '',
    ...SECTIONS.flatMap(section),
  ].join('\n');
}

function docsLlmsTxt(entries) {
  const list = (title) => entries.filter((e) => sectionOf(e.path) === title).map(llmsLine);
  return [
    '# Lensy docs',
    '',
    '> How to check a documentation page with Lensy, on perseveranceai.com or with the `lensy` command line tool, what the Coding agents and AI search scores mean, and every check behind them.',
    '',
    `Every link below is the Markdown copy of a page. The whole site is indexed at ${BASE_URL}/llms.txt.`,
    '',
    '## Docs',
    '',
    ...list('Docs'),
    '',
    '## Checks',
    '',
    ...list('Checks'),
    '',
  ].join('\n');
}

function llmsFullTxt(entries, markdownByPath) {
  const docs = entries.filter((e) => ['Docs', 'Checks'].includes(sectionOf(e.path)));
  return [
    '# Lensy docs, in full',
    '',
    `> Every page of the Lensy docs in one file. Each page starts with its address. The index is at ${BASE_URL}/docs/llms.txt.`,
    '',
    ...docs.flatMap((e) => ['---', '', `Source: ${absolute(e.path)}`, '', markdownByPath.get(e.path).trim(), '']),
  ].join('\n');
}

function sitemapXml(entries) {
  const urls = entries.map((e) => [
    '  <url>',
    `    <loc>${absolute(e.path)}</loc>`,
    `    <lastmod>${e.updated}</lastmod>`,
    '  </url>',
  ].join('\n'));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}

function robotsTxt() {
  const bots = ['*', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'CCBot', 'Bytespider'];
  return [
    ...bots.flatMap((b) => [`User-agent: ${b}`, 'Allow: /', '']),
    `Sitemap: ${BASE_URL}/sitemap.xml`,
    '',
    '# Index of every page for AI agents, with Markdown copies: https://llmstxt.org',
    `# ${BASE_URL}/llms.txt`,
    '',
  ].join('\n');
}

async function main() {
  const started = Date.now();
  const shellPath = path.join(BUILD_DIR, 'index.html');
  if (!fs.existsSync(shellPath)) fail(`no build at ${BUILD_DIR}; run react-scripts build first`);
  const shell = fs.readFileSync(shellPath, 'utf-8');
  if (!shell.includes('<div id="root"></div>')) fail('build/index.html is already prerendered; rebuild first');
  log(`rendering ${BUILD_DIR} for ${BASE_URL}`);

  // build/readiness/history.json: the history pages are drawn with (live copy, or
  // the seed). Deploys sync with --exclude 'readiness/*', so it never replaces the
  // live file; deploy.yml uploads it only when a bucket has none yet.
  const history = await liveHistory();
  write('readiness/history.json', history || fs.readFileSync(path.join(__dirname, '..', 'src', 'readiness-seed.json'), 'utf-8'));
  const server = await startServer(shell, history);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => { try { localStorage.setItem('lensy-analytics-consent', 'denied'); } catch (e) { /* no storage */ } });
  // Nothing leaves the machine. API calls (free scan count, the bot page's IP)
  // are held open, so the saved HTML shows the same "checking" state a browser
  // starts with, and real values load after hydration.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (/execute-api|perseveranceai\.com\/api/.test(url)) return undefined;
    return route.abort();
  });

  try {
    const contentPages = SITE_PAGES.filter((p) => p.kind === 'page');
    const entries = [];
    const markdownByPath = new Map();

    for (const p of contentPages) {
      const { html, markdown, facts } = await render(context, origin, p.path, { content: true });
      checkContent(p.path, facts);
      fs.mkdirSync(path.dirname(htmlFile(p.path)), { recursive: true });
      fs.writeFileSync(htmlFile(p.path), html, 'utf-8');
      write(mdPath(p.path), markdown);
      markdownByPath.set(p.path, markdown);
      entries.push({ path: p.path, title: p.title, description: facts.description, group: p.group, updated: facts.dateModified, links: facts.links });
      log(`  ${p.path}`);
    }

    // Articles: every /learn/<slug> linked from /learn. Check pages: every
    // /docs/checks/<slug> linked from /docs/checks.
    const linkedFrom = (from, pattern) => {
      const page = entries.find((e) => e.path === from);
      return [...new Set((page ? page.links : []).filter((l) => pattern.test(l)))];
    };
    const slugs = linkedFrom('/learn', /^\/learn\/[a-z0-9-]+$/);
    if (!slugs.length) fail('found no articles linked from /learn');
    const checkRoutes = linkedFrom('/docs/checks', /^\/docs\/checks\/[a-z0-9-]+$/);
    if (checkRoutes.length < 30) fail(`found ${checkRoutes.length} check pages linked from /docs/checks, expected every check`);
    for (const route of checkRoutes) {
      const { html, markdown, facts } = await render(context, origin, route, { content: true });
      checkContent(route, facts);
      fs.mkdirSync(path.dirname(htmlFile(route)), { recursive: true });
      fs.writeFileSync(htmlFile(route), html, 'utf-8');
      write(mdPath(route), markdown);
      markdownByPath.set(route, markdown);
      entries.push({ path: route, title: facts.title.replace(/ - Lensy$/, ''), description: facts.description, group: 'docs', updated: facts.dateModified });
    }
    log(`  ${checkRoutes.length} check pages under /docs/checks/`);
    for (const route of slugs) {
      const { html, markdown, facts } = await render(context, origin, route, { content: true });
      checkContent(route, facts);
      fs.mkdirSync(path.dirname(htmlFile(route)), { recursive: true });
      fs.writeFileSync(htmlFile(route), html, 'utf-8');
      write(mdPath(route), markdown);
      const title = facts.title.replace(/ - Lensy$/, '');
      entries.push({ path: route, title, description: `${facts.description} Updated ${facts.dateModified}.`, group: 'learn', updated: facts.dateModified });
      log(`  ${route}`);
    }

    const notFound = await render(context, origin, NOT_FOUND_PROBE, { content: false });
    write('404.html', notFound.html);
    log('  404.html');

    for (const p of SITE_PAGES.filter((x) => x.kind !== 'page')) {
      fs.mkdirSync(path.dirname(htmlFile(p.path)), { recursive: true });
      fs.writeFileSync(htmlFile(p.path), shellFor(shell, p), 'utf-8');
    }
    log(`  shells for ${SITE_PAGES.filter((x) => x.kind !== 'page').map((x) => x.path).join(', ')}`);

    // Same order everywhere: the page list's order, then checks and articles.
    const llms = llmsTxt(entries);
    write('llms.txt', llms);
    write('docs/llms.txt', docsLlmsTxt(entries));
    write('llms-full.txt', llmsFullTxt(entries, markdownByPath));
    write('sitemap.xml', sitemapXml(entries));
    write('robots.txt', robotsTxt());

    // Every same-site link in both llms.txt files must have a file behind it.
    for (const m of (llms + docsLlmsTxt(entries)).matchAll(/\]\((https?:\/\/[^)]+)\)/g)) {
      const u = new URL(m[1]);
      if (`${u.protocol}//${u.host}` !== BASE_URL) continue;
      if (u.pathname === '/') continue;
      if (!fs.existsSync(path.join(BUILD_DIR, u.pathname))) fail(`llms.txt links to ${u.pathname}, which the build doesn't have`);
    }
    log(`llms.txt, sitemap.xml, robots.txt: ${entries.length} pages, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
