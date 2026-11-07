# Design: save results and compare runs

Requirements: `requirements.md` next to this file. Start by reading the code it builds on (all on this branch):
- `packages/cli/src/main.ts`: the `check` command, `Io`, exit codes;
- `packages/cli/src/summary.ts`: `summarize`, `scaledLosses`, `tidy`, `actionLine`;
- `packages/cli/src/render-text.ts`: short view, `--verbose`, the several-pages table;
- `packages/cli/src/render-json.ts`: the `--json` page object;
- `packages/cli/src/report-doc.ts`, `render-md.ts`, `render-html.ts`: the `--md`/`--html` reports;
- `packages/cli/test/check-command.test.ts`: how tests drive `run()` with an `Io` and saved fixtures.

## New and changed files

| File | Change |
|---|---|
| `packages/cli/src/workspace.ts` | **New.** `findProjectRoot(cwd, home)`, `resultsFolder(root, saveDir?)`. |
| `packages/cli/src/settings.ts` | **New.** Read, validate and write `.lensy/config.json` and `~/.lensy/config.json`. `decideSave(...)` implements requirement 3.1 exactly. |
| `packages/cli/src/prompt.ts` | **New.** `askYesNo(io, question)` → `true \| false \| null` (`null` means closed or interrupted). Built on `node:readline/promises`, reading `io.stdin`, writing to `io.stderr`. |
| `packages/cli/src/page-folder.ts` | **New.** `pageFolderName(url)` (requirement 4.2) and `resolvePageFolder(resultsDir, url)` (4.3, using `page.json`). |
| `packages/cli/src/store.ts` | **New.** `writeAtomic`, `withLock`, `readPrevious(pageDir)`, `saveRun(...)` (run records, `latest.*`, keeping runs, `history.md`). |
| `packages/cli/src/compare.ts` | **New.** `compare(prev, current)` → `Change \| null`; `changeLines(change, now)` for the terminal; `changeMessage(change)`. |
| `packages/cli/src/render-json.ts` | Each page gains `change` (null or a `Change`). Export `jsonPage(p, change)` so run records reuse the exact same object. |
| `packages/cli/src/render-text.ts` | Change lines after the scores (one page and short blocks); a `Change` column in the several-pages table when saving. |
| `packages/cli/src/report-doc.ts`, `render-md.ts`, `render-html.ts` | Fix points use `scaledLosses` (requirement 4.9). Add an optional per-page `change` section ("Since last run"). |
| `packages/cli/src/main.ts` | Flags; the save decision before checking; config `pages`; saving after checking; extend `Io` (below). |
| `packages/cli/src/cli.ts` | Pass `cwd`, `home`, `stdin` and `isInteractive` into `run()`. |
| `frontend/src/CliGuide.tsx`, `frontend/e2e/cli.spec.ts`, `docs/test-cases.md`, `packages/cli/README.md`, both `CHANGELOG.md`, `.kiro/steering/lensy-cli.md` | Requirement 7. |

No new runtime dependencies. Use `node:fs`, `node:path`, `node:crypto`, `node:os` and `node:readline/promises` only. Nothing in `backend/` or the engine changes.

## `Io` additions (`main.ts`)

```ts
export interface Io {
  // existing: stdout, stderr, env, fetchImpl, loadAfdocs, version, now
  /** current working directory; default process.cwd() in cli.ts */
  cwd?: string;
  /** home folder for ~/.lensy; default os.homedir() in cli.ts */
  home?: string;
  /** where answers to the first-run question come from */
  stdin?: NodeJS.ReadableStream;
  /** stdin and stdout are terminals; cli.ts sets !!process.stdin.isTTY && !!process.stdout.isTTY */
  isInteractive?: boolean;
}
```

- Interactive means `io.isInteractive === true && !io.env.CI`.
- Tests pass a temp folder for `cwd` and `home`, and a `Readable.from(['y\n'])` for `stdin`.
- When `cwd` is undefined (old tests), use `process.cwd()`. When `home` is undefined, use `os.homedir()`. Existing tests don't set `isInteractive`, so they never prompt.

## Order of work inside `check`

1. Parse flags. `--save` + `--no-save`, or `--save-dir` + `--no-save`, exits 2.
2. Find the project root (`workspace.ts`) and the results folder.
3. Load `<results>/config.json` if it exists. Validate it; a problem exits 2. Warn about unknown keys.
4. Build the URL list: arguments, `--urls-file`, else config `pages`. None at all exits 2 with the extended message.
5. Decide whether to save (`decideSave`, requirement 3.1), asking the question if needed. Remember the answer (requirement 2.4).
6. If saving: create the folder and do the write test (3.3). A failure exits 2.
7. Check the pages (unchanged).
8. If saving:
   - take the lock (8.3) and read each page's previous run;
   - compute the `Change` for each page;
   - write the run records, `latest.*` and history;
   - keep the newest runs;
   - release the lock.
9. Render the terminal, `--json`, `--md` and `--html`, now with `change`. The JSON from step 9 equals the `page` objects saved in step 8, so build them once.
10. Print `Results saved in <relative path>`.

The ordering matters: a usage error (steps 1–6) must never start network requests or write files, except the question's own config write.

## `decideSave` (settings.ts)

```ts
type SaveDecision = 'save' | 'skip' | 'ask';
function decideSave(o: { save?: boolean; saveDir?: string; noSave?: boolean },
                    project: ProjectConfig | null, user: UserConfig, root: string,
                    interactive: boolean, jsonToStdout: boolean): SaveDecision
```

Rules in the order of requirement 3.1. `'ask'` only when interactive and not `jsonToStdout`; otherwise `'skip'`. Unit-test each rule with a table of cases.

**Commander note:** declare `--save`, `--save-dir <dir>` and `--no-save` as three separate options. Don't define both `--save` and `--no-save` on the same option name, because commander would merge them. Name the options `save`, `saveDir` and `noSave` explicitly, and test `--help` output and every combination.

## User settings file (`~/.lensy/config.json`)

```json
{ "configVersion": 1, "projects": { "/abs/path/to/project": { "save": false } } }
```

Keep unknown keys when rewriting. Write the folder with mode 0700 and the file with 0600. If the file is invalid JSON, warn once on stderr and treat it as empty, without overwriting it unless an answer must be remembered, in which case back it up first as `config.json.bak`.

## Page folders (`page-folder.ts`)

Implement requirement 4.2 as one pure function over `new URL(url)`. Test it with a table of at least 20 cases, including:
- `https://Docs.Example.com/A/B` (host lowercased, path case kept);
- `https://x.com/` and `https://x.com` (both `index`);
- `https://x.com/a/` (`a/index`);
- `https://x.com/a%20b/c` (`a-b/c`);
- `https://x.com/..%2F../etc/passwd` (no part is `..`; nothing escapes `pages/`);
- `https://x.com/CON/aux.txt` (`CON_/aux.txt_`);
- a 400-character path (the hashed form);
- a URL with a query (`~q-`);
- a URL with a fragment (ignored);
- a URL with a port.

After resolving, assert in code that `path.resolve(resultsDir, 'pages', name)` starts with `path.resolve(resultsDir, 'pages') + path.sep`. Throw an internal error otherwise. This assertion is the last line of defence; it should never fire.

## Store (`store.ts`)

- `writeAtomic(file, text)`:
  - `mkdirSync(dirname, { recursive: true })`;
  - `writeFileSync(tmp, text)`, where `tmp = file + '.tmp-' + process.pid`;
  - `renameSync(tmp, file)`;
  - on error, try to `unlinkSync(tmp)` and rethrow.
- `withLock(resultsDir, now, fn)` as in requirement 8.3. Write `{ pid, startedAt }` to `.lock` with `openSync(path, 'wx')`. If that fails with `EEXIST`, read `startedAt`: older than 30 minutes, replace it; otherwise skip saving with the warning. Release in `finally`. Also register `process.once('SIGINT'/'SIGTERM')` handlers that remove the lock and then re-raise the default behaviour (exit 130 or 143). Remove the handlers in `finally`.
- `readPrevious(pageDir)` implements requirement 5.1. Validation is minimal: `recordVersion === 1`, a `page.url` string, and a `page.status` string.
- `saveRun(resultsDir, runStartedAt, pages[])` where each item is `{ url, jsonPage, mdPage }`:
  - per page: resolve the folder, write `page.json` if missing, write `runs/<ts>.json`, `latest.json` and `latest.md`, then keep the newest runs;
  - then the top-level `latest.md`, and the new rows into `history.md`.
- **Timestamp:** `runStartedAt` is taken once before checking (`io.now`), formatted `YYYY-MM-DDTHHMMSSZ`, with `-2`, `-3`… suffixes per page folder on collision.
- **`history.md` rows** are inserted after the table's separator line. If the file is missing, or its header doesn't match, write a fresh file; don't try to repair it. Count data rows (lines starting with `| 20`) and cut to 500.

## Compare (`compare.ts`)

```ts
interface CheckRef { id: string; check: string }
interface Change {
  since: string; previousStatus: string;
  codingAgents: { from: number | null; to: number | null; delta: number | null };
  aiSearch: { from: number | null; to: number | null; delta: number | null };
  fixed: CheckRef[]; new: CheckRef[];
  worse: (CheckRef & { from: number; to: number })[];
  better: (CheckRef & { from: number; to: number })[];
  lensyChanged: boolean; message: string;
}
```

- Points lost per check come from `scaledLosses` on each run's report scores. Store them in the run record's `page.fixes` and also as a `lost` map: add `"pointsLost": { "<checkId>": n }` to the JSON page object, so comparisons don't need the old report.
- **Matching:** by check `id`, across both scores. A shared check (rendering-strategy/C1 and S2) is compared per score, as `summarize` keys them.
- `delta` is `to - from` when both are numbers, else `null`.
- **`message` formats:**
  - `"Coding agents 87 → 91 (+4), AI search 95 → 95 since 2026-11-01. Fixed: A, B. New: C."`;
  - `"First saved run."` when there's no previous run (but `change` is `null` in that case, so `message` only appears for real comparisons);
  - when the previous run wasn't ok: `"Checked 2026-11-08; the run on 2026-11-01 couldn't check this page (blocked)."`
- **Terminal lines (`changeLines`):** requirement 5.4. Dates: `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })`, adding `year: 'numeric'` when the year differs from now's. Relative age from whole days between `since` and `now`.

## Terminal changes

- **One page:** after `Coding agents …    AI search …`, insert the `changeLines` output (each line indented two spaces). The rest of the short view stays as it is. `--verbose` gets the same lines plus `Worse:` and `Better:` lines with `from → to` points.
- **Several pages:** the summary table gains a `Change` column only when saving, so the table without saving stays byte-for-byte the same.
- **Last line when saving:** `Results saved in .lensy` (relative), dimmed.

## Reports

- **`report-doc.ts`:** the fixes' `gain` becomes the scaled loss from `scaledLosses` (summed over the checks a fix covers), so the Markdown and HTML agree with the terminal. Add `change?: Change` to `DocPage`.
- **`render-md.ts`:** after the page's `### Summary`, when `change` is set, add `### Since last run` with lines for the scores, Fixed, New, Worse, Better and the Lensy-changed note. Escape text with the existing `text()`.
- **`render-html.ts`:** the same section, styled like the existing summary block. No scripts and no external URLs, as today.
- `reportVersion` stays 1: these are additions.

## Website and docs

- **`CliGuide.tsx`:**
  - add `["save-and-compare", "Save and compare runs"]` to `SECTIONS`, after `reports`;
  - write the section with `Block` examples taken from a real run (task 9);
  - add the "What it sends" sentence;
  - keep the page's existing tone: short sentences, plain words;
  - examples use `docs.example.com`.
- **`cli.spec.ts`:** update CLI-02's heading list, and add CLI-05. Check both themes at 375px through CLI-03, which loops over `/cli` already.
- **`docs/test-cases.md`:** CLI-02 updated, and a CLI-05 row added.
- **`packages/cli/README.md`:** a full README (requirement 7.4). It's the npm page, so it must be correct for `npm i -g @perseverance-ai/lensy@next`.

## Edge cases checklist (each needs a test)

- No URLs, no config → exit 2 with the config hint.
- Config `pages` with a bad URL → exit 2 naming the entry.
- `--json -` with saving on → JSON only on stdout; "Results saved" and warnings on stderr; no question asked.
- Interactive, but `CI=true` → no question.
- The results folder exists but isn't writable → exit 2 before checking.
- `latest.json` is truncated (invalid JSON) → falls back to `runs/`.
- The previous run was blocked, and the current one is ok → change shows `previousStatus: "blocked"`, no deltas, and the message says so.
- The current run is blocked, and the previous one was ok → the record is saved with `status: "blocked"`, and the terminal says the page wasn't checked this time.
- The same URL twice in one run → checked and saved once.
- Two URLs that map to the same folder name → the second gets the `~hash` folder.
- 53 runs of a page with `keep: 52` → 52 files remain, and the oldest is deleted.
- A stale lock (31 minutes old) → replaced, and the run saves.
- Ctrl-C during the question → no file written, and checking continues with no saving. (Test with a stdin that ends.)
- The engine version differs from the previous record → the note is shown.
