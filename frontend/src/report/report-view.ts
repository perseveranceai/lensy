// SPDX-License-Identifier: MIT
// The report view for scoring v2: check grouping, fix order, the reachability
// banner and the agent preview line. Pure and import-free, so the website
// (reportModel.ts) and the Lensy CLI's HTML and Markdown reports run the same
// code and say the same thing. Moved unchanged from reportModel.ts; see
// .kiro/steering/lensy-engine.md. Must stay TypeScript 4.9 compatible (CRA).

// Report signal status. Four states, not pass/fail:
//   pass    = verified / good
//   warn    = present but needs improvement
//   neutral = informational / optional (absence is not a failure)
//   fail    = missing / blocking
export type ReportSignalStatus = "pass" | "warn" | "neutral" | "fail";
type SignalStatus = ReportSignalStatus;

export type EvidenceStatus = "verified" | "advertised" | "mapped" | "not_verified" | "experimental";

export interface DetectionSignal {
  status: EvidenceStatus;
  method?: string;
  validatedUrl?: string | null;
  audience?: "ai_search" | "coding_agents" | "both";
  note?: string | null;
}

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
  /** Where the check comes from, when it isn't Lensy ("afdocs"). */
  source?: string;
};

// points: two-score fixes only, the check's "earned/max" so the fix list says what it costs.
export type Rec = { category?: string; priority?: string; issue?: string; title?: string; fix?: string; description?: string; codeSnippet?: string; points?: string };

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
  /** "afdocs" for AFDocs checks (docs/coding-agents-afdocs/spec.md). */
  source?: string;
}

// The label a check row shows for where the check comes from. Lensy's own checks show none.
export const SOURCE_LABELS: Record<string, string> = { afdocs: "AFDocs" };

export interface ScoringV2 {
  // source "afdocs": checks are AFDocs ids (llms-txt-exists, ...) plus Lensy's
  // own (lensy-headings), not C1-C6 (docs/coding-agents-afdocs/spec.md).
  coding: { score: number; checks: ScoreCheck[]; toImprove: number; source?: "afdocs"; cap?: { cap: number; checkId: string; reason: string } };
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
    coding: {
      score: coding.score,
      checks: coding.checks || [],
      toImprove: toImprove(coding.checks || []),
      ...(coding.source === "afdocs" ? { source: "afdocs" as const } : {}),
      ...(coding.cap ? { cap: coding.cap } : {}),
    },
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

// AFDocs' rendering-strategy and S2 are the same question (does the HTML carry
// the content?), so they share the "Content without JavaScript" row like C1/S2.
export const AFDOCS_JS_CHECK = "rendering-strategy";
export const SHARED_JS_CHECKS = ["C1", AFDOCS_JS_CHECK];
const STATUS_ORDER: Record<string, number> = { fail: 0, warn: 1, pass: 2 };

function afdocsSignalGroups(v2: ScoringV2): SignalGroup[] {
  const s = Object.fromEntries(v2.search.checks.map((x) => [x.id, x]));
  const js = v2.coding.checks.find((x) => x.id === AFDOCS_JS_CHECK);
  const headings = v2.coding.checks.find((x) => x.id === "lensy-headings");
  const row = (x: ScoreCheck | undefined, audience?: string, info?: string): Signal[] => x
    ? [{ label: x.label, detail: x.detail, status: x.status, points: pts(x), checkIds: [x.id], fix: x.fix, audience, info, ...(x.source ? { source: x.source } : {}) }]
    : [];
  const both: Signal[] = [];
  if (js || s.S2) {
    const a = js || s.S2;
    both.push({
      label: "Content without JavaScript",
      detail: [js?.detail, s.S2?.detail].filter(Boolean).join(". "),
      status: worse(js?.status || "pass", s.S2?.status || "pass"),
      points: [js && `Coding ${pts(js)}`, s.S2 && `Search ${pts(s.S2)}`].filter(Boolean).join(" · "),
      checkIds: [js && js.id, s.S2 && "S2"].filter(Boolean) as string[],
      fix: js?.fix || a.fix,
      audience: "both",
      info: "AI crawlers and coding agents read the raw HTML. Most do not run JavaScript.",
    });
  }
  both.push(...row(headings, "coding_agents", "One H1 and no skipped levels, so an agent can find a section by its heading."));
  both.push(...row(s.S5, "ai_search", "AI search quotes sections, so each H2/H3 section should answer one question on its own."));
  // Failing checks first, so the list starts with what to fix.
  const coding = v2.coding.checks
    .filter((x) => x.id !== AFDOCS_JS_CHECK && x.id !== "lensy-headings")
    .map((x, i) => ({ x, i }))
    .sort((a, b) => STATUS_ORDER[a.x.status] - STATUS_ORDER[b.x.status] || a.i - b.i)
    .flatMap(({ x }) => row(x));
  const search = ["S1", "S3", "S4", "S6"].flatMap((id) => row(s[id]));
  return [
    { title: "Both audiences", key: "both", sections: [{ title: "", signals: both }] },
    { title: "Coding agents", key: "coding", sections: [{ title: "", signals: coding }] },
    { title: "AI search", key: "search", sections: [{ title: "", signals: search }] },
  ];
}

// Three cards: what both audiences need, then each score's own checks (§8.2).
function v2SignalGroups(v2: ScoringV2): SignalGroup[] {
  if (v2.coding.source === "afdocs") return afdocsSignalGroups(v2);
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
  // AI search checks are S1-S6; everything else (C1-C6, AFDocs ids, Lensy extras) feeds Coding agents.
  const isSearch = (id: string) => /^S\d$/.test(id);
  const belongs = (id: string) => (filter === "search" ? isSearch(id) : !isSearch(id));
  return groups
    .filter((g) => g.key === "both" || g.key === filter)
    .map((g) => g.key !== "both" ? g : {
      ...g,
      sections: g.sections.map((sec) => ({ ...sec, signals: sec.signals.filter((sig) => (sig.checkIds || []).some(belongs)) })),
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
      // C1 (or AFDocs rendering-strategy) and S2 are the same check scored twice; list its fix once.
      const key = x.id === "S2" || SHARED_JS_CHECKS.includes(x.id) ? "js" : x.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const lost = x.max - x.points;
      const both = key === "js";
      const points = both
        ? [v2.coding.checks.find((c) => SHARED_JS_CHECKS.includes(c.id)), v2.search.checks.find((c) => c.id === "S2")].map((c, i) => c && `${i ? "Search" : "Coding"} ${pts(c)}`).filter(Boolean).join(" · ")
        : pts(x);
      // AFDocs checks weigh 2 to 10 points, so the same points lost means more.
      const afdocs = category === "Coding agents" && v2.coding.source === "afdocs";
      const [high, medium] = afdocs ? [7, 3] : [10, 5];
      items.push({ category: both ? "Both audiences" : category, priority: lost >= high ? "high" : lost >= medium ? "medium" : "low", issue: `${x.label}: ${x.detail}`, fix: x.fix, points, lost });
    }
  }
  items.sort((a, b) => b.lost - a.lost);
  // A tip reads "What we saw. Why it matters." Split it into the title and the
  // body. A tip has no fix: a one-sentence tip is the title alone (REG-25).
  const tips: Rec[] = v2.tips.map((t) => {
    const cut = t.indexOf(". ");
    return cut > 0
      ? { category: "Tip", priority: "best-practice", issue: t.slice(0, cut), fix: t.slice(cut + 2) }
      : { category: "Tip", priority: "best-practice", issue: t, fix: "" };
  });
  return [...items.map(({ lost, ...r }) => r), ...tips];
}

export { v2SignalGroups, v2Recommendations };
