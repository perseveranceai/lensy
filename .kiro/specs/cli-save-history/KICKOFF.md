# Kiro kickoff: save results and compare runs

1. In Kiro, open the folder `~/projects/lensy-cli-save`. It's a separate checkout on branch `feat/cli-save-history`, which builds on `feat/cli-readable-output` (PR #56).
2. Pick the Sonnet model. Open the spec **cli-save-history** (`.kiro/specs/cli-save-history/`) and paste this into the chat:

> Implement the spec in `.kiro/specs/cli-save-history/` (requirements.md, design.md, tasks.md), one task at a time, in the order of tasks.md. Read `AGENTS.md`, `.kiro/steering/testing.md` and the files listed at the top of design.md before writing code. Requirements are the source of truth; design.md says how. If they ever disagree, or something is unclear, stop and ask me instead of guessing.
>
> Rules:
> - Change only the files design.md lists. Nothing in `backend/` or the engine. No new runtime dependencies.
> - Every task ships with its tests. After each task, run `cd packages && npm run build && npm test` and fix every failure before going on. Never skip, weaken or delete a test to make it pass. The 15-fixture parity tests must stay green.
> - Tests never use the network. Use the saved fixtures and an injected `fetchImpl`, temp folders for `cwd` and `home`, a fixed clock, and fake stdin.
> - Lensy may only write inside the results folder and `~/.lensy/config.json`. Paths come only from the folder-naming rules, never from page content.
> - Don't put customer names, real domains other than `example.com`, `vitepress.dev` and `docs.stripe.com`, or absolute paths from this machine into code, tests, docs or saved files.
> - Commit after each task with a short message. Don't push until task 9 (the manual end-to-end check) is done and I've seen its output.
> - At the end, show me: the test counts before and after, `git diff --stat main...HEAD`, and the output of task 9.1 steps 1–5.

3. When task 9 looks right, push and open the PR (task 10).
