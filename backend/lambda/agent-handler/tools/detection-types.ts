/**
 * Lensy v2 Detection Types
 *
 * Evidence-aware types for the 3-phase detection architecture.
 * These are the shared contract between backend detection engine and frontend UI.
 *
 * @see docs/lensy-v2-implementation-spec.md
 */

// ── Evidence Model ──────────────────────────────────────────────────────

/**
 * Evidence-aware status for each detection signal.
 *
 * - verified:      Live HTTP 200 with valid content
 * - advertised:    Signal exists (e.g., Link header) but URL not validated or 404'd
 * - mapped:        Page found in llms.txt index (page-specific positive)
 * - not_verified:  All probes failed across all tested paths
 * - experimental:  Emerging standard, not widely adopted — reported but not scored
 */
export type EvidenceStatus = 'verified' | 'advertised' | 'mapped' | 'not_verified' | 'experimental';

/**
 * A single detection signal with evidence metadata.
 * Used for every check in both site-level and page-level reports.
 */
export interface DetectionSignal {
    status: EvidenceStatus;
    /** Detection method that produced this signal, e.g. 'link-header', 'content-negotiation', 'subpath-probe' */
    method?: string;
    /** The actual URL that returned HTTP 200 (null if not verified) */
    validatedUrl?: string | null;
    /** Who benefits from this signal */
    audience?: 'ai_search' | 'coding_agents' | 'both';
    /** Human-readable note, e.g. 'Link header pointed to /llms.txt (404), found at /docs/llms.txt' */
    note?: string | null;
}

// ── Detection Report ────────────────────────────────────────────────────

export interface SiteLevelSignals {
    llmsTxt: DetectionSignal;
    llmsFullTxt: DetectionSignal;
    sitemap: DetectionSignal;
    agentsMd: DetectionSignal;          // experimental
    mcpJson: DetectionSignal;           // experimental
    blockedAiCrawlers: string[];
    allowedAiCrawlers: string[];
    openApiSpecs: string[];
}

export interface PageLevelSignals {
    markdown: DetectionSignal;
    llmsTxtMapping: DetectionSignal;          // is this page listed in llms.txt?
    llmsTxtMarkdownMapping: DetectionSignal;  // is it listed as a .md URL?
    contentNegotiation: DetectionSignal;
}

/**
 * The complete v2 detection report — site-level + page-level.
 * This is the primary output of the 3-phase detection engine.
 */
export interface DetectionReport {
    site: SiteLevelSignals;
    page: PageLevelSignals;
    /** All URLs that were probed, with their HTTP status (for evidence drawers) */
    probeLog: ProbeLogEntry[];
}

export interface ProbeLogEntry {
    url: string;
    /** HTTP status code, or 0 for timeout/network error */
    statusCode: number;
    /** What this probe was checking for */
    purpose: string;
    /** Wall-clock time in ms */
    durationMs: number;
}

// ── Phase 1: Signal Harvest ─────────────────────────────────────────────

/**
 * Signals extracted from prefetched HTML, HTTP headers, and robots.txt.
 * Zero HTTP calls — pure parsing.
 */
export interface HarvestedSignals {
    /** URLs from Link header rel="llms-txt" and X-Llms-Txt */
    llmsTxtHintUrls: string[];
    /** URLs from Link header rel="llms-full-txt" */
    llmsFullTxtHintUrls: string[];
    /** <link rel="alternate" type="text/markdown"> href */
    markdownAlternateUrl: string | null;
    /** HTTP Link header with type="text/markdown" */
    markdownLinkHeaderUrl: string | null;
    /** href="*.md" links found in HTML */
    mdLinksInHtml: string[];
    /** Vary: Accept header present — supporting evidence only, not scored */
    varyAccept: boolean;
    /** X-Robots-Tag value — supporting evidence only */
    xRobotsTag: string | null;
    /** AI crawlers with Disallow rules in robots.txt */
    blockedCrawlers: string[];
    /** AI crawlers explicitly allowed or not mentioned (default allow) */
    allowedCrawlers: string[];
    /** <link rel="canonical"> href */
    canonicalUrl: string | null;
    /** <meta name="robots" content="..."> */
    metaRobots: string | null;
    /** OpenGraph meta tags */
    openGraphTags: Record<string, string>;
    /** Docs subpath derived from URL patterns */
    docsSubpath: string | null;
}

// ── Phase 2: Probe Results ──────────────────────────────────────────────

export interface ProbeResult {
    found: boolean;
    url: string;
    content?: string;
    statusCode?: number;
    contentType?: string;
    headers?: Record<string, string>;
    durationMs?: number;
}

export interface LlmsTxtProbeResults {
    llmsTxt: ProbeResult | null;
    llmsFullTxt: ProbeResult | null;
    /** All candidate URLs that were tried */
    llmsTxtCandidates: string[];
    llmsFullTxtCandidates: string[];
}

export interface MarkdownProbeResults {
    contentNegotiation: ProbeResult | null;
    linkAlternate: ProbeResult | null;
    directMdProbe: ProbeResult | null;
}

export interface ExtrasProbeResults {
    agentsMd: ProbeResult | null;
    mcpJson: ProbeResult | null;
    sitemap: ProbeResult | null;
}

export interface AllProbeResults {
    llmsTxt: LlmsTxtProbeResults;
    markdown: MarkdownProbeResults;
    extras: ExtrasProbeResults;
    probeLog: ProbeLogEntry[];
}

// ── Recommendations (v2) ────────────────────────────────────────────────

export interface RecommendationV2 {
    title: string;
    /** "Why Lensy believes this" — evidence explanation */
    evidence: string;
    /** Who benefits from this fix */
    audience: 'ai_search' | 'coding_agents' | 'both';
    impact: 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    category: string;
    fix: string;
    codeSnippet?: string;
    /** Don't show if related signal is verified */
    suppressIfVerified?: boolean;
}

// ── Helper: create default "not verified" signal ────────────────────────

export function notVerifiedSignal(audience?: DetectionSignal['audience']): DetectionSignal {
    return { status: 'not_verified', audience };
}

export function experimentalSignal(method?: string, audience?: DetectionSignal['audience']): DetectionSignal {
    return { status: 'experimental', method, audience };
}
