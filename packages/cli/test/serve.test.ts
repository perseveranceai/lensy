// SPDX-License-Identifier: MIT
// --dir's static server: clean URLs, the folder's 404 page, content types, a
// base path, nothing served from outside the folder, and 127.0.0.1 only.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { hasHtml, listPages, resolveRequest, startServer } from '../src/serve';
import type { Served } from '../src/serve';
import { useTempDirs } from './helpers';

const SITE = path.join(__dirname, 'sample-site');
const tmp = useTempDirs();

describe('startServer on the sample build', () => {
  let s: Served;
  beforeAll(async () => { s = await startServer(SITE); });
  afterAll(async () => { await s.close(); });

  test('listens on 127.0.0.1', () => expect(s.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/));

  test.each([
    ['/', 200, 'text/html', 'Acme Docs'],
    ['/guide/start', 200, 'text/html', 'Getting started'],
    ['/guide/start.html', 200, 'text/html', 'Getting started'],
    ['/guide/start.md', 200, 'text/markdown', '# Getting started'],
    ['/llms.txt', 200, 'text/plain', '# Acme Docs'],
    ['/sitemap.xml', 200, 'application/xml', '<urlset'],
    ['/robots.txt', 200, 'text/plain', 'User-agent'],
    ['/nope', 404, 'text/html', 'Page not found'],
  ])('%s → %i %s', async (p, status, type, text) => {
    const r = await fetch(s.origin + p);
    expect(r.status).toBe(status);
    expect(r.headers.get('content-type')).toContain(type);
    expect(await r.text()).toContain(text);
  });

  test('no content negotiation: Accept: text/markdown still gets HTML, like a plain static host', async () => {
    const r = await fetch(`${s.origin}/guide/start`, { headers: { accept: 'text/markdown' } });
    expect(r.headers.get('content-type')).toContain('text/html');
  });

  test('POST is refused', async () => expect((await fetch(`${s.origin}/`, { method: 'POST' })).status).toBe(405));
});

describe('nothing outside the folder', () => {
  test.each(['/../package.json', '/%2e%2e/package.json', '/guide/%2e%2e/%2e%2e/serve.test.ts', '/..%2fserve.test.ts', '/%00'])('%s → null', p => {
    expect(resolveRequest(fs.realpathSync(SITE), '/', p)).toBeNull();
  });

  test('a symlink out of the folder is not followed', async () => {
    const dir = tmp('lensy-serve-');
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>x</h1>');
    const outside = tmp('lensy-outside-');
    fs.writeFileSync(path.join(outside, 'secret.html'), 'secret');
    fs.symlinkSync(path.join(outside, 'secret.html'), path.join(dir, 'leak.html'));
    const s = await startServer(dir);
    try {
      expect((await fetch(`${s.origin}/leak`)).status).toBe(404);
      expect((await fetch(`${s.origin}/`)).status).toBe(200);
    } finally {
      await s.close();
    }
  });
});

describe('a base path (VitePress base, Docusaurus baseUrl)', () => {
  test('the folder is served under it, and nothing outside it', async () => {
    const s = await startServer(SITE, '/docs/');
    try {
      expect((await fetch(`${s.origin}/docs/guide/start`)).status).toBe(200);
      expect((await fetch(`${s.origin}/docs`)).status).toBe(200);
      expect((await fetch(`${s.origin}/guide/start`)).status).toBe(404);
    } finally {
      await s.close();
    }
  });
});

describe('listPages and hasHtml', () => {
  test('clean URL paths, 404.html left out, sorted', () => {
    expect(listPages(SITE)).toEqual(['/', '/guide/start']);
    expect(listPages(SITE, '/docs/')).toEqual(['/docs/', '/docs/guide/start']);
  });
  test('a folder of Markdown sources has no HTML', () => {
    const dir = tmp('lensy-src-');
    fs.writeFileSync(path.join(dir, 'a.md'), '# A');
    expect(hasHtml(dir)).toBe(false);
    expect(hasHtml(SITE)).toBe(true);
  });
});
