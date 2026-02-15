# Feature Requirements: Perseverance AI Console Deployment

## Overview

**Feature Name:** Perseverance AI Console with Lensy — AWS Deployment
**Priority:** High
**Estimated Effort:** 3-4 hours
**Date:** February 10, 2026 (Updated from Jan 30, 2026)
**Revision:** v2.1 — Changed from `app` to `console` subdomain; added console wrapper concept; aligned branding to official Perseverance AI design system from website repo

### Goal

Deploy a Perseverance AI Console to AWS S3 + CloudFront with:
- Custom subdomain: `console.perseveranceai.com`
- AWS Console-inspired wrapper/shell with Perseverance AI branding
- Lensy as the first service accessible within the console
- Password protection with 48-hour expiration
- SSL/HTTPS via ACM certificate
- Same infrastructure pattern as main website
- Future-proofed for additional services beyond Lensy

### Key Change from v1.0

The original doc targeted `app.perseveranceai.com` as a direct Lensy deployment. This revision changes the approach to `console.perseveranceai.com` — a console portal (inspired by AWS Console) that wraps Lensy and can host future Perseverance AI services. Branding aligned to the **official Perseverance AI design system** from the website repo (`github.com/perseveranceai/website`), NOT from Lensy's frontend (which has a font mismatch).

### Critical Brand Issue Identified

The Lensy frontend currently uses **Inter** as its primary font. However, the official Perseverance AI Design Requirements doc (`PerseveranceAI_Design_Requirements-Jan10.md` in the website repo) explicitly states:

> "❌ Never use Inter as primary font (overused in AI products)"

The official brand font is **Plus Jakarta Sans**. The console must use Plus Jakarta Sans, and the Lensy frontend font should also be corrected to match. This is a two-line change in `frontend/src/index.css` and `frontend/public/index.html`.

---

## Current State Analysis (VERIFIED Feb 10, 2026)

### Frontend Configuration

**Location:** `frontend/src/App.tsx`

**Hardcoded API Endpoints:**
```typescript
const API_BASE_URL = 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';
const WEBSOCKET_URL = 'wss://g2l57hb9ak.execute-api.us-east-1.amazonaws.com/prod';
```

**Build System:** Create React App (`react-scripts`)
**Framework:** React 18.2 + TypeScript + Material-UI 5.15
**Design System:** Dark theme, Inter + JetBrains Mono fonts, blue accent (#3b82f6) ⚠️ **FONT MISMATCH** — should be Plus Jakarta Sans per brand guidelines
**Current Auth:** None
**Current Routing:** None (single-page, no React Router)
**Current Deployment:** Local only (`npm start`) — frontend has never been deployed to AWS

### Backend Status (Fully Deployed)

- 19 Lambda functions operational
- Step Functions workflow running
- HTTP API + WebSocket API both live
- S3, DynamoDB, Bedrock integration all working
- No changes needed to backend for this deployment

### Existing AWS Infrastructure (VERIFIED)

**ACM Certificate for perseveranceai.com:**
```
ARN: arn:aws:acm:us-east-1:951411676525:certificate/37b20bd1-e8e9-4a7e-867c-7bf9a09cd420
Domain: www.perseveranceai.com
SANs: perseveranceai.com
Status: ISSUED
Expires: 2026-04-06
```
**NOTE:** This cert does NOT cover `console.perseveranceai.com`. A new certificate is required.

**Route53 Hosted Zone for perseveranceai.com:**
```
Hosted Zone ID: Z0232150VQYAKXQMS0HH
Name: perseveranceai.com
Records: 14
```

**Website CDK Stack Pattern (from `perseverance-ai-cdk-stack.ts`):**
- Uses `route53.HostedZone.fromLookup()` for zone lookup
- Uses `acm.DnsValidatedCertificate` for certificate creation
- Uses `cloudfront.Distribution` (modern L2 construct)
- Uses `origins.S3Origin` with Origin Access Identity (OAI)
- Uses `route53.ARecord` with `targets.CloudFrontTarget`

### Lensy CDK Stack (from `lensy-stack.ts`)

**Current Imports:**
```typescript
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigwv2_integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as iam from 'aws-cdk-lib/aws-iam';
```

**Imports to Add:**
```typescript
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
```

---

## Functional Requirements

### FR-1: Console Architecture (NEW in v2.0)

**FR-1.1:** The console SHALL be an AWS Console-inspired wrapper that hosts Perseverance AI services.

**FR-1.2:** The console SHALL have a persistent top navigation bar with:
- Perseverance AI logo (`{P}`) and "Perseverance AI" text (left)
- "Console" label (center)
- Sign Out button (right)

**FR-1.3:** The console SHALL have a service dashboard at `/console` showing available services as cards.

**FR-1.4:** Lensy SHALL be the first (and currently only) service, accessible at `/console/lensy`.

**FR-1.5:** The console header/shell SHALL use Perseverance AI branding while preserving Lensy's branding within the service content area.

**FR-1.6:** The design system SHALL use the **official Perseverance AI design tokens** (from website repo `PerseveranceAI_Design_Requirements-Jan10.md`):

**Colors:**
```css
--bg-primary: #0a0a0a;       /* Page background */
--bg-secondary: #111111;     /* Cards, sections */
--bg-tertiary: #1a1a1a;      /* Hover states, elevated surfaces */
--text-primary: #fafafa;     /* Headings */
--text-secondary: #e5e7eb;   /* Body text */
--text-muted: #737373;       /* Captions, metadata */
--text-code: #525252;        /* Logo braces, code brackets */
--border-subtle: #1f1f1f;
--border-default: #2a2a2a;
--border-strong: #3a3a3a;
--accent-primary: #3b82f6;   /* Links, interactive elements */
--accent-hover: #60a5fa;
--accent-success: #22c55e;
--accent-warning: #f59e0b;
--accent-error: #ef4444;
```

**Typography (IMPORTANT — NOT Inter):**
```css
--font-sans: 'Plus Jakarta Sans', 'DM Sans', 'Inter', -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'Source Code Pro', monospace;
```
Google Fonts import:
```html
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Logo markup (exact match from website):**
```html
<a href="/" class="logo">
  <span class="logo-brace">{</span>    <!-- JetBrains Mono, 300, #525252 -->
  <span class="logo-p">P</span>         <!-- Plus Jakarta Sans, 700, #fafafa -->
  <span class="logo-brace">}</span>     <!-- JetBrains Mono, 300, #525252 -->
  <span class="logo-company">Perseverance AI</span>  <!-- Plus Jakarta Sans, 600, #fafafa -->
</a>
```

**Header style (frosted glass, exact match from website):**
```css
header {
  background: rgba(10, 10, 10, 0.8);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-subtle);
  position: fixed;
  width: 100%;
  top: 0;
  z-index: 100;
}
```

**Primary button (white, not blue — matches website):**
```css
.btn { background: #fafafa; color: #0a0a0a; border-radius: 6px; font-weight: 600; }
.btn:hover { background: #e5e7eb; transform: translateY(-1px); }
```

**Secondary/ghost button:**
```css
.btn-secondary { background: transparent; color: #e5e7eb; border: 1px solid #2a2a2a; }
.btn-secondary:hover { background: #1a1a1a; border-color: #3a3a3a; }
```

**Card style (for service dashboard):**
```css
.card { background: #111111; border: 1px solid #1f1f1f; border-radius: 12px; padding: 2rem; }
.card:hover { background: #1a1a1a; border-color: #2a2a2a; transform: translateY(-2px); }
```

**Form inputs (for login page):**
```css
input { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; color: #fafafa; }
input:focus { border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.1); }
```

**Background pattern (subtle grid, matches website):**
```css
body {
  background-image:
    linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 50px 50px;
}
```

**Typography "Don'ts" from brand guide:**
- ❌ Never use Inter as primary font
- ❌ Never use Arial, Roboto, or system defaults
- ❌ Never use purple gradients
- ❌ Avoid font weights below 400 for body text

**FR-1.7:** The console layout SHALL be responsive and work on desktop and tablet.

**FR-1.8 (NEW):** The Lensy frontend font SHALL be changed from Inter to Plus Jakarta Sans to match the official brand guidelines. This requires:
- Updating `frontend/src/index.css`: Change `--font-ui`, `--font-heading`, `--font-subheading`, `--font-serif` from `'Inter'` to `'Plus Jakarta Sans', 'DM Sans', 'Inter'`
- Updating `frontend/public/index.html`: Change Google Fonts import from `Inter` to `Plus+Jakarta+Sans`

### FR-2: S3 Bucket for Console Hosting

**FR-2.1:** Create S3 bucket for the console frontend (name pattern: `lensy-console-{account}-{region}`).

**FR-2.2:** Configure bucket for static website hosting:
- Index document: `index.html`
- Error document: `index.html` (for SPA routing)

**FR-2.3:** Block all public access on bucket (CloudFront will access via OAI).

**FR-2.4:** Enable versioning for rollback capability.

**FR-2.5:** Add lifecycle rule to delete old versions after 30 days.

### FR-3: CloudFront Distribution

**FR-3.1:** Create CloudFront distribution with S3 origin.

**FR-3.2:** Configure Origin Access Identity (OAI) for secure S3 access.

**FR-3.3:** Set default root object to `index.html`.

**FR-3.4:** Configure custom error responses for SPA routing:
- 403 → /index.html (200)
- 404 → /index.html (200)

**FR-3.5:** Enable HTTPS only (redirect HTTP to HTTPS).

**FR-3.6:** Associate ACM certificate for `console.perseveranceai.com`.

**FR-3.7:** Set alternate domain name (CNAME) to `console.perseveranceai.com`.

**FR-3.8:** Configure caching behavior:
- Default (HTML files): `CACHING_DISABLED` — always fetch latest
- `/static/js/*`: `CACHING_OPTIMIZED` — cache 1 year (content hash in filenames)
- `/static/css/*`: `CACHING_OPTIMIZED` — cache 1 year
- `/static/media/*`: `CACHING_OPTIMIZED` — cache 1 year

**FR-3.9:** Enable gzip/brotli compression.

### FR-4: ACM Certificate

**FR-4.1:** Create NEW certificate for `console.perseveranceai.com`.

**FR-4.2:** Certificate MUST be in `us-east-1` region (CloudFront requirement).

**FR-4.3:** Use DNS validation via Route 53.

**FR-4.4:** Use `acm.DnsValidatedCertificate` for consistency with existing website stack.

### FR-5: Route 53 DNS Configuration

**FR-5.1:** Create A record (Alias) for `console.perseveranceai.com` pointing to CloudFront distribution.

**FR-5.2:** Use the existing `perseveranceai.com` hosted zone (ID: `Z0232150VQYAKXQMS0HH`).

**FR-5.3:** Use `route53.HostedZone.fromLookup()` to reference existing zone.

### FR-6: Password Protection with Expiration

**FR-6.1:** Implement password protection using CloudFront Function (not Lambda@Edge for cost).

**FR-6.2:** Password tokens SHALL expire after 48 hours.

**FR-6.3:** The system SHALL support multiple active passwords (for different beta testers).

**FR-6.4:** Cookie name: `perseverance_console_token` (console-wide, not Lensy-specific).

**FR-6.5:** Cookie settings:
- HttpOnly: false (needs JS access for SPA)
- Secure: true (HTTPS only)
- SameSite: Strict
- Max-Age: 172800 (48 hours)

**FR-6.6:** Password configuration SHALL be stored inline in CloudFront Function code (simple, requires `cdk deploy` to change).

**FR-6.7:** After password expires, user SHALL see login page with instructions to request new access.

**FR-6.8:** Admin SHALL be able to generate new passwords via script.

**FR-6.9:** CloudFront Function SHALL bypass auth for: `/login`, `/static/*`, `*.ico`, `*.png`, `*.svg`.

### FR-7: Login Page

**FR-7.1:** Create login page at `/login` route.

**FR-7.2:** Login page SHALL show:
- Perseverance AI branding (`{P}` logo, "Perseverance AI Console" heading)
- Password input field
- "Access Console" button
- "Request Access" mailto link
- "Access expires after 48 hours" notice

**FR-7.3:** Login page design SHALL match the Lensy/Perseverance AI dark theme (#0a0a0a background, #3b82f6 blue accent).

**FR-7.4:** On successful password entry, set cookie and redirect to `/console`.

**FR-7.5:** On failed password, show error message.

**FR-7.6:** Login page SHALL be accessible without authentication.

### FR-8: Console Dashboard

**FR-8.1:** Create console dashboard at `/console` route.

**FR-8.2:** Dashboard SHALL display available services as clickable cards (inspired by AWS Console).

**FR-8.3:** Lensy card SHALL show:
- Lensy icon/logo
- "Lensy" title
- "Documentation Quality Auditor" subtitle
- Click → navigates to `/console/lensy`

**FR-8.4:** Future services can be added as additional cards.

### FR-9: Console Header / Sign Out

**FR-9.1:** Console layout SHALL have a persistent header across all console pages.

**FR-9.2:** Header SHALL contain:
- `{P}` Perseverance AI logo and name (left side)
- "Console" label
- "Sign Out" button (right side)

**FR-9.3:** Sign Out SHALL:
- Clear the `perseverance_console_token` cookie
- Redirect to `/login`

### FR-10: Build and Deployment

**FR-10.1:** Production build: `npm run build` in frontend directory.

**FR-10.2:** Build output: `frontend/build/` directory.

**FR-10.3:** Deployment script SHALL:
- `aws s3 sync build/ s3://bucket-name --delete`
- Set `no-cache` headers on `index.html`
- Invalidate CloudFront cache

**FR-10.4:** Document manual deployment steps.

---

## Non-Functional Requirements

### NFR-1: Performance
- Page load under 3 seconds on 4G
- Edge caching for static assets
- Gzip/Brotli compression

### NFR-2: Security
- HTTPS only
- S3 bucket not publicly accessible
- Password protection prevents unauthorized access
- No sensitive data in frontend code

### NFR-3: Cost
- Estimated: $1-5/month (minimal beta traffic)
- CloudFront Function preferred over Lambda@Edge

### NFR-4: Maintainability
- Password changes deployable within 5 minutes
- Frontend updates deployable within 10 minutes

---

## Technical Design

### Architecture Diagram

```
                                    ┌─────────────────────────────────┐
                                    │         Route 53                │
                                    │    perseveranceai.com zone      │
                                    └─────────────────────────────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    │                              │                              │
                    ▼                              ▼                              ▼
        ┌─────────────────────┐    ┌────────────────────────────┐    ┌─────────────────────┐
        │ perseveranceai.com  │    │console.perseveranceai.com  │    │ API Gateway         │
        │   (main website)    │    │  (Console + Lensy)         │    │ (existing, no change)│
        └──────────┬──────────┘    └──────────┬─────────────────┘    └─────────────────────┘
                   │                          │
                   ▼                          ▼
        ┌─────────────────────┐    ┌─────────────────────┐
        │    CloudFront       │    │    CloudFront       │
        │   (existing)        │    │   (NEW)             │
        └──────────┬──────────┘    └──────────┬──────────┘
                   │                          │
                   │               ┌──────────┴──────────┐
                   │               │                     │
                   │               ▼                     ▼
                   │    ┌─────────────────────┐ ┌─────────────────────┐
                   │    │ CloudFront Function │ │   S3 Origin         │
                   │    │ (Password Check)    │ │ lensy-console-*     │
                   │    └─────────────────────┘ └─────────────────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │     S3 Bucket       │
        │  (main website)     │
        └─────────────────────┘
```

### React App Route Structure

```
console.perseveranceai.com
│
├── /login              → Login.tsx (no auth required)
│
├── /console            → ConsoleLayout.tsx (persistent shell)
│   │                     ├── Header: {P} Perseverance AI Console | Sign Out
│   │                     └── Content area:
│   │
│   ├── /console        → ConsoleDashboard.tsx (service cards)
│   │                     └── Card: Lensy — Documentation Quality Auditor
│   │
│   └── /console/lensy  → LensyApp.tsx (existing App.tsx content)
│                         └── Full analysis UI, WebSocket, fixes
│
└── /*                  → Redirect to /console (if authed) or /login
```

### New React Components

**1. `src/Login.tsx`** — Password login page
**2. `src/ConsoleLayout.tsx`** — Header shell with Outlet for child routes
**3. `src/ConsoleDashboard.tsx`** — Service card grid
**4. `src/LensyApp.tsx`** — Extracted from current App.tsx (the actual Lensy UI)
**5. `src/App.tsx`** — Now just the router entry point

### CloudFront Function: Password Protection

**Cookie name:** `perseverance_console_token`

```javascript
function handler(event) {
    var request = event.request;
    var cookies = request.cookies;
    var uri = request.uri;

    // Bypass auth for login page and static assets
    if (uri === '/login' || uri === '/login.html' ||
        uri.startsWith('/static/') ||
        uri.endsWith('.ico') || uri.endsWith('.png') || uri.endsWith('.svg')) {
        return request;
    }

    // Check for valid access token cookie
    var token = cookies['perseverance_console_token']
        ? cookies['perseverance_console_token'].value : null;

    if (token && isValidToken(token)) {
        return request;
    }

    // Not authenticated - redirect to login
    return {
        statusCode: 302,
        statusDescription: 'Found',
        headers: {
            'location': { value: '/login' },
            'cache-control': { value: 'no-store' }
        }
    };
}

function isValidToken(token) {
    // UPDATE THESE PASSWORDS AS NEEDED
    // Format: { 'password': createdTimestampMs }
    var validPasswords = {
        'LensyBeta2026!': 1738281600000  // Created: Jan 31, 2026
    };

    var parts = token.split(':');
    if (parts.length !== 2) return false;

    var password = parts[0];
    var loginTime = parseInt(parts[1], 10);

    if (!validPasswords[password]) return false;

    // 48 hours = 172800000 ms
    var expirationMs = 48 * 60 * 60 * 1000;
    var now = Date.now();
    var passwordCreatedTime = validPasswords[password];

    if (loginTime < passwordCreatedTime) return false;
    if (now - loginTime > expirationMs) return false;

    return true;
}
```

---

## Deployment Steps

### Step 0: Fix Lensy Font (Brand Alignment)
```bash
# In frontend/public/index.html — change Google Fonts import:
# FROM: family=Inter:wght@300;400;500;600;700
# TO:   family=Plus+Jakarta+Sans:wght@400;500;600;700

# In frontend/src/index.css — change CSS variables:
# FROM: --font-ui: 'Inter', -apple-system, ...
# TO:   --font-ui: 'Plus Jakarta Sans', 'DM Sans', 'Inter', -apple-system, ...
# (Same for --font-heading, --font-subheading, --font-serif)
```

### Step 1: Install Dependencies
```bash
cd frontend
npm install react-router-dom @types/react-router-dom
```

### Step 2: Create Console Components
- `src/Login.tsx`
- `src/ConsoleLayout.tsx`
- `src/ConsoleDashboard.tsx`
- Extract `LensyApp.tsx` from `App.tsx`
- Refactor `App.tsx` as router entry point

### Step 3: Test Locally
```bash
npm start
# Test: /login → /console → /console/lensy → sign out
```

### Step 4: Add CDK Infrastructure
Edit `backend/lib/lensy-stack.ts`:
- Add imports (cloudfront, acm, route53, origins, targets)
- Add ACM certificate for `console.perseveranceai.com`
- Add S3 frontend bucket
- Add CloudFront Function (password auth)
- Add CloudFront distribution
- Add Route53 A record

### Step 5: Deploy Infrastructure
```bash
cd backend
npm run build
cdk deploy LensyStack
# Note the outputs: Distribution ID, Bucket Name
```

### Step 6: Build & Deploy Frontend
```bash
cd frontend
npm run build
aws s3 sync build/ s3://BUCKET_NAME --delete
aws s3 cp s3://BUCKET_NAME/index.html s3://BUCKET_NAME/index.html \
    --metadata-directive REPLACE \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "text/html"
aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
```

### Step 7: Generate Password & Test
```bash
./scripts/generate-password.sh "ShawnBeta2026!"
# Visit https://console.perseveranceai.com
# Login → Dashboard → Lensy → Sign Out
```

---

## Acceptance Criteria

- [ ] `console.perseveranceai.com` resolves and loads the console
- [ ] HTTPS is enforced
- [ ] Unauthenticated users are redirected to login page
- [ ] Login page shows Perseverance AI branding
- [ ] Valid password grants access for 48 hours
- [ ] After login, user sees console dashboard with Lensy service card
- [ ] Clicking Lensy card opens full Lensy UI inside console shell
- [ ] Console header shows Perseverance AI branding and Sign Out button
- [ ] Sign Out clears cookie and redirects to login
- [ ] Expired passwords require re-authentication
- [ ] Lensy analysis, WebSocket, and fix generation all work
- [ ] SPA routing works (refresh on any page loads correctly)
- [ ] Admin can generate new passwords via script
- [ ] Console uses Plus Jakarta Sans font (NOT Inter) per brand guidelines
- [ ] Lensy app inside console also uses Plus Jakarta Sans
- [ ] `{P}` logo matches website exactly (JetBrains Mono braces in #525252, Plus Jakarta Sans P in #fafafa)
- [ ] Console header has frosted glass effect (blur backdrop) matching website nav
- [ ] Primary buttons are white (#fafafa bg, #0a0a0a text), NOT blue
- [ ] Service dashboard cards match website card style (12px radius, #111111 bg, hover lift)

---

## Cost Estimate

| Resource | Monthly Cost |
|----------|--------------|
| S3 Storage (~50MB) | ~$0.01 |
| S3 Requests | ~$0.01 |
| CloudFront Data Transfer (1GB) | ~$0.09 |
| CloudFront Requests (10K) | ~$0.01 |
| CloudFront Function (10K invocations) | ~$0.00 |
| Route 53 (existing zone) | $0.50 |
| ACM Certificate | Free |
| **Total** | **~$1-2/month** |
