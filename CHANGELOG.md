# Changelog

All notable changes to the Lensy Documentation Auditor project will be documented in this file.

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
