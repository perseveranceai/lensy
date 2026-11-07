// SPDX-License-Identifier: MIT
// Page folder names (Req 4.2, 4.3, 8.1): one folder per URL, named only from the
// URL by fixed rules, always inside <results>/pages/.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { containedPageDir, pageFolderName, resolvePageFolder } from '../src/page-folder';
import { useTempDirs } from './helpers';

const tmp = useTempDirs();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('pageFolderName: the table', () => {
  test.each<[string, string, string]>([
    // [what it checks, URL, folder]
    ['the example from the spec', 'https://help.example.com/account-hub/onboarding-guide', 'help.example.com/account-hub/onboarding-guide'],
    ['an empty path adds index', 'https://docs.example.com/', 'docs.example.com/index'],
    ['a bare host adds index', 'https://docs.example.com', 'docs.example.com/index'],
    ['the host is lowercased and the path keeps its case', 'https://Docs.Example.com/A/B', 'docs.example.com/A/B'],
    ['a path ending in / adds index', 'https://x.com/a/', 'x.com/a/index'],
    ['a percent-encoded space becomes -', 'https://x.com/a%20b/c', 'x.com/a-b/c'],
    ['an encoded ../ cannot become a .. part', 'https://x.com/..%2F../etc/passwd', 'x.com/_/etc/passwd'],
    ['a whole encoded ../../ run is one segment and cleans to its last word', 'https://x.com/a/..%2f..%2f..%2fetc', 'x.com/a/etc'],
    ['%2e%2e is resolved by the URL parser, not kept', 'https://x.com/a/%2e%2e/b', 'x.com/b'],
    ['Windows device names get _', 'https://x.com/CON/aux.txt', 'x.com/CON_/aux.txt_'],
    ['every device name family', 'https://x.com/prn/nul/COM1/lpt9.log', 'x.com/prn_/nul_/COM1_/lpt9.log_'],
    ['names that only start like a device name are kept', 'https://x.com/console/com10/auxiliary', 'x.com/console/com10/auxiliary'],
    ['a port adds _port', 'http://localhost:4173/guide/start', 'localhost_4173/guide/start'],
    ['a default port adds nothing', 'https://x.com:443/a', 'x.com/a'],
    ['a fragment is ignored', 'https://x.com/guide#intro', 'x.com/guide'],
    ['an empty query adds nothing', 'https://x.com/a?', 'x.com/a'],
    ['an empty middle segment becomes _', 'https://x.com/a//b', 'x.com/a/_/b'],
    ['characters outside the safe set become -, runs collapse', 'https://x.com/a%20%20%2Fb', 'x.com/a-b'],
    ['non-ASCII text leaves nothing, so _', 'https://x.com/%E4%BD%A0%E5%A5%BD', 'x.com/_'],
    ['non-ASCII next to ASCII keeps the ASCII', 'https://x.com/caf%C3%A9-menu', 'x.com/caf-menu'],
    ['leading and trailing dots are trimmed', 'https://x.com/.hidden/end./', 'x.com/hidden/end/index'],
    ['a malformed % is kept as text, not thrown on', 'https://x.com/100%', 'x.com/100'],
    ['a lone % is nothing', 'https://x.com/%', 'x.com/_'],
    ['a backslash is a separator, as the URL parser sees it', 'https://x.com/a\\b', 'x.com/a/b'],
    ['a null byte is just a character', 'https://x.com/a%00b', 'x.com/a-b'],
    ['underscores and dots inside a part stay', 'https://x.com/my_file.v2.html', 'x.com/my_file.v2.html'],
    ['userinfo is not part of the name', 'https://user:pw@x.com/a', 'x.com/a'],
    ['an IPv6 host has no brackets or colons', 'http://[::1]:8080/a', '1-_8080/a'],
  ])('%s', (_what, url, folder) => {
    expect(pageFolderName(url)).toBe(folder);
  });

  test('a query adds ~q- and the first 8 hex of sha256(query), without the ?', () => {
    expect(pageFolderName('http://localhost:4173/guide/start?tab=a')).toBe(`localhost_4173/guide/start~q-${sha('tab=a').slice(0, 8)}`);
    expect(pageFolderName('https://x.com/a/?b')).toBe(`x.com/a/index~q-${sha('b').slice(0, 8)}`);
    expect(pageFolderName('https://x.com/a?b=1')).not.toBe(pageFolderName('https://x.com/a?b=2'));
  });

  test('a part is cut to 60 characters', () => {
    expect(pageFolderName(`https://x.com/${'a'.repeat(100)}`)).toBe(`x.com/${'a'.repeat(60)}`);
  });

  test('a cut never leaves a trailing dot or dash', () => {
    const name = pageFolderName(`https://x.com/${'a'.repeat(59)}.b`);
    expect(name).toBe(`x.com/${'a'.repeat(59)}`);
  });

  test('the query hash survives the 60-character cut, so two long URLs that differ in the query stay apart', () => {
    const a = pageFolderName(`https://x.com/${'a'.repeat(100)}?x=1`);
    const b = pageFolderName(`https://x.com/${'a'.repeat(100)}?x=2`);
    const lastOf = (n: string) => n.split('/').pop()!;
    expect(lastOf(a).length).toBeLessThanOrEqual(60);
    expect(lastOf(a).endsWith(`~q-${sha('x=1').slice(0, 8)}`)).toBe(true);
    expect(a).not.toBe(b);
  });

  test('a relative path over 150 characters becomes its first 130 characters, -, and 12 hex of sha256(URL)', () => {
    const url = `https://x.com/${Array.from({ length: 5 }, (_, i) => String.fromCharCode(97 + i).repeat(40)).join('/')}`;
    const plain = ['x.com', ...Array.from({ length: 5 }, (_, i) => String.fromCharCode(97 + i).repeat(40))].join('/');
    expect(plain.length).toBeGreaterThan(150);
    expect(pageFolderName(url)).toBe(`${plain.slice(0, 130)}-${sha(url).slice(0, 12)}`);
    // Exactly 150 is still the plain name.
    const edge = `https://x.com/${'a'.repeat(60)}/${'b'.repeat(60)}/${'c'.repeat(22)}`;
    expect(('x.com/' + 'a'.repeat(60) + '/' + 'b'.repeat(60) + '/' + 'c'.repeat(22)).length).toBe(150);
    expect(pageFolderName(edge)).toBe(edge.replace('https://', ''));
  });

  test('two long URLs with the same first 130 characters get different folders', () => {
    const base = `https://x.com/${'a'.repeat(60)}/${'b'.repeat(60)}/${'c'.repeat(40)}`;
    expect(pageFolderName(`${base}1`)).not.toBe(pageFolderName(`${base}2`));
  });
});

describe('pageFolderName: nothing can escape pages/', () => {
  const HOSTILE = [
    'https://x.com/..%2f..%2f..%2fetc%2fpasswd',
    'https://x.com/%2e%2e%2f%2e%2e%2f',
    'https://x.com/\\..\\..\\windows\\system32',
    'https://x.com/%00%01%1f%7f',
    'https://x.com/a/./b/../../c',
    'https://x.com/' + '%2F'.repeat(300),
    'https://x.com/' + 'é'.repeat(200),
    'https://x.com/.../...../',
    'https://xn--80ak6aa92e.com/%D0%BF%D1%83%D1%82%D1%8C',
    'https://x.com/?../../../x',
    'https://x.com/c:%5Cwindows',
  ];

  test.each(HOSTILE)('%s', (url) => {
    const name = pageFolderName(url);
    expectSafe(name);
    const dir = path.join(tmp(), 'results');
    const { dir: page } = resolvePageFolder(dir, url);
    expect(page.startsWith(path.resolve(dir, 'pages') + path.sep)).toBe(true);
  });

  test('2000 random paths: always a relative, dot-free, separator-clean name inside pages/', () => {
    let seed = 20261108; // fixed, so a failure can be repeated
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const alphabet = ['a', 'B', '7', '.', '..', '/', '%2F', '%2e', '%5C', '\\', ' ', '%20', '-', '_', '~', '%', '%00', 'é', '你', ':', '?x', '#y', 'CON', 'aux.', '*'];
    const base = path.resolve(tmp(), 'results');
    for (let i = 0; i < 2000; i++) {
      const p = Array.from({ length: 1 + Math.floor(rnd() * 14) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
      let url: string;
      try { url = new URL('https://docs.example.com/' + p).href; } catch { continue; }
      const name = pageFolderName(url);
      expectSafe(name);
      expect(containedPageDir(base, name).startsWith(path.resolve(base, 'pages') + path.sep)).toBe(true);
    }
  });

  function expectSafe(name: string) {
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.startsWith('/')).toBe(false);
    expect(name).not.toMatch(/\\|:|\*|\?|"|<|>|\||[\x00-\x1f\x7f]/);
    for (const part of name.split('/')) {
      expect(part, `empty part in ${name}`).not.toBe('');
      expect(part, `dot part in ${name}`).not.toBe('.');
      expect(part, `dot-dot part in ${name}`).not.toBe('..');
      expect(part.length).toBeLessThanOrEqual(150);
      expect(/[. ]$/.test(part), `${part} ends in a dot or space`).toBe(false);
    }
  }
});

describe('containedPageDir: the last line of defence', () => {
  test('throws for a name that leaves pages/ or is empty', () => {
    const dir = tmp();
    expect(() => containedPageDir(dir, '../x')).toThrow(/outside the results folder/);
    expect(() => containedPageDir(dir, 'a/../../x')).toThrow(/outside the results folder/);
    expect(() => containedPageDir(dir, '')).toThrow(/outside the results folder/);
    expect(() => containedPageDir(dir, '/etc/passwd')).toThrow(/outside the results folder/);
  });
  test('accepts a normal name', () => {
    const dir = tmp();
    expect(containedPageDir(dir, 'x.com/a')).toBe(path.join(dir, 'pages', 'x.com', 'a'));
  });
});

describe('resolvePageFolder: one URL per folder (Req 4.3)', () => {
  // Two different URLs that share one folder name: the fragment is ignored in the name.
  const OWNER = 'https://x.com/a';
  const NEWCOMER = 'https://x.com/a#other';
  const NAME = 'x.com/a';

  const put = (dir: string, url: unknown) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'page.json'), JSON.stringify({ url }));
  };
  const putRaw = (dir: string, text: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'page.json'), text);
  };
  const folder = (results: string, name: string) => path.join(results, 'pages', ...name.split('/'));

  test('the two URLs really do share a folder name', () => {
    expect(pageFolderName(OWNER)).toBe(NAME);
    expect(pageFolderName(NEWCOMER)).toBe(NAME);
  });

  test('a new URL gets its plain folder, and nothing is created', () => {
    const results = tmp();
    expect(resolvePageFolder(results, OWNER)).toEqual({ name: NAME, dir: folder(results, NAME) });
    expect(fs.existsSync(path.join(results, 'pages'))).toBe(false);
  });

  test('a folder whose page.json names the same URL is reused', () => {
    const results = tmp();
    put(folder(results, NAME), OWNER);
    expect(resolvePageFolder(results, OWNER).name).toBe(NAME);
  });

  test('a folder whose page.json names another URL: the new URL gets <name>~<8 hex of sha256(URL)>', () => {
    const results = tmp();
    put(folder(results, NAME), OWNER);
    const r = resolvePageFolder(results, NEWCOMER);
    expect(r.name).toBe(`${NAME}~${sha(NEWCOMER).slice(0, 8)}`);
    expect(r.dir).toBe(folder(results, r.name));
  });

  test('the hashed name is stable for the newcomer, and the owner keeps the plain folder', () => {
    const results = tmp();
    put(folder(results, NAME), OWNER);
    const first = resolvePageFolder(results, NEWCOMER);
    put(first.dir, NEWCOMER);
    expect(resolvePageFolder(results, NEWCOMER)).toEqual(first);
    expect(resolvePageFolder(results, OWNER).name).toBe(NAME);
  });

  test('if the hashed name is taken by yet another URL, a longer hash is used', () => {
    const results = tmp();
    put(folder(results, NAME), OWNER);
    put(folder(results, `${NAME}~${sha(NEWCOMER).slice(0, 8)}`), 'https://x.com/a#third');
    expect(resolvePageFolder(results, NEWCOMER).name).toBe(`${NAME}~${sha(NEWCOMER).slice(0, 12)}`);
  });

  test.each([
    ['page.json is not JSON', 'not json'],
    ['page.json is empty', ''],
    ['page.json has no url', '{"other":1}'],
    ['page.json has a non-string url', '{"url":42}'],
    ['page.json is an array', '[]'],
  ])('%s: only a page.json that names a different URL counts as a collision', (_what, content) => {
    const results = tmp();
    putRaw(folder(results, NAME), content);
    expect(resolvePageFolder(results, NEWCOMER).name).toBe(NAME);
  });

  test('a folder with no page.json at all is reused', () => {
    const results = tmp();
    fs.mkdirSync(folder(results, NAME), { recursive: true });
    expect(resolvePageFolder(results, NEWCOMER).name).toBe(NAME);
  });

  test('a long-path folder goes through the same collision rule', () => {
    const results = tmp();
    const url = `https://x.com/${'a'.repeat(60)}/${'b'.repeat(60)}/${'c'.repeat(60)}`;
    const name = pageFolderName(url);
    expect(name).toMatch(/-[0-9a-f]{12}$/); // the hashed form
    put(folder(results, name), 'https://x.com/someone-else'); // something else already owns this folder
    expect(resolvePageFolder(results, url).name).toBe(`${name}~${sha(url).slice(0, 8)}`);
  });

  test('two long URLs that differ only in a fragment get different folders already, because the hash covers the whole URL', () => {
    const base = `https://x.com/${'a'.repeat(60)}/${'b'.repeat(60)}/${'c'.repeat(60)}`;
    expect(pageFolderName(base)).not.toBe(pageFolderName(`${base}#other`));
  });
});
