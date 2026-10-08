---
inclusion: always
---

# Tests ship with the code

Follow the project rules in AGENTS.md. When you change product code, write or
update the matching e2e test in `frontend/e2e/` in the same commit; bug fixes
get a REG-xx regression test. The pre-push hook (`scripts/pre-cr.sh`) checks
and fills gaps automatically, then runs the full suite on a production build.

#[[file:AGENTS.md]]
