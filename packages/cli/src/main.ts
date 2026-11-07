// SPDX-License-Identifier: MIT
// The `lensy` command. run() takes its inputs (arguments, streams, fetch,
// environment) as parameters so tests drive it in process with saved fixtures.
import { check, defaultUserAgent, ENGINE_COMMIT, isLocalUrl } from '@perseverance-ai/lensy-core';
import type { CheckOptions } from '@perseverance-ai/lensy-core';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createColors } from 'picocolors';
import { ALL_CHECKS, explainCheck } from './explain';
import { largeRunNotice, uniquePages } from './pages';
import { askYesNo } from './prompt';
import { buildReportDoc } from './report-doc';
import { renderHtml } from './render-html';
import { renderJson } from './render-json';
import { renderMarkdown } from './render-md';
import { PageResult, renderBrief, renderPage, renderSummary } from './render-text';
import { ConfigError, DEFAULT_KEEP, decideSave, readProjectConfig, readUserConfig, rememberNoSave, writeSaveKey } from './settings';
import type { ProjectConfig } from './settings';
import { friendlyReason } from './store';
import { findProjectRoot, resultsFolder } from './workspace';

export const EXIT = { ok: 0, usage: 2, notChecked: 3 } as const;

export interface Io {
  stdout: { write(s: string): unknown; isTTY?: boolean; columns?: number };
  stderr: { write(s: string): unknown };
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** tests replay saved AFDocs runs (core CheckOptions.loadAfdocs) */
  loadAfdocs?: CheckOptions['loadAfdocs'];
  version: string;
  /** fixed clock for tests */
  now?: () => number;
  /** current working directory; cli.ts passes process.cwd() */
  cwd?: string;
  /** home folder for ~/.lensy; cli.ts passes os.homedir() */
  home?: string;
  /** where answers to the first-run question come from */
  stdin?: NodeJS.ReadableStream;
  /** stdin and stdout are both terminals; cli.ts sets it. Tests that don't set it never get asked. */
  isInteractive?: boolean;
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

/** The report file's folder must exist, so a long run never ends without its file. */
function reportPath(flag: string, path?: string): string | undefined {
  if (path === undefined) return undefined;
  const full = resolve(path);
  const dir = dirname(full);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`${flag}: the folder ${dir} doesn't exist.`);
  if (existsSync(full) && statSync(full).isDirectory()) throw new UsageError(`${flag}: ${full} is a folder; give a file name, for example report.html.`);
  return full;
}

/** A path for the terminal: relative to the current folder, with / separators (Req 4.10). */
export function shown(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return (rel === '' ? '.' : rel).split(sep).join('/');
}

/** Req 3.3: make sure results can be saved before any page is checked: create the folder, then write and delete a small file. */
function ensureWritable(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const probe = join(dir, `.write-test-${process.pid}`);
  writeFileSync(probe, 'lensy');
  unlinkSync(probe);
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

  // commander treats --no-save as the opposite of --save and merges them into one
  // value. Here they are three separate options (save, saveDir, noSave), so a run
  // can tell "--no-save given" from "neither given", and both together is an error.
  const noSave = new Option('--no-save', "don't save this run, and don't ask");
  noSave.negate = false;

  let exitCode: number = EXIT.ok;
  program.command('check')
    .description('Check one or more live docs pages and print both scores.')
    .argument('[urls...]', 'pages to check')
    .option('--urls-file <path>', 'read page URLs from a file, one per line')
    .option('--user-agent <string>', 'send this user agent instead of lensy-cli/<version>')
    .option('--timeout <ms>', 'timeout per request in milliseconds', int('--timeout', 1000, 120000))
    .option('--concurrency <n>', 'pages checked at once (default 2)', int('--concurrency', 1, 5), 2)
    .option('--html <file>', 'write the full report as one offline HTML file')
    .option('--md <file>', 'write the full report as Markdown, for coding agents')
    .option('--json <file>', 'write the results as JSON for scripts and CI; - prints only the JSON')
    .option('--verbose', 'show every check with its points instead of what to fix first')
    .option('--save', 'save results in .lensy/, compare with last run')
    .option('--save-dir <dir>', 'save results in <dir> instead of .lensy/')
    .addOption(noSave)
    .option('--no-color', 'plain text output')
    .action(async (urls: string[], o: { urlsFile?: string; userAgent?: string; timeout?: number; concurrency: number; html?: string; md?: string; json?: string; verbose?: boolean; save?: boolean; saveDir?: string; noSave?: boolean; color: boolean }) => {
      // Flag conflicts come first: nothing is read, asked or fetched before them.
      if (o.save && o.noSave) throw new UsageError("--save and --no-save can't be used together.");
      if (o.saveDir !== undefined && o.noSave) throw new UsageError("--save-dir and --no-save can't be used together.");
      if (o.saveDir !== undefined && !o.saveDir.trim()) throw new UsageError('--save-dir needs a folder, for example --save-dir results/lensy.');
      const jsonOnly = o.json === '-';

      // Where results would go, and the project's settings (Req 1, 6). Nothing is written yet.
      const cwd = io.cwd ?? process.cwd();
      const home = io.home ?? homedir();
      const root = findProjectRoot(cwd, home);
      const resultsDir = resultsFolder(root, o.saveDir, cwd);
      const resultsShown = shown(cwd, resultsDir);
      const configFile = join(resultsDir, 'config.json');
      const configShown = shown(cwd, configFile);
      let project: ProjectConfig | null;
      try {
        const loaded = readProjectConfig(configFile, configShown);
        project = loaded.config;
        if (loaded.unknownKeys.length) io.stderr.write(`${configShown}: ignoring unknown key${loaded.unknownKeys.length === 1 ? '' : 's'}: ${loaded.unknownKeys.join(', ')}.\n`);
      } catch (e) {
        if (e instanceof ConfigError) throw new UsageError(e.message);
        throw e;
      }

      // The pages: arguments and --urls-file, else "pages" from the project config (Req 6.2-6.3).
      const raw = [...urls, ...(o.urlsFile ? readUrlsFile(o.urlsFile) : [])];
      let list: string[];
      if (raw.length) {
        list = raw.map(normalizeUrl);
      } else if (project?.pages?.length) {
        list = project.pages.map(entry => {
          try { return normalizeUrl(entry); } catch (e) { throw new UsageError(`${configShown}: in "pages", ${(e as Error).message}`); }
        });
      } else {
        throw new UsageError(`Give at least one URL, for example: lensy check https://docs.example.com/guide\nOr list pages in .lensy/config.json under "pages".`);
      }
      const local = list.find(isLocalUrl);
      if (local) throw new UsageError(`${local} is a local address. Checking a local build comes in a later version.`);
      const htmlPath = reportPath('--html', o.html);
      const mdPath = reportPath('--md', o.md);
      const jsonPath = jsonOnly ? undefined : reportPath('--json', o.json);

      // Whether this run saves (Req 3.1), asking once if needed (Req 2). A usage error above never gets here.
      const interactive = io.isInteractive === true && !io.env.CI;
      const user = readUserConfig(home);
      if (user.invalid) io.stderr.write("~/.lensy/config.json isn't valid JSON, so Lensy ignores it.\n");
      let decision = decideSave({ save: o.save, saveDir: o.saveDir, noSave: o.noSave }, project, user, root, interactive, jsonOnly);
      let answeredYes = false;
      if (decision === 'ask') {
        const answer = await askYesNo(io, `Save Lensy results for this project in ${resultsShown}? Each run is compared with the last one, so you can see what changed. [Y/n]`);
        if (answer === true) { decision = 'save'; answeredYes = true; }
        else {
          decision = 'skip';
          if (answer === false) {
            try { rememberNoSave(home, root); } catch (e) { io.stderr.write(`Couldn't remember your answer: ${friendlyReason(e)}.\n`); }
          }
        }
      }
      const saving = decision === 'save';
      if (saving) {
        try {
          ensureWritable(resultsDir);
          if (answeredYes) writeSaveKey(configFile, true);
        } catch (e) {
          throw new UsageError(`Can't save results in ${resultsShown}: ${friendlyReason(e)}.`);
        }
      }

      const c = createColors(o.color && !!io.stdout.isTTY && !io.env.NO_COLOR);
      const { pages: toCheck } = uniquePages(list);
      const notice = largeRunNotice(toCheck.length, o.concurrency);
      if (notice) (jsonOnly ? io.stderr : io.stdout).write((jsonOnly ? notice : c.yellow(notice)) + '\n\n');
      const userAgent = o.userAgent ?? defaultUserAgent(io.version);
      const pages = await pool(toCheck, o.concurrency, async (url): Promise<PageResult> => {
        try {
          return { url, report: await check(url, { userAgent, timeoutMs: o.timeout, fetchImpl: io.fetchImpl, loadAfdocs: io.loadAfdocs }) };
        } catch (e) {
          if (io.env.LENSY_DEBUG === '1') io.stderr.write(`${(e as Error).stack}\n`);
          return { url, internalError: (e as Error).message };
        }
      });

      const written: string[] = [];
      const checkedAt = new Date((io.now ?? Date.now)()).toISOString();
      const json = o.json ? renderJson(pages, { toolVersion: io.version, engineCommit: ENGINE_COMMIT, checkedAt }) : '';
      if (jsonPath) { writeFileSync(jsonPath, json); written.push(jsonPath); }
      if (htmlPath || mdPath) {
        const doc = buildReportDoc(pages, { version: io.version, engineCommit: ENGINE_COMMIT, checkedAt });
        if (htmlPath) { writeFileSync(htmlPath, renderHtml(doc)); written.push(htmlPath); }
        if (mdPath) { writeFileSync(mdPath, renderMarkdown(doc)); written.push(mdPath); }
      }

      const allOk = pages.every(p => p.report?.status === 'ok' && !p.internalError);
      exitCode = allOk ? EXIT.ok : EXIT.notChecked;
      if (jsonOnly) { io.stdout.write(json); return; }

      // One page: what to fix first (every check with --verbose). Several: the
      // table and top fixes; full details go in --html/--md/--json.
      const width = Math.min(Math.max(io.stdout.columns ?? 100, 80), 110);
      const pointer = written.length
        ? c.dim(written.map(p => `Report written to ${p}`).join('\n'))
        : c.dim('Full results: rerun with --html report.html, --md report.md or --json report.json.');
      const parts = pages.length === 1
        ? [renderPage(c, pages[0], { verbose: o.verbose, width }), ...(written.length ? [pointer] : [])]
        : [renderSummary(c, pages), ...pages.map(p => (o.verbose ? renderPage(c, p, { verbose: true, width }) : renderBrief(c, p, 3, width))), pointer];
      io.stdout.write(parts.join('\n\n') + '\n');
    });

  program.command('explain')
    .description('Explain one check: what it measures, its points, why it matters and the evidence.')
    .argument('<checkId>', 'a check id, for example llms-txt-exists or S3')
    .action((id: string) => {
      const text = explainCheck(id);
      if (!text) throw new UsageError(`No check called "${id}". Checks: ${ALL_CHECKS.map(x => x.id).join(', ')}.`);
      io.stdout.write(text + '\n');
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
