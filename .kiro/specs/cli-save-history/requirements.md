# Requirements: save results and compare runs (`lensy check`)

## Introduction

Today `lensy check` prints results and forgets them. Docs teams want to see whether their docs got better or worse since last time ("Coding agents went from 87 to 91 this week; fixed: …; new problem: …"), keep that history next to their docs, and later share it automatically (a weekly CI job posting to Slack, phase 2).

This feature:
- saves every run in a `.lensy/` folder at the root of the user's project;
- compares each page with its previous run;
- shows the change in the terminal, the reports and the JSON;
- lets a project list its pages in `.lensy/config.json`, so `lensy check` needs no arguments.

Everything stays on the user's machine. Nothing new is sent anywhere.

Built on branch `feat/cli-save-history`, which starts from `feat/cli-readable-output` (the short "Fix these first" view, `--verbose`, `--json`). Requirements here use that branch's behaviour as the baseline.

**Out of scope:**
- posting to Slack, Teams or email;
- a GitHub Action or CI template;
- thresholds that fail a build;
- checking local builds (`localhost`), which has its own spec, `cli-serve`;
- an MCP server or editor plugin;
- any scoring change.

## Glossary

- **Project root:** the folder Lensy treats as the user's workspace (Requirement 1).
- **Results folder:** where results are saved. By default `<project root>/.lensy/`.
- **Page folder:** the subfolder of `<results folder>/pages/` for one page URL.
- **Run record:** one JSON file describing one page's result in one run.
- **Previous run:** the newest saved run record for the same page URL before the current run.
- **Points lost:** a check's loss on the 0–100 scale of its score, as in the short view (`summary.ts` `scaledLosses`). Points lost in a score add up to 100 minus that score.
- **Interactive:** stdin and stdout are both terminals, and the `CI` environment variable is unset or empty.

## Requirement 1: Find the project root

**User story:** As a technical writer, I want Lensy to save results in my docs project without my having to say where it is.

1. WHEN saving is needed (Requirement 3) THE SYSTEM SHALL look for the project root by walking up from the current working directory, one folder at a time, and SHALL choose:
   a. the nearest folder that contains a `.lensy` folder; otherwise
   b. the nearest folder that contains `.git` (a folder or a file, so git worktrees count); otherwise
   c. the current working directory.
2. THE SYSTEM SHALL NEVER choose the user's home folder or the filesystem root as the project root through rules 1a or 1b. If either would be chosen, it SHALL go on to rule 1c instead. (A home folder can hold a dotfiles `.git`.)
3. THE SYSTEM SHALL NEVER choose a folder inside a `node_modules` folder; the walk starts above it.
4. WHEN `--save-dir <dir>` is given THE SYSTEM SHALL use `<dir>` (relative to the current working directory) as the results folder itself and skip discovery.

## Requirement 2: Ask once, in a terminal only

**User story:** As a technical writer, I want to be asked once whether to keep results, and never again.

1. WHEN a run is interactive, no `--save`, `--save-dir` or `--no-save` is given, no `--json -` is given, and the project has no saved answer (1.1 and 2.4) THE SYSTEM SHALL ask on stderr, before checking any page:
   ```
   Save Lensy results for this project in <results folder path>? Each run is compared with the last one, so you can see what changed. [Y/n]
   ```
2. THE SYSTEM SHALL treat an empty answer, `y` or `yes` (any case) as yes, and `n` or `no` as no. For anything else it SHALL ask once more; a second invalid answer counts as no for this run only and SHALL NOT be remembered.
3. WHEN stdin closes, or the user presses Ctrl-C at the question, THE SYSTEM SHALL treat it as no for this run, not remember it, and go on checking. Ctrl-C SHALL NOT leave a half-written file.
4. **Remembering the answer:**
   - Yes: create the results folder and write `config.json` with `"save": true` (Requirement 6).
   - No: record the project root's absolute path under `projects` in the user settings file `~/.lensy/config.json` with `"save": false`, and create no folder in the project.
5. THE SYSTEM SHALL write `~/.lensy/config.json` with file mode 0600 and its folder with mode 0700. It SHALL keep any other keys already in that file, and SHALL write it atomically (Requirement 8.2).
6. WHEN a run is not interactive THE SYSTEM SHALL NEVER ask.

## Requirement 3: When results are saved

1. THE SYSTEM SHALL save results when any of these is true, checked in order:
   a. `--no-save` is given → **don't save** (this beats everything below);
   b. `--save` or `--save-dir <dir>` is given → **save**;
   c. the project's `.lensy/config.json` has `"save": false` → **don't save**;
   d. the project's `.lensy/config.json` has `"save": true` → **save**;
   e. the user settings remember `"save": false` for this project root → **don't save**;
   f. the run is interactive → **ask** (Requirement 2);
   g. otherwise → **don't save**.
2. `--save` and `--no-save` together, or `--save-dir` with `--no-save`, SHALL exit 2 with a message, before checking anything.
3. THE SYSTEM SHALL check that it can save before checking any page: create the results folder if needed, then write and delete a small temporary file in it. If that fails THE SYSTEM SHALL exit 2 with "Can't save results in <path>: <reason>." and check nothing.
4. WHEN saving was decided by rules 1b or 1d and writing fails later (for example, a full disk), THE SYSTEM SHALL print "Couldn't save results: <reason>" to stderr and exit 1. Rule 3.3 makes this rare.
5. Saving SHALL NOT change what is printed, apart from the comparison lines (Requirement 5) and one closing line, `Results saved in <relative path to results folder>`. That line goes to stdout, or to stderr with `--json -`.

## Requirement 4: What is saved

**User story:** As a docs engineer, I want a predictable folder that people, coding agents and scripts can all read.

1. THE results folder SHALL have this layout:
   ```
   <results folder>/
   ├── config.json          project settings (Requirement 6)
   ├── latest.md            the last run, all its pages: the Markdown report (--md) plus "Since last run"
   ├── history.md           one row per page per run, newest first
   └── pages/
       └── <page folder>/
           ├── page.json    { "url": "<page URL>" } (identifies the folder)
           ├── latest.json  the newest run record for this page
           ├── latest.md    the Markdown report for this page alone, with "Since last run"
           └── runs/
               └── <timestamp>.json   one run record per run
   ```
2. **Page folder names** come from the page URL:
   - the lowercased host (with `_<port>` when a port is given), then each path segment;
   - each part is percent-decoded, and every character outside `A–Z a–z 0–9 . _ -` becomes `-`, with runs of `-` collapsed and leading or trailing `-` and `.` trimmed;
   - an empty path or a path ending in `/` adds a final `index` segment;
   - a query string adds `~q-<first 8 hex of sha256(query)>` to the last segment; the fragment is ignored;
   - a part named `.` or `..`, or one that's empty after cleaning, becomes `_`;
   - a part matching a Windows reserved name (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`, any case, with or without an extension) gets `_` added;
   - each part is cut to 60 characters;
   - if the whole relative folder path is longer than 150 characters, it becomes the first 130 characters, then `-`, then the first 12 hex characters of sha256(URL).

   Examples:
   - `https://help.example.com/account-hub/onboarding-guide` → `pages/help.example.com/account-hub/onboarding-guide/`
   - `https://docs.example.com/` → `pages/docs.example.com/index/`
   - `http://localhost:4173/guide/start?tab=a` → `pages/localhost_4173/guide/start~q-<hash>/`
3. **Two URLs in one folder:** IF a page folder's `page.json` names a different URL (for example two URLs that differ only in letter case, on a case-insensitive disk) THEN THE SYSTEM SHALL use `<folder name>~<first 8 hex of sha256(URL)>` for the new URL. A page folder holds exactly one URL.
4. **Run timestamp file names:** the run's start time in UTC, `YYYY-MM-DDTHHMMSSZ.json` (no colons, safe on Windows). If that file already exists, add `-2`, `-3`, and so on. All pages of one run share the run's start time.
5. **Run record format** (`runs/*.json` and `latest.json`):
   ```json
   {
     "recordVersion": 1,
     "tool": "lensy",
     "toolVersion": "0.1.0",
     "engineCommit": "f3cf801",
     "checkedAt": "2026-11-08T18:30:12.000Z",
     "page": { …the same object as one entry of --json "pages", including "change" (Requirement 5.6)… }
   }
   ```
   A page that couldn't be checked (blocked, unreachable, not HTML, internal error) is saved too, with its status, so the history shows it.
6. **Keeping runs:** after saving, THE SYSTEM SHALL keep the newest `keep` run records in each page folder it wrote to this run (Requirement 6, default 52) and delete older ones. It SHALL delete only files in that page's `runs/` folder whose names match the timestamp pattern in 4.4.
7. **`history.md`:**
   - a title and a short line that says what the file is, then a table with the header `| Date (UTC) | Page | Coding agents | AI search | Change | Fixed | New |`;
   - each run inserts its rows right under the header, newest first, one per page in the order the pages were given;
   - Change reads like `+4 / 0`, or `first run`, or `not checked`;
   - Fixed and New list check labels, at most 3 each, then `+N more`;
   - the table keeps at most 500 rows; older rows are dropped;
   - text taken from pages is escaped as in `render-md.ts`.
8. **`latest.md` (top level):** the same content as `--md` for all pages of the run, plus a "Since last run" section per page (Requirement 5.5). It's replaced on every run that saves.
9. **Points in fixes:** the Markdown and HTML reports SHALL show each fix's points lost on the 0–100 scale (the same numbers as the short view and `--json`), not raw check points, so every output agrees. Golden files change to match.
10. Saved Markdown and JSON SHALL NOT contain absolute paths from the user's machine. Paths shown in the terminal SHALL be relative to the current working directory.

## Requirement 5: Compare with the previous run

**User story:** As a technical writer, I want to see what changed since last time, so I know whether my fixes worked and catch new problems early.

1. WHEN saving is on THE SYSTEM SHALL read each page's previous run, the page folder's `latest.json`, before writing the new one. IF that file is missing, unreadable or invalid JSON, or has a `recordVersion` other than 1, THEN THE SYSTEM SHALL fall back to the newest valid file in `runs/`, and IF there is none, treat the page as having no previous run. A broken file SHALL NOT stop the run.
2. A comparison, for a page checked in both runs (`status: "ok"` both times), holds:
   - for each score: previous value, current value and difference;
   - **Fixed:** checks that lost points in the previous run and lose none now;
   - **New:** checks that lost no points in the previous run and lose some now;
   - **Worse** and **Better:** checks that lose points in both runs, with more or fewer points lost now (shown only in `--verbose`, Markdown and JSON);
   - checks are matched by `id`; a check present in only one run counts as New or Fixed by the same rules, treating "absent" as losing no points.
3. WHEN the previous run's `toolVersion` or `engineCommit` differs from the current one THE SYSTEM SHALL add: "Lensy changed between these runs (<old> → <new>), so some differences may come from Lensy, not your docs."
4. **Terminal, one page:** right after the scores line, THE SYSTEM SHALL print:
   ```
   Since Nov 1 (7 days ago): Coding agents 87 → 91 (+4)    AI search 95 → 95
   Fixed: Page points agents to llms.txt (HTML)
   New: Markdown on request
   ```
   - Fixed and New appear only when they have items, at most 5 each, then `+N more`.
   - With no previous run, print `First saved run for this page.`
   - When the previous run wasn't `ok` (or this one isn't), say so: `Last run on Nov 1 couldn't check this page (blocked).`
   - Dates use the local timezone in the terminal (`Nov 1`, with the year when it isn't the current year) and ISO dates in files.
   - Ages read `today`, `yesterday`, `N days ago` or `N weeks ago`.
5. **Markdown (`latest.md` files and `--md` when saving):** a `### Since last run` section with the same facts, including Worse and Better.
6. **JSON (`--json` and run records):** each page gets `"change"`, which is `null` when there's no previous run, otherwise:
   ```json
   {
     "since": "2026-11-01T18:30:12.000Z",
     "previousStatus": "ok",
     "codingAgents": { "from": 87, "to": 91, "delta": 4 },
     "aiSearch": { "from": 95, "to": 95, "delta": 0 },
     "fixed": [{ "id": "llms-txt-directive-html", "check": "Page points agents to llms.txt (HTML)" }],
     "new": [],
     "worse": [],
     "better": [],
     "lensyChanged": false,
     "message": "Coding agents 87 → 91 (+4), AI search 95 → 95 since 2026-11-01. Fixed: Page points agents to llms.txt (HTML)."
   }
   ```
   `message` is one plain sentence a later Slack or email step can post as is. Score fields are `null` when a run wasn't `ok`.
7. **Several pages:** the summary table SHALL add a `Change` column after `AI search` with values like `+4 / 0`, `first run` or `-`. Each page's short block SHALL show its `Since …` line.
8. Without saving (rule 3.1 says don't save), THE SYSTEM SHALL NOT read previous runs, and output SHALL be exactly as on `feat/cli-readable-output`. `"change"` is still present in `--json`, as `null`.

## Requirement 6: Project settings (`.lensy/config.json`)

**User story:** As a docs engineer, I want to list my pages once, so that `lensy check` (or a weekly job) needs no arguments.

1. THE file SHALL be JSON:
   ```json
   {
     "configVersion": 1,
     "save": true,
     "keep": 52,
     "pages": ["https://docs.example.com/guide/start", "https://docs.example.com/api"]
   }
   ```
   - every key is optional;
   - `keep` is a whole number from 1 to 1000;
   - `pages` is an array of strings, each accepted the way URLs on the command line are, including bare hostnames;
   - Lensy writes the file with 2-space indentation and a trailing newline.
2. WHEN `lensy check` gets no URLs and no `--urls-file` THE SYSTEM SHALL check the `pages` from the project's config file, found as in Requirement 1. IF there are none THEN THE SYSTEM SHALL exit 2 with the existing message plus: "Or list pages in .lensy/config.json under "pages"."
3. WHEN URLs or `--urls-file` are given THE SYSTEM SHALL check only those, and SHALL NOT change `pages`.
4. IF the file isn't valid JSON, or a known key has the wrong type or range, THEN THE SYSTEM SHALL exit 2 naming the file and the problem (for example, `".lensy/config.json: "keep" must be a whole number from 1 to 1000."`), before checking anything. Unknown keys SHALL produce one warning on stderr and otherwise be ignored.
5. Lensy SHALL only ever add or change the `save` key in an existing config file, keeping every other key and its order.

## Requirement 7: Help, docs and pages

1. `lensy check --help` SHALL list `--save`, `--save-dir <dir>` and `--no-save`, each with one short line.
2. THE CLI guide page `/cli` (`frontend/src/CliGuide.tsx`) SHALL gain a section **"Save and compare runs"** between "Save a report" and "Explain a check", with:
   - the folder layout;
   - the first-run question;
   - what a comparison looks like (an example from a real run);
   - `.lensy/config.json` with `pages`;
   - the save rules in plain words;
   - a note that saved results stay on the user's machine and teams may commit `.lensy/` to share history.

   The "On this page" list SHALL include it. `packages/cli/test/guide.test.ts` keeps working (every flag in `--help` appears on the page).
3. THE `/cli` "What it sends" section SHALL add one sentence: saving writes only to the user's own disk and sends nothing.
4. `packages/cli/README.md` (the npm page) SHALL become a full README:
   - install;
   - check a page;
   - several pages;
   - reports (`--md`, `--html`, `--json`);
   - save and compare runs;
   - `.lensy/config.json`;
   - exit codes;
   - what it sends, and that saved results stay local;
   - a link to https://perseveranceai.com/cli.

   No customer names, and no example domains other than `example.com`, `vitepress.dev` and `docs.stripe.com`.
5. `packages/CHANGELOG.md` and the root `CHANGELOG.md` SHALL describe the feature.
6. `docs/test-cases.md` SHALL get rows for the new e2e checks (Requirement 9.3) and update CLI-02 for the new section.
7. THE privacy page needs **no change**: nothing new is collected or sent. The PR description SHALL say this was checked.
8. `.kiro/steering/lensy-cli.md` SHALL describe the current CLI (AFDocs coding score, lowercase `lensy-cli` user agent, `--json`, saving and `config.json`) and SHALL no longer say a config file or `--json` is out of scope.

## Requirement 8: Safety and robustness

1. THE SYSTEM SHALL write only inside the results folder, and to `~/.lensy/config.json`. Page folder names come only from the rules in 4.2, never from page content.
2. Every file Lensy writes SHALL be written atomically: write `<name>.tmp-<pid>` in the same folder, then rename it. Ctrl-C at any point SHALL leave each file either complete or untouched.
3. **One run at a time per results folder:**
   - Before writing, take a lock by creating `<results folder>/.lock` exclusively (open with the `wx` flag), holding the pid and start time.
   - IF the lock exists and is younger than 30 minutes THEN print "Another lensy run is saving to <path>; results from this run weren't saved." to stderr and don't save, with no change to the exit code. A lock older than 30 minutes is stale: replace it.
   - The lock is removed in a `finally` and on SIGINT/SIGTERM.
4. Comparison and history SHALL handle a page whose previous run was blocked, unreachable or not HTML, a check whose `points` is `null`, a capped score, a run with duplicate URLs (checked once, as today), and unreadable old files, without throwing.
5. Saving SHALL NOT slow checking noticeably: files are written after all pages are checked, and a run of 100 pages saves in under 2 seconds on a laptop SSD.
6. Text from scanned pages (findings, fixes, labels) SHALL be escaped in Markdown, as `render-md.ts` already does, and is never used in a file path.

## Requirement 9: Tests

1. **Vitest, `packages/cli/test/`.** Every requirement above has at least one test. They run in temporary folders (`fs.mkdtempSync`), with a fixed clock (`io.now`), a fake home folder, fake stdin answers, and saved fixtures (no network). These include:
   - **project root discovery:** `.lensy`, a `.git` folder, a `.git` file, the home folder skipped, `node_modules` skipped, the fallback to the current folder, and `--save-dir`;
   - **every rule in 3.1, in order,** plus 3.2 and 3.3;
   - **the question:** yes, no, empty, invalid twice, stdin closed, never when not interactive, never with `--json -`, and remembered answers in both places;
   - **every folder-naming rule in 4.2–4.4,** including the collision and long-path cases;
   - **run record shape,** keeping runs (4.6), and `history.md` (order, escaping, the 500-row cap);
   - **comparison:** score deltas, Fixed, New, Worse and Better, the Lensy-changed note, previous run not ok, a broken `latest.json` falling back to `runs/`, and no previous run;
   - **terminal output** for one page and several pages, with and without a previous run;
   - **`--json` `change`,** and `change: null` without saving;
   - **config:** `pages` used with no arguments, invalid JSON, a bad `keep`, unknown keys warned, and the `save` key added without touching others;
   - **the lock:** held, and stale;
   - **atomic writes:** no `.tmp-` files left behind;
   - **no absolute paths** in saved files;
   - **the Markdown and HTML fix points** match the scaled losses (4.9);
   - **an end-to-end run in process:** check two fixture pages, change one fixture to fail a check, check again, and assert the comparison in terminal, JSON, `latest.md` and `history.md`.
2. All existing tests SHALL pass, including the 15-fixture parity tests.
3. **Playwright, `frontend/e2e/cli.spec.ts`:**
   - CLI-02 updated for the new section order;
   - **CLI-05** (new): the "Save and compare runs" section shows the folder layout, the question, a comparison example and `config.json`, and its side link scrolls to it;
   - CLI-03 still passes at 375px in both themes.
4. A **manual end-to-end check** (tasks.md, last task) on a real machine, with output pasted into the PR.
