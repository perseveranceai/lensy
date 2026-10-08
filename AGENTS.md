# Working on Lensy (instructions for coding agents and humans)

Read by Claude Code (via `CLAUDE.md`), Kiro (via `.kiro/steering/`), Cursor,
Codex and other agents that support `AGENTS.md`.

## Tests before commit

Every change to product code — `frontend/src/`, `frontend/public/index.html`,
`backend/lambda/`, `backend/lib/` — ships with its tests in the same commit.

1. **Update the test cases.** Open `docs/test-cases.md`. For any behaviour you
   added or changed, add or edit the matching case (smoke `S-xx`, area check,
   or regression `REG-xx`) so the expected result matches the new behaviour.
2. **Bug fixes add a regression case.** A bug that reached gamma or prod gets
   a new `REG-xx` entry in `docs/test-cases.md` describing the incident, and a
   test in `frontend/e2e/` that would have caught it. Put the REG id in the
   test title.
3. **Automate what you can.** Add or update the Playwright test in
   `frontend/e2e/` (`smoke.spec.ts` for S-xx, `regressions.spec.ts` for REG-xx).
   If a case can't be automated, say so in the doc and in the PR.
4. **Run the suite on a production build before committing:**
   ```
   cd frontend && npm run test:e2e:local
   ```
   This builds with `build:gamma`, checks the minified CSS, serves the build
   on localhost:3000 and runs every test. It makes real scans against the
   gamma API. Do not rely on `npm start`: the dev server doesn't minify CSS,
   and that is exactly where the October 2026 light-theme bug hid (REG-01).
5. **Fill in "Test cases run" in the PR** (environment, themes, viewports,
   results, REG case added).

A pre-commit hook (`.githooks/pre-commit`, installed by `npm install` in
`frontend/`) blocks commits that change product code without touching
`frontend/e2e/` or `docs/test-cases.md`. CI runs the same check on every PR.
For a change with genuinely no behaviour impact, commit with
`SKIP_TEST_IMPACT=1` and explain why in the PR.

## What runs where

- **Every PR (CI):** backend typecheck + CDK synth, frontend production build,
  minified-CSS check, `tailwind.css` drift check, test-impact check.
- **After merge to `main` (deploy.yml):** deploy gamma → smoke scan → full
  e2e suite against gamma. Prod deploys **only** if all of that passed, and
  it ships the frontend bundle built in that same gamma run — prod never
  rebuilds its own. Prod still needs a human approval.

## Frontend rules learned the hard way

- **Never hand-edit `frontend/src/tailwind.css`.** It is generated from
  `frontend/src/index.css` by `npm run build:css`, which every build runs.
- **Don't use Tailwind opacity modifiers on arbitrary colours**
  (`bg-[var(--bg)]/15`). CRA's CSS minifier merges them into the plain class
  and breaks it in production only. Use
  `bg-[color-mix(in_srgb,var(--bg)_15%,transparent)]`. `npm run check:css`
  catches this.
- **Check both themes and 375px mobile** for any visual change.
- **Analytics:** gamma and prod share one GA4 property. Tests block Google
  Analytics requests; never let automated runs send real events.

## Don't

- Deploy to prod, approve prod deployments, or change deploy approvals.
- Mark a test `fixme`/`skip` to get a red build green unless it's a known,
  tracked bug — and then name the tracking id in the test (see N-06 in
  `frontend/e2e/smoke.spec.ts`).
