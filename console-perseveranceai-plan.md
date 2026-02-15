# Console.PerseveranceAI.com — Architecture Plan

**Date:** February 10, 2026
**Status:** Planning
**Target:** Tonight

---

## 1. Current State of Lensy (Verified)

### What's Working
- **Backend** is fully deployed to AWS and operational:
  - 19 Lambda functions (Node.js 20.x)
  - Step Functions orchestration
  - HTTP API: `https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com/`
  - WebSocket API: `wss://g2l57hb9ak.execute-api.us-east-1.amazonaws.com/prod`
  - S3 + DynamoDB for storage
  - AWS Bedrock integration (Claude 4.5 Sonnet, Titan, Llama 3.1)

- **Frontend** is a working React 18 + TypeScript + MUI app:
  - Runs locally via `npm start`
  - Connects to the deployed AWS backend
  - Full analysis UI, real-time WebSocket progress, fix generation

### What's Missing
- Frontend has **never been deployed to AWS** — it only runs locally
- **No authentication** of any kind (API is open CORS `*`)
- **No routing** — everything is in a single `App.tsx` component
- **No console/wrapper** — just the raw Lensy app
- No deployment pipeline for frontend
- **⚠️ FONT MISMATCH**: Lensy uses **Inter**, but the official PA brand guide says "Never use Inter" — must be **Plus Jakarta Sans**

### Existing Infrastructure We Can Reuse
- Route53 hosted zone: `perseveranceai.com` (Zone ID: `Z0232150VQYAKXQMS0HH`)
- ACM cert covers `www.perseveranceai.com` + `perseveranceai.com` only
- A new ACM certificate is needed for `console.perseveranceai.com`
- CDK stack pattern from the main website (S3 + CloudFront + OAI + Route53)

---

## 2. The Vision: AWS Console-Inspired Wrapper

### What Shawn Will See

```
┌──────────────────────────────────────────────────────────────────────┐
│  [P] Perseverance AI Console              Shawn ▾  │  Sign Out     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │                                                            │      │
│  │                    LENSY                                   │      │
│  │           Documentation Quality Auditor                    │      │
│  │                                                            │      │
│  │   ┌──────────────────────────────────────────────────┐    │      │
│  │   │  Enter documentation URL...                       │    │      │
│  │   └──────────────────────────────────────────────────┘    │      │
│  │                                                            │      │
│  │        [ Analyze Documentation ]                           │      │
│  │                                                            │      │
│  │   Results, progress, fixes...                              │      │
│  │                                                            │      │
│  └────────────────────────────────────────────────────────────┘      │
│                                                                      │
│  ─────────────────────────────────────────────────────────────────   │
│  © 2026 Perseverance AI                                              │
└──────────────────────────────────────────────────────────────────────┘
```

### Login Flow

```
User visits console.perseveranceai.com
    │
    ▼
CloudFront Function checks cookie
    │
    ├─ No valid cookie → Redirect to /login
    │       │
    │       ▼
    │   Login Page (Perseverance AI branded)
    │   Enter password → Cookie set (48hr TTL)
    │       │
    │       ▼
    │   Redirect to /console
    │
    └─ Valid cookie → Serve content
            │
            ▼
    Console Dashboard (service cards)
    Currently: only Lensy
    Future: more services
            │
            ▼
    Click Lensy → /console/lensy
    Full Lensy UI embedded in console shell
```

---

## 3. Architecture Options

### Option A: Console Shell in Same React App ⭐ RECOMMENDED

**Approach:** Add React Router + console layout to the existing Lensy React app.

**Routes:**
- `/login` → Password login page
- `/console` → Service dashboard (AWS Console-style service cards)
- `/console/lensy` → Lensy app wrapped in console layout
- Future: `/console/other-service` → New services added as routes

**What Changes:**
1. Add `react-router-dom` dependency
2. Create `ConsoleLayout.tsx` — persistent header with PA branding + sign out
3. Create `ConsoleDashboard.tsx` — service cards (like AWS Console homepage)
4. Create `Login.tsx` — password page with PA branding
5. Wrap existing `App.tsx` content inside console layout at `/console/lensy`
6. Deploy to S3 + CloudFront via CDK (same approach as requirements doc)
7. CloudFront Function for 48-hour password auth

**Pros:**
- Fastest to implement (2-3 hours)
- Lensy already works — just wrapping it
- Single deployment, single S3 bucket
- Easy to add services later as new route/component
- Perseverance AI branding in shell, Lensy branding preserved inside

**Cons:**
- All future services would share the same React bundle
- Monolith grows over time (but fine for 1-3 services)

**Effort:** 2-3 hours tonight ✅

---

### Option B: Separate Console App + Iframe

**Approach:** Build a lightweight console app (just header + nav + auth), load Lensy in an iframe.

**Routes:**
- `console.perseveranceai.com/login` → Auth
- `console.perseveranceai.com/` → Dashboard with iframe to Lensy
- Lensy deployed separately to its own S3 bucket

**Pros:**
- Complete isolation between console and services
- Each service can be deployed independently
- True microservice frontend pattern

**Cons:**
- Iframe quirks (scrolling, sizing, cross-origin communication)
- WebSocket in iframe can be unreliable
- More complex deployment (2 S3 buckets, 2 CloudFront distributions)
- Overkill for one service

**Effort:** 4-6 hours ❌ Too slow for tonight

---

### Option C: CloudFront Multi-Origin with Shared Shell

**Approach:** CloudFront behaviors route `/lensy/*` to one S3 prefix, `/other-app/*` to another. Shared header injected via Lambda@Edge.

**Pros:**
- Independent deployments per service
- Shared branding via edge function

**Cons:**
- Lambda@Edge is expensive and slow to deploy
- Complex CloudFront configuration
- Header injection is fragile
- Significant over-engineering

**Effort:** 6-8 hours ❌ Way too complex

---

## 4. Recommended Approach: Option A (Detailed)

### What We Build Tonight

**1. Login Page** (`/login`)
- Perseverance AI branding (dark theme, `{P}` logo)
- Single password field + "Access Console" button
- 48-hour cookie-based auth
- "Request Access" mailto link
- No username needed (password-only for beta)

**0. Font Fix** (before anything else)
- Change Lensy frontend from Inter → Plus Jakarta Sans
- Update Google Fonts import in `index.html`
- Update CSS variables in `index.css`
- This aligns Lensy with official PA brand (website repo design guide explicitly bans Inter)

**2. Console Layout** (persistent shell)
- **Top bar** (frosted glass, like website nav: `rgba(10,10,10,0.8)` + `backdrop-filter: blur(12px)`)
  - Left: `{P}` logo (JetBrains Mono braces in `#525252`, Plus Jakarta Sans P in `#fafafa`) + "Perseverance AI" text
  - Center/right: "Console" label
  - Right: User indicator + "Sign Out" button
- **Background**: Uses PA design system (`#0a0a0a` + subtle grid pattern)
- **Accents**: PA blue (`#3b82f6`), green (`#22c55e`)
- **Font**: Plus Jakarta Sans (primary), JetBrains Mono (code)
- **Primary buttons**: White bg (`#fafafa`), dark text (`#0a0a0a`) — NOT blue (matches website)

**3. Console Dashboard** (`/console`)
- Simple service cards (AWS Console-inspired)
- One card for now: "Lensy — Documentation Quality Auditor"
- Card click → navigates to `/console/lensy`
- Future: add more service cards here

**4. Lensy App** (`/console/lensy`)
- Existing `App.tsx` content rendered inside console layout
- Lensy title visible in content area
- All existing functionality preserved (analysis, WebSocket, fixes)

### Auth Architecture (CloudFront Function)

Same approach as the requirements doc, with these changes:
- Cookie name: `perseverance_console_token` (console-wide, not Lensy-specific)
- Bypass paths: `/login`, `/static/*`, `*.ico`, `*.png`, `*.svg`
- Password expiry: 48 hours
- Token format: `password:timestamp`

**Password management:** Inline in CDK-deployed CloudFront Function. To add/rotate passwords, update the function code and run `cdk deploy`.

### Infrastructure (CDK Changes)

Add to existing `lensy-stack.ts`:
- New ACM certificate for `console.perseveranceai.com`
- S3 bucket for frontend (`lensy-console-{account}-{region}`)
- CloudFront distribution with OAI
- CloudFront Function for password protection
- Route53 A record: `console.perseveranceai.com` → CloudFront
- Error responses: 403/404 → `/index.html` (SPA routing)

### Key Changes from Original Requirements Doc

| Item | Original Doc | Updated |
|------|-------------|---------|
| Subdomain | `app.perseveranceai.com` | `console.perseveranceai.com` |
| Concept | Direct Lensy deployment | Console wrapper with Lensy inside |
| Cookie name | `lensy_access_token` | `perseverance_console_token` |
| Routes | `/login`, `/` | `/login`, `/console`, `/console/lensy` |
| Header | None (Lensy's own header) | Perseverance AI console header + sign out |
| Future services | Not considered | Dashboard with service cards |
| Branding | Lensy-only | Console = PA branding; Lensy branding preserved inside |

---

## 5. Implementation Steps (Tonight)

### Phase 1: Frontend Changes (~1.5 hours)

1. `npm install react-router-dom @types/react-router-dom`
2. Create `src/Login.tsx` — password page with PA branding
3. Create `src/ConsoleLayout.tsx` — header shell + outlet
4. Create `src/ConsoleDashboard.tsx` — service card grid
5. Refactor `App.tsx` — extract Lensy content into `LensyApp` component
6. Add routing in new `App.tsx` entry point
7. Test locally: login → dashboard → Lensy

### Phase 2: CDK Infrastructure (~1 hour)

1. Add CloudFront/ACM/Route53 imports to `lensy-stack.ts`
2. Add ACM certificate for `console.perseveranceai.com`
3. Add S3 frontend bucket
4. Add CloudFront Function (password auth with 48hr expiry)
5. Add CloudFront distribution
6. Add Route53 A record
7. `cdk deploy`

### Phase 3: Deploy & Test (~30 min)

1. `npm run build` in frontend
2. `aws s3 sync build/ s3://bucket-name --delete`
3. Invalidate CloudFront cache
4. Test: `https://console.perseveranceai.com`
5. Test: login flow, Lensy access, sign out, expiration

---

## 6. What Shawn Gets

- URL: `https://console.perseveranceai.com`
- Password: Generated for him (48-hour expiry)
- Experience: Login → sees console dashboard → clicks Lensy → full Lensy app
- Sign out button in header
- Perseverance AI branding throughout
- All Lensy features work (analysis, WebSocket, fixes)
- After 48 hours: password expires, needs new one from Rakesh

---

## 7. Future Scalability

When new services are added:

1. Create new component (e.g., `NewServiceApp.tsx`)
2. Add route: `/console/new-service`
3. Add card to `ConsoleDashboard.tsx`
4. Deploy — that's it

If the monolith becomes too large (3+ complex services), migrate to Option B (iframe/module federation) at that point. For now, keep it simple.
