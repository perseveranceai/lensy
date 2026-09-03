# Engineering Environment Setup

Audience: a new engineer getting a working Lensy dev environment, with **no AWS admin rights**.
This complements two existing Notion docs — it doesn't replace them:
- **"AI & LLM Onboarding Plan (v3)"** — the 2-week AI/LLM training curriculum and check-in cadence.
- **"Lensy — Start Here (Team Onboarding Overview)"** — product, architecture, and business context.

This doc is the missing piece: exact steps and exact versions to stand up, run, and test the environment — nothing to reverse-engineer from someone else's machine.

---

## 1. Access provisioning (owner: Rakesh)

| Surface | How it gets granted | Who does it |
|---|---|---|
| GitHub (`perseveranceai/lensy`) | Invite as **Write** collaborator (not Admin/Maintain) | Can be done for you once you have his email or GitHub username — no manual steps needed |
| Notion | Workspace → Settings & members → **Invite members** → paste email → role **Member** → share "Start Here", "AI & LLM Onboarding Plan", and this doc | Manual — Notion's API has no invite-a-new-member endpoint |
| AWS (scoped IAM user, §3) | Create IAM user + attach the Tier 1 policy below | Manual — creating credentials/identity isn't something to automate even with sign-off |
| Kiro IDE (billed to AWS credits) | See §4 — either self-serve (his own bill) or IAM Identity Center (your AWS bill/credits) | Manual, account-level |
| Claude Code seat | Self-serve signup, or add to your Team plan if you have one | Manual |

---

## 2. Exact local toolchain

This is what's actually installed and used to build/run/deploy Lensy today. Match these, don't guess:

| Tool | Version | Install |
|---|---|---|
| Node.js | v23.11.0 | `nvm install 23.11.0 && nvm use 23.11.0` |
| npm | 10.9.2 | ships with the Node install above |
| AWS CLI | 2.27.21 | [AWS CLI v2 install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |
| AWS CDK | 2.1100.1 | not installed globally — the repo calls it via `npx cdk`, so nothing to install separately |
| git | 2.48.1 | Xcode Command Line Tools or `brew install git` |
| OS used day-to-day | macOS (Apple Silicon) | not a hard requirement — Linux/Intel work too, paths below are the same |

No `.nvmrc` or `engines` field is checked into the repo, so there's no automatic version guard — these versions are the ones known to work.

---

## 3. AWS IAM — scoped to gamma, no admin

Two tiers. Start with Tier 1 only; add Tier 2 later once you trust them with infra changes. Run these yourself (or hand to whoever owns the AWS account) — this is identity/security config, not something to script on your behalf.

### Tier 1 — code iteration only (start here)

Lets them push Lambda code changes directly to **gamma** functions (the "Direct Lambda Deployment" path already documented in the [README](../README.md#direct-lambda-deployment)) and read logs — no CloudFormation, no IAM, no prod.

```bash
aws iam create-user --user-name lensy-eng-gamma

cat > /tmp/lensy-gamma-tier1-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UpdateGammaLambdaCodeOnly",
      "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:InvokeFunction"],
      "Resource": "arn:aws:lambda:us-east-1:951411676525:function:LensyStack-gamma-*"
    },
    {
      "Sid": "ReadGammaLogs",
      "Effect": "Allow",
      "Action": ["logs:GetLogEvents", "logs:DescribeLogStreams", "logs:DescribeLogGroups", "logs:FilterLogEvents"],
      "Resource": "arn:aws:logs:us-east-1:951411676525:log-group:/aws/lambda/LensyStack-gamma-*:*"
    },
    {
      "Sid": "ReadGammaDataForDebugging",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:us-east-1:951411676525:table/LensyStack-gamma-*"
    },
    {
      "Sid": "ConsoleReadOnlyForOrientation",
      "Effect": "Allow",
      "Action": ["cloudformation:DescribeStacks", "cloudformation:DescribeStackResources", "lambda:ListFunctions", "dynamodb:ListTables", "s3:ListBucket", "cloudwatch:GetMetricData"],
      "Resource": "*"
    }
  ]
}
EOF

aws iam put-user-policy --user-name lensy-eng-gamma --policy-name lensy-gamma-tier1 --policy-document file:///tmp/lensy-gamma-tier1-policy.json

# CLI access
aws iam create-access-key --user-name lensy-eng-gamma
# hand him the AccessKeyId/SecretAccessKey out of band (not over Slack/email in plaintext if avoidable)

# Console access (optional, if he'll ever click around the AWS console)
aws iam create-login-profile --user-name lensy-eng-gamma --password '<temporary-password>' --password-reset-required
```

Then require MFA on that console login (Console → IAM → Users → lensy-eng-gamma → Security credentials → Assign MFA device — no CLI shortcut for this one).

Exact Lambda/table names come from `aws cloudformation describe-stack-resources --stack-name LensyStack-gamma` — tighten the `LensyStack-gamma-*` wildcards to exact ARNs if you want it stricter.

### Tier 2 — CDK deploys (add later, once trusted)

Don't grant broad `cloudformation:*` / `dynamodb:CreateTable` / etc. directly — that's effectively admin. Your account is already `cdk bootstrap`-ed, which created deploy roles his user can be allowed to **assume**, while the roles themselves stay scoped to CloudFormation's own service principal:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AssumeCdkGammaDeployRoles",
    "Effect": "Allow",
    "Action": "sts:AssumeRole",
    "Resource": [
      "arn:aws:iam::951411676525:role/cdk-hnb659fds-deploy-role-951411676525-us-east-1",
      "arn:aws:iam::951411676525:role/cdk-hnb659fds-file-publishing-role-951411676525-us-east-1",
      "arn:aws:iam::951411676525:role/cdk-hnb659fds-lookup-role-951411676525-us-east-1"
    ]
  }]
}
```

This gives real `cdk deploy` ability for `LensyStack-gamma` without ever putting `iam:*`, `dynamodb:*`, etc. directly on his user. (`hnb659fds` is the default CDK bootstrap qualifier — confirm yours with `aws cloudformation describe-stacks --stack-name CDKToolkit`.)

**Full `cdk deploy` to gamma stays a PR + your explicit go-ahead**, same as today — Tier 2 is about *being able to*, not *being expected to* run it unsupervised.

---

## 4. Kiro IDE — getting it billed to AWS credits

Two real paths here, and they're not interchangeable:

**Path A — self-serve (simplest, but bills him, not the company account).** He signs in to Kiro with his own AWS Builder ID (or Google/GitHub). First upgrade gets a one-time $20 credit. Fine for evaluation, but the spend lands on his personal payment method, not your AWS account's credits.

**Path B — billed to your AWS account's credits (what you actually want).** Kiro's team billing only draws from your AWS account when identities come through **AWS IAM Identity Center**, not Builder ID. Steps:
1. Enable IAM Identity Center on your AWS account (Console → IAM Identity Center → Enable), if not already on.
2. Add him as an Identity Center user with his email.
3. Go through Kiro's [Subscribe your team](https://kiro.dev/docs/enterprise/subscribe/) flow, connect it to your IAM Identity Center instance, and assign him a seat (Pro is the base paid tier).
4. The subscription cost then shows up under AWS Billing and Cost Management → Charges by service, where your AWS credits apply automatically.

This is separate infrastructure from the Tier 1/2 IAM user in §3 — Identity Center users and classic IAM users are different systems. You don't have to unify them; it's fine for him to have a classic IAM user for AWS CLI/console work and an Identity Center identity purely for Kiro billing.

Model selection isn't exposed in Kiro today — that's expected, not a misconfiguration.

**Claude Code**, if/when you add a seat: self-serve individual signup, or invite by email under your Team/Enterprise plan if you have one. Not needed to start — Kiro covers the agentic-coding use case for now.

---

## 5. Local setup

```bash
git clone https://github.com/perseveranceai/lensy.git
cd lensy
npm run setup            # installs root + frontend + backend deps
```

Configure AWS CLI with his own scoped credentials from §3 (never share yours):

```bash
aws configure --profile lensy-gamma
export AWS_PROFILE=lensy-gamma
```

---

## 6. Run & test — locally

Point the local frontend at **gamma** (never prod) — there's already a checked-in `.env.gamma` to copy from:

```bash
cp frontend/.env.gamma frontend/.env.local
# edit frontend/.env.local: set REACT_APP_SKIP_RATE_LIMIT=true
cd frontend && npm start
# → http://localhost:3000, UI running locally, talking to the live gamma backend
```

Verify it's actually working: paste a real docs URL into the running UI (e.g. `https://docs.stripe.com/api`) and confirm you see live progress over the WebSocket and a finished report. If that works, the environment is correctly wired end-to-end.

Run the test suites:

```bash
cd backend && npm test     # jest — Lambda/unit tests
cd frontend && npm test    # react-scripts test
```

For backend Lambda code changes, iterate with the direct-deploy path (Tier 1 permissions cover this — no CDK needed):

```bash
cd backend/lambda/agent-handler
npm run build   # or the repo's usual TS build step for that function
zip -r /tmp/agent-handler.zip . -x "*.ts" "tsconfig.json" "*.d.ts"
aws lambda update-function-code \
  --function-name LensyStack-gamma-AgentHandlerFunction<suffix> \
  --zip-file fileb:///tmp/agent-handler.zip
```

(Get the exact `<suffix>` once with `aws lambda list-functions --query "Functions[?starts_with(FunctionName,'LensyStack-gamma-AgentHandlerFunction')].FunctionName"`.)

---

## 7. Run & test — against gamma directly (no local frontend)

Useful for confirming a backend change actually landed, independent of any local UI. The gamma API has **no auth** — it's public, rate-limited by IP (3 free scans/day, gamma's limit is raised to 100 for testing) — so a plain `curl` works:

```bash
# kick off an analysis
curl -X POST https://bnkzdze378.execute-api.us-east-1.amazonaws.com/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.stripe.com/api",
    "sessionId": "smoke-test-001",
    "useAgent": true
  }'
# → 202 { "message": "Analysis started (agent)", "engine": "agent", "sessionId": "smoke-test-001", "status": "started" }

# poll for the result (analysis takes ~30-90s)
curl https://bnkzdze378.execute-api.us-east-1.amazonaws.com/status/smoke-test-001
# in progress → { "sessionId": "...", "status": "in_progress", "message": "Analysis in progress" }
# done       → { "sessionId": "...", "status": "completed", "report": { "overallScore": 82, "dimensions": {...}, ... } }
# failed     → { "sessionId": "...", "status": "failed", "error": "..." }
```

Cross-check against CloudWatch to confirm which code actually ran (helpful right after a direct Lambda code push):

```bash
aws logs tail /aws/lambda/LensyStack-gamma-AgentHandlerFunction<suffix> --since 5m --follow
```

If `curl` and the logs agree, the deploy is verified — no need to also click through the UI for a backend-only change.

---

## 8. First week

1. Get through §3–§7 above — working local frontend against gamma, AWS CLI configured, a completed smoke-test scan via curl, Kiro installed.
2. Read the Notion **"Lensy — Start Here"** doc, then do its own "First week" exercises (run a scan, read the User Guide, break something on purpose).
3. Follow the **"AI & LLM Onboarding Plan (v3)"** Week 1 curriculum for the LLM/AI foundations track in parallel.
4. First real task: a small, contained bug fix or test in `backend/lambda/agent-handler/` or `frontend/src/components/`, shipped as a PR — reviewed by Rakesh before anything touches gamma via CDK.
