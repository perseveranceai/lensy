#!/usr/bin/env bash
# Pre-CR check: makes sure a branch's tests cover its changes, and that they
# pass on a production build, before the branch is pushed for review.
#
# Runs automatically on `git push` (.githooks/pre-push, installed by
# `npm install` in frontend/). Run it by hand any time with:
#   cd frontend && npm run pre-cr
#
# What it does:
#   1. No product-code changes on this branch → nothing to do.
#   2. Your coding agent (Claude Code or Kiro, whichever is installed) reads the
#      branch diff and adds/updates e2e tests. Prompt: scripts/pre-cr-prompt.md.
#        - tests changed     → push stops so you can review + commit them
#        - covered / no impact → continue
#        - can't tell        → push stops and asks you to check the tests
#   3. Production build + minified-CSS check + full e2e suite. Pass → push.
#
# Overrides:
#   PRE_CR_CONFIRMED=1 git push   you've checked the tests yourself; skip the
#                                 agent step, still run the suite
#   PRE_CR_AGENT=claude|kiro|none pick the agent (default: whichever exists)
#   SKIP_PRE_CR=1 git push        skip everything (PR CI still runs the suite)
set -u

[ "${SKIP_PRE_CR:-}" = "1" ] && { echo "pre-cr: skipped (SKIP_PRE_CR=1). PR CI will still run the e2e suite."; exit 0; }

ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
STATE_DIR="$(git rev-parse --git-dir)/pre-cr"
mkdir -p "$STATE_DIR"

PRODUCT_RE='^(frontend/src/|frontend/public/index\.html$|backend/lambda/|backend/lib/)'
TEST_RE='^(frontend/e2e/|docs/test-cases\.md$)'

say()  { printf '\npre-cr: %s\n' "$*"; }
fail() { printf '\npre-cr: %s\n\n' "$*" >&2; exit 1; }

git fetch -q origin main 2>/dev/null || say "couldn't fetch origin/main; comparing against the local copy"
BASE=$(git merge-base HEAD origin/main) || fail "can't find the merge base with origin/main"

product=$(git diff --name-only "$BASE"...HEAD | grep -E "$PRODUCT_RE" | grep -v '^frontend/src/tailwind\.css$' || true)
if [ -z "$product" ]; then
  say "no product-code changes on this branch — nothing to test."
  exit 0
fi

# What gets tested must be exactly what gets pushed.
dirty=$(git status --porcelain --untracked-files=no -- frontend backend docs/test-cases.md)
[ -n "$dirty" ] && fail "commit or stash these first, so the tested code is the pushed code:
$dirty"

TREE=$(git rev-parse 'HEAD^{tree}')
if [ "$(cat "$STATE_DIR/passed" 2>/dev/null)" = "$TREE" ]; then
  say "this exact code already passed the pre-CR check — pushing."
  exit 0
fi

# ── Step 1: the coding agent brings the tests up to date ─────────────────────
DIFF_HASH=$(git diff "$BASE"...HEAD -- $product | git hash-object --stdin)

pick_agent() {
  case "${PRE_CR_AGENT:-}" in
    claude|kiro|none) echo "$PRE_CR_AGENT"; return ;;
  esac
  if command -v claude >/dev/null 2>&1; then echo claude
  elif command -v kiro-cli >/dev/null 2>&1; then echo kiro
  else echo none; fi
}

if [ "${PRE_CR_CONFIRMED:-}" = "1" ]; then
  say "PRE_CR_CONFIRMED=1 — you've checked the tests; skipping the agent step."
elif [ "$(cat "$STATE_DIR/agent-diff" 2>/dev/null)" = "$DIFF_HASH" ]; then
  say "tests were already brought up to date for these changes — skipping the agent step."
else
  AGENT=$(pick_agent)
  # Pushed from inside a Claude Code session (an engineer's agent ran
  # `git push`): Claude won't start a nested copy of itself, so hand the job to
  # the agent that's already running — it reads this output and acts on it.
  if [ "$AGENT" = "claude" ] && [ -n "${CLAUDECODE:-}" ]; then
    fail "this push came from a Claude Code session, so the test update is yours to do:
  1. Follow scripts/pre-cr-prompt.md for this branch's changes:
       git diff \$(git merge-base HEAD origin/main)...HEAD -- $(printf '%s ' $product)
  2. Add or update the tests in frontend/e2e/ (and docs/test-cases.md for a REG case).
  3. Commit them, then push again with:  PRE_CR_CONFIRMED=1 git push
     (the full e2e suite still runs on that push)."
  fi
  if [ "$AGENT" = "none" ]; then
    tests_on_branch=$(git diff --name-only "$BASE"...HEAD | grep -E "$TEST_RE" || true)
    [ -z "$tests_on_branch" ] && fail "this branch changes product code, no tests changed, and no coding agent
(claude or kiro-cli) is installed to update them automatically.
Check that frontend/e2e/ covers your change, then push with PRE_CR_CONFIRMED=1."
  else
    PROMPT_FILE="$STATE_DIR/prompt.md"
    {
      cat scripts/pre-cr-prompt.md
      printf '\n## Changed product files\n\n%s\n\n## Diff (branch vs main, may be truncated)\n\n```diff\n' "$product"
      git diff "$BASE"...HEAD -- $product | head -c 80000
      printf '\n```\n'
    } > "$PROMPT_FILE"

    say "asking $AGENT to update the e2e tests for this branch (takes a minute or two)…"
    LOG="$STATE_DIR/agent.log"
    # Snapshot the working tree so we only ever act on what the agent changed —
    # never on the engineer's own untracked or uncommitted files.
    git status --porcelain --untracked-files=all | sort > "$STATE_DIR/before"
    case "$AGENT" in
      claude) claude -p --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Grep,Glob" \
                < "$PROMPT_FILE" > "$LOG" 2>&1 ;;
      kiro)   kiro-cli chat --no-interactive --trust-tools=read,write,grep,glob "$(cat "$PROMPT_FILE")" \
                > "$LOG" 2>&1 ;;
    esac

    # Paths the agent changed = status entries that weren't there before it ran.
    git status --porcelain --untracked-files=all | sort > "$STATE_DIR/after"
    agent_changed=$(comm -13 "$STATE_DIR/before" "$STATE_DIR/after" | awk '{print $NF}')

    # The agent may only touch tests. Put back anything else it changed.
    stray=$(printf '%s\n' "$agent_changed" | grep -vE "$TEST_RE" | grep -v '^$' || true)
    if [ -n "$stray" ]; then
      say "the agent touched files outside the tests; reverting them:"
      printf '  %s\n' $stray
      for f in $stray; do
        if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then git checkout -- "$f"; else rm -f "$f"; fi
      done
    fi

    verdict_line=$(grep -E 'PRE_CR_VERDICT:' "$LOG" | tail -1)
    verdict=$(printf '%s' "$verdict_line" | sed -E 's/.*PRE_CR_VERDICT:[[:space:]]*([A-Z_]+).*/\1/')
    changed_tests=$(printf '%s\n' "$agent_changed" | grep -E "$TEST_RE" || true)

    if [ -n "$changed_tests" ]; then
      printf '%s\n' "$DIFF_HASH" > "$STATE_DIR/agent-diff"
      fail "$AGENT updated the tests for your change:
$(printf '  %s\n' $changed_tests)
${verdict_line:+$verdict_line
}Review them (git diff), commit them, and push again — the next push runs the suite.
Full agent output: $LOG"
    fi

    # Never take the agent's word for it: files are the truth. An agent whose
    # writes were blocked can still *say* it updated tests (Kiro did, in our
    # first trial run), which would let an untested change through.
    if grep -qE '^\[denied\]|permission approval is not supported|writes are blocked' "$LOG"; then
      fail "$AGENT was blocked from editing files, so the tests were NOT updated. Its output:
$(grep -E '^\[denied\]|blocked' "$LOG" | head -5)
Full output: $LOG"
    fi

    case "$verdict" in
      TESTS_UPDATED)
        fail "$AGENT said it updated the tests, but no test file changed — nothing was actually written.
$verdict_line
Full output: $LOG
Check the tests cover your change, then push with PRE_CR_CONFIRMED=1." ;;
      ALREADY_COVERED|NO_TEST_IMPACT)
        say "$verdict_line"
        printf '%s\n' "$DIFF_HASH" > "$STATE_DIR/agent-diff" ;;
      NEEDS_HUMAN)
        fail "$AGENT couldn't work out how to test this change on its own:
$(tail -25 "$LOG")
Check the tests cover your change (add or fix them in frontend/e2e/), then
push again — or push with PRE_CR_CONFIRMED=1 if they're already right." ;;
      *)
        fail "$AGENT didn't return a verdict. Last lines of its output:
$(tail -15 "$LOG")
Check the tests cover your change, then push with PRE_CR_CONFIRMED=1." ;;
    esac
  fi
fi

# ── Step 2: production build + CSS check + full e2e suite ─────────────────────
say "building for production and running the e2e suite (a few minutes; real scans on the gamma API)…"
[ -d frontend/node_modules ] || (cd frontend && npm ci) || fail "npm ci failed in frontend/"

restore_generated() {
  # The build regenerates these from source; put the committed copies back so
  # the build doesn't leave the working tree dirty.
  git checkout -- frontend/public/sitemap.xml frontend/public/llms.txt frontend/public/robots.txt frontend/public/education 2>/dev/null || true
}

( cd frontend && E2E_SKIP_CITATIONS=1 npm run --silent test:e2e:local )
status=$?

if ! git diff --quiet -- frontend/src/tailwind.css; then
  restore_generated
  fail "frontend/src/tailwind.css is out of date with frontend/src/index.css.
The build just regenerated it — commit the regenerated file and push again.
(Never hand-edit tailwind.css; see AGENTS.md.)"
fi
restore_generated

[ $status -ne 0 ] && fail "the e2e suite failed (details above; report: frontend/playwright-report).
Fix the code or the test, commit, and push again."

printf '%s\n' "$TREE" > "$STATE_DIR/passed"
say "all checks passed — pushing."
exit 0
