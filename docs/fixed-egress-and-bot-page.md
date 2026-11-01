# Spec: fixed outbound IP, one honest bot name, and the `/bot` page

Status: draft, 2026-11-01. Owner: Rakesh. Builder: Mahesh. No product code changed yet.

## Why

Some sites' bot protection (Cloudflare at help.branch.io) blocks Lensy's scans intermittently, and on prod it's been blocking all of them since Oct 26. Prod logs for Ara Hill's scans (Oct 29, 20:02 and 20:03 UTC) show `honest 403, browser 403, blocked`. Lensy runs on AWS Lambda without a VPC, so every scan goes out from a rotating, shared AWS IP. Customers can't safely allow us, because:

- they can't allow an IP that keeps changing;
- allowing only the user-agent name is unsafe, because anyone can send `Lensy/1.0`.

This change gives Lensy **fixed outbound IPs** and **one honest name**, and **publishes both** on a `/bot` page. Customers can then write a narrow rule ("this user agent **from these IPs**"), and it prepares the Cloudflare verified-bot application (Web Bot Auth, a separate PR).

## 1. Fixed outbound IP (CDK, `backend/lib/lensy-stack.ts`)

- New VPC per environment: 2 AZs, public plus private subnets.
- **One NAT gateway** with a static **Elastic IP** per environment (gamma and prod each get their own). About $33/month per NAT plus data. A second NAT for high availability can come later, but it would mean a second published IP.
- **Gateway VPC endpoints for S3 and DynamoDB** (free), so that traffic doesn't go through the NAT and add data charges.
- Put **`AgentHandlerFunction`** in the private subnets. It does all page fetching (prefetch in `agent.ts`, `collect-signals-v2.ts`, `fetch-page.ts`).
  - Its other calls (Bedrock, API Gateway management/WebSocket, Jina) go out through the NAT, which is fine.
  - Check: no other Lambda fetches customer pages on the default path (`USE_AGENT=true`). The legacy Step Functions functions (`url-processor`, `ai-readiness-checker`) only run when `USE_AGENT=false`. Leave them out of the VPC, but say so in the PR.
- Output the Elastic IP as a stack output (`LensyEgressIp`), and pass it to the frontend build so `/bot` shows the real address (see §3).
- **Watch:** cold starts (should be small with Lambda's VPC networking), the Lambda timeout on NAT failure, and costs in Cost Explorer for the first week.

## 2. One honest bot name

- Real scans already identify as `Lensy/1.0 (+https://perseveranceai.com/bot)` (`shared/fetch-page.ts`).
- A second name, `Lensy Documentation Quality Auditor/1.0`, survives only in `tools/process-url.ts`. Nothing imports that file at commit `1d5a757`, so it's dead code. **Delete it** (and its compiled `.js`) so the old name can't come back, and keep the single constant in `fetch-page.ts`.
- Keep the browser-user-agent fallback on 403/429 for now. Note on `/bot` that it exists and when it's used.

## 3. The `/bot` page (`frontend`, route `/bot` plus `public/bot.md` for agents)

Plain, short, factual. Sections:

1. **What Lensy is:** "Lensy checks whether AI search engines and coding agents can read a docs page. A person starts each scan on perseveranceai.com; Lensy then fetches that page and a few related files (robots.txt, sitemap, llms.txt, the page's Markdown version)."
2. **How to recognise it:**
   - User agent: `Lensy/1.0 (+https://perseveranceai.com/bot)`.
   - Outbound IPs: the prod Elastic IP, from the stack output at build time (never hard-code a guess). Also say "we'll announce changes here at least 14 days ahead."
   - Open-source CLI user agent: `Lensy-CLI/<version>`. It runs from the user's own machine, so it has no fixed IP.
3. **What it fetches, and how often:** only pages someone asked to scan, plus the related files above. Roughly 10 to 25 requests per scan. No crawling.
4. **robots.txt:** be honest. A scan is a user-requested fetch (like ChatGPT-User), so Lensy doesn't apply robots.txt rules to itself today; it reports what robots.txt says to AI bots. **Decision for Rakesh:** keep that, or honour `User-agent: Lensy` Disallow rules (recommended: honour them; it's cheap and builds trust).
5. **How to allow it (for site owners who want Lensy scans to work):**
   - Cloudflare example: a custom WAF rule with action **Skip** (Super Bot Fight Mode and managed rules) when `http.user_agent contains "Lensy/1.0" and ip.src in {<egress IP>}`.
   - Say plainly: "Match both the user agent **and** our IP. A rule on the user agent alone lets anyone in who copies the name."
6. **How to block it:** a robots.txt line (if honoured) or a WAF block rule on the same match.
7. **Contact:** an email address for operators.

## 4. Fix the blocked-scan message (`frontend`, wherever `blocked-by-bot-protection` maps to copy)

Current text (it tells customers to loosen their security, and suggests real AI agents are blocked):
> "HTTP 403. The site refused Lensy under its own name and as a browser. AI agents that name themselves may be refused the same way. To scan it, allow the Lensy/1.0 user agent in your bot protection."

New text:
> "This site's bot protection blocked our checker (HTTP 403). That's common for new tools that aren't on Cloudflare's verified-bot list yet, and it doesn't mean verified AI crawlers are blocked. You don't need to change anything. If you'd like Lensy scans to work now, see [how to allow Lensy](/bot)."

## 5. Tests (AGENTS.md)

- **REG-27:** a single user-agent constant is used for every outbound fetch. A unit test greps or imports to confirm there's no other `User-Agent` literal in `agent-handler`.
- **REG-28:** the blocked-scan card shows the new copy, with no "allow the Lensy/1.0 user agent" wording. Playwright, with a mocked rejected status.
- **E2E:** `/bot` renders, lists the user agent and a valid IPv4 address, and has a robots/WAF section. Check both themes and 375 px.
- **CDK:** synth test that `AgentHandlerFunction` has a VPC config, the NAT gateway has an EIP, and the S3 and DynamoDB gateway endpoints exist.
- **On gamma after merge:**
  - from the gamma Lambda, fetch `https://api.ipify.org` (or check a request log) and confirm the outbound IP equals the `LensyEgressIp` output;
  - scan 3 known pages and confirm the scores are unchanged.

## 6. Out of scope (separate PR)

Web Bot Auth signing and the Cloudflare verified-bot application. Mahesh has three open questions on hosting and keys for that work; Rakesh to answer.
