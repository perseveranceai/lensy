// Turns a finished scan into the plain data both report downloads print
// (H-001): Markdown for coding agents (./markdown.ts) and PDF for people
// (./pdf.ts). Everything comes from buildReportModel(), the same function the
// results page renders from, so a file never shows something the page doesn't.
import { buildReportModel, EVIDENCE_LABELS, AUDIENCE_LABELS, TIER_LABELS } from "./reportModel";
import type { ReportSignalStatus, DetectionData, Rec } from "./reportModel";

export type CitationsState = "done" | "no_engine" | "no_results" | "failed" | "not_run";

export interface ExportSignal {
  label: string;
  status: ReportSignalStatus;
  evidence?: string;
  audience?: string;
  impact?: string;
  detail: string;
  fix?: string;
  note?: string;
}

export interface ExportRec {
  issue: string;
  impact: string;
  effort: string;
  category?: string;
  fix: string;
  codeSnippet?: string;
  helpLink?: { label: string; href: string };
}

export interface ExportCitationRow {
  query: string;
  tier?: string;
  engine: string;
  cited: boolean;
  citedUrl?: string;
  competingDomains: string[];
}

export interface ExportReport {
  url: string;
  hostname: string;
  reportId?: string;
  /** ISO time the scan finished, or null for reports saved before generatedAt existed. */
  scannedAt: string | null;
  downloadedAt: string;
  readinessSeconds?: number;
  score: number | null;
  signalsToImprove: number;
  categoriesToImprove: number;
  docCheck: { label: string; signals: string[] } | null;
  bots: {
    banner: string;
    robotsUrl: string | null;
    jsBlocked: boolean;
    note?: string;
    list: Array<{ name: string; allowed: boolean }>;
  };
  groups: Array<{ title: string; status: ReportSignalStatus; sections: Array<{ title: string; signals: ExportSignal[] }> }>;
  citations: {
    state: CitationsState;
    reason?: string;
    engine?: string;
    cited: number;
    total: number;
    seconds?: number;
    rows: ExportCitationRow[];
    notes: Array<{ issue: string; fix: string }>;
  };
  recommendations: { quickWins: ExportRec[]; deeper: ExportRec[]; watch: ExportRec[]; total: number };
  helpLinks: Array<{ label: string; href: string }>;
}

export interface ExportInput {
  report: any;
  url?: string;
  sessionId?: string | null;
  overallScoreData?: any;
  detectionData?: DetectionData;
  citationData?: any;
  /** Why citations are missing when the download had to go ahead without them. */
  citationsReason?: string;
  /** The user chose to download before the citations check finished. */
  citationsSkipped?: boolean;
  /** Lets tests pin the clock. */
  now?: Date;
  /** Absolute origin for help links (defaults to window.location.origin). */
  origin?: string;
}

export const STATUS_WORD: Record<ReportSignalStatus, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  neutral: "INFO",
};

// The page prefixes some banners with ✓ / ✗ / !. Files print the words only:
// PDF fonts have no glyph for those symbols and agents don't need them.
const stripGlyph = (text: string) => text.replace(/^[✓✗!]\s*/, "").trim();

function parseUrl(raw: string): URL | null {
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

export function buildExportReport(input: ExportInput): ExportReport {
  const { report, overallScoreData, detectionData, citationData } = input;
  const model = buildReportModel({ report, overallScoreData, detectionData, citationData });
  const url = report?.scope?.url || report?.url || input.url || "";
  const parsed = parseUrl(url);
  const hostname = parsed?.hostname || url;
  const origin = input.origin ?? (typeof window !== "undefined" ? window.location.origin : "https://perseveranceai.com");

  // ── Page check (the docs-confidence chip and its tooltip) ──
  const docConf = overallScoreData?.docConfidence || report?.docConfidence;
  let docCheck: ExportReport["docCheck"] = null;
  if (docConf) {
    const raw = docConf.score;
    const pct = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
    const message = docConf.label || (pct >= 75 ? "Likely a doc page" : pct >= 40 ? "May be a doc page" : "Unlikely a doc page");
    docCheck = {
      label: docConf.markdownRescued ? "Recovered via markdown alternate" : `${message} (${pct}%)`,
      signals: Array.isArray(docConf.signals) ? docConf.signals.map(String) : [],
    };
  }

  // ── Bot access (same rules as the banner on the page) ──
  const jsBlocked = model.botAccessState === "js_blocked";
  const botAccess = model.botAccess;
  const bots = {
    banner: jsBlocked ? "AI bot access is blocked by JavaScript" : stripGlyph(model.botAccessBannerText()),
    robotsUrl: botAccess?.robotsTxtFound && parsed ? `${parsed.protocol}//${parsed.hostname}/robots.txt` : null,
    jsBlocked,
    note: jsBlocked
      ? "This page is a JavaScript-rendered SPA. Most AI bots do not execute JavaScript, making your content invisible to them regardless of your robots.txt configuration. Lensy rendered this page for content analysis; most AI bots cannot."
      : !botAccess?.bots?.length
        ? report ? "No checked crawler names were returned." : "No bot access data returned."
        : undefined,
    list: (botAccess?.bots || []).map((bot: any) => ({
      name: String(bot.name),
      allowed: !jsBlocked && (bot.status === "allowed" || bot.status === "not-mentioned"),
    })),
  };

  // ── Signals ──
  const groups = model.signalGroups.map((group) => ({
    title: group.title,
    status: model.groupStatus(group),
    sections: group.sections.map((section) => ({
      title: section.title,
      signals: section.signals.map((sig): ExportSignal => {
        const audienceKey = sig.signal?.audience || sig.audience;
        const failing = sig.status !== "pass";
        return {
          label: sig.label,
          status: sig.status,
          evidence: sig.signal ? EVIDENCE_LABELS[sig.signal.status] : undefined,
          audience: audienceKey ? AUDIENCE_LABELS[audienceKey] || audienceKey : undefined,
          impact: failing ? model.resolveImpact(sig.label) : undefined,
          detail: sig.detail,
          fix: failing ? model.fixForSignal(sig.label) : undefined,
          note: sig.signal?.note || undefined,
        };
      }),
    })),
  }));

  // ── Recommendations ──
  const helpLinks: ExportReport["helpLinks"] = [];
  const toRec = (rec: Rec): ExportRec => {
    const link = model.actionLink(rec);
    // On the page the label sits next to its rec ("We can help you generate one"); in a file it needs to say what.
    const helpLink = link ? { label: link.href.includes("llmstxt") ? "We can help you generate llms.txt" : "We can help you generate markdown", href: `${origin}${link.href}` } : undefined;
    if (helpLink && !helpLinks.some((h) => h.href === helpLink.href)) helpLinks.push(helpLink);
    return {
      issue: model.recIssue(rec),
      impact: model.impactLabel(rec),
      effort: model.effortLabel(rec),
      category: rec.category,
      fix: model.recFix(rec),
      codeSnippet: rec.codeSnippet,
      helpLink,
    };
  };
  const recommendations = {
    quickWins: model.quickWins.map(toRec),
    deeper: model.deeperImprovements.map(toRec),
    watch: model.thingsToWatch.map(toRec),
    total: model.totalRecCount,
  };
  // Signal-level "we can help" offers (llms.txt / markdown) the page shows.
  for (const sig of model.signalGroups.flatMap((g) => g.sections).flatMap((s) => s.signals)) {
    if (!sig.waitlist) continue;
    const href = `${origin}/contact?ref=${sig.waitlist}`;
    if (!helpLinks.some((h) => h.href === href)) {
      helpLinks.push({ label: sig.waitlist === "llmstxt" ? "We can help you generate llms.txt" : "We can help you generate markdown", href });
    }
  }

  // ── AI citations ──
  const aiDisc = model.aiDisc;
  const rows: ExportCitationRow[] = [...model.citationsByTier.flatMap((g) => g.rows), ...model.citationsUntiered].map((r: any) => ({
    query: String(r.query),
    tier: r.tier ? TIER_LABELS[r.tier] : undefined,
    engine: model.engineLabel(r.engine),
    cited: Boolean(r.cited),
    citedUrl: r.citedUrl || undefined,
    competingDomains: Array.isArray(r.competingDomains) ? r.competingDomains : [],
  }));
  let state: CitationsState;
  let reason: string | undefined;
  if (!aiDisc) {
    state = input.citationsReason && !input.citationsSkipped ? "failed" : "not_run";
    reason = input.citationsSkipped ? "the check was still running when this file was downloaded" : input.citationsReason;
  } else if (aiDisc.status === "error") {
    state = "failed";
    reason = aiDisc.error || "the check returned an error";
  } else if (rows.length) {
    state = "done";
  } else if (model.availableCitationEngines.length === 0) {
    state = "no_engine";
  } else {
    state = "no_results";
  }
  const citationSeconds = aiDisc && (aiDisc.analysisTime || aiDisc.processingTime || aiDisc.duration || aiDisc.executionTime || aiDisc.time);
  const citations: ExportReport["citations"] = {
    state,
    reason,
    engine: model.testedEngineLabel || undefined,
    cited: model.citedCount,
    total: rows.length,
    seconds: citationSeconds ? citationSeconds / 1000 : undefined,
    rows,
    notes: state === "done" || state === "failed" ? [] : (aiDisc?.recommendations || []).map((r: any) => ({ issue: String(r.issue), fix: String(r.fix) })),
  };

  return {
    url,
    hostname,
    reportId: input.sessionId || undefined,
    scannedAt: typeof report?.generatedAt === "string" ? report.generatedAt : null,
    downloadedAt: (input.now || new Date()).toISOString(),
    readinessSeconds: typeof report?.analysisTime === "number" ? report.analysisTime / 1000 : undefined,
    score: typeof report?.overallScore === "number" ? report.overallScore : null,
    signalsToImprove: model.failingSignalCount,
    categoriesToImprove: model.failingGroupCount,
    docCheck,
    bots,
    groups,
    citations,
    recommendations,
    helpLinks,
  };
}

/** lensy-report-<hostname>-<YYYY-MM-DD>.<ext>, safe on every OS. */
export function reportFileName(data: ExportReport, ext: "md" | "pdf"): string {
  const host = (data.hostname || "page").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "page";
  const day = (data.scannedAt || data.downloadedAt).slice(0, 10);
  return `lensy-report-${host}-${day}.${ext}`;
}

export function citationsSummary(c: ExportReport["citations"]): string {
  switch (c.state) {
    case "done":
      return `Cited in ${c.cited} of ${c.total} tested queries${c.engine ? ` (${c.engine})` : ""}`;
    case "no_engine":
      return "The citation check completed, but no configured AI search engine was available to test this documentation.";
    case "no_results":
      return "The citation check completed but did not return query-level results.";
    case "failed":
      return `AI citations could not run for this report${c.reason ? `: ${c.reason.replace(/\.$/, "")}.` : "."}`;
    default:
      return c.reason ? `AI citations are not in this report: ${c.reason}.` : "AI citations were not run for this report.";
  }
}

export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
