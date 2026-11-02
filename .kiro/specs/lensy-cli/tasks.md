# Tasks: Lensy CLI, phase 1 (local use)

Work top to bottom on branches off `main`, one PR per numbered group. Our PR checks must be green before merging.

Rules for every task:
- **Website behaviour must not change,** except the copy in task 2.9 and the new API route and domain in group 3.
  - Existing backend Jest and frontend e2e suites must pass.
  - Website changes get tests per `AGENTS.md`. The pre-push hook will run the e2e suite for `backend/lambda/`, `backend/lib/` and `frontend/src/` changes.
- **Phase 1 is local use only.** Don't build thresholds, baselines, `lensy.config.json`, `--json` or the GitHub Action (design.md "Phase 2").
- **Don't deploy, publish or push tags.** Deploys go through `deploy.yml` (Rakesh approves prod), and npm publishing is Rakesh's (group 10).
- **`packages/` is self-contained.** Don't add workspaces to the repo root `package.json`, and don't change `frontend/` or `backend/` build scripts.
- **Reuse before writing** (Req 6.8). A PR that adds a function duplicating an engine or report-view function says why.
- **Stop and report** if parity fails (4.5), or an engine or report-view file needs an import from AWS, LangChain, S3, React or `process.env`.

- [x] 0. Branch, spec and prerequisites
  - [x] 0.1 Branch `feat/lensy-cli` off `origin/main` at `1d5a757`, not tracking `main`.
  - [x] 0.2 Spec and steering in `.kiro/`.
  - [x] 0.3 Free `api.perseveranceai.com`: the old Dosthy CloudFront distribution, its DNS records and its certificate were removed on 2026-11-01. A local backup is in `.kiro/backups/`.
  - [x] 0.4 npm organisation `perseverance-ai` exists, and the account `perseveranceai` is its owner.
  - [ ] 0.5 **Rakesh:** turn on two-factor authentication for every npm account that will publish. It's currently off for `perseveranceai`.

- [ ] 1. Workspace scaffold and our PR checks
  - [ ] 1.1 `packages/package.json`:
    - `private: true`;
    - workspaces `core` and `cli`;
    - scripts `build`, `test` (`vitest run`), `check:secrets` and `docs:checks`;
    - `engines.node >=22`.

    Add `packages/tsconfig.base.json` (strict, ES2022, `moduleResolution: bundler`).
  - [ ] 1.2 Package skeletons:
    - `packages/core` (`@perseverance-ai/lensy-core`);
    - `packages/cli` (`@perseverance-ai/lensy`, `bin: { lensy: dist/cli.js }`).

    Both get `"license": "MIT"`, `publishConfig.access: public`, and `files` limited to `dist`, `README.md`, `LICENSE` and `THIRD_PARTY_LICENSES`.
  - [ ] 1.3 Repo documents:
    - `packages/LICENSE` (MIT, "Copyright (c) 2026 Perseverance AI");
    - `SECURITY.md` (hello@perseveranceai.com);
    - `CONTRIBUTING.md`, `CHANGELOG.md` and a `README.md` stub.

    The build copies LICENSE into each package and generates `THIRD_PARTY_LICENSES`.
  - [ ] 1.4 `.github/workflows/cli.yml` on `pull_request` to `main`:
    - path filter as in design.md "Keeping the website and the CLI in step";
    - Node 22: `npm ci`, build, test, then gitleaks over `packages/` and the built `dist/` folders;
    - the advisory step for `markdown.ts` drift;
    - `permissions: contents: read`, no secrets, and actions pinned by SHA like `ci.yml`.
  - [ ] 1.5 `deploy.yml`: add `'packages/**'` to `paths-ignore`. Change nothing else in the file.
  - Done when: `cd packages && npm ci && npm run build && npm test` passes with empty tests, and `cli.yml` runs on a PR.
  - _Requirements: 4.10, 4.11, 6.6, 6.7_

- [ ] 2. Engine prep, report view and website copy (website code)
  - [ ] 2.1 E1 in `shared/fetch-page.ts`: `userAgent?` and `browserFallback?` (default `true`). Jest cases:
    - the honest request uses the override;
    - `browserFallback: false` makes one request and returns `errorKind: 'blocked'` on 403 or 429;
    - the existing fallback tests still pass.
  - [ ] 2.2 E2 in `tools/collect-signals-v2.ts`: pass `userAgent` and `browserFallback` through `CollectOptions`.
  - [ ] 2.3 E3: create `tools/report-v2.ts` and have `generate-report.ts` import and re-export from it. Point `report-v2.test.ts` at the new file. Don't hand-edit any tracked `.js` file; say what you did about `generate-report.js` in the PR.
  - [ ] 2.4 E4: `tools/check-registry.ts` with all 12 checks:
    - `measures` from spec §4.2–4.4, and `why` and evidence from spec §3 (`docs/two-score-readiness/spec.md`);
    - no customer names;
    - `hostDependent` set, with `hostNote` and `sourceNote` filled in.
  - [ ] 2.5 E5: `netErrorChecks` with the request-to-check map. Jest cases in `scoring-v2-edges.test.ts`.
  - [ ] 2.6 E6: `HONEST = /^Lensy(-CLI)?\//` in `tools/__tests__/replay.ts`.
  - [ ] 2.7 E7: `// SPDX-License-Identifier: MIT` as the first line of every engine file.
  - [ ] 2.8 Report view:
    - create `frontend/src/report/report-view.ts`, which is pure, has the MIT header and no imports, and is TypeScript 4.9 compatible;
    - move these into it, unchanged: `ScoreCheck`, `ScoringV2`, `AI_SEARCH_BOTS`, `AGENT_WINDOW_CHARS`, `readScoringV2`, `gateBannerText`, `previewSummary`, `v2SignalGroups` and `v2Recommendations` (the last two now exported);
    - have `reportModel.ts` import them from it, and update its other importers if needed.

    The frontend build and e2e suite must pass unchanged.
  - [ ] 2.9 Website copy:
    - **`/bot` page:** since PR #49 (fixed egress IP, REG-27/28), the page already has a `Lensy-CLI` paragraph and an allow rule of user agent `Lensy/1.0` **and** the fixed scan IP. Keep that rule, because it's for the website. Only extend the CLI paragraph: it fetches as `Lensy-CLI/<version>`, never retries as a browser, and a site that blocks it should be checked on perseveranceai.com instead.
    - **Blocked-scan messages** (`frontend/src/botBlockedCopy.ts`): no change.
    - **Privacy page:** add a paragraph on CLI usage records (opt-in, the fields, kept under the scan-record policy, deleted on request) and update its date.
    - **`AGENTS.md`:** add `cli` to the `trafficSource` values, and say traction reporting counts `cli` as its own line next to `web`.
    - Add or update the e2e tests per `AGENTS.md`.
  - Done when:
    - `cd backend && npm test` passes, and all 15 fixtures still match `expected.json`;
    - the frontend build and e2e suite pass;
    - the PR confirms no website output changed beyond `netErrorChecks` and the copy in 2.9.
  - _Requirements: 1.2, 1.4, 1.5, 1.6, 4.8, 4.10, 4.11, 6.1, 6.2, 6.8_

- [ ] 3. API: custom domain and usage endpoint (website code; deploys through `deploy.yml`)
  - [ ] 3.1 Custom domain in `lensy-stack.ts`:
    - `api.perseveranceai.com` (prod) and `gamma.api.perseveranceai.com` (gamma);
    - an ACM certificate with DNS validation in the existing `hostedZone`;
    - an `apigwv2.DomainName` and an API mapping to `httpApi`;
    - A and AAAA alias records;
    - a `CfnOutput`.

    `cdk synth` passes for gamma and prod. The website's `.env.*` URLs don't change.
  - [ ] 3.2 `POST /cli/usage` in `lensy-stack.ts` and the API handler (`handleCliUsage`), per design.md "Usage records → API side":
    - validation with an allowlist (400 for anything else);
    - `hashIp`;
    - `cli#<date>` counters in `UsageTrackingTable`, limited by `CLI_USAGE_DAILY_LIMIT=500` (429 above it);
    - a conditional `PutItem` to `AuditLogTable` with server-set `auditUrl`, `submittedAt`, `trafficSource: 'cli'` and `ipHash`;
    - a `CLI_USAGE` log line;
    - no email;
    - `auditLogTable.grantWriteData(apiHandler)` and the `AUDIT_LOG_TABLE` env var.
  - [ ] 3.3 Jest tests for `handleCliUsage`: valid record, unknown field, bad `sessionId`, oversized URL, rate limit, conditional-write failure, server-set fields, and no SES call.
  - Done when: backend tests and `cdk synth` pass, and the PR lists the new IAM grant and route. After merge: gamma deploys automatically, then smoke-test `POST https://gamma.api.perseveranceai.com/cli/usage`. Prod waits for Rakesh's approval.
  - _Requirements: 4.4, 4.6, 4.8, 4.9_

- [ ] 4. `lensy-core`
  - [ ] 4.1 `packages/core/tsconfig.json` and a `tsup` build that compiles `src/index.ts` with the engine files and `report-view.ts` in place. Inject `ENGINE_COMMIT` and the version.
  - [ ] 4.2 `src/report.ts`:
    - the `Report`, `Score` and `Check` types;
    - mapping from `ScoringV2Fields` and `netErrorChecks`, adding `source` from the registry;
    - the score rule with `coveredMax`;
    - the `WEBSITE_ONLY` list.
  - [ ] 4.3 `src/check.ts`:
    - `check()`: page fetch, then status `blocked`, `unreachable` or `not-html`;
    - `checkFromPage()`;
    - the default user agent;
    - always `browserFallback: false`.
  - [ ] 4.4 `test/boundary.test.ts`, `test/registry.test.ts` and `test/report-shape.test.ts`.
  - [ ] 4.5 `test/parity.test.ts`: all 15 fixtures, comparing `checkFromPage()` against `buildScoringV2(collectSignalsV2(...))` and `expected.json`. **Stop and report on any difference.**
  - [ ] 4.6 `test/check.test.ts`: blocked (403, 429), unreachable, not HTML, a sub-request network error, and the user agent on every request.
  - _Requirements: 1.1, 1.2, 1.4–1.8, 6.2–6.5, 7.1–7.4_

- [ ] 5. Local mode
  - [ ] 5.1 `src/local-mode.ts`:
    - detection;
    - the `siteUrl` page URL and routing `fetchImpl`;
    - blocking other origins;
    - registry `full` and `partial` handling;
    - the `local` label;
    - the gate set to `skipped`;
    - the dev-server note.
  - [ ] 5.2 `test/sample-site/` and `test/local-mode.test.ts`, with one test per rule.
  - _Requirements: 2.2–2.6, 2.8_

- [ ] 6. Source mode
  - [ ] 6.1 E8 `backend/lambda/agent-handler/shared/markdown-source.ts`: `splitFrontMatter`, `cleanMdx`, `normalizeMarkdown` and `codeFences`, pure and with the MIT header. Jest tests: front matter, MDX import/export/JSX/expressions, `{#id}`, `~~~`, and fence languages.
  - [ ] 6.2 E9 `backend/lambda/agent-handler/tools/source-signals.ts`: `buildSourceSignals()` returning `signals` and `measured`, per the design table. Jest tests: each `measured` row, and that the placeholders score no points for unmeasured checks.
  - [ ] 6.3 `packages/core/src/source.ts` `checkSource()`:
    - file discovery (skips `node_modules`, hidden folders and `.gitignore` entries);
    - static `llms.txt` and `robots.txt`;
    - platform detection from config file names;
    - scoring through the engine;
    - the `source` label and `coveredMax`;
    - the notes (estimates, title-as-H1, how to check the full result).
  - [ ] 6.4 `test/sample-source/` and `test/source.test.ts`: the coverage table, `coveredMax`, the notes, no `fetch` calls (fail the test if the global `fetch` is called), and exit code 2 with no files.
  - _Requirements: 2.7, 8.1–8.9, 6.8_

- [ ] 7. CLI
  - [ ] 7.1 `src/cli.ts` with `commander`: `check`, `explain`, `usage`, `report-issue` and `--version`. Exit codes 0, 2 and 3.
  - [ ] 7.2 `src/serve.ts`:
    - the static server (clean URLs, `..` rejected, `127.0.0.1` on port 0);
    - switching to source mode when the folder has no `.html` but does have `.md`/`.mdx`;
    - otherwise exit 2 with the build commands.
  - [ ] 7.3 `src/render-text.ts`: summary table, per-page output, labels, skipped checks explained. No per-check code.
  - [ ] 7.4 `src/report-doc.ts`, `src/render-html.ts` and `src/render-md.ts`, built on the report view, per design.md:
    - HTML: self-contained (inline CSS, no script, no external URLs), website colours, dark mode, print styles, `<meta name="lensy:*">`;
    - Markdown: YAML front matter, the sections and `- [ ]` fixes.
  - [ ] 7.5 `src/usage.ts`:
    - `~/.lensy/config.json` (mode 0600);
    - the one-time prompt (terminal only, `CI` unset, default No);
    - `lensy usage on|off|status`;
    - `--no-usage` and `LENSY_USAGE=0`;
    - the payload allowlist;
    - sending after output, with a 2-second cap at exit;
    - `~/.lensy/last-run.json`.
  - [ ] 7.6 `src/report-issue.ts`:
    - build and print the report, and confirm before sending;
    - send to `/console/feedback` with `scanMetrics` capped at 4 KB;
    - on failure, fall back to a local file.
  - [ ] 7.7 `lensy explain <id>` from the registry, and `npm run docs:checks` to generate `packages/docs/checks.md`.
  - [ ] 7.8 Tests that run the built binary, against a local stub server:
    - exit codes;
    - the HTML has no external URLs and no `<script>`;
    - golden files for both reports;
    - `--no-color`;
    - `explain` for every id;
    - the usage prompt never appears without a terminal or with `CI` set;
    - nothing is sent without opt-in;
    - the payload holds only allowlisted fields;
    - `report-issue` falls back to a file;
    - `docs/checks.md` is up to date.
  - _Requirements: 1.3, 1.9, 2.1, 2.7, 3.1–3.8, 4.1–4.7, 4.12–4.14, 6.3_

- [ ] 8. Docs
  - [ ] 8.1 `packages/cli/README.md` covering:
    - a 30-second quick start (`npx @perseverance-ai/lensy check <url>`);
    - the three targets (URL, `--serve`, `--source`);
    - `--html` and `--md`;
    - exit codes;
    - the user agent, and what to do when a site blocks it;
    - every usage-record field and how to turn records off;
    - `report-issue`;
    - "same engine as perseveranceai.com".
  - [ ] 8.2 Platform recipes in `packages/docs/`: VitePress, Docusaurus and Mintlify (source folder, build command, output folder, `--site-url`).
  - [ ] 8.3 `AGENTS.md`: a short "The CLI shares the engine" section pointing to `.kiro/steering/lensy-engine.md`.
  - _Requirements: 4.7, 4.11_

- [ ] 9. Live smoke test (manual; our PR checks never run it)
  - [ ] 9.1 `npm run test:live`: the 15 fixture URLs live, next to `expected.json`. Explain every difference.
  - [ ] 9.2 Check the design partner's onboarding page (URL in `docs/two-score-readiness/spec.md` §5) from a laptop. It should succeed.
  - [ ] 9.3 A VitePress starter site, end to end: `--source docs`, then build, then `--serve docs/.vitepress/dist --site-url <prod>`, with `--html` and `--md`.
  - [ ] 9.4 Opt in to usage records with `LENSY_API_URL=https://gamma.api.perseveranceai.com`, run a check, and confirm the record in the gamma `AuditLogTable` with `trafficSource: cli`.

- [ ] 10. Release (stop for Rakesh)
  - [ ] 10.1 Prepare 0.1.0:
    - version bump and changelog;
    - `npm pack --dry-run` for both packages;
    - gitleaks on the tarballs;
    - confirm no customer names or fixtures in them.
  - [ ] 10.2 **Rakesh:** with two-factor authentication on, publish by hand from `packages/`: `npm publish --access public -w core`, then `-w cli`.
  - [ ] 10.3 **Rakesh:** send the design partner the install command, the README and `report-issue` instructions.
  - [ ] 10.4 Prepare `.github/workflows/lensy-release.yml`:
    - runs on a `lensy-v*` tag;
    - uses a protected `npm-release` environment;
    - `id-token: write`, npm trusted publishing and provenance.

    Don't create tags.
  - [ ] 10.5 **Rakesh:** create the `npm-release` environment with himself as the required reviewer, and link both packages to the workflow under npm trusted publishing.
  - _Requirements: 4.10, 4.11_
