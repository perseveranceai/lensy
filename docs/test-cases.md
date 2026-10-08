# Lensy test cases

A living document. It replaces `v2-test-cases.md` (April 2026), whose expected
results described the pre-redesign UI and no longer hold.

**Every bug that reaches gamma or prod gets a regression case (REG-xx) added
here, in the same PR that fixes it.** That is how this list stays current.

---

## Rules for every test run

1. **Test a production build, never only `npm start`.** The dev server does not
   minify CSS, and minification has broken the site before while it looked
   fine locally (REG-01). Use gamma after merge, or a local production build.
   The automated suite does this for you:
   ```
   cd frontend && npm run test:e2e:local
   ```
2. **Both themes, every time.** Light and dark. A bug that only shows in light
   theme shipped to prod because dark theme hid it (REG-01).
3. **Desktop and 375px mobile.** Several layout bugs only showed on mobile
   (REG-11, REG-12).
4. **Fresh private window.** A tab opened before a deploy can keep serving the
   old JS/CSS bundle and make a working deploy look broken, or the reverse.
5. **Browser console must be clean** (no red errors) on every page you touch.

### What to run when

| When | Run |
|---|---|
| Every PR | Smoke (S-01 to S-08) + the sections for the areas you changed + every REG case for those areas |
| Before approving a prod deploy | Everything in this document |
| After any CSS/Tailwind/theme change | Smoke + REG-01 + REG-07 + the Accessibility section, in both themes |

Paste the IDs you ran and the result into the PR's **Test cases run** section.

### What's automated, and where it runs

Cases marked **[auto]** below have a Playwright test in `frontend/e2e/` with
the same ID in its title. Everything else is checked by hand.

| Where | What runs | Blocks |
|---|---|---|
| Your machine, before committing | `cd frontend && npm run test:e2e:local` — production build, minified-CSS check, then the full e2e suite against it (real scans on the gamma API) | Nothing automatically; the pre-commit hook blocks commits that change product code without changing tests |
| Every PR (CI) | Backend typecheck + CDK synth; frontend production build; minified-CSS check (REG-01); `tailwind.css` drift check (REG-07); test-impact check | The PR shows red; merging is only blocked if branch protection requires these checks |
| After merge to `main` (deploy.yml) | Deploy gamma → wait until gamma serves the new build → smoke scan → **full e2e suite against gamma** | **Prod.** The prod job runs only if all of that passed, and it deploys the frontend bundle built in that same run — it never rebuilds its own |
| After prod deploy | Smoke scan against prod | — |

Notes:
- The suite blocks Google Analytics requests (gamma and prod share one GA4
  property), so test runs never send real analytics.
- Each run makes ~10 real scans and one citation check (paid Perplexity calls).
  Set `E2E_SKIP_CITATIONS=1` to skip the citation test locally.
- There are still no unit tests in the repo.

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

---

## Smoke (every PR, ~10 minutes)

| ID | Steps | Expected |
|---|---|---|
| S-01 [auto] | Open home in light theme, then dark theme | Light: white background, dark text. Dark: dark background, light text. Font is Plus Jakarta Sans. No console errors |
| S-02 [auto] | Scan U-1 | Progress log is **open by default** while scanning; report loads with score, bot access, three signal groups, recommendation count |
| S-03 [auto] | On the report, click **Run citation check** | Spinner, then a results table: engine column named "Perplexity", High/Mid/Low intent tags, "Cited: X / Y" matches the rows |
| S-04 [auto] | Submit U-9, then U-8, from the home page | Friendly error card on the home page (not raw "HTTP 400"), with Try again / Try another URL / Report an issue |
| S-05 [auto] | `/contact`, submit the empty form | Three separate field messages (URL, name, email); no network request sent |
| S-06 [auto] | At 375px: open the menu; scan U-1 and run the citation check | Beta badge shows in the mobile menu; the Cited/Not cited pill is fully visible |
| S-07 [auto] | Open `/this-page-does-not-exist` | 404 page has header and footer; exactly one `<meta name="robots">` and it says `noindex` |
| S-08 [auto] | After S-02, reload `/results` | The same report is still there |

---

## Regression cases (from real incidents)

| ID | Incident (when, PR) | How to check | Expected |
|---|---|---|---|
| REG-01 [auto] | Light theme rendered dark grey on gamma and prod, looked fine locally (Oct 2026; introduced #30, fixed #31). CRA's CSS minifier merged a Tailwind opacity class (`bg-[var(--bg)]/15`) into the plain `bg-[var(--bg)]` class | On a **production build**, light theme, home page and a report | Page background solid white. **Rule:** don't use Tailwind opacity modifiers (`/15`, `/12`) on arbitrary `var(...)` colours; use `bg-[color-mix(in_srgb,var(--x)_15%,transparent)]` |
| REG-02 [auto] | Real docs rejected as "not documentation" — 200 of 221 rejections in May 2026, mostly enterprise docs (fixed #28) | Scan U-3, U-1, U-2 | All pass the doc check |
| REG-03 [auto] | SPA pages were labelled "not documentation" with no explanation | Scan U-4 | Clear JavaScript-rendered message (prod) or consent prompt + render (gamma) |
| REG-04 | `report.json` overwritten with a summary, losing results on reload (introduced #26, fixed #27) | Scan U-1, reload `/results`; with AWS access, open `sessions/<id>/report.json` in the gamma analysis bucket | Full report after reload; `report.json` has `categories`, `detection`, `recommendations` and `docConfidence` |
| REG-05 [auto: U-5; U-6 manual] | Blocked sites showed a green "allowed" check; no-robots sites showed "10/10 allowed" (redesign) | Scan U-6 and U-5 | U-6: all blocked. U-5: "no robots.txt found" wording |
| REG-06 [auto: once-per-scan; rest manual] | Analytics events dropped in the redesign | DevTools console: `dataLayer` during S-02, S-03, an article read to the end, header Contact, Feedback button | `generate_report_started` and `_completed` once each per scan (no double-fire) — reloading `/results` still re-fires `_completed`, see N-06 below; `article_read_complete` with the right `article_slug`; `contact_link_clicked`; `feedback_widget_opened` |
| REG-07 [auto] | `src/tailwind.css` drifted from its source and lost classes (D-08) | `cd frontend && npm run build:css && git diff --exit-code src/tailwind.css` | No diff. Never hand-edit `src/tailwind.css`; edit `src/index.css` or the components |
| REG-08 [auto] | Generated `/education/*.md` dropped References, a list, and the TL;DR label; sitemap listed `/about` and missed `/how-it-works` (fixed #29) | `curl` each `/education/<slug>.md`, `/sitemap.xml`, `/llms.txt` on gamma | Each `.md` has `## TL;DR` and `## References`; sitemap and llms.txt include `/how-it-works`, not `/about` |
| REG-09 [auto] | Every results page had two conflicting robots tags (fixed #29) | On `/results` after a scan: `document.querySelectorAll('meta[name=robots]')` | Exactly one, `noindex` |
| REG-10 [auto] | Leaving a scan mid-way left `/results` stuck on "waiting" forever | Start a scan, click Education within ~1s, then open `/results` | Redirects home; no stuck page; no false `generate_report_completed` |
| REG-11 [auto] | 404 page rendered without header/footer (fixed #29) | S-07 | Header and footer present |
| REG-12 [auto] | Citations Cited pill clipped at 375px (fixed #29) | S-06 | Pill fully visible; long cited URLs wrap |

---

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
- [ ] Footer has LinkedIn, X, Schedule a conversation, Terms and Policy, Privacy
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
