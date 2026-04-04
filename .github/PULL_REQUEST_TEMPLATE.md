## Description

<!-- What does this CR do? One paragraph max. Link to the ticket/story. -->

**Ticket**: [JIRA/Linear link]

## Type of Change

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (fix or feature that causes existing functionality to change)
- [ ] ♻️ Refactor (code change that neither fixes a bug nor adds a feature)
- [ ] 📝 Documentation (changes to docs only)
- [ ] 🔧 Config/Infra (CI, build, deployment, environment changes)

## What Changed

<!-- Bullet list of key changes. Keep it concise — the diff tells the full story. -->

-
-
-

## Why

<!-- What problem does this solve? What was the motivation? -->

## How to Test

<!-- Step-by-step instructions for the reviewer to verify the changes. -->

1.
2.
3.

## Screenshots / Recordings

<!-- If UI changes, attach before/after screenshots or a short recording. Delete this section if not applicable. -->

| Before | After |
|--------|-------|
|        |       |

## Pre-CR Checklist

_Run `/pre-cr` in Claude Code to auto-verify these._

### Cleanup
- [ ] No debug statements (`console.log`, `debugger`, `print`, etc.)
- [ ] No commented-out code blocks
- [ ] No leftover TODO/FIXME (tracked as tickets instead)
- [ ] No hardcoded test data, mock URLs, or localhost references
- [ ] No merge conflict markers
- [ ] No secrets, API keys, or credentials committed

### Code Quality
- [ ] Consistent naming conventions
- [ ] Proper error handling (no bare catch blocks)
- [ ] No duplicated logic that should be shared
- [ ] Functions are focused and not overly complex
- [ ] Null/undefined handled properly
- [ ] Input validated on new endpoints

### Security
- [ ] No hardcoded secrets or tokens
- [ ] No SQL injection or XSS vulnerabilities
- [ ] Auth/authz checks present on new endpoints
- [ ] No sensitive data in logs or error messages
- [ ] `npm audit` (or equivalent) clean

### Tests
- [ ] All existing tests pass
- [ ] New code has corresponding unit tests
- [ ] No skipped tests (`.skip`, `xit`) left behind
- [ ] Test names are descriptive

### Build & Lint
- [ ] Build succeeds with zero errors
- [ ] Linter passes with zero violations
- [ ] Type checker passes (if applicable)
- [ ] Code formatter verified

### Documentation
- [ ] README updated (if public API changed)
- [ ] `.env.example` updated (if new env vars added)
- [ ] New dependencies justified and documented
- [ ] CHANGELOG updated (if breaking changes)

### Git Hygiene
- [ ] Branch name follows convention (`feat/`, `fix/`, `chore/`)
- [ ] Commit messages follow conventional commit format
- [ ] WIP commits squashed
- [ ] No large binaries or build artifacts committed
- [ ] Branch rebased on latest `main`

## Dependencies

<!-- List any new packages added and why. Delete if none. -->

| Package | Version | Purpose |
|---------|---------|---------|
|         |         |         |

## Environment Changes

<!-- New env vars, config changes, infra updates. Delete if none. -->

| Variable | Required | Description |
|----------|----------|-------------|
|          |          |             |

## Rollback Plan

<!-- How do we undo this if something goes wrong in production? -->

## Reviewer Notes

<!-- Anything specific you want the reviewer to focus on? Known tradeoffs? Areas of uncertainty? -->
