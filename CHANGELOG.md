# Changelog

All notable changes to the Lensy Documentation Auditor project will be documented in this file.

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
