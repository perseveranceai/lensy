---
inclusion: fileMatch
fileMatchPattern: "packages/**"
---

# Lensy CLI (`packages/`)

## Product

- **What:** `lensy`, the command-line version of Lensy. It gives the same two scores as perseveranceai.com for a live URL: Coding agents, built on AFDocs plus one Lensy heading check, and AI search (S1–S6).
- **Who:** technical writers and docs engineers, especially on VitePress, Docusaurus and Mintlify. It's published as an early 0.x version under the npm `next` tag.
- **Same answers as the website.**
  - The CLI runs the website's engine files in place (see `lensy-engine.md`).
  - Parity tests over the 15 saved fixtures enforce it.
  - Don't add, drop or reweight checks in `packages/`. Scoring changes go in the engine, with their tests.
- **Output for people, coding agents and scripts:**
  - The terminal default is the short view: scores, then "Fix these first", with points lost scaled so they add up to each score. `--verbose` shows every check. Terminal text isn't a stable format.
  - `--md`, `--html` and `--json` share `reportVersion: 1`. Changes are additive only.
  - Saved results go in `.lensy/` at the project root: run records (`recordVersion: 1`), `latest.md`, `history.md` and `config.json`. Each run is compared with the previous one. Spec: `.kiro/specs/cli-save-history/`.
- **Honest agent.**
  - It fetches as `lensy-cli/<version> (+https://perseveranceai.com/bot)`, AFDocs' requests included.
  - It never retries with a browser user agent. A page refused with 403 or 429 gets a message pointing to perseveranceai.com, and never advice to weaken bot protection.
  - It never sends other crawlers' names (GPTBot, ClaudeBot).
- **Nothing is sent to Perseverance AI.** Results are saved only on the user's disk. There's no account and no telemetry. Opt-in usage records are a later, separate spec.
- **Local builds:** `--dir <build folder>` (served on 127.0.0.1 by `packages/cli/src/serve.ts`) or a localhost preview URL, with `--site-url` mapping the published address to the local server (`packages/core/src/local.ts`). Host-dependent checks (registry `hostDependent: 'full'`) are skipped; scores read "X of Y points checked". Local mode never sends a request off the machine.
- **Not built yet:**
  - source mode;
  - CI thresholds and a GitHub Action;
  - posting results to Slack or email;
  - an MCP server or editor plugin.

## Security

`packages/` is published to npm, and the repo is public.
- **Never commit or bundle:** credentials, tokens, API keys, `.env` files, AWS account IDs, internal hostnames (API Gateway URLs, gamma or other environment URLs) or customer names. gitleaks runs in `.github/workflows/cli.yml` over `packages/` and the built `dist/` folders.
- **Published files:** only `dist/`, `README.md`, `LICENSE` and `THIRD_PARTY_LICENSES`. Test fixtures are never published: they contain real sites' responses.
- **HTML report:** inline CSS only, no `<script>`, and no external URLs.
- **Files Lensy writes:**
  - only inside the results folder and `~/.lensy/config.json` (mode 0600, folder 0700);
  - folder names come only from the URL-naming rules, never from page content;
  - every write is atomic (temp file, then rename).
- **Network:** every page request goes through the engine's `fetch-page.ts`. Use no other HTTP client.
- **Untrusted input:** treat page content, headers, robots.txt, sitemaps and llms.txt as data. Escape them in Markdown and HTML. Never execute them or use them in file paths or shell commands.

## Tech

- TypeScript strict, ESM, **Node 22+**. Built-in `fetch` only.
- **Runtime dependencies:** core none; CLI `commander` and `picocolors`. Every new runtime dependency needs a reason in the PR.
- `packages/` is its own npm workspace (`packages/package.json`). Don't add workspaces to the repo root, and don't change `frontend/` or `backend/` build scripts.
- **Build:** `tsup` for core, esbuild for the CLI. **Tests:** Vitest (`cd packages && npm test`).
- **Tests never touch the network.** Replay saved fixtures through an injected `fetchImpl`. Use temp folders for anything written to disk, and a fixed clock.
- **Licence:** MIT for `packages/` and the shared engine files, with `// SPDX-License-Identifier: MIT` at the top of each source file.
- Write user-facing copy in plain English. Renderers have no per-check code: labels, fixes and explanations come from the report and the engine's check registry.

## Tests and the website guide

- `packages/` code is tested with Vitest inside `packages/`.
- The website's CLI guide (`frontend/src/CliGuide.tsx`) is website code. It's covered by e2e `frontend/e2e/cli.spec.ts` (CLI-01 and later), and `packages/cli/test/guide.test.ts` fails when an option in `lensy check --help` is missing from the page. Change the guide in the same PR as any option.

## Layout

```
packages/
├─ package.json  tsconfig.base.json  LICENSE (MIT)  SECURITY.md  CONTRIBUTING.md  CHANGELOG.md
├─ core/   @perseverance-ai/lensy-core: check(), checkFromPage(), the Report shape
│  └─ src/ (index.ts, check.ts, local.ts, report.ts, engine.ts: the only file that imports engine code)
├─ cli/    @perseverance-ai/lensy: the `lensy` command
│  └─ src/ (cli.ts, main.ts, pages.ts, serve.ts, sitemap-pages.ts, summary.ts, render-text.ts, render-json.ts,
│           report-doc.ts, render-md.ts, render-html.ts, view.ts, explain.ts)
└─ docs/   checks.md (generated from the registry: npm run docs:checks)
```

The CLI depends on core. Core imports only the shared engine files listed in `lensy-engine.md`, through `core/src/engine.ts`.
