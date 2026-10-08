---
inclusion: always
---

# Tests before commit

Follow the project rules in AGENTS.md, especially "Tests before commit":
every product-code change updates `docs/test-cases.md` and `frontend/e2e/`,
and runs `cd frontend && npm run test:e2e:local` before committing.

#[[file:AGENTS.md]]
