---
name: pre-cr
description: Full pre-CR sweep — clean, review, test, and validate before raising a code review. Use when the user says pre-cr, pre-review, before CR, ready for review, or CR checklist.
allowed-tools: Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(find:*), Bash(grep:*), Bash(cat:*), Bash(wc:*), Bash(eslint:*), Bash(tsc:*)
---

Run the full pre-CR checklist on all files changed vs `main` (or the default branch). Report results as a GO / NO-GO summary at the end.

---

## Phase 1: Identify Scope

- Run `git diff --name-only main` to list all changed files
- Categorize files: source code, tests, config, documentation, assets
- Count total lines changed: `git diff main --stat`
- **Flag if CR is too large** (>400 lines changed) and suggest logical ways to split it
- List any new files added and any files deleted

---

## Phase 2: Codebase Cleanup

For all changed **source** files (not test files):

- Remove `console.log`, `console.debug`, `console.warn` (non-error), `print()`, `debugger`, `binding.pry`, `dd()`, `var_dump()`, or similar debug statements
- Remove commented-out code blocks (>3 consecutive commented lines)
- Remove leftover `TODO`, `FIXME`, `HACK`, `XXX` comments — these should be tracked as tickets, not left in code
- Remove unused imports, variables, and dead code paths
- Remove hardcoded test data, mock URLs, `localhost` references, or placeholder values (`foo`, `bar`, `test123`)
- Check for merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
- **Secrets scan**: Ensure no `.env` values, API keys, tokens, passwords, private keys, or credentials are committed
- Check that no `.DS_Store`, `Thumbs.db`, `*.log`, or IDE config files (`.idea/`, `.vscode/settings.json`) are staged

---

## Phase 3: Code Quality Review

For all changed source files:

- **Naming**: Verify consistent naming conventions (camelCase, PascalCase, snake_case per project standard)
- **Error handling**: No bare/empty `catch` blocks; errors should be logged or re-thrown
- **DRY**: Flag duplicated logic (>10 similar lines) that should be extracted into shared functions
- **Complexity**: Flag overly complex functions (>50 lines, >3 levels of nesting, cyclomatic complexity concerns)
- **SOLID principles**: Single responsibility check — does any function/class do too many things?
- **Null safety**: Check for proper null/undefined/nil handling; no unguarded property access on nullable values
- **Input validation**: Any new API endpoints or form handlers must validate and sanitize inputs
- **Magic numbers/strings**: Flag hardcoded values that should be constants or config
- **Return early**: Suggest guard clauses where deeply nested if/else can be simplified

---

## Phase 4: Security Scan

- No hardcoded secrets, tokens, passwords, or API keys (check strings, comments, and config files)
- No SQL injection risks (raw string concatenation in database queries)
- No XSS risks (unsanitized user input rendered in HTML/templates)
- Verify authentication and authorization checks on any new or modified endpoints
- No sensitive data (PII, tokens, passwords) in logs or error messages
- Check for insecure HTTP URLs that should be HTTPS
- Run `npm audit` (or equivalent) to check for known dependency vulnerabilities
- Verify no overly permissive CORS, file permissions, or access controls

---

## Phase 5: Unit Tests

- Run the full test suite: `npm test` (or project-specific command)
- **All tests must pass** — report any failures with file and test name
- Check test coverage for changed files — flag any new source code without corresponding tests
- Ensure test names are descriptive (should read as a specification)
- Check for skipped tests: `.skip`, `xit`, `xdescribe`, `@Ignore`, `@Disabled` — remove or justify each one
- Flag flaky or timing-dependent tests (arbitrary `setTimeout`, `sleep`, fixed port numbers)
- Verify tests are testing behavior, not implementation details

---

## Phase 6: Build & Lint Verification

- Run the **build** command — must complete with zero errors
- Run the **linter** — must complete with zero violations
- Run the **type checker** (TypeScript `tsc --noEmit`, Flow, mypy, etc.) — zero type errors
- Run the **formatter** check (Prettier `--check`, Black `--check`, etc.) — confirm code is formatted
- If CI pipeline config exists, verify it would pass locally before pushing

---

## Phase 7: Documentation

Check if any of these apply to the changed files:

- **API changes**: If public API signatures changed (endpoints, function signatures, props) → update README, API docs, or JSDoc/docstrings
- **New environment variables**: Added new env vars → update `.env.example` and document in README
- **New dependencies**: Added packages → verify they're justified (not redundant with existing libraries), note license compatibility
- **Config or setup changes**: Updated build steps, Docker config, or infra → update `CONTRIBUTING.md`, setup docs, or onboarding guide
- **Breaking changes**: Any backwards-incompatible changes → document in CHANGELOG or migration guide
- **Inline comments**: Verify comments explain *why*, not *what* (the code should be self-documenting for *what*)

---

## Phase 8: Git Hygiene

- **Branch name**: Follows convention (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`)
- **Commit messages**: Follow conventional commit format (`feat:`, `fix:`, `chore:`, etc.)
- **Commit cleanliness**: Squash or reword WIP commits — each commit should be a meaningful, atomic unit
- **No large binaries**: No build artifacts, compiled files, images >500KB, or data dumps committed
- **`.gitignore` updated**: If new generated/build files exist, verify `.gitignore` covers them
- **No unrelated changes**: The CR should be focused — flag any changes that don't relate to the stated purpose
- **Rebase on latest main**: Ensure branch is up-to-date with the target branch to avoid merge conflicts

---

## Phase 9: Pre-CR Summary Report

Generate this report:

```
============================================
  PRE-CR READINESS REPORT
  Branch: <branch-name>
  Files changed: <count>
  Lines changed: +<additions> / -<deletions>
============================================

| Phase                | Status | Issues |
|----------------------|--------|--------|
| Codebase Cleanup     | ✅/❌  | ...    |
| Code Quality         | ✅/❌  | ...    |
| Security             | ✅/❌  | ...    |
| Unit Tests           | ✅/❌  | ...    |
| Build & Lint         | ✅/❌  | ...    |
| Documentation        | ✅/❌  | ...    |
| Git Hygiene          | ✅/❌  | ...    |

BLOCKING ISSUES:
- [ ] <issue 1 — file:line>
- [ ] <issue 2 — file:line>

NON-BLOCKING SUGGESTIONS:
- <suggestion 1>
- <suggestion 2>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  VERDICT: ✅ GO  /  ❌ NO-GO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If **NO-GO**: List all blocking issues with exact file names and line numbers. Offer to auto-fix what's possible.
If **GO**: Confirm the CR is ready to submit. Suggest a one-line CR description based on the changes.
