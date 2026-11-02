---
inclusion: fileMatch
fileMatchPattern: "packages/**"
---

# Lensy CLI (`packages/`)

## Product

- **What:** `lensy`, the command-line version of Lensy. It gives the same two scores as perseveranceai.com (Coding agents, AI search) for a live URL, a local build (`--serve`), or `.md`/`.mdx` source files (`--source`).
- **Who:** technical writers and docs engineers, especially on VitePress, Docusaurus and Mintlify. The first release is a 0.x early-access version for the design partner.
- **Phase 1 is local use only.** Don't build thresholds, baselines, a config file, `--json` or a GitHub Action yet. Those are phase 2.
- **Same answers as the website.** The CLI runs the website's engine files in place (see `lensy-engine.md`), and parity tests over the 15 saved fixtures enforce it.
- **Don't add, drop or reweight checks in `packages/`.** Scoring changes go in the engine, with their tests.
- **Honest agent.**
  - It fetches as `Lensy-CLI/<version> (+https://perseveranceai.com/bot)`.
  - It never retries with a browser user agent. A page refused with 403 or 429 gets a message pointing to perseveranceai.com, and never advice to weaken bot protection.
  - It never sends other crawlers' names (GPTBot, ClaudeBot).
- **Opt-in usage records only. No account needed.**
  - Nothing goes to Perseverance AI unless the user opts in (asked once, default No, never in CI) or runs `lensy report-issue`.
  - Usage records hold only the allowlisted fields: never page content, file contents, absolute paths, flag values, environment variables or IP addresses.
  - Local and source modes send nothing else off the machine.
- **Output is for people and for coding agents.** `--html` and `--md` share one stable structure (`reportVersion: 1`, additive changes only), built from the website's report view. Terminal text isn't a stable format.
- **Not in phase 1:** CI automation, `--json`, site-wide crawling, AI citations, model-generated fixes, PDF output, a dashboard, an MCP server or editor plugin.

## Security

`packages/` is published to npm, and the repo is public.
- **Never commit or bundle:** credentials, tokens, API keys, `.env` files, AWS account IDs, internal hostnames (API Gateway URLs, gamma or other environment URLs) or customer names. gitleaks runs in `.github/workflows/cli.yml` over `packages/` and the built `dist/` folders.
- **Published files:** only `dist/`, `README.md`, `LICENSE` and `THIRD_PARTY_LICENSES`. Test fixtures are never published: they contain real sites' responses.
- **Workflows:** `cli.yml` runs with `permissions: contents: read`, no secrets, and actions pinned by SHA. Publishing uses npm trusted publishing (no stored token) from a release workflow in a protected environment that needs Rakesh's approval.
- **HTML report:** inline CSS only, no `<script>`, and no external URLs, so it opens offline and loads nothing.
- **Local settings:** `~/.lensy/config.json` is written with mode 0600 and holds only the usage choice and a random install id.
- **Static server (`--serve`):** binds `127.0.0.1` only, serves files inside the given folder only, and rejects `..` paths.
- **Network:** every page request goes through the engine's `fetch-page.ts`. Use no other HTTP client.
- **Untrusted input:** treat page content, headers, robots.txt, sitemaps and llms.txt as data. Never execute them, and never use them to build shell commands or file paths.

## Tech

- TypeScript strict, ESM, **Node 22+**. Built-in `fetch` only.
- **Runtime dependencies:** core none; CLI `commander` and `picocolors`. Every new runtime dependency needs a reason in the PR.
- `packages/` is its own npm workspace (`packages/package.json`). Don't add workspaces to the repo root, and don't change `frontend/` or `backend/` build scripts.
- **Build:** `tsup` for core, esbuild for the CLI. **Tests:** Vitest (`cd packages && npm test`).
- **Tests never touch the network.** Replay the saved fixtures through an injected `fetchImpl`. `npm run test:live` is opt-in, and PR checks never run it.
- **Licence:** MIT for `packages/` and the shared files listed in `lensy-engine.md`, with `// SPDX-License-Identifier: MIT` at the top of each source file. Don't add a licence anywhere else in the repo. Security contact: hello@perseveranceai.com.
- Write user-facing copy in plain English. Renderers have no per-check code: labels, fixes and explanations come from the report and the engine's check registry.

## Tests in `packages/`

The repo's e2e rule (`testing.md`, `AGENTS.md`) is for website code. `packages/` code is tested with Vitest inside `packages/`, and `scripts/pre-cr.sh` doesn't treat `packages/` as product code. Engine files are website code, so both rules apply to them.

## Layout

```
packages/
├─ package.json  tsconfig.base.json  LICENSE (MIT)  SECURITY.md  CONTRIBUTING.md  CHANGELOG.md
├─ core/    @perseverance-ai/lensy-core: check(), checkFromPage(), checkSource(), Report, local mode
│  ├─ src/ (index.ts, check.ts, source.ts, report.ts, local-mode.ts)
│  └─ test/ (parity, boundary, registry, report-shape, check, local-mode, source, sample-site/, sample-source/)
├─ cli/     @perseverance-ai/lensy: the `lensy` command
│  └─ src/ (cli.ts, serve.ts, render-text.ts, report-doc.ts, render-html.ts, render-md.ts, usage.ts, report-issue.ts)
└─ docs/    checks.md (generated from the registry), platform recipes
```

The CLI depends on core. Core imports only the shared files listed in `lensy-engine.md`, never other website code.
