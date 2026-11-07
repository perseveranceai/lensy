// SPDX-License-Identifier: MIT
// One folder per page URL (Req 4.2, 4.3). The name comes only from the URL by the
// rules below, never from page content, and a folder can only be created below
// <results folder>/pages/ (Req 8.1).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i; // Windows device names, with or without an extension
const PART_MAX = 60;
const PATH_MAX = 150;

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Safe characters only: A-Z a-z 0-9 . _ -, runs of - collapsed, no leading or trailing - or . */
function clean(raw: string): string {
  return decode(raw).replace(/[^A-Za-z0-9._-]/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

/** Cut to `max` characters; a trailing . or - is dropped, because Windows doesn't allow a folder ending in a dot. */
function cut(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).replace(/[-.]+$/, '') : s;
}

/** One name part: cleaned, never empty or dot-only, never a Windows device name, at most `max` characters. */
function part(raw: string, max = PART_MAX): string {
  let p = clean(raw);
  if (p === '' || p === '.' || p === '..') p = '_';
  if (RESERVED.test(p)) p += '_';
  return cut(p, max) || '_';
}

/** The relative folder name for a page URL, for example help.example.com/account-hub/onboarding-guide. */
export function pageFolderName(url: string): string {
  const u = new URL(url);
  const parts = [part(u.hostname + (u.port ? `_${u.port}` : ''))];
  const segments = u.pathname.split('/').slice(1); // pathname always starts with /
  if (segments[segments.length - 1] === '') segments[segments.length - 1] = 'index'; // "" or a path ending in /
  const rest = segments.map(s => part(s));
  if (u.search.length > 1) {
    // The query goes on the last segment. Its hash must survive the 60-character cut, so the base is cut first.
    const suffix = `~q-${sha256(u.search.slice(1)).slice(0, 8)}`;
    const last = segments[segments.length - 1];
    rest[rest.length - 1] = part(last, PART_MAX - suffix.length) + suffix;
  }
  const name = [...parts, ...rest].join('/');
  return name.length > PATH_MAX ? `${name.slice(0, 130)}-${sha256(url).slice(0, 12)}` : name;
}

/** The absolute page folder for `name`, checked to be inside <results>/pages/. Should never throw. */
export function containedPageDir(resultsDir: string, name: string): string {
  const pagesRoot = resolve(resultsDir, 'pages');
  const dir = resolve(pagesRoot, name);
  if (!name || !dir.startsWith(pagesRoot + sep)) throw new Error(`internal error: the page folder "${name}" is outside the results folder`);
  return dir;
}

/** The URL a page folder says it holds, or null when page.json is missing or unreadable. */
function ownerOf(dir: string): string | null {
  try {
    const j = JSON.parse(readFileSync(join(dir, 'page.json'), 'utf8')) as { url?: unknown };
    return typeof j.url === 'string' ? j.url : null;
  } catch {
    return null;
  }
}

/**
 * Req 4.3: a page folder holds exactly one URL. When page.json names another URL
 * (for example two URLs that differ only in letter case, on a case-insensitive
 * disk), the new URL gets "<name>~<hash of its URL>". Nothing is created here.
 */
export function resolvePageFolder(resultsDir: string, url: string): { dir: string; name: string } {
  const base = pageFolderName(url);
  const hash = sha256(url);
  let name = base;
  for (let n = 8; n <= hash.length; n += 4) {
    const dir = containedPageDir(resultsDir, name);
    const owner = ownerOf(dir);
    if (owner === null || owner === url) return { dir, name };
    name = `${base}~${hash.slice(0, n)}`; // 8 hex first; a longer hash only if that name is taken by yet another URL
  }
  throw new Error(`internal error: no free page folder for ${url}`);
}
