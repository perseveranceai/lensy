# Changelog

All notable changes to the Lensy Documentation Auditor project will be documented in this file.

## [Unreleased]

### Added
- **Two-score report page**: two score cards (AI search, Coding agents) replace the score and citations cards; clicking a card filters the checks to that score. A reachability banner (honest-agent status, the six AI search bots, the robots.txt/server mismatch warning) replaces the bot-access banner. Checks are grouped as Both audiences, Coding agents and AI search, each with points out of its max and its fix, plus a "What an agent receives" preview and unscored tips. Recommendations come from the scored checks. Reports saved before v2 keep the old view with a re-scan note (S-02, S-06, S-08 to S-10).
- **Downloads show both scores**: Markdown and PDF carry both scores, reachability, the agent preview and the new groups (DL-01, DL-02); older reports download in the old format (DL-08).
- **Citations flag**: `REACT_APP_CITATIONS_ENABLED`, off in `.env.gamma` and `.env.production`. Off hides the citations card and views, and downloads never run citations (DL-07). S-03 and DL-03 to DL-05 run on a build with the flag on.
- **Feedback carries both scores**: the feedback widget sends the scanned URL and both scores from a report page, and the feedback email prints them.
- **Scoring v2 backend (two readiness scores)**: `report.json` now carries `scoringVersion: 2`, `scores.codingAgents` (C1-C6), `scores.aiSearch` (S1-S6), a reachability `gate` (pass/warn), tips and an agent-preview summary, per `docs/two-score-readiness/spec.md`. `overallScore` is now the AI search score; `scoreBreakdown` is kept for the current UI. Audit rows add `codingScore`, `searchScore` and `scoringVersion`.
- **Scoring fixtures**: saved responses for the 15 spec pages and `backend/scripts/capture-fixtures.mjs`; tests require the prototype's points for every check.
- **`/bot` page**: what the Lensy checker is, its user agent and how to allow it through bot protection.
- **Backend unit tests** (Jest, `backend/**/__tests__/`), run by the pre-push hook and PR CI. First test: REG-18.
- **Cookie banner**: Google Analytics loads only after the visitor accepts; consent mode starts as denied, Decline sets `ga-disable` and removes `_ga` cookies, and **Cookie settings** in the footer changes the choice (CK-01 to CK-05).

### Fixed
- **REG-19**: Markdown listed in llms.txt now counts as discoverable (was hardcoded off).
- **REG-20**: an H1 inside an article `<header>` is counted; only site-chrome headers are dropped.
- **REG-21**: HTML soft-404s no longer pass as llms.txt, sitemap or `.md`.
- **REG-22**: network errors are "couldn't check", not "not found".
- **REG-23**: the PDF prints the page check's minus sign as "-" instead of "?".
- **REG-24**: a PDF heading always starts the page its content is on.
- **REG-25**: two-score downloads list each fix once, under Fixes with its points; tips have no "Fix: Not scored." line (Markdown, PDF and the page).
- **REG-26**: on phones the Feedback button is a small icon in the bottom-right corner, so it no longer covers the score cards.
- **pre-cr**: installs the lambda packages (`npm run install:lambdas`, as CI does) when any are missing, so the backend unit tests can run on a fresh clone.

### Changed
- **Fix text for llms.txt and .md copies**: when the file exists but loses points, the fix says which part (too large, broken links, wrong format, or a .md copy nothing points to) instead of how to publish one.
- **How it works and research copy**: the analysis tiles read AI search, Coding agents and Reachability; "two scores out of 100"; the unsupported "JSON-LD increases rich snippet visibility by 20 to 30%" claim is replaced with the Ahrefs controlled study.
- **Honest fetcher (REG-18)**: Lensy now sends `Lensy/1.0 (+https://perseveranceai.com/bot)` first and retries once with the browser user agent on 403/429. Sites whose bot protection refuses both end with `blocked-by-bot-protection` and a "bot protection blocked our checker" card instead of "unreachable". Audit rows add `submittedUrl`, `finalUrl`, `httpStatus` and `ipHash`; the privacy page says so.
- **Privacy page rewritten** to match the code: names Jina Reader, Perplexity, Amazon Bedrock, Google Analytics and Google Fonts; describes the contact form, feedback and hashed-IP usage limit; states real retention periods. Removed the unused `PrivacyPolicy.tsx` copy.
- **Scan files expire after 30 days**: lifecycle rule on the analysis bucket, which the privacy page now promises.

## [2.0.1] — 2026-04-07

### Fixed
- **Discoverability spinner bug**: stripped `fullContent` (entire llms.txt file) from WebSocket payload — was exceeding API Gateway's 128KB frame limit, causing the discoverability card to show an infinite spinner on sites with large llms.txt files (dub.co, infisical, appwrite, tinybird, gitbook)
- **WebSocket payload guard**: added 120KB safety limit in ProgressPublisher to truncate oversized payloads before sending, preventing silent card rendering failures

## [2.0.0] — 2026-04-05

### Added
- **3-phase detection engine**: harvestSignals → executeProbes → crossReference pipeline with evidence-aware analysis for structured data, discoverability, and consumability
- **Detection types**: new `DetectionReport`, `DetectionSignal`, and evidence classification system (verified, advertised, mapped, not_verified, experimental)
- **Prefetched HTTP headers**: agent pipeline now captures and passes response headers to readiness tool, enabling Link header detection for llms.txt hints
- **Recommendations layout**: three vertically stacked sections — Quick Wins, Deeper Improvements, Things to Watch — each in distinct inner container boxes, hidden when empty
- **Test cases doc**: `docs/v2-test-cases.md` with 20 manual test cases and smoke test checklist

### Changed
- **Score/grade removal**: removed grade letter, score numbers, /20 /40 denominators, +pts badges, and grade scale bar from UI — scoring math was inaccurate, commented out for future fix
- **Hero card**: replaced grade display with centered "AI Readiness" title + contextual summary line
- **Anchor tags**: monochrome underlined links throughout (replaced blue accent color)
- **Markdown recommendation**: moved from Deeper Improvements to Things to Watch (priority changed from 'low' to 'best-practice')

### Fixed
- **Link header false negatives**: prefetched HTTP headers were discarded in agent.ts, causing detection engine to miss `Link: </llms.txt>; rel="llms-txt"` headers entirely
- **Best-practice leak**: recommendations with priority 'best-practice' were appearing in Deeper Improvements instead of Things to Watch
- **TypeScript errors**: fixed `mcpConfig` → `mcpJson` property name, added explicit type annotation for 'best-practice' priority union

### Removed
- Dead `generateContextualSuggestions` function and unused `invokeBedrockForJson` import from generate-report.ts
- Unused `DetectionSignal` import from check-ai-readiness.ts
- Mock test files (`mock-bot-access.html`)

---

## [Unreleased] - 2026-01-12

### Added
- **Fix Generation Pipeline**: Integrated Bedrock (Claude 3.5 Sonnet v2) for generating precise documentation fixes.
- **Fix Review UI**: New side-by-side diff viewer for reviewing and selectively applying AI-generated fixes.
- **CloudFront Integration**: Automated cache invalidation after documentation updates to ensure immediate freshness.
- **Progress Tracking**: Enhanced real-time progress messages for generation and application phases.
- **UX Improvements**: Added dedicated "Generating..." and "Applying..." statuses to the main action button.
- **Re-scan Prompt**: UI now encourages a fresh scan after fixes are applied to verify results.
- **Automated Doc Changelog**: `FixApplicator` now automatically updates/creates a `CHANGELOG.md` in the documentation bucket whenever a file is modified.
- **Stability Fixes**: Enhanced `FixApplicator` with robust string substitution and detailed transition logging.
- **UI Architecture**: Resolved React DOM nesting errors in the fix review components.

### Changed
- **Brand Neutralization**: Removed WordPress-specific logos and terminology across backend analysis and frontend UI.
- **Refinement**: Simplified results UI to focus on a "Top 5 Issues" list with checkboxes.
- **IAM Security**: Updated Lambda roles to support Bedrock Cross-Region Inference Profiles and S3 bucket listing.

### Fixed
- **S3 "Key does not exist"**: Resolved API Gateway V2 payload parsing issues in `FixGenerator` and `FixApplicator`.
- **Bedrock Access**: Aligned model IDs across services to use Claude 3.5 Sonnet v2 consistently.
- **Polling Loop**: Fixed missing dependencies and worker bundling in the frontend analysis engine.
- **Permission Errors**: Resolved various IAM and CloudFront/S3 policy mismatches causing 403/Forbidden errors.

---
*Note: This changelog tracks the evolution of the brand-neutral Lensy pilot.*
