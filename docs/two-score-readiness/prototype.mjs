// Measurement prototype for docs/two-score-readiness/spec.md (2026-10-22). Not product code.
// Run: node docs/two-score-readiness/prototype.mjs <url>   (Node 22+, no dependencies)
// Prototype of the proposed Lensy check set (2026-10-22): reachability gate +
// Coding agents (100) + AI search (100). Measurement only — not product code.
// Usage: node score.mjs <url>   -> prints JSON
const HONEST_UA = 'Lensy/1.0 (+https://perseveranceai.com/bot)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (+https://perseveranceai.com/bot)';
const AI_SEARCH_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'Claude-SearchBot', 'Claude-User'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NET_ERRORS = []; // network failures (not HTTP errors); a run with any of these must be repeated

async function get(url, { ua = HONEST_UA, accept = 'text/html,*/*;q=0.8', method = 'GET' } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method, redirect: 'follow', headers: { 'User-Agent': ua, Accept: accept }, signal: AbortSignal.timeout(30000) });
      const body = method === 'HEAD' ? '' : await res.text();
      return { status: res.status, ok: res.ok, url: res.url, type: (res.headers.get('content-type') || '').toLowerCase(), headers: res.headers, body };
    } catch (e) {
      if (attempt === 2) { NET_ERRORS.push(url); return { status: 0, ok: false, error: e.message, body: '', type: '', headers: new Headers() }; }
      await sleep(800 * (attempt + 1));
    }
  }
}

// Drop scripts, styles, nav, sidebars and footers. A <header> is only dropped when it is
// site chrome (contains a nav or is a banner) — article headers often hold the page's H1.
const stripNonContent = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<(nav|aside|footer)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<header\b([^>]*)>([\s\S]*?)<\/header>/gi, (all, attrs, inner) => (/role=["']banner|navbar|site-header/i.test(attrs) || /<nav\b/i.test(inner)) ? ' ' : inner);
// HTML content as rough Markdown: H2/H3 become "## " lines, so sections can be measured without a .md version.
const htmlAsMd = h => stripNonContent(h).replace(/<h([23])\b[^>]*>/gi, '\n## ').replace(/<\/h[23]>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ');
const textOf = h => stripNonContent(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
const looksMarkdown = (r) => r.ok && (/markdown|text\/plain/.test(r.type)) && !/^\s*<(!doctype|html)/i.test(r.body) && /(^|\n)#{1,3} |\]\(/.test(r.body);

// Minimal robots.txt evaluation: pick the most specific matching group, longest matching rule wins.
function robotsAllows(robots, agent, path) {
  if (!robots) return true;
  const groups = []; let cur = null, lastWasUA = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...rest] = line.split(':'); const key = k.trim().toLowerCase(); const val = rest.join(':').trim();
    if (key === 'user-agent') { if (!lastWasUA || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val.toLowerCase()); lastWasUA = true; }
    else { lastWasUA = false; if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val }); }
  }
  const a = agent.toLowerCase();
  let group = groups.find(g => g.agents.some(x => x !== '*' && a.includes(x))) || groups.find(g => g.agents.includes('*'));
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (r.path === '' ) { if (!r.allow && !best) best = { allow: true, len: 0 }; continue; }
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}

function headingsFromHtml(html) {
  const out = []; const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi; const content = stripNonContent(html); let m;
  while ((m = re.exec(content))) { const t = m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/​/g, '').trim(); if (t) out.push({ level: +m[1], text: t, id: /\bid=/.test(m[2]) }); }
  return out;
}
function headingsFromMd(md) {
  const out = []; let inFence = false;
  for (const line of md.split('\n')) { if (/^\s*```/.test(line)) inFence = !inFence; if (inFence) continue; const m = line.match(/^(#{1,6})\s+(.+)/); if (m) out.push({ level: m[1].length, text: m[2].trim() }); }
  return out;
}
const skips = hs => hs.filter((h, i) => i > 0 && h.level > hs[i - 1].level + 1).length;
function sectionWords(text, hs) { // words between headings in the markdown/text
  const parts = text.split(/\n(?=#{2,3} )/); return parts.slice(1).map(p => p.split(/\s+/).length);
}
function parseDate(s) { const d = new Date(s); return isNaN(d) ? null : d; }

async function sitemapUrls(origin, robots) {
  const roots = [...(robots || '').matchAll(/^sitemap:\s*(\S+)/gim)].map(m => m[1]);
  if (!roots.length) roots.push(origin + '/sitemap.xml');
  const entries = []; const queue = [...roots]; let fetched = 0;
  while (queue.length && fetched < 12) {
    const r = await get(queue.shift(), { accept: 'application/xml,text/xml,*/*' }); fetched++;
    if (!r.ok) continue;
    if (/<sitemapindex/i.test(r.body)) { for (const m of r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) queue.push(m[1]); continue; }
    for (const u of r.body.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
      const loc = (u[1].match(/<loc>\s*([^<\s]+)/i) || [])[1]; const lm = (u[1].match(/<lastmod>\s*([^<\s]+)/i) || [])[1];
      if (loc) entries.push({ loc, lastmod: lm || null });
    }
  }
  return { found: fetched > 0 && entries.length > 0, entries };
}
const norm = u => { try { const x = new URL(u); return (x.host + x.pathname).replace(/\/(index\.html?)?$/, '').toLowerCase(); } catch { return u; } };

async function score(url) {
  const out = { url, gate: {}, coding: { total: 0, checks: {} }, search: { total: 0, checks: {} }, notes: [] };
  const add = (bucket, name, pts, max, detail) => { out[bucket].checks[name] = { pts: Math.round(pts * 10) / 10, max, detail }; out[bucket].total += pts; };

  // ── Gate: reachable by an honestly named agent? ──
  let page = await get(url);
  out.gate.honestStatus = page.status; if (page.error) out.gate.honestError = page.error;
  if (!page.ok) { const b = await get(url, { ua: BROWSER_UA }); out.gate.browserStatus = b.status; if (b.ok) page = b; }
  out.gate.reachable = out.gate.honestStatus >= 200 && out.gate.honestStatus < 300;
  if (!page.ok) { out.error = 'page not fetchable'; out.netErrors = NET_ERRORS; return out; }
  const finalUrl = page.url || url; const origin = new URL(finalUrl).origin; const path = new URL(finalUrl).pathname;
  const html = page.body;
  const robotsRes = await get(origin + '/robots.txt', { accept: 'text/plain,*/*' });
  const robots = robotsRes.ok && !/<html/i.test(robotsRes.body) ? robotsRes.body : '';
  const allowedBots = AI_SEARCH_BOTS.filter(b => robotsAllows(robots, b, path));
  out.gate.robotsBlocks = AI_SEARCH_BOTS.filter(b => !allowedBots.includes(b));
  out.gate.mismatch = out.gate.robotsBlocks.length === 0 && !out.gate.reachable ? 'robots.txt allows AI bots but the server blocked an honest agent' : null;

  // ── Shared: content without JavaScript ──
  const text = textOf(html); const words = text.split(/\s+/).filter(Boolean).length;
  const spaShell = /<div\s+id=["'](root|app|__next|__nuxt)["']\s*>\s*<\/div>/i.test(html);
  const jsPts = words >= 150 && !spaShell ? 1 : words >= 40 ? 0.5 : 0;
  const jsDetail = `${words} words in raw HTML${spaShell ? ', empty SPA root' : ''}`;

  // ── Markdown routes ──
  const cn = await get(finalUrl, { accept: 'text/markdown' });
  const cnOk = looksMarkdown(cn);
  const alt = html.match(/<link[^>]*rel=["']alternate["'][^>]*type=["']text\/markdown["'][^>]*href=["']([^"']+)["']/i) || html.match(/<link[^>]*type=["']text\/markdown["'][^>]*href=["']([^"']+)["']/i);
  const linkHdr = (page.headers.get('link') || '').match(/<([^>]+)>[^,]*type="?text\/markdown/i);
  const mdCandidate = alt ? new URL(alt[1], finalUrl).href : linkHdr ? new URL(linkHdr[1], finalUrl).href : finalUrl.replace(/\/$/, '') + '.md';
  const md = await get(mdCandidate, { accept: 'text/markdown,text/plain,*/*' });
  const mdOk = looksMarkdown(md);

  // ── llms.txt ──
  const segs = path.split('/').filter(Boolean);
  const llmsCands = [origin + '/llms.txt', ...(segs.length > 1 ? [origin + '/' + segs[0] + '/llms.txt'] : [])];
  let llms = null, llmsUrl = null;
  for (const c of llmsCands) { const r = await get(c, { accept: 'text/plain,text/markdown,*/*' }); if (r.ok && !/^\s*<(!doctype|html)/i.test(r.body) && r.body.length > 50) { llms = r.body; llmsUrl = c; break; } }
  const mdListedInLlms = !!llms && (llms.includes(new URL(mdCandidate).pathname) || llms.includes(path.replace(/\/$/, '') + '.md'));
  const mdDiscoverable = mdOk && (!!alt || !!linkHdr || mdListedInLlms);

  // Coding 1: content without JS (20)
  add('coding', 'Content without JavaScript', 20 * jsPts, 20, jsDetail);
  // Coding 2: Markdown on request (15)
  add('coding', 'Markdown on Accept: text/markdown', cnOk ? 15 : 0, 15, cnOk ? `served ${cn.type.split(';')[0]}` : `got ${cn.type.split(';')[0] || cn.status}`);
  // Coding 3: .md discoverable (15)
  add('coding', '.md version discoverable', mdDiscoverable ? 15 : mdOk ? 8 : 0, 15, mdOk ? `${mdCandidate} (${alt ? 'rel=alternate' : linkHdr ? 'Link header' : mdListedInLlms ? 'listed in llms.txt' : 'not advertised'})` : 'no .md version');
  // Coding 4: llms.txt (20)
  let llmsPts = 0, llmsDetail = 'not found';
  if (llms) {
    const links = [...llms.matchAll(/\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g)].map(m => new URL(m[1], llmsUrl).href);
    const validFmt = /^#\s+\S/m.test(llms) && links.length > 0;
    const sample = links.filter((_, i) => i % Math.max(1, Math.floor(links.length / 8)) === 0).slice(0, 8);
    let okCount = 0; for (const l of sample) { const r = await get(l, { method: 'HEAD', accept: '*/*' }); if (r.status === 405 || r.status === 403) { const g = await get(l, { accept: 'text/markdown,text/html,*/*' }); if (g.ok) okCount++; } else if (r.ok) okCount++; }
    const resolve = sample.length ? okCount / sample.length : 0;
    const size = llms.length; const sizePts = size <= 50000 ? 4 : size <= 100000 ? 2 : 0;
    llmsPts = 8 + (validFmt ? 4 : 0) + 4 * resolve + sizePts;
    llmsDetail = `${llmsUrl}, ${links.length} links, ${Math.round(resolve * 100)}% of ${sample.length} sampled resolve, ${Math.round(size / 1000)}K chars`;
  }
  add('coding', 'llms.txt usable', llmsPts, 20, llmsDetail);
  // Coding 5: page fits one fetch (15) — measure what an agent receives
  const received = cnOk ? cn.body : mdOk ? md.body : text;
  const recvLen = received.length;
  const recvWords = received.split(/\s+/).filter(Boolean).length; // an empty page is not "small": no content, no points
  add('coding', 'Page fits one fetch', recvWords < 40 ? 0 : recvLen <= 50000 ? 15 : recvLen <= 100000 ? 10 : 0, 15, recvWords < 40 ? `no readable content received (${recvWords} words)` : `${Math.round(recvLen / 1000)}K chars received as ${cnOk || mdOk ? 'Markdown' : 'HTML text'}`);
  // Coding 6: sections findable (15)
  const mdText = cnOk ? cn.body : mdOk ? md.body : null;
  const hs = mdText ? headingsFromMd(mdText) : headingsFromHtml(html);
  const hHtml = headingsFromHtml(html);
  const h1 = hs.filter(h => h.level === 1).length; const sk = skips(hs);
  const sub = hHtml.filter(h => h.level === 2 || h.level === 3); const idShare = sub.length ? sub.filter(h => h.id).length / sub.length : 0;
  const generic = hs.filter(h => /^(overview|introduction|details|more|notes?|example)$/i.test(h.text)).length;
  const secPts = (h1 === 1 ? 5 : h1 > 1 ? 2 : 0) + (hs.length < 2 ? 0 : sk === 0 ? 6 : sk === 1 ? 3 : 0) + 4 * idShare;
  add('coding', 'Sections findable', secPts, 15, `${h1} H1, ${sk} level skip(s), ${Math.round(idShare * 100)}% of H2/H3 have ids, ${generic} generic heading(s)`);

  // ── AI search ──
  add('search', 'AI search bots allowed', 20 * allowedBots.length / AI_SEARCH_BOTS.length, 20, out.gate.robotsBlocks.length ? `blocked: ${out.gate.robotsBlocks.join(', ')}` : `all ${AI_SEARCH_BOTS.length} allowed${robots ? '' : ' (no robots.txt)'}`);
  add('search', 'Content without JavaScript', 20 * jsPts, 20, jsDetail);
  const metaRobots = (html.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)/i) || [])[1] || '';
  const noindex = /noindex/i.test(metaRobots) || /noindex/i.test(page.headers.get('x-robots-tag') || '');
  const canon = (html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i) || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i) || [])[1];
  const sm = await sitemapUrls(origin, robots);
  const smEntry = sm.entries.find(e => norm(e.loc) === norm(finalUrl)) || sm.entries.find(e => norm(e.loc) === norm(canon || ''));
  add('search', 'Indexable', noindex ? 0 : 10 + (canon ? 7 : 0) + (smEntry ? 8 : 0), 25, `${noindex ? 'NOINDEX' : 'indexable'}, canonical ${canon ? 'yes' : 'no'}, ${sm.found ? `in sitemap: ${smEntry ? 'yes' : 'no'} (${sm.entries.length} URLs read)` : 'no sitemap found'}`);
  // Freshness (15)
  const pageDates = [];
  for (const m of html.matchAll(/"dateModified"\s*:\s*"([^"]+)"/g)) pageDates.push(['dateModified', m[1]]);
  for (const m of html.matchAll(/article:modified_time["'][^>]*content=["']([^"']+)/g)) pageDates.push(['article:modified_time', m[1]]);
  for (const m of html.matchAll(/<time[^>]*datetime=["']([^"']+)["']/g)) pageDates.push(['<time>', m[1]]);
  const vis = textOf(html).match(/(last\s+updated|updated\s+on|last\s+modified)\s*:?\s*([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (vis) pageDates.push(['visible', vis[2]]);
  const pageDate = pageDates.map(d => parseDate(d[1])).find(Boolean);
  const lastmods = sm.entries.map(e => e.lastmod).filter(Boolean);
  const distinct = new Set(lastmods.map(l => l.slice(0, 10))).size;
  const believable = lastmods.length > 0 && (distinct > 1 || sm.entries.length === 1);
  const entryLm = smEntry && smEntry.lastmod ? parseDate(smEntry.lastmod) : null;
  const agree = pageDate && entryLm && Math.abs(pageDate - entryLm) <= 7 * 86400e3;
  const freshPts = (pageDate ? 6 : 0) + (entryLm ? 4 : 0) + (believable ? 3 : 0) + (agree ? 2 : 0);
  const age = pageDate || entryLm; const ageDays = age ? Math.round((Date.now() - age) / 86400e3) : null;
  add('search', 'Freshness declared', freshPts, 15, `page date: ${pageDate ? pageDates.find(d => parseDate(d[1]))[0] : 'none'}; sitemap lastmod: ${lastmods.length}/${sm.entries.length} URLs, ${distinct} distinct dates${lastmods.length && !believable ? ' (all identical = generated)' : ''}; this URL ${entryLm ? 'has lastmod' : 'no lastmod'}${ageDays != null ? `; age ${ageDays} days (info)` : ''}`);
  // Answer-ready sections (15) — AI search crawlers receive the HTML, so measure the HTML.
  const sh1 = hHtml.filter(h => h.level === 1).length; const ssk = skips(hHtml);
  const secs = sectionWords(htmlAsMd(html));
  const med = secs.length ? secs.sort((a, b) => a - b)[Math.floor(secs.length / 2)] : null;
  const chunkPts = med == null ? 0 : med >= 40 && med <= 500 ? 7 : med <= 900 ? 4 : 1;
  add('search', 'Answer-ready sections', (sh1 === 1 ? 4 : sh1 > 1 ? 2 : 0) + (hHtml.length < 2 ? 0 : ssk === 0 ? 4 : ssk === 1 ? 2 : 0) + chunkPts, 15, `${sh1} H1, ${ssk} skip(s), median section ${med ?? 'n/a'} words (HTML)`);
  // JSON-LD (5)
  let types = [], hasDM = false;
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { const j = JSON.parse(m[1]); const arr = Array.isArray(j) ? j : j['@graph'] || [j]; for (const x of arr) { if (x['@type']) types.push([].concat(x['@type']).join('/')); if (x.dateModified) hasDM = true; } } catch { types.push('invalid'); } }
  add('search', 'JSON-LD', (types.some(t => t !== 'invalid') ? 3 : 0) + (hasDM ? 2 : 0), 5, types.length ? `${types.join(', ')}${hasDM ? ', dateModified' : ''}` : 'none');

  out.netErrors = NET_ERRORS;
  // Reachability is a banner, not a cap (spec §4.1): warn when only the browser fallback worked.
  out.gate.state = out.gate.reachable ? 'pass' : 'warn';
  for (const b of ['coding', 'search']) out[b].total = Math.round(out[b].total);
  return out;
}

score(process.argv[2]).then(r => console.log(JSON.stringify(r, null, 1))).catch(e => { console.error(e); process.exit(1); });
