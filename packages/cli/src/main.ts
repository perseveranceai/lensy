// SPDX-License-Identifier: MIT
// The `lensy` command. run() takes its inputs (arguments, streams, fetch,
// environment) as parameters so tests drive it in process with saved fixtures.
import { check, defaultUserAgent, isLocalUrl } from '@perseverance-ai/lensy-core';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { readFileSync } from 'node:fs';
import { createColors } from 'picocolors';
import { PageResult, renderPage, renderSummary } from './render-text';

export const EXIT = { ok: 0, usage: 2, notChecked: 3 } as const;

export interface Io {
  stdout: { write(s: string): unknown; isTTY?: boolean };
  stderr: { write(s: string): unknown };
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  version: string;
}

class UsageError extends Error {}

const int = (name: string, min: number, max: number) => (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new InvalidArgumentError(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
};

/** Accepts a bare hostname like the website does (REG-17); http(s) only. */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { throw new UsageError(`"${raw}" isn't a URL.`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UsageError(`"${raw}" isn't an http or https URL.`);
  return u.href;
}

function readUrlsFile(path: string): string[] {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { throw new UsageError(`Can't read --urls-file ${path}.`); }
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export async function run(argv: string[], io: Io): Promise<number> {
  const program = new Command('lensy')
    .description('Check whether AI search engines and coding agents can find and read a docs page.')
    .version(io.version, '-v, --version')
    .exitOverride()
    .configureOutput({ writeOut: s => io.stdout.write(s), writeErr: s => io.stderr.write(s) });

  let exitCode: number = EXIT.ok;
  program.command('check')
    .description('Check one or more live docs pages and print both scores.')
    .argument('[urls...]', 'pages to check')
    .option('--urls-file <path>', 'read page URLs from a file, one per line')
    .option('--user-agent <string>', 'send this user agent instead of Lensy-CLI/<version>')
    .option('--timeout <ms>', 'timeout per request in milliseconds', int('--timeout', 1000, 120000))
    .option('--concurrency <n>', 'pages checked at once (default 2)', int('--concurrency', 1, 5), 2)
    .option('--no-color', 'plain text output')
    .action(async (urls: string[], o: { urlsFile?: string; userAgent?: string; timeout?: number; concurrency: number; color: boolean }) => {
      const raw = [...urls, ...(o.urlsFile ? readUrlsFile(o.urlsFile) : [])];
      if (!raw.length) throw new UsageError('Give at least one URL, for example: lensy check https://docs.example.com/guide');
      const list = raw.map(normalizeUrl);
      const local = list.find(isLocalUrl);
      if (local) throw new UsageError(`${local} is a local address. Checking a local build comes in a later version.`);

      const c = createColors(o.color && !!io.stdout.isTTY && !io.env.NO_COLOR);
      const userAgent = o.userAgent ?? defaultUserAgent(io.version);
      const pages = await pool(list, o.concurrency, async (url): Promise<PageResult> => {
        try {
          return { url, report: await check(url, { userAgent, timeoutMs: o.timeout, fetchImpl: io.fetchImpl }) };
        } catch (e) {
          if (io.env.LENSY_DEBUG === '1') io.stderr.write(`${(e as Error).stack}\n`);
          return { url, internalError: (e as Error).message };
        }
      });

      const parts = [];
      if (pages.length > 1) parts.push(renderSummary(c, pages));
      parts.push(...pages.map(p => renderPage(c, p)));
      io.stdout.write(parts.join('\n\n') + '\n');
      exitCode = pages.every(p => p.report?.status === 'ok' && !p.internalError) ? EXIT.ok : EXIT.notChecked;
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
    return exitCode;
  } catch (e) {
    if (e instanceof UsageError) { io.stderr.write(`${e.message}\n`); return EXIT.usage; }
    if (e instanceof CommanderError) {
      if (e.code === 'commander.version' || e.code === 'commander.helpDisplayed' || e.code === 'commander.help') return EXIT.ok;
      return EXIT.usage;
    }
    throw e;
  }
}
