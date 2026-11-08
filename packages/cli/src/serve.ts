// SPDX-License-Identifier: MIT
// `lensy check --dir <folder>`: serve a docs build folder on 127.0.0.1 for the
// length of the run, like a plain static host. Clean URLs (/guide/start serves
// guide/start.html or guide/start/index.html), the folder's 404.html with
// status 404, .md files as text/markdown, and no content negotiation (that is
// the host's job, so local mode skips it). Nothing outside the folder is ever
// served: paths are decoded once, resolved, and checked against the folder's
// real path, so `..`, encoded dots and symlinks out of the folder all give 404.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

export interface Served { origin: string; close(): Promise<void> }

const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };

/**
 * The file a request path maps to, or null. `basePath` is the site's path
 * prefix ("/" or "/docs/"); requests outside it get 404.
 */
export function resolveRequest(rootReal: string, basePath: string, rawPath: string): string | null {
  let p: string;
  try { p = decodeURIComponent(rawPath.split('?')[0].split('#')[0]); } catch { return null; }
  if (p.includes('\0')) return null;
  if (!p.startsWith(basePath)) {
    if (p !== basePath.replace(/\/$/, '')) return null;
    p = basePath;
  }
  const rel = p.slice(basePath.length);
  const candidates = rel === ''
    ? ['index.html']
    : rel.endsWith('/')
      ? [join(rel, 'index.html'), `${rel.slice(0, -1)}.html`]
      : [rel, `${rel}.html`, join(rel, 'index.html')];
  for (const cand of candidates) {
    const full = resolve(rootReal, '.' + sep + cand);
    if (!isFile(full)) continue;
    let real: string;
    try { real = realpathSync(full); } catch { continue; }
    if (real === rootReal || real.startsWith(rootReal + sep)) return real;
  }
  return null;
}

/** Serve `dir` under `basePath` on 127.0.0.1 and a free port. */
export async function startServer(dir: string, basePath = '/'): Promise<Served> {
  const rootReal = realpathSync(dir);
  const notFound = isFile(join(rootReal, '404.html')) ? readFileSync(join(rootReal, '404.html')) : Buffer.from('Not found');
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
    const file = resolveRequest(rootReal, basePath, req.url || '/');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : notFound);
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => ok()); });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(ok => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}

/** Every page in a build folder as a clean URL path ("/", "/guide/start"), 404.html left out. Sorted. */
export function listPages(dir: string, basePath = '/'): string[] {
  const rootReal = realpathSync(dir);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && /\.html?$/i.test(e.name)) {
        const rel = relative(rootReal, full).split(sep).join('/');
        if (/^404\.html?$/i.test(rel)) continue;
        const clean = rel.replace(/(^|\/)index\.html?$/i, '$1').replace(/\.html?$/i, '');
        out.push(basePath + clean);
      }
    }
  };
  walk(rootReal);
  return [...new Set(out)].sort();
}

/** True when the folder has at least one .html file (a build, not a source folder). */
export function hasHtml(dir: string): boolean {
  try { return listPages(dir).length > 0; } catch { return false; }
}

const LOC = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

/**
 * --dir --all: the pages the build's own sitemap lists (sitemap.xml, or Astro's
 * sitemap-index.xml and the sitemaps it names), as paths that exist in the
 * folder, so they match the addresses the docs tool publishes (Docusaurus
 * lists /docs/intro, not /docs/intro/). Without a usable sitemap, every page
 * file is listed instead.
 */
export function pagesFromBuild(dir: string, basePath = '/'): string[] {
  const rootReal = realpathSync(dir);
  const read = (rel: string): string | null => {
    const file = resolveRequest(rootReal, basePath, basePath + rel);
    try { return file ? readFileSync(file, 'utf8') : null; } catch { return null; }
  };
  const locsIn = (xml: string) => [...xml.matchAll(LOC)].map(m => m[1].replace(/&amp;/g, '&'));
  const paths: string[] = [];
  for (const name of ['sitemap.xml', 'sitemap-index.xml']) {
    const xml = read(name);
    if (!xml) continue;
    let locs = locsIn(xml);
    if (/<sitemapindex[\s>]/i.test(xml)) {
      locs = locs.flatMap(loc => {
        try {
          const p = new URL(loc).pathname;
          const child = p.startsWith(basePath) ? read(p.slice(basePath.length)) : read(p.replace(/^\//, ''));
          return child ? locsIn(child) : [];
        } catch { return []; }
      });
    }
    for (const loc of locs) {
      try { paths.push(new URL(loc, 'http://localhost').pathname); } catch { /* not a URL */ }
    }
    if (paths.length) break;
  }
  const found = [...new Set(paths)].filter(p => p.startsWith(basePath.replace(/\/$/, '')) && resolveRequest(rootReal, basePath, p));
  return found.length ? found : listPages(dir, basePath);
}
