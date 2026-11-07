# Tasks: save results and compare runs

**Rules for every task:**
- Work in `packages/cli/`, except task 8, which also touches the website, docs and steering.
- Each task ships with its tests in the same commit.
- After each task, run `cd packages && npm run build && npm test`. Fix every failure before moving on. Never skip or delete a test to make it pass.
- Commit after each task with a short message.
- Don't push until task 9 is done.

- [ ] 0. Baseline
  - [ ] 0.1 `cd packages && npm ci && npm run build && npm test`. Expect 139 passing tests (2026-11-08). Note the number in your first commit message.
  - [ ] 0.2 Read the files listed at the top of `design.md`, and run `node cli/dist/cli.js check https://vitepress.dev/guide/getting-started` once to see the current output.

- [ ] 1. `Io` and plumbing
  - [ ] 1.1 Add `cwd`, `home`, `stdin` and `isInteractive` to `Io` (design "Io additions"), and set them in `cli.ts`. Existing tests must pass unchanged.
  - [ ] 1.2 Add the flags `--save`, `--save-dir <dir>` and `--no-save` as three separate options (design "Commander note"). Requirement 3.2: exit 2 on conflicting flags. Test every combination, and that `--help` lists all three.
  - _Requirements: 3.2, 7.1_

- [ ] 2. Project root and page folders *(pure functions, new files)*
  - [ ] 2.1 `workspace.ts`: `findProjectRoot`, `resultsFolder`. Tests: every case in requirement 1.
  - [ ] 2.2 `page-folder.ts`: `pageFolderName` and `resolvePageFolder`, with the containment assertion. Tests: the table in design "Page folders" (at least 20 cases), the collision case and the long-path case.
  - _Requirements: 1, 4.2, 4.3, 8.1_

- [ ] 3. Settings and the question
  - [ ] 3.1 `settings.ts`:
    - read and validate the project config;
    - read and write the user config (mode 0600 file, 0700 folder, unknown keys kept, `.bak` on invalid JSON);
    - add the `save` key without touching other keys or their order;
    - `decideSave` as a table-driven function.

    Tests: every rule in 3.1 in order, plus every validation error in 6.4.
  - [ ] 3.2 `prompt.ts`: `askYesNo`. Tests: yes, no, empty, invalid then valid, invalid twice, stdin closed (`null`).
  - [ ] 3.3 Wire it into `main.ts` steps 1–6 (design "Order of work"), including the write test (3.3) and config `pages` when no URLs are given (6.2). Tests:
    - no question when not interactive, with `CI` set, or with `--json -`;
    - the answer is remembered in each place;
    - the folder isn't writable → exit 2 and no fetch (use a `fetchImpl` that fails the test if called);
    - config `pages` used;
    - no URLs and no config → exit 2 with the hint.
  - _Requirements: 2, 3, 6_

- [ ] 4. Store
  - [ ] 4.1 `store.ts`: `writeAtomic`, `withLock`, `readPrevious`. Tests:
    - no `.tmp-` files left behind, including after a write error (mock `renameSync` to throw once);
    - the lock is held, stale or released;
    - `readPrevious` falls back to `runs/` when `latest.json` is truncated, missing, or has the wrong `recordVersion`.
  - [ ] 4.2 `saveRun`:
    - run records (requirement 4.5), `page.json`, `latest.json`, the per-page `latest.md`, the top-level `latest.md`;
    - `history.md` (rows newest first, escaping, the 500-row cap, a fresh file when the header doesn't match);
    - keeping runs (`keep`; delete only matching file names);
    - timestamp collisions (`-2`).

    Tests for each, plus "no absolute paths in any saved file": write in a temp folder and assert that no saved file contains the temp folder's path.
  - _Requirements: 4, 8.2, 8.3, 8.6_

- [ ] 5. Compare
  - [ ] 5.1 Add `pointsLost` (check id → points lost on the 0–100 scale) to the `--json` page object in `render-json.ts`. Export `jsonPage(p, change)`.
  - [ ] 5.2 `compare.ts`: `compare`, `changeMessage`, `changeLines`. Tests:
    - score deltas;
    - Fixed, New, Worse and Better, including a check that exists in only one run;
    - a capped score;
    - `points: null` checks;
    - the previous run not ok, and the current run not ok;
    - the Lensy-changed note;
    - date formats (same year, different year, today, yesterday, days, weeks) with a fixed clock and `TZ=UTC` in the test.
  - _Requirements: 5.1–5.3, 5.6_

- [ ] 6. Output
  - [ ] 6.1 Terminal: change lines for one page (short view and `--verbose` with Worse/Better), each page's short block, and the `Change` column only when saving. Add `Results saved in <relative path>`, on stderr with `--json -`. Tests:
    - each output with and without a previous run;
    - without saving, the output is exactly the same as before (compare with the current snapshot of `check-command.test.ts` expectations).
  - [ ] 6.2 `report-doc.ts`: fix points from scaled losses (requirement 4.9), and `change` on `DocPage`. `render-md.ts` / `render-html.ts`: a "Since last run" section. Update the golden files deliberately, and review the diff: only the points and the new section may change.
  - [ ] 6.3 `--json`: `change` per page (null without saving). The JSON written to `--json` and the `page` object in the run record must be the same object; test that they're deep-equal.
  - _Requirements: 4.8, 4.9, 5.4–5.8_

- [ ] 7. End-to-end in process
  - [ ] 7.1 A test that runs `run()` twice in a temp project (a `.git` folder inside):
    - **Run 1:** two fixture pages. Check: "First saved run"; the files exist; `history.md` has 2 rows.
    - **Run 2:** the same pages, with one fixture changed so one passing check fails (copy the fixture entries and edit the response that check reads; for example remove the llms.txt link from the page HTML), and the clock 7 days later. Check:
      - the terminal shows `Since … (7 days ago)` with the right deltas and `New:`;
      - `--json` `change` matches;
      - `latest.md` has "Since last run";
      - `history.md` has 4 rows, newest first;
      - `runs/` has 2 files per page.
  - [ ] 7.2 A run where one page is blocked (403), followed by a run where it's ok. Check the "couldn't check this page" wording and `previousStatus`.
  - _Requirements: 5, 9.1_

- [ ] 8. Website, docs and steering
  - [ ] 8.1 `frontend/src/CliGuide.tsx`: add the "Save and compare runs" section and the "What it sends" sentence (requirements 7.2–7.3). Use output from a real run (task 9.1) for the examples. Keep the existing `Block` and `H2` components and the page's writing style.
  - [ ] 8.2 `frontend/e2e/cli.spec.ts`: update CLI-02's heading list, and add CLI-05 (requirement 9.3). Run `cd frontend && npx playwright test e2e/cli.spec.ts` against `npm start`, then the full pre-push check (`cd frontend && npm run pre-cr`).
  - [ ] 8.3 `docs/test-cases.md`: update the CLI-02 row and add a CLI-05 row.
  - [ ] 8.4 `packages/cli/README.md`: the full README (requirement 7.4).
  - [ ] 8.5 `packages/CHANGELOG.md` and the root `CHANGELOG.md`.
  - [ ] 8.6 `.kiro/steering/lensy-cli.md` (requirement 7.8).
  - [ ] 8.7 Confirm the privacy page needs no change (requirement 7.7), and say so in the PR description.
  - _Requirements: 7_

- [ ] 9. Manual end-to-end (on this Mac, before pushing)
  - [ ] 9.1 Build, pack and install globally: `cd packages && npm run build && cd cli && npm pack && npm install -g ./perseverance-ai-lensy-0.0.0.tgz`. Then in `~/projects/vitepress-sample` (a git repo):
    1. `lensy check https://vitepress.dev/guide/getting-started`. Answer **Y** to the question. Expect "First saved run", then `.lensy/` with the layout in requirement 4.1.
    2. Run it again. Expect `Since today: … → … (0)`, and a second file in `runs/`.
    3. Edit `.lensy/pages/vitepress.dev/guide/getting-started/latest.json`: set `page.scores.codingAgents` to 80, and add `"llms-txt-exists": 5` to `pointsLost`. Run again. Expect `Coding agents 80 → 87 (+7)` and `Fixed: llms.txt exists`.
    4. Add `"pages": ["https://vitepress.dev/guide/getting-started", "https://docs.stripe.com/api"]` to `.lensy/config.json`, then run `lensy check` with no arguments. Expect both pages, and the Change column.
    5. `lensy check --json - | head -30`: JSON only, with `change`.
    6. `CI=1 lensy check https://docs.stripe.com/api`: no question; saves, because config says `"save": true`.
    7. `cd /tmp && lensy check https://docs.stripe.com/api`: asks about `/tmp/.lensy`. Answer **n**. Run again: no question. Check that `~/.lensy/config.json` has the entry and mode `-rw-------`.
    8. `lensy check https://docs.stripe.com/api --no-save --save`: exit 2.
    9. Open `.lensy/history.md` and `.lensy/latest.md` in the IDE preview. They should read well.
  - [ ] 9.2 Clean up: `rm -rf ~/projects/vitepress-sample/.lensy`, and remove the `/tmp` entry from `~/.lensy/config.json`.
  - [ ] 9.3 Paste the terminal output of 9.1 steps 1–5 into the PR description.

- [ ] 10. PR
  - [ ] 10.1 Push `feat/cli-save-history`. The pre-push hook runs the production build and full e2e suite; it must pass.
  - [ ] 10.2 Open a PR into `main`, stacked on PR #56 (`feat/cli-readable-output`). If #56 has merged, rebase onto `main` first. The description lists every requirement and where it's tested, the privacy-page check, and the 9.3 output.
