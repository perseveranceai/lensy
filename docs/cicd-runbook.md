# CI/CD Runbook

Operator steps for the deploy pipeline. Run these in order — each unblocks the next.

Everything here is a one-time setup action on identity, monitoring, or repo settings, which is why it lives in a runbook rather than in the pipeline itself.

> **Run Steps 1–4 from the `feat/cicd-pipeline` branch, before merging it.**
> The CDK changes only exist on that branch, and merging first would trigger a
> `Deploy` run that fails at credential assumption because the OIDC roles do
> not exist yet. Merge last, once Steps 1–4 are done.
>
> ```bash
> git checkout feat/cicd-pipeline
> ```

---

## Step 1 — Gamma monitoring cutover (do this before any deploy)

The gamma alarms and metric filters currently live only in the AWS console. The CDK stack now defines the same five alarms with **the same names**, so a gamma deploy will fail with `already exists` until the manual ones are removed.

Delete the hand-built resources first:

```bash
aws cloudwatch delete-alarms --alarm-names \
  Lensy-Gamma-AgentErrors \
  Lensy-Gamma-ApiErrors \
  Lensy-Gamma-RateLimitHits \
  Lensy-Gamma-AgentLambdaErrors \
  Lensy-Gamma-ApiLambdaErrors

aws logs delete-metric-filter \
  --log-group-name /aws/lambda/LensyStack-gamma-AgentHandlerFunction4A575D3B-Q17g4RtN43Kt \
  --filter-name AgentErrors-gamma
aws logs delete-metric-filter \
  --log-group-name /aws/lambda/LensyStack-gamma-ApiHandlerFunction9E589C02-JscoIXtHtd5W \
  --filter-name ApiErrors-gamma
aws logs delete-metric-filter \
  --log-group-name /aws/lambda/LensyStack-gamma-ApiHandlerFunction9E589C02-JscoIXtHtd5W \
  --filter-name RateLimitExceeded-gamma
```

Then redeploy gamma to recreate them from code:

```bash
cd backend && npm run deploy:gamma
```

Verify five alarms came back, now stack-managed:

```bash
aws cloudwatch describe-alarms --alarm-name-prefix Lensy-Gamma \
  --query 'MetricAlarms[].AlarmName' --output text
```

There is a monitoring gap of a few minutes between the delete and the deploy. On gamma that is acceptable.

## Step 2 — Prod monitoring (the actual gap)

Prod has never had alarms, metric filters, or a `Lensy/Prod` namespace. Nothing to delete.

**This deploy is not monitoring-only.** Prod has drifted from `main`, so `cdk diff` shows two application changes riding along. Both look intentional, but decide deliberately rather than discovering them after:

| Change | Effect |
|---|---|
| `AgentHandlerFunction` code | Ships `dd78962` — JS-rendered SPA shell detection. Currently gamma-only. This is the fix for doc portals that returned an empty shell and got rejected as "not documentation". |
| `ApiHandlerFunction` env `FREE_TIER_DAILY_LIMIT` | **100 → 3.** Prod is currently running the gamma testing value, so the free tier has been 33× looser than intended. Deploying restores the intended limit. |

Re-check before running, since this drifts over time:

```bash
cd backend && LENSY_ENV=prod npx cdk diff
```

Then:

```bash
cd backend && npm run deploy:prod
```

This creates five `Lensy-Prod-*` alarms, three metric filters publishing to `Lensy/Prod`, and the `LensyDeploymentDecisions` table. Confirm:

```bash
aws cloudwatch describe-alarms --alarm-name-prefix Lensy-Prod \
  --query 'MetricAlarms[].AlarmName' --output text
aws dynamodb describe-table --table-name LensyDeploymentDecisions \
  --query 'Table.TableStatus' --output text
```

All alarms route to the existing `lensy-alerts` topic, already subscribed by hello@perseveranceai.com — no SNS changes needed.

## Step 3 — GitHub OIDC provider and deploy roles

No thumbprint is required. AWS has validated GitHub's OIDC provider against its own trusted root CA store since July 2023 and ignores any thumbprint you supply; guides telling you to rotate one are out of date.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```

### Gamma role — assumable only from `refs/heads/main`

```bash
cat > /tmp/trust-gamma.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::951411676525:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:perseveranceai/lensy:ref:refs/heads/main"
      }
    }
  }]
}
EOF

cat > /tmp/perms-gamma.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeCdkBootstrapRoles",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": [
        "arn:aws:iam::951411676525:role/cdk-hnb659fds-deploy-role-951411676525-us-east-1",
        "arn:aws:iam::951411676525:role/cdk-hnb659fds-file-publishing-role-951411676525-us-east-1",
        "arn:aws:iam::951411676525:role/cdk-hnb659fds-lookup-role-951411676525-us-east-1"
      ]
    },
    {
      "Sid": "GammaFrontend",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::lensy-console-951411676525-us-east-1-gamma",
        "arn:aws:s3:::lensy-console-951411676525-us-east-1-gamma/*"
      ]
    },
    {
      "Sid": "GammaInvalidation",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::951411676525:distribution/E1J3M0RUB5VA7F"
    },
    {
      "Sid": "DecisionLog",
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:us-east-1:951411676525:table/LensyDeploymentDecisions"
    }
  ]
}
EOF

aws iam create-role --role-name lensy-gha-gamma \
  --assume-role-policy-document file:///tmp/trust-gamma.json
aws iam put-role-policy --role-name lensy-gha-gamma \
  --policy-name lensy-gha-gamma --policy-document file:///tmp/perms-gamma.json
```

### Prod role — assumable only from the production environments

```bash
cat > /tmp/trust-prod.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::951411676525:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": [
          "repo:perseveranceai/lensy:environment:production",
          "repo:perseveranceai/lensy:environment:production-auto"
        ]
      }
    }
  }]
}
EOF

cat > /tmp/perms-prod.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeCdkBootstrapRoles",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": [
        "arn:aws:iam::951411676525:role/cdk-hnb659fds-deploy-role-951411676525-us-east-1",
        "arn:aws:iam::951411676525:role/cdk-hnb659fds-file-publishing-role-951411676525-us-east-1",
        "arn:aws:iam::951411676525:role/cdk-hnb659fds-lookup-role-951411676525-us-east-1"
      ]
    },
    {
      "Sid": "ProdFrontend",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::www.perseveranceai.com",
        "arn:aws:s3:::www.perseveranceai.com/*"
      ]
    },
    {
      "Sid": "ProdInvalidation",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::951411676525:distribution/E274OKID4GUQ1J"
    },
    {
      "Sid": "DecisionLog",
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:us-east-1:951411676525:table/LensyDeploymentDecisions"
    }
  ]
}
EOF

aws iam create-role --role-name lensy-gha-prod \
  --assume-role-policy-document file:///tmp/trust-prod.json
aws iam put-role-policy --role-name lensy-gha-prod \
  --policy-name lensy-gha-prod --policy-document file:///tmp/perms-prod.json
```

Neither role holds `iam:*`, `dynamodb:*`, or `cloudformation:*` directly. All infrastructure mutation happens through the CDK bootstrap roles, which only CloudFormation and these two roles can assume.

## Step 4 — GitHub settings

**Environments** — Settings → Environments:

| Environment | Required reviewers | Deployment branches |
|---|---|---|
| `production` | you (`drpasupuleti`) | `main` only |
| `production-auto` | none | `main` only |

Create `production-auto` now even though nothing routes to it yet. Phase 5 flips `CLASSIFIER_SHADOW_MODE=false` and the workflow starts selecting it — if the environment doesn't exist at that point, the job fails.

**Branch protection** — Settings → Branches → add rule for `main`:
- Require a pull request before merging (1 approval)
- Require status checks: `Backend build + tests`, `Frontend build`
- Do not allow bypassing

**Actions hardening** — Settings → Actions → General:
- Require actions to be pinned to a full-length commit SHA
- Fork pull request workflows: require approval for all outside collaborators
- Restrict allowed actions to selected/verified creators

## Step 5 — First run

Merge the pipeline PR. The first `Deploy` run will:

1. Deploy gamma, publish the frontend, and run a real scan as a smoke test
2. Classify the deploy and write the features row to `LensyDeploymentDecisions`
3. Pause on the `production` environment awaiting your approval

Approve at **Actions → the running workflow → Review deployments → ☑ production → Approve and deploy**.

---

## Reference

**Shadow mode.** The classifier runs on every deploy but has no authority: `target_env` stays `production` regardless of verdict. The verdict and its reasons appear in the run summary and in the decision log. Phase 5 sets `CLASSIFIER_SHADOW_MODE=false` in `deploy.yml` — only once the log shows the classifier has been right consistently.

**Reading the decision log.**

```bash
aws dynamodb scan --table-name LensyDeploymentDecisions \
  --projection-expression "deployId,env,verdict,outcomeLabel" --output table
```

**Rollback.** CloudFormation rolls back automatically on a failed deploy. For a bad-but-successful deploy, revert the commit on `main` — the pipeline redeploys the previous state through the same gate. Frontend rollback is the same path.

**Prod frontend target.** `LensyStack` outputs `ConsoleBucketName = lensy-console-951411676525-us-east-1`, which redirects and does **not** serve the site. The live frontend is `s3://www.perseveranceai.com` behind CloudFront `E274OKID4GUQ1J`. `deploy.yml` hardcodes the correct one; don't "fix" it to use the stack output.
