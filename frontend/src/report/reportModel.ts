// Single source of truth for what a Lensy scan report contains.
//
// The results page (ScanReport in AppRoutes.tsx) and the report downloads
// (Markdown and PDF, see ./markdown.ts and ./pdf.ts) all read from
// buildReportModel(), so a downloaded file can never drift from what the page
// shows. This logic used to live inline in ScanReport; it was moved here
// unchanged for the H-001 report download.

// Report signal status. Four states, not pass/fail:
//   pass    = verified / good
//   warn    = present but needs improvement
//   neutral = informational / optional (absence is not a failure)
//   fail    = missing / blocking
export type ReportSignalStatus = "pass" | "warn" | "neutral" | "fail";
type SignalStatus = ReportSignalStatus;

// A card's header icon aggregates the state of its signals: any warn/fail ->
// warning, otherwise all-clear -> pass, otherwise informational only -> neutral.
export function aggregateStatus(statuses: ReportSignalStatus[]): ReportSignalStatus {
  if (statuses.some((s) => s === "warn" || s === "fail")) return "warn";
  if (statuses.some((s) => s === "pass")) return "pass";
  return "neutral";
}

// ── v2 evidence-aware detection model (mirrors backend detection-types.ts) ──
export type EvidenceStatus = "verified" | "advertised" | "mapped" | "not_verified" | "experimental";

export interface DetectionSignal {
  status: EvidenceStatus;
  method?: string;
  validatedUrl?: string | null;
  audience?: "ai_search" | "coding_agents" | "both";
  note?: string | null;
}

export interface DetectionData {
  site: {
    llmsTxt: DetectionSignal;
    llmsFullTxt: DetectionSignal;
    sitemap: DetectionSignal;
    agentsMd: DetectionSignal;
    mcpJson: DetectionSignal;
    blockedAiCrawlers?: string[];
    allowedAiCrawlers?: string[];
    openApiSpecs?: string[];
  };
  page: {
    markdown: DetectionSignal;
    llmsTxtMapping: DetectionSignal;
    llmsTxtMarkdownMapping?: DetectionSignal;
    contentNegotiation: DetectionSignal;
  };
  probeLog?: Array<{ url: string; statusCode: number; purpose: string; durationMs: number }>;
}

export const EVIDENCE_LABELS: Record<EvidenceStatus, string> = {
  verified: "Verified",
  advertised: "Advertised",
  mapped: "Mapped",
  not_verified: "Not verified",
  experimental: "Experimental",
};

export const AUDIENCE_LABELS: Record<string, string> = {
  ai_search: "AI search",
  coding_agents: "Coding agents",
  both: "Both",
};


  // A signal now carries the same rich metadata the old UI showed: an evidence
// signal (for the ✓ Verified / ✗ Not verified badge), an audience, an info
// tooltip, and an optional "we can help" waitlist link.
export type Signal = {
  label: string;
  detail: string;
  status: SignalStatus;
  signal?: DetectionSignal;
  info?: string;
  waitlist?: "llmstxt" | "markdown";
  // Static descriptors restored from the pre-redesign UI, shown only when the
  // signal is not passing. `audience` says who benefits (e.g. "AI search");
  // `impact` says how much a missing signal matters (e.g. "Low–medium").
  // For structured-data signals these are definitional constants — the backend
  // does not compute them per scan. Discoverability/content signals instead
  // carry a live audience via `signal.audience` from the detection engine.
  // `impact` is resolved centrally at render time via resolveImpact(label).
  audience?: string;
  // Scoring v2 rows: points earned out of the check's max ("11/15", or one per
  // score for the shared rows), the check ids behind the row, and the fix the
  // backend wrote for that check.
  points?: string;
  checkIds?: string[];
  fix?: string;
};

export type Rec = { category?: string; priority?: string; issue?: string; title?: string; fix?: string; description?: string; codeSnippet?: string };

export type SignalGroup = { title: string; key?: ScoreGroupKey; sections: Array<{ title: string; signals: Signal[] }> };

// ── Scoring v2: two scores (docs/two-score-readiness/spec.md §4, §8) ──
export type ScoreGroupKey = "both" | "coding" | "search";
export type ScoreFilter = "coding" | "search" | null;

export interface ScoreCheck {
  id: string;
  label: string;
  points: number;
  max: number;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
}

export interface ScoringV2 {
  coding: { score: number; checks: ScoreCheck[]; toImprove: number };
  search: { score: number; checks: ScoreCheck[]; toImprove: number };
  gate: {
    state: "pass" | "warn";
    via?: "honest" | "browser";
    honestStatus: number;
    browserStatus?: number;
    robotsBlocks: string[];
    mismatch?: string;
  };
  bots: Array<{ name: string; allowed: boolean }>;
  preview: { format: "markdown" | "html"; chars: number; approxTokens: number; windowShare: number; url?: string } | null;
  tips: string[];
}

// The six AI search and retrieval bots S1 checks (spec §4.3).
export const AI_SEARCH_BOTS = ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User"];

// Agents read about 100,000 characters per fetch (C5).
export const AGENT_WINDOW_CHARS = 100_000;

export function readScoringV2(report: any): ScoringV2 | null {
  const coding = report?.scores?.codingAgents;
  const search = report?.scores?.aiSearch;
  if (report?.scoringVersion !== 2 || !coding || !search) return null;
  const toImprove = (checks: ScoreCheck[]) => checks.filter((c) => c.status !== "pass").length;
  const gate = report.gate || { state: "pass", honestStatus: 0, robotsBlocks: [] };
  const blocked: string[] = Array.isArray(gate.robotsBlocks) ? gate.robotsBlocks : [];
  const p = report.agentPreview;
  return {
    coding: { score: coding.score, checks: coding.checks || [], toImprove: toImprove(coding.checks || []) },
    search: { score: search.score, checks: search.checks || [], toImprove: toImprove(search.checks || []) },
    gate: { ...gate, robotsBlocks: blocked },
    bots: AI_SEARCH_BOTS.map((name) => ({ name, allowed: !blocked.includes(name) })),
    preview: p && typeof p.chars === "number" ? p : null,
    tips: (report.tips || []).map((t: any) => String(t.text || t)).filter(Boolean),
  };
}

// One line for the reachability banner, the same on the page and in the files.
export function gateBannerText(v2: ScoringV2, jsBlocked: boolean): string {
  const g = v2.gate;
  const blocked = v2.bots.filter((b) => !b.allowed).length;
  const robots = blocked === 0 ? `robots.txt allows all ${v2.bots.length} AI search bots` : `robots.txt blocks ${blocked} of ${v2.bots.length} AI search bots`;
  if (jsBlocked) return `Reachability: the page needs JavaScript, so most AI bots see little or nothing. ${robots}.`;
  if (g.state === "pass") return `Reachability: an honest AI agent can read this page (HTTP ${g.honestStatus}). ${robots}.`;
  const browser = g.browserStatus ? ` A browser got HTTP ${g.browserStatus}.` : "";
  return `Reachability warning: the server refused an honest AI agent (HTTP ${g.honestStatus}).${browser} ${robots}.`;
}

export function previewSummary(p: NonNullable<ScoringV2["preview"]>): string {
  const format = p.format === "markdown" ? "Markdown" : "HTML text";
  const fits = p.chars <= AGENT_WINDOW_CHARS
    ? "fits in one fetch"
    : `about ${Math.round(p.windowShare * 100)}% fits in one fetch; the rest is cut off`;
  return `${format}, ${p.chars.toLocaleString("en-US")} characters (about ${p.approxTokens.toLocaleString("en-US")} tokens), ${fits}`;
}

const pts = (c?: ScoreCheck) => (c ? `${c.points}/${c.max}` : "");
const worse = (a: ScoreCheck["status"], b: ScoreCheck["status"]): ReportSignalStatus =>
  a === "fail" || b === "fail" ? "fail" : a === "warn" || b === "warn" ? "warn" : "pass";

// Three cards: what both audiences need, then each score's own checks (§8.2).
function v2SignalGroups(v2: ScoringV2): SignalGroup[] {
  const c = Object.fromEntries(v2.coding.checks.map((x) => [x.id, x]));
  const s = Object.fromEntries(v2.search.checks.map((x) => [x.id, x]));
  // The audience chip is only shown in "Both audiences"; elsewhere the card title says it.
  const row = (x: ScoreCheck | undefined, audience?: string, info?: string): Signal[] => x
    ? [{ label: x.label, detail: x.detail, status: x.status, points: pts(x), checkIds: [x.id], fix: x.fix, audience, info }]
    : [];
  const both: Signal[] = [];
  if (c.C1 || s.S2) {
    const a = c.C1 || s.S2;
    both.push({
      label: "Content without JavaScript",
      detail: a.detail,
      status: worse(c.C1?.status || "pass", s.S2?.status || "pass"),
      points: [c.C1 && `Coding ${pts(c.C1)}`, s.S2 && `Search ${pts(s.S2)}`].filter(Boolean).join(" · "),
      checkIds: [c.C1 && "C1", s.S2 && "S2"].filter(Boolean) as string[],
      fix: c.C1?.fix || s.S2?.fix,
      audience: "both",
      info: "AI crawlers and coding agents read the raw HTML. Most do not run JavaScript.",
    });
  }
  both.push(...row(c.C6, "coding_agents", "One H1, no skipped levels, and ids on H2/H3 so an agent can jump to a section."));
  both.push(...row(s.S5, "ai_search", "AI search quotes sections, so each H2/H3 section should answer one question on its own."));
  const coding = ["C2", "C3", "C4", "C5"].flatMap((id) => row(c[id]));
  const search = ["S1", "S3", "S4", "S6"].flatMap((id) => row(s[id]));
  return [
    { title: "Both audiences", key: "both", sections: [{ title: "", signals: both }] },
    { title: "Coding agents", key: "coding", sections: [{ title: "", signals: coding }] },
    { title: "AI search", key: "search", sections: [{ title: "", signals: search }] },
  ];
}

// What a score card shows when clicked: the shared rows that feed that score,
// plus that score's own card.
export function filterGroups(groups: SignalGroup[], filter: ScoreFilter): SignalGroup[] {
  if (!filter) return groups;
  const prefix = filter === "coding" ? "C" : "S";
  return groups
    .filter((g) => g.key === "both" || g.key === filter)
    .map((g) => g.key !== "both" ? g : {
      ...g,
      sections: g.sections.map((sec) => ({ ...sec, signals: sec.signals.filter((sig) => (sig.checkIds || []).some((id) => id.startsWith(prefix))) })),
    });
}

// Fixes for the v2 checks, in the same Quick Wins / Deeper / Watch shape the
// recommendations view uses. Ordered by points lost; tips are "watch" items.
function v2Recommendations(v2: ScoringV2): Rec[] {
  const seen = new Set<string>();
  const items: Array<Rec & { lost: number }> = [];
  for (const [category, checks] of [["Coding agents", v2.coding.checks], ["AI search", v2.search.checks]] as const) {
    for (const x of checks) {
      if (x.status === "pass" || !x.fix) continue;
      // C1 and S2 are the same check scored twice; list its fix once.
      const key = x.id === "S2" ? "C1" : x.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const lost = x.max - x.points;
      items.push({ category: key === "C1" ? "Both audiences" : category, priority: lost >= 10 ? "high" : lost >= 5 ? "medium" : "low", issue: `${x.label}: ${x.detail}`, fix: x.fix, lost });
    }
  }
  items.sort((a, b) => b.lost - a.lost);
  // A tip reads "What we saw. Why it matters." Split it into the title and the body.
  const tips: Rec[] = v2.tips.map((t) => {
    const cut = t.indexOf(". ");
    return cut > 0
      ? { category: "Tip", priority: "best-practice", issue: t.slice(0, cut), fix: t.slice(cut + 2) }
      : { category: "Tip", priority: "best-practice", issue: t, fix: "Not scored." };
  });
  return [...items.map(({ lost, ...r }) => r), ...tips];
}

export const TIER_LABELS: Record<string, string> = { high: "High intent", mid: "Mid intent", low: "Low intent" };

export interface ReportModelInput {
  report?: any;
  overallScoreData?: any;
  detectionData?: DetectionData;
  citationData?: any;
}

export function buildReportModel({ report, overallScoreData, detectionData, citationData }: ReportModelInput) {

  // ── Per-signal impact ──
  // Primary source: the backend now emits `report.signalImpact`, a map of stable
  // signal id -> 'high'|'medium'|'low', derived from the same scoring weights the
  // backend uses (single source of truth). We read that first so every signal
  // shows a consistent impact chip. A small local fallback map covers reports
  // persisted before this field existed. Content-quality labels carry live values
  // (e.g. "Text-to-HTML: 4.1%"), so we key by the label prefix, not the full label.
  const IMPACT_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
  const impactKeyFor = (label: string) => label.toLowerCase().split(":")[0].trim();
  // Fallback tiers for legacy reports without report.signalImpact.
  const legacyImpact: Record<string, "high" | "medium" | "low"> = {
    "llms.txt": "high", "llms-full.txt": "low", "sitemap": "medium", "canonical url": "medium",
    "meta robots": "high", "indexing directive": "high", "page markdown": "high", "page in llms.txt": "low",
    "content negotiation": "medium", "agents.md": "low", "mcp config": "low", "json-ld": "medium",
    "opengraph": "high", "breadcrumbs": "low", "client-side rendered": "high", "text-to-html": "medium",
    "headings": "high", "word count": "medium", "code blocks": "low", "links": "low",
  };
  const backendImpact: Record<string, "high" | "medium" | "low"> | undefined = report?.signalImpact;
  const resolveImpact = (label: string): string | undefined => {
    const key = impactKeyFor(label);
    const tier = backendImpact?.[key] || legacyImpact[key];
    return tier ? IMPACT_LABEL[tier] : undefined;
  };

  const v2 = readScoringV2(report);
  const signalGroups: SignalGroup[] = v2 ? v2SignalGroups(v2) : [];
  const categories = report?.categories;
  const botAccess = categories?.botAccess;
  // Prefer the canonical report state, but fall back to deriving `js_blocked`
  // from the JS-render signal. Restored from PR 20 (fix: correctly identify and
  // handle JS-rendered SPAs): a JS-rendered SPA is effectively invisible to AI
  // bots regardless of robots.txt, so the bot-access banner must NOT read
  // "10/10 allowed". The redesign dropped this fallback, so when the backend
  // didn't populate botAccessState=js_blocked (e.g. reloaded report), the banner
  // wrongly showed full access for JS-rendered pages.
  const isJsRendered =
    categories?.consumability?.originRequiresJavaScript === true ||
    categories?.consumability?.jsRendered === true;
  // N-03: read the canonical top-level report.botAccessState (values:
  // js_blocked | fully_blocked | partially_blocked | accessible). The old code
  // read report.overallScore.botAccessState, but overallScore is a NUMBER, so
  // that was always undefined — fully/partially-blocked sites fell through to a
  // green "N/N allowed" banner. Keep the JS-render fallback for legacy reports
  // that predate the field.
  const botAccessState =
    report?.botAccessState ?? (isJsRendered ? "js_blocked" : undefined);

  // N-03: build the bot-access banner text from the canonical state + robots.txt
  // presence. Rules: no robots.txt (404) => don't claim "N/N allowed" (there's
  // nothing granting access); fully_blocked => all bots blocked; partially =>
  // some blocked; js_blocked handled separately in the JSX.
  const botAccessBannerText = (): string => {
    if (!botAccess) return "Bot access data unavailable";
    const total = (botAccess.allowedCount ?? 0) + (botAccess.blockedCount ?? 0);
    if (!botAccess.robotsTxtFound) {
      // Absent robots.txt: bots are allowed by default, but we don't assert a count.
      return "! No robots.txt found — bot access is not explicitly configured";
    }
    if (botAccessState === "fully_blocked" || botAccess.allowedCount === 0) {
      return `✗ Bot access: all ${total} checked crawlers are blocked`;
    }
    if (botAccessState === "partially_blocked" || botAccess.blockedCount > 0) {
      return `! Bot access: ${botAccess.allowedCount} / ${total} allowed (${botAccess.blockedCount} blocked)`;
    }
    return `✓ Bot access: ${botAccess.allowedCount} / ${total} allowed`;
  };

  // Detection report: prefer the live category-result (asyncCards.detection,
  // threaded as detectionData), fall back to report.detection when reloading a
  // persisted report. Drives the evidence badges and detection-only signals.
  const detection: DetectionData | undefined = detectionData || report?.detection;

  // Card header aggregate icon uses the backend scoreBreakdown thresholds from
  // the old UI (structuredData >= 15, discoverability >= 30, consumability >= 32),
  // falling back to aggregating the child signal statuses when unavailable.
  const scoreBreakdown = report?.scoreBreakdown || overallScoreData?.scoreBreakdown;
  const headerStatus = (key: "structuredData" | "discoverability" | "consumability", threshold: number, signals: Signal[]): SignalStatus => {
    const val = scoreBreakdown?.[key];
    if (typeof val === "number") return val >= threshold ? "pass" : "warn";
    return aggregateStatus(signals.map((s) => s.status));
  };

  if (!v2 && categories?.structuredData) {
    const s = categories.structuredData;
    const signals: Signal[] = [
      {
        label: "JSON-LD",
        status: s.jsonLd.found ? "pass" : "fail",
        detail: s.jsonLd.found
          ? `Found ${s.jsonLd.types.length ? s.jsonLd.types.join(", ") + " markup" : "markup"}${s.schemaCompleteness?.status === "complete" ? ". Schema is complete." : s.schemaCompleteness?.status === "partial" ? " — some optional fields could be added." : "."}`
          : "Structured data can improve machine understanding and rich-search eligibility. Helpful for discoverability, but not a major coding-agent blocker.",
        info: "Secondary improvement for AI search — not a core coding-agent requirement.",
        audience: "ai_search",
      },
      {
        label: "OpenGraph",
        status: s.openGraphCompleteness.score === "complete" ? "pass" : "fail",
        detail: s.openGraphCompleteness.score === "complete"
          ? "All required tags are present."
          : s.openGraphCompleteness.score === "partial"
            ? `Found, but missing ${s.openGraphCompleteness.missingTags.slice(0, 2).join(", ")}.`
            : "Not found.",
        info: "Controls the preview card when your link is shared on social channels.",
      },
      {
        label: "Breadcrumbs",
        status: s.breadcrumbs.found ? "pass" : "fail",
        detail: s.breadcrumbs.found
          ? "BreadcrumbList schema found."
          : "Breadcrumb markup helps search systems understand page hierarchy. Useful, but lower priority than crawlability and Markdown access.",
        info: "Helps search systems display page hierarchy — secondary AI search signal.",
        audience: "ai_search",
      },
    ];
    signalGroups.push({ title: "Structured data", sections: [{ title: "", signals }] });
  }

  if (!v2 && categories?.discoverability) {
    const d = categories.discoverability;
    const consumability = categories.consumability;

    let siteSignals: Signal[];
    let pageSignals: Signal[];

    if (detection) {
      // ── Evidence-aware signals from the v2 detection engine ──
      const site = detection.site;
      const page = detection.page;
      siteSignals = [
        {
          label: "llms.txt",
          signal: site.llmsTxt,
          status: site.llmsTxt.status === "verified" ? "pass" : site.llmsTxt.status === "advertised" ? "warn" : "fail",
          detail: site.llmsTxt.status === "verified"
            ? `Verified at ${site.llmsTxt.validatedUrl || "found URL"}. AI coding tools can consume your docs directly.`
            : site.llmsTxt.status === "advertised"
              ? `Advertised via ${site.llmsTxt.method || "header"} but not validated. ${site.llmsTxt.note || ""}`
              : "Not verified from tested paths.",
          info: "A markdown table of contents for your docs. Helps AI coding tools find and consume your content at inference time.",
          waitlist: site.llmsTxt.status === "not_verified" ? "llmstxt" : undefined,
        },
        {
          label: "llms-full.txt",
          signal: site.llmsFullTxt,
          status: site.llmsFullTxt.status === "verified" ? "pass" : site.llmsFullTxt.status === "advertised" ? "warn" : "neutral",
          detail: site.llmsFullTxt.status === "verified"
            ? `Verified at ${site.llmsFullTxt.validatedUrl}. Full doc content available for coding agents.`
            : site.llmsFullTxt.status === "advertised"
              ? "Advertised but not validated."
              : "Not found (optional for large doc sites).",
          info: "The complete concatenation of all doc pages. Useful for coding agents that need full context.",
        },
        {
          label: "Sitemap",
          signal: site.sitemap,
          status: site.sitemap.status === "verified" ? "pass" : "fail",
          detail: site.sitemap.status === "verified" ? "Found. Crawlers can discover all your pages." : "Not found. Crawlers may miss deeper pages.",
          info: "Lists every page on your site so crawlers don't have to guess.",
        },
        {
          label: "Canonical URL",
          status: d.canonical.found ? "pass" : "fail",
          detail: d.canonical.found ? "Set. Prevents duplicate indexing." : "Not set. Search engines may index duplicate versions.",
          info: "Tells search engines which URL is the authoritative version of this page.",
        },
        ...(d.metaRobots.blocksIndexing
          ? [{ label: "Meta Robots", status: "fail" as SignalStatus, detail: `Set to "${d.metaRobots.content}". Blocks indexing.`, info: "Your meta robots tag is preventing indexing." }]
          : []),
      ];
      pageSignals = [
        {
          label: "Page Markdown",
          signal: page.markdown,
          status: page.markdown.status === "verified" ? "pass" : page.markdown.status === "advertised" ? "warn" : "neutral",
          detail: page.markdown.status === "verified"
            ? `Verified via ${page.markdown.method || "probe"}. Coding agents can consume this page as markdown.`
            : page.markdown.status === "advertised"
              ? `Advertised but not validated. ${page.markdown.note || ""}`
              : "Markdown was not verified for this page.",
          info: "Whether this page can be served as markdown for AI coding tools.",
        },
        {
          label: "Page in llms.txt",
          signal: page.llmsTxtMapping,
          status: page.llmsTxtMapping.status === "mapped" ? "pass" : "neutral",
          detail: page.llmsTxtMapping.status === "mapped"
            ? `This page is listed in llms.txt${page.llmsTxtMapping.validatedUrl ? ` as ${page.llmsTxtMapping.validatedUrl}` : ""}.`
            : site.llmsTxt.status === "verified"
              ? "Site has llms.txt but this page is not listed in it."
              : "Cannot check — llms.txt not found.",
          info: "Whether this specific page is listed in the site's llms.txt index.",
        },
        {
          label: "Content Negotiation",
          signal: page.contentNegotiation,
          status: page.contentNegotiation.status === "verified" ? "pass" : "neutral",
          detail: page.contentNegotiation.status === "verified"
            ? "Server returns markdown when requested with Accept: text/markdown."
            : "Server does not support content negotiation for this page.",
          info: "Whether the server returns markdown when an AI agent sends Accept: text/markdown header.",
        },
      ];
    } else {
      // ── Fallback: v1 category signals when no detection report is present ──
      siteSignals = [
        {
          label: "llms.txt",
          status: d.llmsTxt.found ? "pass" : "fail",
          detail: d.llmsTxt.found ? `Verified at ${d.llmsTxt.url}.` : "Not found. llms.txt helps AI coding tools consume your docs faster.",
          info: "A markdown table of contents for your docs. Helps AI coding tools find and consume your content at inference time.",
          waitlist: d.llmsTxt.found ? undefined : "llmstxt",
        },
        {
          label: "llms-full.txt",
          status: d.llmsFullTxt.found ? "pass" : "neutral",
          detail: d.llmsFullTxt.found ? `Verified at ${d.llmsFullTxt.url}.` : "Not found (optional for large doc sites).",
          info: "The complete concatenation of all doc pages. Useful for coding agents that need full context.",
        },
        {
          label: "Sitemap",
          status: d.sitemapXml.found ? "pass" : "fail",
          detail: d.sitemapXml.found ? "Found. Crawlers can discover your pages." : "Not found. Crawlers may miss deeper pages.",
          info: "Lists every page on your site so crawlers don't have to guess.",
        },
        {
          label: "Canonical URL",
          status: d.canonical.found ? "pass" : "fail",
          detail: d.canonical.found ? "Set. Prevents duplicate indexing." : "Not set. Search engines may index duplicate versions.",
          info: "Tells search engines which URL is the authoritative version of this page.",
        },
        ...(d.metaRobots.blocksIndexing
          ? [{ label: "Meta Robots", status: "fail" as SignalStatus, detail: `Set to "${d.metaRobots.content}". Blocks indexing.`, info: "Your meta robots tag is preventing indexing." }]
          : []),
      ];
      pageSignals = [
        {
          label: "Page Markdown",
          status: consumability?.markdownAvailable.found ? "pass" : "neutral",
          detail: consumability?.markdownAvailable.found
            ? (consumability.markdownAvailable.discoverable ? "Available and discoverable by coding agents." : 'Available but not easily discoverable. Add a <link rel="alternate" type="text/markdown"> tag.')
            : "No machine-readable Markdown version was found.",
          info: "AI coding agents work better with markdown (up to 80% fewer tokens).",
          waitlist: consumability?.markdownAvailable.found ? undefined : "markdown",
        },
        {
          label: "Indexing directive",
          status: d.metaRobots.blocksIndexing ? "fail" : "pass",
          detail: d.metaRobots.blocksIndexing ? "The returned meta robots directive blocks indexing." : "The returned meta robots directive does not block indexing.",
          info: "Whether a meta robots directive is preventing this page from being indexed.",
        },
      ];
    }

    // Experimental signals (AGENTS.md, MCP Config) — only when detected.
    const experimentalSignals: Signal[] = [];
    if (detection) {
      if (detection.site.agentsMd.status === "experimental" && detection.site.agentsMd.validatedUrl) {
        experimentalSignals.push({
          label: "AGENTS.md",
          signal: detection.site.agentsMd,
          status: "neutral",
          detail: `Found at ${detection.site.agentsMd.validatedUrl}. Emerging standard — not scored.`,
          info: "Vercel convention for declaring agent-readiness. Not widely adopted yet.",
        });
      }
      if (detection.site.mcpJson.status === "experimental" && detection.site.mcpJson.validatedUrl) {
        experimentalSignals.push({
          label: "MCP Config",
          signal: detection.site.mcpJson,
          status: "neutral",
          detail: `Found at ${detection.site.mcpJson.validatedUrl}. Emerging standard — not scored.`,
          info: "MCP server discovery file. Not widely adopted yet.",
        });
      }
    }

    const discSections: Array<{ title: string; signals: Signal[] }> = [
      { title: "Site-level", signals: siteSignals },
      { title: "Page-level", signals: pageSignals },
    ];
    if (experimentalSignals.length) discSections.push({ title: "Experimental", signals: experimentalSignals });
    signalGroups.push({ title: "Discoverability", sections: discSections });
  }

  if (!v2 && categories?.consumability) {
    const consumability = categories.consumability;
    const h1 = consumability.headingHierarchy.h1Count;
    const h2 = consumability.headingHierarchy.h2Count || 0;
    const h3 = consumability.headingHierarchy.h3Count || 0;
    const wordCount = consumability.wordCount || 0;
    const markdownFound = Boolean(consumability.markdownAvailable?.found);

    // Content-quality signals follow the pre-redesign rules. A non-passing item
    // here is a warning ("needs improvement"), not a hard failure.
    const contentSignals: Signal[] = [];

    // Client-side rendered: a hard problem — AI crawlers see a blank page.
    if (consumability.jsRendered) {
      contentSignals.push({
        label: "Client-Side Rendered",
        status: "fail",
        detail: "Page relies on JavaScript to render. AI crawlers see a blank page.",
        info: "Most AI bots don't run JavaScript. Client-side rendered pages appear empty to them.",
        audience: "both",
      });
    }

    // Text-to-HTML: a good ratio, OR a markdown alternative, counts as a pass.
    const textPass = consumability.textToHtmlRatio.status === "good" || markdownFound;
    contentSignals.push({
      label: `Text-to-HTML: ${(consumability.textToHtmlRatio.ratio * 100).toFixed(1)}%`,
      status: textPass ? "pass" : "warn",
      detail: textPass
        ? (consumability.textToHtmlRatio.status === "good"
            ? "Good ratio. AI crawlers can extract content efficiently."
            : "Low ratio, but a markdown alternative is available for coding agents.")
        : "AI crawlers may process mostly noise (scripts, CSS, nav).",
      info: "Higher ratio means more content relative to markup. Below 5% is concerning unless a markdown alternative exists.",
      audience: "ai_search",
    });

    // Headings: exactly one H1 and at least one H2 is a well-structured page.
    const headingsPass = h1 === 1 && h2 >= 1;
    const headingsDetail = consumability.headingHierarchy.hasProperNesting
      ? `Well-structured. AI can split into ${h2} chunks.`
      : h1 === 0
        ? "No H1 found."
        : h1 > 1
          ? `${h1} H1 tags. Use exactly one.`
          : h2 === 0
            ? "No H2s. Content is one big block."
            : "Heading nesting is inconsistent.";
    contentSignals.push({
      label: `Headings: ${h1} H1, ${h2} H2, ${h3} H3`,
      status: headingsPass ? "pass" : "warn",
      detail: headingsDetail,
      info: "AI splits pages at heading boundaries. Each H2 becomes a separately retrievable unit.",
      audience: "both",
    });

    // Word count: sweet spot is 500-2,000 words.
    if (wordCount > 0) {
      const wordPass = wordCount >= 500 && wordCount <= 2000;
      const wordDetail = wordCount < 500
        ? `Only ${wordCount.toLocaleString()} words. Pages under 500 often lack context for AI.`
        : wordCount > 2000
          ? `${wordCount.toLocaleString()} words. Consider splitting.`
          : `${wordCount.toLocaleString()} words. Good depth.`;
      contentSignals.push({
        label: `Word count: ${wordCount.toLocaleString()}`,
        status: wordPass ? "pass" : "warn",
        detail: wordDetail,
        info: "Sweet spot is 500-2,000 words.",
        audience: "ai_search",
      });
    }

    // Code blocks: only shown when the page actually has code.
    if (consumability.codeBlocks.hasCode) {
      const codePass = consumability.codeBlocks.withLanguageHints > 0;
      const codeDetail = consumability.codeBlocks.withLanguageHints === consumability.codeBlocks.count
        ? `All ${consumability.codeBlocks.count} blocks have language hints.`
        : consumability.codeBlocks.withLanguageHints > 0
          ? `${consumability.codeBlocks.withLanguageHints}/${consumability.codeBlocks.count} have language hints.`
          : `${consumability.codeBlocks.count} blocks found, none have language hints.`;
      contentSignals.push({
        label: `Code blocks: ${consumability.codeBlocks.count}`,
        status: codePass ? "pass" : "warn",
        detail: codeDetail,
        info: "Language hints help AI search engines and coding assistants understand code examples.",
        audience: "coding_agents",
      });
    }

    // Links: internal link density.
    const linksPass = consumability.internalLinkDensity.status === "good";
    const linksDetail = consumability.internalLinkDensity.status === "good"
      ? `${consumability.internalLinkDensity.count} internal links. Good cross-referencing.`
      : consumability.internalLinkDensity.status === "sparse"
        ? `Only ${consumability.internalLinkDensity.count} internal link${consumability.internalLinkDensity.count === 1 ? "" : "s"}. Add cross-references to related pages.`
        : `${consumability.internalLinkDensity.count} internal links — high density relative to content length.`;
    contentSignals.push({
      label: `Links: ${consumability.internalLinkDensity.count}`,
      status: linksPass ? "pass" : "warn",
      detail: linksDetail,
      info: "Internal links help AI understand how your pages relate.",
      audience: "both",
    });

    signalGroups.push({ title: "Content quality", sections: [{ title: "", signals: contentSignals }] });
  }

  if (!v2 && !categories && report?.dimensions) {
    Object.entries(report.dimensions).forEach(([dimKey, dimData]: [string, any]) => {
      const signals: Signal[] = (dimData.signals || []).map((signal: any): Signal => ({
        label: signal.name || "Check",
        detail: signal.message || "Completed",
        status: signal.status === "pass" ? "pass" : signal.status === "warn" ? "warn" : signal.status === "neutral" || signal.status === "info" ? "neutral" : "fail",
      }));
      if (signals.length > 0) signalGroups.push({ title: dimData.title || dimKey, sections: [{ title: "", signals }] });
    });
  }

  // ── Recommendations: keep the full objects and group them like the old UI ──
  // Quick Wins = high priority; Deeper Improvements = medium/low; Things to Watch
  // = best-practice (informational, non-scored). Each rec carries category, fix,
  // an optional codeSnippet, and effort is derived from whether a snippet exists.
  let allRecs: Rec[] = v2 ? v2Recommendations(v2) : report?.recommendations || [];
  if (!v2 && allRecs.length === 0 && report?.dimensions) {
    allRecs = Object.values(report.dimensions).flatMap((d: any) => (d.recommendations || []).map((r: any) => ({
      category: d.title,
      priority: r.priority,
      issue: r.title || r.text || "Improvement",
      fix: r.description || "Consider improving this dimension.",
    })));
  }
  const recIssue = (r: Rec) => r.issue || r.title || r.category || "Improvement needed";
  const recFix = (r: Rec) => r.fix || r.description || "Review this area for potential improvements.";
  const scoredRecs = allRecs.filter((r) => r.priority !== "best-practice");
  const quickWins = scoredRecs.filter((r) => r.priority === "high");
  const deeperImprovements = scoredRecs.filter((r) => r.priority !== "high");
  const thingsToWatch = allRecs.filter((r) => r.priority === "best-practice");
  const impactLabel = (r: Rec) => (r.priority === "high" ? "High impact" : r.priority === "medium" ? "Medium impact" : "Low impact");
  const effortLabel = (r: Rec) => (r.codeSnippet ? "Medium effort" : "Low effort");
  const actionLink = (r: Rec): { href: string; label: string } | null => {
    const issue = recIssue(r).toLowerCase();
    // Two-score fixes: offer help only when the file is missing, not when it exists and loses points.
    if (v2) {
      if (issue.startsWith("llms.txt usable: not found")) return { href: "/contact?ref=llmstxt", label: "We can help you generate one" };
      if (issue.startsWith(".md version discoverable: no .md version")) return { href: "/contact?ref=markdown", label: "We can help you generate markdown" };
      return null;
    }
    const category = (r.category || "").toLowerCase();
    if (issue.includes("llms.txt")) return { href: "/contact?ref=llmstxt", label: "We can help you generate one" };
    // N-10: only offer "generate markdown" for recommendations genuinely about
    // serving a markdown version of the docs — not any rec that happens to
    // contain the word "markdown". The Breadcrumbs / structured-data recs
    // mention it incidentally and were getting a bogus markdown link. Gate on
    // markdown-serving phrasing and exclude structured-data recs.
    const isMarkdownServingRec =
      /markdown version|serve a \.md|\.md version|rel="alternate"|markdown alternate|no markdown/.test(issue) &&
      !category.includes("structured") &&
      !issue.includes("breadcrumb") &&
      !issue.includes("json-ld");
    if (isMarkdownServingRec) return { href: "/contact?ref=markdown", label: "We can help you generate markdown" };
    return null;
  };
  const totalRecCount = allRecs.length;

  // T-06: surface the real backend fix guidance directly under each failing/
  // warning signal (previously it lived only in the "All recommendations" view).
  // We match a signal to its recommendation by the same fuzzy identity used for
  // impact, so the guidance stays in sync with the backend and is never hardcoded.
  const fixForSignal = (label: string): string | undefined => {
    if (v2) return signalGroups.flatMap((g) => g.sections).flatMap((sec) => sec.signals).find((sig) => sig.label === label)?.fix;
    const key = impactKeyFor(label);
    const match = allRecs.find((r) => {
      const hay = `${recIssue(r)} ${r.category || ""}`.toLowerCase();
      return hay.includes(key)
        || (key === "headings" && /heading|h1|h2/.test(hay))
        || (key === "text-to-html" && hay.includes("text-to-html"))
        || (key === "client-side rendered" && hay.includes("javascript"))
        || (key === "word count" && hay.includes("word"))
        || (key === "code blocks" && hay.includes("code block"))
        || (key === "links" && hay.includes("internal link"))
        || (key === "canonical url" && hay.includes("canonical"))
        || (key === "meta robots" && hay.includes("noindex"))
        || (key === "page markdown" && hay.includes("markdown"))
        // T-06: the signal label is plural ("Breadcrumbs") but the backend's
        // recommendation text says "breadcrumb" (singular, e.g. "No
        // BreadcrumbList schema found"), so the plain hay.includes(key) above
        // never matched and this signal silently got no Fix line.
        || (key === "breadcrumbs" && hay.includes("breadcrumb"));
    });
    return match ? recFix(match) : undefined;
  };

  const aiDisc = citationData || report?.aiDiscoverability;
  const citationEngines = Object.entries(aiDisc?.engines || {}) as Array<[string, any]>;
  const availableCitationEngines = citationEngines.filter(([, engine]) => engine?.available);
  // Human-readable engine name for attribution (T-09). e.g. "perplexity" -> "Perplexity".
  const CITATION_ENGINE_LABELS: Record<string, string> = { perplexity: "Perplexity", chatgpt: "ChatGPT", gemini: "Gemini", claude: "Claude" };
  const engineLabel = (name: string) => CITATION_ENGINE_LABELS[name.toLowerCase()] || name.charAt(0).toUpperCase() + name.slice(1);
  // Intent tier per query (T-08): backend sends parallel arrays queries[] and
  // queryTypes[]. Map a result back to its tier by matching the query string.
  const queryTierByText: Record<string, "high" | "mid" | "low"> = {};
  (aiDisc?.queries || []).forEach((q: string, i: number) => { const t = aiDisc?.queryTypes?.[i]; if (t) queryTierByText[q] = t; });
  // Flatten results, tagging each with its engine name and intent tier.
  const citationResults = availableCitationEngines.flatMap(([name, engine]) =>
    (engine.results || []).map((r: any) => ({ ...r, engine: name, tier: queryTierByText[r.query] }))
  );
  // Group by intent tier for tiered display; keep engine attribution per row.
  const citationsByTier = (["high", "mid", "low"] as const)
    .map((tier) => ({ tier, rows: citationResults.filter((r: any) => r.tier === tier) }))
    .filter((g) => g.rows.length > 0);
  const citationsUntiered = citationResults.filter((r: any) => !r.tier);
  // Distinct engine label(s) tested, for the results header.
  const testedEngineLabel = availableCitationEngines.map(([name]) => engineLabel(name)).join(", ");
  const citedCount = citationResults.filter((result: any) => result.cited).length;
  const citationsReturned = Boolean(aiDisc);
  // "To improve" counts actionable signals only — warnings and hard failures.
  // 'neutral' (informational/optional) and 'pass' do not count against the user.
  const isActionable = (status: SignalStatus) => status === "warn" || status === "fail";
  const failingSignalCount = signalGroups.flatMap((group) => group.sections).flatMap((section) => section.signals).filter((s) => isActionable(s.status)).length;
  const failingGroupCount = signalGroups.filter((group) => group.sections.some((section) => section.signals.some((s) => isActionable(s.status)))).length;

  // Header status for a signal group card, using the same backend thresholds
  // the results page always used.
  const groupStatus = (group: SignalGroup): SignalStatus => {
    const all = group.sections.flatMap((s) => s.signals);
    if (group.title === "Structured data") return headerStatus("structuredData", 15, all);
    if (group.title === "Discoverability") return headerStatus("discoverability", 30, all);
    if (group.title === "Content quality") return headerStatus("consumability", 32, all);
    return aggregateStatus(all.map((x) => x.status));
  };

  return {
    v2,
    categories,
    botAccess,
    botAccessState,
    botAccessBannerText,
    isJsRendered,
    detection,
    signalGroups,
    groupStatus,
    resolveImpact,
    fixForSignal,
    allRecs,
    quickWins,
    deeperImprovements,
    thingsToWatch,
    totalRecCount,
    recIssue,
    recFix,
    impactLabel,
    effortLabel,
    actionLink,
    aiDisc,
    availableCitationEngines,
    engineLabel,
    citationResults,
    citationsByTier,
    citationsUntiered,
    testedEngineLabel,
    citedCount,
    citationsReturned,
    failingSignalCount,
    failingGroupCount,
  };
}

export type ReportModel = ReturnType<typeof buildReportModel>;
