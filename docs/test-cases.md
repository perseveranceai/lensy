# Lensy test cases

A living document. It replaces `v2-test-cases.md` (April 2026), whose expected
results described the pre-redesign UI and no longer hold.

**Engineers don't maintain this by hand.** Automated cases live in
`frontend/e2e/` (the test is the test case; its title carries the id). On
every `git push`, the pre-push hook has the engineer's coding agent add or
update tests for the branch, then runs the whole suite (see "What's
automated" below). Every bug that reaches gamma or prod still gets a
regression case (REG-xx) — the agent adds the row here and the test.

---

## Rules for every test run

1. **Test a production build, never only `npm start`.** The dev server does not
   minify CSS, and minification has broken the site before while it looked
   fine locally (REG-01). The pre-push hook and CI do this automatically; to
   run it by hand: `cd frontend && npm run pre-cr`.
2. **Both themes, every time.** Light and dark. A bug that only shows in light
   theme shipped to prod because dark theme hid it (REG-01).
3. **Desktop and 375px mobile.** Several layout bugs only showed on mobile
   (REG-11, REG-12).
4. **Fresh private window.** A tab opened before a deploy can keep serving the
   old JS/CSS bundle and make a working deploy look broken, or the reverse.
5. **Browser console must be clean** (no red errors) on every page you touch.

### What still needs a human

The automated suite covers everything marked **[auto]**. Before approving a
prod deploy, glance at the unmarked cases and the area checklists below for
whatever the change touched — those are the only manual checks left.

### What's automated, and where it runs

Cases marked **[auto]** below have a Playwright test in `frontend/e2e/` with
the same ID in its title.

| Where | What runs | Blocks |
|---|---|---|
| On `git push`, before the CR (pre-push hook → `scripts/pre-cr.sh`) | If product code changed: the coding agent (Claude Code or Kiro) adds/updates e2e tests for the diff; then production build, minified-CSS check and the full e2e suite (citation test skipped to save paid calls) | **The push.** It also stops if the agent changed tests (review + commit them) or couldn't tell how to test the change (`PRE_CR_CONFIRMED=1` once checked). `SKIP_PRE_CR=1` skips it entirely |
| Every PR (CI) | Backend typecheck + CDK synth; frontend production build; minified-CSS check (REG-01); `tailwind.css` drift check (REG-07); **full e2e suite on the PR's build**; advisory test-impact warning | The PR shows red; merging is only blocked if branch protection requires these checks |
| After merge to `main` (deploy.yml) | Deploy gamma → wait until gamma serves the new build → smoke scan → **full e2e suite against gamma** | **Prod.** The prod job runs only if all of that passed, and it deploys the frontend bundle built in that same run — it never rebuilds its own |
| After prod deploy | Smoke scan against prod | — |

Notes:
- The suite blocks Google Analytics requests (gamma and prod share one GA4
  property), so test runs never send real analytics. It also starts every
  test with analytics declined, so the cookie banner stays out of the way.
- Each run makes ~10 real scans and one citation check (paid Perplexity calls).
  Set `E2E_SKIP_CITATIONS=1` to skip the citation test locally.
- Backend unit tests (Jest, `backend/**/__tests__/`) run in the pre-push hook and in PR CI (`npm --prefix backend test`).
- Scoring v2 is tested offline against saved responses for the 15 pages in the two-score spec (§5, §12):
  `backend/lambda/agent-handler/tools/__tests__/fixtures/<page>/`. Each folder has every response the
  reference prototype received (`responses.json.gz`) and its output (`expected.json`); the tests require the
  same points per check. Re-capture with `node backend/scripts/capture-fixtures.mjs [page names]` (needs open
  internet) and review the score changes it prints.

---

## Test URLs

Expected outcomes were last confirmed on 2026-10-08. If a site changes and a
URL stops behaving as described, replace it and note the date.

| ID | URL | Use it for | Expected |
|---|---|---|---|
| U-1 | `https://docs.stripe.com/api` | Default happy path | Passes doc check (~99%); llms.txt verified; markdown via content negotiation; bot access 10/10 allowed |
| U-2 | `https://docs.github.com/en/rest` | Second happy path | Passes doc check |
| U-3 | `https://docs.paloaltonetworks.com/common-services/subscription-and-tenant-management/get-started` | DITA/AEM-style enterprise docs | Passes, "May be a doc page (67%)" — was wrongly rejected before #28 |
| U-4 | `https://redocly.github.io/redoc/` | JavaScript-rendered SPA | Prod: clear "rendered by JavaScript" message, not "not documentation". Gamma: consent prompt, then rendered via Jina |
| U-5 | `https://www.lua.org/manual/5.4/manual.html` | Site with no robots.txt | Passes; bot access says no robots.txt found, not "10/10 allowed" |
| U-6 | `https://www.reddit.com/dev/api` | Site that blocks AI crawlers | Bot access: all 10 checked crawlers blocked |
| U-7 | `https://library.zoom.com` | Markdown-alternate rescue | Report labelled "Recovered via markdown alternate" |
| U-8 | `https://stripe.com/` | Marketing page / root URL | Rejected with the "doesn't look like a documentation page" card |
| U-9 | `not a url` | Invalid input | "That doesn't look like a valid URL" card |
| U-10 | `https://help.branch.io` | Bare hostname; site behind Cloudflare bot protection (VitePress) | Scan completes (REG-17, REG-18). Added to this table 2026-10-22 |
| U-11 | `https://help.branch.io/account-hub/onboarding-guide` | Docs page behind bot protection | Scan completes, not "unreachable" (REG-18). Strong coding-agent score, freshness 0 (spec two-score-readiness §5) |

---

## Smoke (every PR, ~10 minutes)

| ID | Steps | Expected |
|---|---|---|
| S-01 [auto] | Open home in light theme, then dark theme | Light: white background, dark text. Dark: dark background, light text. Font is Plus Jakarta Sans. No console errors |
| S-02 [auto] | Scan U-1; and a saved two-score report (`report-v2.spec.ts`) | Progress log is **open by default** while scanning; report loads with **two** score cards (AI search, Coding agents), the reachability banner with the six AI search bots, Coding agents selected with two signal groups (Both audiences, Coding agents), points on each signal, the "What an agent receives" preview and a recommendation count. On gamma the live scan must be two-score; a PR build scans gamma's current backend and accepts either view |
| S-03 [auto] | On the report, click **Run citation check** | **Retired while citations are off** (`REACT_APP_CITATIONS_ENABLED=false` in `.env.gamma` and `.env.production`, spec `docs/two-score-readiness/spec.md` §8.3). Meanwhile the check is that no citations card renders. On a build with the flag on: spinner, then a results table: engine column named "Perplexity", High/Mid/Low intent tags, "Cited: X / Y" matches the rows |
| S-04 [auto] | Submit U-9, then U-8, from the home page | Friendly error card on the home page (not raw "HTTP 400"), with Try again / Try another URL / Report an issue |
| S-05 [auto] | `/contact`, submit the empty form | Three separate field messages (URL, name, email); no network request sent |
| S-06 [auto] | At 375px: open the menu; open a two-score report (and, with citations on, run the citation check) | Beta badge shows in the mobile menu; both score cards, the reachability banner and the agent preview fit with no horizontal scroll; with citations on, the Cited/Not cited pill is fully visible |
| S-07 [auto] | Open `/this-page-does-not-exist` | 404 page has header and footer; exactly one `<meta name="robots">` and it says `noindex` |
| S-08 [auto] | After S-02, reload `/results` | The same report is still there, with both scores |
| S-09 [auto] | On a two-score report, click the AI search card, then Coding agents | Each card shows only its score's checks (Both audiences keeps the rows that feed that score; the agent preview shows with Coding agents) |
| S-10 [auto] | Load a report saved before two scores (`report-stripe.json`) at `/results` | The legacy single-score view with "Re-scan to see the new scores" and a Re-scan button; no two-score cards |
| S-11 [auto] | Load a report whose Coding agents score came from AFDocs (`report-stripe-afdocs.json`) | Coding agents card shows that score; Both audiences has "Content without JavaScript" and "Headings an agent can navigate"; the Coding agents group lists every other AFDocs check with points, failing checks first; AI search is unchanged |

## Report download (H-001)

Run against saved fixtures from real gamma scans (`frontend/e2e/fixtures/`, U-1 on 2026-10-13); citation calls are mocked, so these make no paid calls. `report-stripe-v2.json` is that U-1 report with the two-score fields added by the backend's own scoring code from the U-1 page saved on 2026-10-22. DL-03 to DL-05 run only on a build with citations on; DL-07 runs while they are off.

| ID | Steps | Expected |
|---|---|---|
| DL-01 [auto] | Two-score report → **Download report** → Markdown | Saves `lensy-report-<host>-<date>.md` at once, no citation request; front matter has `scoring_version: 2` and both scores; holds both scores, every check with its points, each fix once (REG-25), the six AI search bots, the agent preview, every tip and every signal group on the page (with citations on, every citation query too); plain PASS/WARN/FAIL/INFO words; one `report_download_clicked` and one `_completed`; reloading fires neither again |
| DL-02 [auto] | Same → PDF | A real PDF under 1 MB with the site font embedded. **Manual:** open it; no broken characters, no row split across pages, links work |
| DL-03 [auto] | Report without citations → Markdown, then PDF while waiting | Button shows "Running AI citations, then downloading… Ns"; one `/run-citations` call serves both files; files include the citation table; the citations card fills in; `run_citations_clicked` has `trigger: download` |
| DL-04 [auto] | Citations can't start (`/run-citations` fails) | File still downloads and says "AI citations could not run", never "Not cited" |
| DL-05 [auto] | While waiting, click **Download without citations** | Saves at once; file says citations are not in this report |
| DL-06 [auto] | 375px | The download menu fits on screen |
| DL-07 [auto] | Citations off: download Markdown, then PDF | Both save at once; no `/run-citations` or `/citations/` request; no citations section or `citations:` key in the file |
| DL-08 [auto] | Report saved before two scores → Markdown | The old format: `readiness_score`, the three old signal groups, AI bot access, every recommendation |
| DL-09 [auto] | AFDocs-based report → Markdown and PDF | Markdown has the Coding agents score and every AFDocs check label with points; the PDF prints AFDocs' "→" as "->", never "?" |

## Cookie consent and privacy

Google Analytics may only load on the live site after the visitor accepts in the cookie banner. Every other test starts with analytics already declined (`playwright.config.ts`), so the banner never covers what a test clicks; `consent.spec.ts` starts from a first visit.

| ID | Steps | Expected |
|---|---|---|
| CK-01 [auto] | First visit to `/` → **Decline** → reload | Banner shows; first `consent` command in `dataLayer` is `default` with `analytics_storage: denied`; after Decline the banner is gone, `lensy-analytics-consent` is `denied`, `ga-disable-<id>` is true, and it stays that way after reload; no request to Google Analytics |
| CK-02 [auto] | First visit → **Accept** → reload | Choice saved as `granted`; `consent update granted` in `dataLayer` before and after reload; still no Google Analytics request on a non-live host (REG-14) |
| CK-03 [auto] | Accept → footer **Cookie settings** → **Decline** → open Privacy | Banner reopens; switching saves `denied`, sends `consent update denied` and sets `ga-disable`; the privacy page names Google Analytics, `_ga`, Jina, Perplexity, Amazon Bedrock, 30 days and Cookie settings |
| CK-04 [auto] | 375px | Banner fits on screen with both buttons visible |
| CK-05 [manual] | On perseveranceai.com in a private window: watch the network tab, Accept, then reload; then Cookie settings → Decline | No `googletagmanager.com` request before Accept; `gtag/js` and `collect` requests after; after Decline the `_ga` cookies are gone and no further `collect` requests |

---

## Command-line guide

The `/docs/cli` page (was `/cli`, which now redirects) and the "Command line" section on the home page. Spec: `.context/specs/cli-docs-page.md`. `packages/cli/test/guide.test.ts` also fails when the page and `lensy --help` disagree about an option.

| ID | Steps | Expected |
|---|---|---|
| CLI-01 [auto] | Open `/`, find the Command line section, click **Read the CLI guide** | The section sits before "A few good questions"; the link opens `/docs/cli` |
| CLI-02 [auto] | Open `/docs/cli`; click a side link | The twelve sections are in order; the install command and `lensy-cli/<version>` user agent are shown; the example output shows "Fix these first", and `--verbose` and `--json` are described; the old "local addresses are refused" line is gone; the side link scrolls the section below the header; the bot page link opens `/bot` |
| CLI-03 [auto] | At 375px, light and dark: `/` and `/docs/cli` | No horizontal scroll; the longest command scrolls inside its box and can be focused |
| CLI-04 [manual] | Before approving prod: `npm view @perseverance-ai/lensy dist-tags`, then run the Install commands from the page on a clean machine | The `next` tag exists and every command on the page works as written |
| CLI-05 [auto] | Open `/docs/cli`, find **Save and compare runs**; click its side link | The first-run question, a real comparison (`Since …`, `Fixed:`), the `.lensy` folder layout and `config.json` with `pages` are shown; `--save`, `--no-save` and `--save-dir` are described; saved results are said to stay on the machine; the side link scrolls to the section |
| CLI-06 [auto] | Open `/docs/cli`, find **Check a local build**; click its side link | The `--dir … --site-url … --all` command, a real local result ("58 of 70 points checked", "Not checked here"), the comparison after a fix (`77 → 89 (+12)`) and the preview-not-dev-server note are shown; the side link scrolls to the section |
| CLI-07 [auto] | Open `/docs/cli`, find **Requirements and help** | Node 22+ and npm are named; the tested OS and Node versions are listed; "Open an issue on GitHub" links to the CLI issue form; the email link is `mailto:hello@perseveranceai.com` |

## Regression cases (from real incidents)

| ID | Incident (when, PR) | How to check | Expected |
|---|---|---|---|
| REG-01 [auto] | Light theme rendered dark grey on gamma and prod, looked fine locally (Oct 2026; introduced #30, fixed #31). CRA's CSS minifier merged a Tailwind opacity class (`bg-[var(--bg)]/15`) into the plain `bg-[var(--bg)]` class | On a **production build**, light theme, home page and a report | Page background solid white. **Rule:** don't use Tailwind opacity modifiers (`/15`, `/12`) on arbitrary `var(...)` colours; use `bg-[color-mix(in_srgb,var(--x)_15%,transparent)]` |
| REG-02 [auto] | Real docs rejected as "not documentation" — 200 of 221 rejections in May 2026, mostly enterprise docs (fixed #28) | Scan U-3, U-1, U-2 | All pass the doc check |
| REG-03 [auto] | SPA pages were labelled "not documentation" with no explanation | Scan U-4 | Clear JavaScript-rendered message (prod) or consent prompt + render (gamma) |
| REG-04 | `report.json` overwritten with a summary, losing results on reload (introduced #26, fixed #27) | Scan U-1, reload `/results`; with AWS access, open `sessions/<id>/report.json` in the gamma analysis bucket | Full report after reload; `report.json` has `categories`, `detection`, `recommendations` and `docConfidence` |
| REG-05 [auto: no robots.txt; U-6 manual] | Blocked sites showed a green "allowed" check; no-robots sites showed "10/10 allowed" (redesign) | Jest (`scoring-v2-edges.test.ts`): the saved U-5 responses, which have no robots.txt. Playwright (`regressions.spec.ts`): a saved report for a page with no robots.txt. Manual: scan U-6. Until 2026-11-05 the e2e test scanned U-5 live; lua.org often doesn't answer in time, which failed CI and the gamma gate for reasons unrelated to Lensy | No robots.txt: S1 reads "all 6 allowed (no robots.txt)" and nothing says "N/N allowed". U-6: all blocked |
| REG-06 [auto: once-per-scan; rest manual] | Analytics events dropped in the redesign | DevTools console: `dataLayer` during S-02, S-03, an article read to the end, header Contact, Feedback button | `generate_report_started` and `_completed` once each per scan (no double-fire) — reloading `/results` still re-fires `_completed`, see N-06 below; `article_read_complete` with the right `article_slug`; `contact_link_clicked`; `feedback_widget_opened` |
| REG-07 [auto] | `src/tailwind.css` drifted from its source and lost classes (D-08) | `cd frontend && npm run build:css && git diff --exit-code src/tailwind.css` | No diff. Never hand-edit `src/tailwind.css`; edit `src/index.css` or the components |
| REG-08 [auto] | Generated `/education/*.md` dropped References, a list, and the TL;DR label; sitemap listed `/about` and missed `/how-it-works` (fixed #29) | `curl` each `/education/<slug>.md`, `/sitemap.xml`, `/llms.txt` on gamma | Each `.md` has `## TL;DR` and `## References`; sitemap and llms.txt include `/how-it-works`, not `/about` |
| REG-09 [auto] | Every results page had two conflicting robots tags (fixed #29) | On `/results` after a scan: `document.querySelectorAll('meta[name=robots]')` | Exactly one, `noindex` |
| REG-10 [auto] | Leaving a scan mid-way left `/results` stuck on "waiting" forever | Start a scan, click Education within ~1s, then open `/results` | Redirects home; no stuck page; no false `generate_report_completed` |
| REG-11 [auto] | 404 page rendered without header/footer (fixed #29) | S-07 | Header and footer present |
| REG-12 [auto] | Citations Cited pill clipped at 375px (fixed #29) | S-06 | Pill fully visible; long cited URLs wrap |
| REG-13 [auto] | Reloading `/results` re-fired `generate_report_completed`, inflating GA completions (was N-06; fixed). A reload wipes the module-level dedupe set, so the restored terminal state re-counted | Scan U-1, reload `/results`, watch `dataLayer` | No new `generate_report_completed` on the reload |
| REG-14 [auto] | Test traffic (gamma, localhost, e2e) reached the production GA4 property, and the first page view of each visit was counted twice | Load `/` on gamma or a local build, then open Contact; watch network and `dataLayer` | No request to Google Analytics; exactly one `page_view` per route |
| REG-15 | The audit log couldn't tell customer scans from our own smoke tests, e2e runs and local development, so traction numbers included internal use | After a gamma deploy, open the gamma `AuditLogTable` in DynamoDB and look at the newest rows | Each row has `trafficSource` and `clientOrigin`: the post-deploy smoke scan (`smoke-` session id) and e2e scans are `test`; a scan you start by hand on gamma is `dev` with `clientOrigin` `gamma.perseveranceai.com`; on prod, a scan from the live site is `web` |
| REG-16 [auto] | X/Twitter showed no preview image: its card cache kept a fetch from before `og-image.png` was live. Renamed to `og-image-v2.png` so crawlers fetch fresh | Load `/`, fetch the `og:image` URL | `og:image` and `twitter:image` match; the URL serves a 1200×630 PNG |
| REG-17 [auto] | Bare hostnames without trailing slash (e.g. `help.branch.io`) were rejected as unreachable because `fetch()` failed without a path; `new URL().toString()` now normalizes them | Scan U-10 (`https://help.branch.io`) | Scan completes with a report; not rejected as `unreachable-url` |
| REG-18 [auto] | Sites behind bot protection (Cloudflare) were rejected as "unreachable" because the fetcher pretended to be Chrome (Branch, 2026-10-21). Lensy now sends `Lensy/1.0 (+https://perseveranceai.com/bot)` first and retries once with the browser user agent on 403/429 | Unit (Jest, `backend/lambda/agent-handler/shared/__tests__/fetch-page.test.ts`): mocked `fetch` per user agent. UI (Playwright): mocked scan that fails with `blocked-by-bot-protection`; open `/bot`. On gamma after deploy: scan U-10 and U-11 | Honest 200 = pass; honest 403 + browser 200 = warn (browser fallback); both 403 = `blocked-by-bot-protection`; a network error is never a block. The UI shows "This site's bot protection blocked our checker", never "We couldn't reach that page". `/bot` names the user agent. A two-score report whose server refused the honest agent shows "Reachability warning" and the robots.txt mismatch note (`report-v2.spec.ts`) |
| REG-19 [auto] | Markdown listed in llms.txt never counted as discoverable: `analyzeConsumability` was called with `llmsTxtFound` hardcoded to `false` (found while prototyping two-score readiness, 2026-10-22) | Jest: `tools/__tests__/legacy-fixes.test.ts` and the v2 edge test in `scoring-v2-edges.test.ts` | A `.md` listed in llms.txt is discoverable (v1 `discoveryMethod: llms-txt`; v2 C3 = 15) |
| REG-20 [auto] | A page H1 inside an article `<header>` was ignored because every `<header>` was stripped (Docusaurus, React) | Jest: `legacy-fixes.test.ts`, `scoring-v2-edges.test.ts`, and the `docusaurus-docs` / `react-learn` fixtures | The article H1 counts; a site-chrome header (with a `<nav>`, `role=banner`, `navbar` or `site-header`) is still dropped |
| REG-21 [auto] | `checkUrl` treated any 2xx as found, so an HTML soft-404 could pass as llms.txt, sitemap or `.md` | Jest: `legacy-fixes.test.ts`, `scoring-v2-edges.test.ts` | HTML (by content type or body) is never an llms.txt or `.md`; a sitemap must contain `<urlset>` or `<sitemapindex>` |
| REG-22 [auto] | A network error (DNS, timeout, reset) was reported as "not found" | Jest: `legacy-fixes.test.ts` | One retry, then "couldn't check" (`unknown`), with a re-scan note instead of "No llms.txt found" |
| REG-23 [auto] | The PDF printed the page check's minus sign as "?" ("Feature/benefit grid layout (?1)"): agent-handler writes U+2212, which neither embedded font has (found 2026-10-24) | Playwright (`download.spec.ts`): download the PDF of `report-stripe-v2.json` and read its text | "(-1)" prints; no "(?" anywhere |
| REG-24 [auto] | A PDF heading could end a page with its content on the next one ("Coding agents" alone at the foot of page 1; "All recommendations" too) (found 2026-10-24) | Playwright (`download.spec.ts`): download the PDF, read each page's text | No page ends on a group title, section label or recommendations heading |
| REG-25 [auto] | A two-score Markdown listed every fix twice (Fixes, then "Signals to improve", then again under Signals), and a one-sentence tip printed "Fix: Not scored." (found 2026-10-24) | Playwright (`download.spec.ts`): `report-stripe-v2.json` plus a one-sentence tip; Markdown, PDF and the recommendations view | Each failing check's fix appears once, under Fixes, with its points; no "Signals to improve"; tips sit under "Also worth knowing (not scored)" with no "Fix:" line; "Not scored." appears nowhere. Older reports keep their layout (DL-08) |
| REG-26 [auto] | The floating Feedback button covered page text: the score cards' "N checks to improve" line at 375px (found 2026-10-24), then the scan card and How it works at 1280px (found 2026-11-10) | Playwright (`report-v2.spec.ts`) at 375px and 1280px | The button sits in the header (an icon on phones, "Feedback" from 1024px), is never `position: fixed`, opens its panel under the header and closes with Escape |
| REG-27 [auto] | Scans left AWS from rotating shared IPs, so sites could not safely allowlist Lensy, and Branch's Cloudflare refused every prod scan from Oct 26 (honest 403, browser 403). Dead code also kept an old "Lensy Documentation Quality Auditor" name | Jest: `backend/lib/__tests__/scan-egress.test.ts` (synth: one Elastic IP on the only NAT gateway, S3/DynamoDB gateway endpoints, agent Lambda in the VPC, `LensyEgressIp` output, `SCAN_EGRESS_IP` on the API, `GET /bot-info` route) and `single-user-agent.test.ts` (one Lensy user agent in agent-handler; `/bot-info` advertises the same one). After a gamma deploy: compare the `LensyEgressIp` output with `curl $API/bot-info` | Every scan leaves from the one published IP; every request is named `Lensy/1.0 (+https://perseveranceai.com/bot)` |
| REG-28 [auto] | The blocked-scan card told visitors to allow the `Lensy/1.0` user agent in their bot protection (unsafe: anyone can send that name) and said AI agents may be refused too; `/bot` said Lensy had no fixed IP | Playwright (`regressions.spec.ts`): mocked blocked status; `/bot` with `/bot-info` mocked, failing, and at 375px in both themes | The card says nothing needs changing and links to /bot; `/bot` shows the user agent, the IP, and an allow rule that matches both, and the free-plan IP Access rule option; a Command-line tool section shows the lowercase `lensy-cli/<version>` user agent, says it never retries as a browser, and pairs the user agent with the owner's own runner IP; no `Lensy-CLI` text anywhere |
| REG-29 [auto] | The published prod scan IP could change: the Elastic IP had the default delete policy, so deleting or replacing it would silently break every site owner's allow rule | Jest: `backend/lib/__tests__/scan-egress.test.ts` synthesises prod (EIP `ScanEgressEip` has DeletionPolicy and UpdateReplacePolicy Retain) and gamma (Delete) | The prod IP survives stack changes; the logical ID stays `ScanEgressEip` |
| REG-30 [auto] | The report's first view showed three signal groups, then two after clicking either score card (found 2026-10-29) | Playwright (`report-v2.spec.ts`): open a saved two-score report, check the groups, click AI search twice | Coding agents is selected on arrival; every view shows two groups (Both audiences plus the selected score); clicking the selected card keeps it selected |
| REG-31 [auto] | Minified HTML drops attribute quotes (`<link rel=canonical href=...>`, Docusaurus for one), so the canonical link was missed (-7 on S3). The same regexes also missed unquoted meta robots, meta generator and the Markdown rel=alternate link (found 2026-11-08 in CLI testing) | Jest (`scoring-v2-edges.test.ts`): canonical with double, single and no quotes in either order, a `rel="canonical-x"` decoy, unquoted noindex, generator and rel=alternate | Each is read; a rel that only starts with "canonical" is not one |
| REG-32 [auto] | With no Sitemap: line in robots.txt only /sitemap.xml was tried, so Astro's /sitemap-index.xml and a page's `<link rel="sitemap">` were ignored (-8 on S3) | Jest: a site whose only sitemap is /sitemap-index.xml (an index), and one with only a rel=sitemap link | The page is found in the sitemap; S3 gets the 8 sitemap points |
| REG-33 [auto] | A sitemap under the base path (/docs/sitemap.xml) was never tried | Jest: a site whose only sitemap is under the page's first path segment; plus checks that the search stops at the first sitemap with URLs and that a robots.txt Sitemap: line means no other URL is tried | Found; no extra requests when an earlier candidate or robots.txt answers |
| REG-34 [auto] | S2 (and C1) told a short static page to switch to server-side rendering | Jest: an empty JavaScript shell and a short static page | The shell gets the rendering advice; the static page gets advice to add content, with its word count. S3 and S4 fixes name only what is missing |
| REG-35 [auto] | Every unknown URL on perseveranceai.com returned 200 with the home page shell (soft 404), costing our own Coding agents score 7 points (found 2026-11-10) | Playwright (`site.spec.ts`, SITE-06) | `/this-page-does-not-exist` and `/education/no-such-article` return 404 with the Not found page; `/scan`, `/results` and `/about` still return 200 |
| REG-36 [auto] | `generate-markdown.js` wrote `public/education/*.md` and never deleted old ones, so 5 removed articles stayed live as Markdown (found 2026-11-10) | Playwright (`site.spec.ts`) | `/education/blocking-ai-crawlers.md`, `why-ai-readiness-matters.md` and `text-to-html-ratio.md` return 404 |
| REG-38 [auto] | Page titles split with `<br />` read as one glued word to crawlers and screen readers: "Your docsbelong in theanswer.", "Join thewaitlist." (found by SITE-10, 2026-11-10) | Playwright (`site.spec.ts`): H1 text from the saved HTML, no JavaScript | `/` reads "Your docs belong in the answer."; `/contact`, `/cli`, `/bot`, `/education` keep the space at the line break |
| REG-37 [auto] | Every page reached crawlers as an empty `<div id="root">` with the home page's title and canonical; Lensy scored its own pages 39 Coding agents and 55 AI search (found 2026-11-10) | Playwright (`site.spec.ts`, SITE-03) with a GPTBot user agent and no JavaScript | Each page in sitemap.xml has its own canonical, one H1, H2 sections, `dateModified` in JSON-LD and no "enable JavaScript" text |
| REG-39 [auto] | The site moved to folders (/docs, /learn, /legal) on 2026-11-12. `/bot` is in the user agent of every Lensy request and `/cli` in published CLI READMEs, so old addresses must keep working; a page answering at two addresses (with and without a trailing slash) splits its signals | Playwright (`site.spec.ts`) through `backend/cloudfront/site-router.js` (`serve-build.js` runs the same file) | `/cli`, `/bot`, `/how-it-works`, `/education`, `/education/<slug>`, `/terms`, `/privacy`, `/console` and their `.md` copies answer 301 to the new address, keeping the query string; `/docs/cli/` answers 301 to `/docs/cli`; new pages answer 200 with no redirect |

---

## Site structure and AI readiness

Spec: `.context/specs/site-architecture.md`. `src/site-pages.json` is the page list; `scripts/prerender.js` writes each page's HTML and Markdown, llms.txt, `docs/llms.txt`, `llms-full.txt`, sitemap.xml and robots.txt after the build. The site is in folders: `/docs` (scores, every check with a page each, the command line guide, the Lensy checker), `/learn` (articles), `/legal`. Moved addresses answer 301 at the edge (`backend/cloudfront/site-router.js`, REG-39). Tests in `frontend/e2e/site.spec.ts`.

| ID | Steps | Expected |
|---|---|---|
| SITE-01 [auto] | Read `/sitemap.xml` and `/llms.txt`; open `/` at 1280px and 375px | Every content page in `site-pages.json` and every article is in both, once; `/scan`, `/results`, `/about` aren't. Every check has its own page in the sitemap. Header and mobile menu show Scan, Docs, Learn, Changelog |
| SITE-02 [auto] | Follow only `<a href>` links from `/` in the saved HTML | Every sitemap page is reached within 2 clicks |
| SITE-03 [auto] | Fetch every sitemap page with no JavaScript (REG-37) | Own canonical, one H1, H2 sections, `dateModified`, the `/llms.txt` pointer |
| SITE-04 [auto] | Fetch `<path>.md` (`/index.md` for home) for every page; fetch `/docs/cli` with `Accept: text/markdown` | 200, `text/markdown`, starts with the H1, points to llms.txt in its first lines |
| SITE-05 [auto] | Read `/llms.txt`, `/docs/llms.txt`, `/llms-full.txt` and `/robots.txt` | H1, summary blockquote, Product, Docs, Checks, Learn, Company and Optional sections; `/docs/llms.txt` lists only the docs and checks; `/llms-full.txt` returns 200; every link is a `.md` that returns 200; robots.txt names the sitemap and blocks nothing |
| SITE-06 [auto] | Fetch missing pages (REG-35), including `/learn/<missing>`, `/docs/checks/<missing>` and `/docs/<missing>` | 404 with the Not found page; app routes still 200 |
| SITE-07 [auto] | Open each content page in a browser | No hydration warning (`[Hydrate]` or React errors 418/423/425) |
| SITE-08 [auto] | Open `/` | "Start a free scan" link, "Start scan" button, "N free scans left"; none of the retired four-part model copy |
| SITE-09 [manual] | After deploy: `lensy check` on every gamma page, then prod | Both scores at least 95 on every page; results pasted in the spec |
| DOCS-01 [auto] | Read the sitemap; open `/docs/checks`, click a check, use the docs navigation | Every check in `src/checks.json` has a page; its Markdown has "What it measures and why", "Evidence:" and "How it counts"; the page says "Depends on your hosting." when the check does; the docs navigation marks the current page and only shows under `/docs` |
| DOCS-02 [auto] | Fetch `/index.md`, `/docs/scores.md`, `/learn.md` | No widget labels ("Checking free scans", chart legend, "Reading list", list numbers, "Read"); the home example reads "Before: 39 … after: 100" |
| SEO-01 [auto] | For every sitemap page, read the saved head and the sitemap entry | `<title>`, `meta name="title"` and `og:title` are the same and unique across the site; `og:url` is the canonical; `og:description` is the description; the JSON-LD `dateModified` is the sitemap `<lastmod>` |
| READY-01 [auto] | Open `/` with the history file missing, scroll to "Our own score" | The chart shows the history saved in the page at build time (the live file then, or the seed): it starts at the real Nov 10 baseline and has as many runs as that history; with only the baseline, "Last checked Nov 10, 2026" and no range buttons (`readiness.spec.ts`) |
| READY-02 [auto] | Load 200 daily runs (about 7 months); switch 7D, 1M, 3M, All; hover; arrow keys; Escape | 1Y isn't offered; 7, 30, 91, 200 runs shown; tooltip with date and both scores; one check-change mark and its note; Escape closes the tooltip |
| READY-03 [auto] | Open `/` at 375px with 200 test runs | The chart shows all 200; no horizontal scroll |
| READY-04 [auto] | Fetch `/` without JavaScript, then open it | Saved HTML has `readiness-data` and the "Same checks, on our own site." section; no hydration warning |
| READY-05 [manual] | After the weekly job runs: open `/` on gamma | The new week is in the chart; `/readiness/history.json` is still there after the next deploy |
| CONTENT-01 [auto] | Open `/`, scroll to "What you get" | A real result, before (Nov 10, 2026) and after (Nov 12, 2026), each fix with the score it adds to (+29 Coding agents, +15 AI search) (`content.spec.ts`) |
| CONTENT-02 [auto] | Open `/docs/checks` | One row per check in `src/checks.json`, which `scripts/site-content.test.mjs` keeps equal to `packages/docs/checks.md` |
| CONTENT-03 [auto] | Fetch and open `/about` | 200 with its own canonical, no redirect; five H2 sections; links to the changelog |
| CONTENT-04 [auto] | Open `/changelog`; open `/docs/cli`, click Changelog in the footer | Months newest first, dates in `<time>`, in descending order; footer link works |
| CONTENT-05 [auto] | Open an article | Breadcrumb Home / Learn / title; title and H2s in sentence case |
| SITE-10 [auto] | Open `/docs/scores`, `/docs/checks`, `/contact`, `/learn`, an article; then `/` with no free scans left and start a scan | "The two scores." and "A local build." sections; the AI search points in the check list; Contact has "Talk to us" and "Join the waitlist"; dates in `<time>`, "By Perseverance AI", TL;DR and References headings; "Free scans refresh tomorrow" and the used-up notice with a waitlist link |

## Functional checks by area

Run the sections for whatever your PR touches.

### Report
- [ ] Doc-confidence chip (e.g. "Likely a doc page (99%)") and its signal-count tooltip
- [ ] `robots.txt` link opens the site's real robots.txt in a new tab
- [ ] Per-bot chips have screen-reader labels like "GPTBot (OpenAI): allowed"
- [ ] Each failing signal shows a "Fix:" line, including Breadcrumbs and Headings
- [ ] Impact (High/Medium/Low) shown on failing signals; audience tags (AI search / Coding agents / Both) shown
- [ ] "View all N recommendations": Quick Wins = backend `high` priority only; code snippets render as code blocks; "← Back" returns to the readiness view
- [ ] Header shows the full scanned URL

### Citations
- [ ] Run, results, intent tiers, engine name (S-03)
- [ ] With AWS access: a second run for the same session returns the saved result instead of a new Perplexity call (`/run-citations` answers `status: done`)
- [ ] Results survive a reload of `/results`
- [ ] "Completed in Xs" roughly matches the wait

### Home and errors
- [ ] Start scan button uses the inverse style (same as "Run a free check"), not grey
- [ ] FAQ: each question opens; only one open at a time
- [ ] Error cards (S-04); "Try another URL" clears the input

### Contact
- [ ] Empty submit (S-05)
- [ ] `?ref=llmstxt`, `?ref=markdown`, `?ref=feedback` each show their own heading and button text

### Education
- [ ] Each article renders its TL;DR and References list
- [ ] Prev/next divider line still shows on the first and last article
- [ ] Reading to the end shows the CTA and fires `article_read_complete` (REG-06)

### Accessibility (both themes)
- [ ] Light theme: muted grey text passes WCAG AA (4.5:1) — `--muted` is `#6b6e70`
- [ ] Tab through home and a report: every focusable element shows a visible focus indicator (links/buttons and the URL input get a ring; info icons darken to ink)
- [ ] Links read as active (ink colour + underline), not grey

### Footer and nav
- [ ] Footer has LinkedIn, X, Schedule a conversation, Terms and Policy, Privacy, Cookie settings
- [ ] Beta badge on Lensy in desktop nav and mobile menu (S-06)

---

## Known open issues (don't re-file)

Tracked in the UX review sheet. If one of these changes behaviour, update the
sheet and this list.

- AI citation queries run on an end-of-life Bedrock model and fall back to template queries (N-09) — needs a model decision
- Article pages don't server-render their own title/meta (N-01)
- Reloading `/results` fires `generate_report_completed` again, inflating GA completions (N-06). The v4 sheet marked this fixed; the e2e suite showed on 2026-10-08 that it is not. Its test is `test.fixme` in `frontend/e2e/smoke.spec.ts` until fixed
- Progress log rows have no timestamps; "Analysis complete!" appears twice (T-01)
- Bot chips have no "+N" expander (T-07)
- Logo smaller than prod (P1-05); loader not on the Start scan button (P1-10)
- In generated `.md` files, a section's bullet list renders after its paragraphs even when the source interleaves them
- Open founder decisions: heading scale (D-02), default open/closed states (D-11), chip styling (D-12)
