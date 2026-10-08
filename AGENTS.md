# Working on Lensy (instructions for coding agents and humans)

Read by Claude Code (via `CLAUDE.md`), Kiro (via `.kiro/steering/`), Cursor,
Codex and other agents that support `AGENTS.md`.

## Tests are automatic — engineers don't have to think about them

Product code is `frontend/src/`, `frontend/public/index.html`,
`backend/lambda/`, `backend/lib/`. The e2e tests in `frontend/e2e/` are the
test cases: each test's title carries its case id (S-xx smoke, REG-xx
regression). `docs/test-cases.md` holds the rules, the test URLs and the few
checks that can't be automated.

**On every `git push`** (`.githooks/pre-push` → `scripts/pre-cr.sh`, installed
by `npm install` in `frontend/`), before a CR exists:

1. If the branch changes product code, the engineer's coding agent (Claude
   Code or Kiro, whichever is installed) reads the diff and adds or updates
   e2e tests, following `scripts/pre-cr-prompt.md`.
   - It changed tests → the push stops; review and commit them, push again.
   - Already covered / no behaviour change → carry on.
   - It can't tell how to test the change → only then the push stops and
     asks the engineer to check the tests (`PRE_CR_CONFIRMED=1 git push`
     once they're right).
2. Production build + minified-CSS check + the full e2e suite. Pass → push.

Run the same thing by hand any time: `cd frontend && npm run pre-cr`.

**If you are a coding agent making a change:** write or update the e2e test
for it in the same commit, so the pre-push step finds nothing to do. Bug
fixes get a regression test with the next REG-xx id in its title and a row in
the regression table in `docs/test-cases.md`. Never sign off on `npm start`
alone: the dev server doesn't minify CSS, which is where the October 2026
light-theme bug hid (REG-01).

## What runs where

- **Before the CR (pre-push):** as above.
- **Every PR (CI):** backend typecheck + CDK synth, frontend production build,
  minified-CSS check, `tailwind.css` drift check, the full e2e suite on the
  PR's production build, and an advisory "test impact" warning.
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
