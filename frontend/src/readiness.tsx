// This site's own AI readiness over time: the daily history written by
// .github/workflows/site-readiness.yml, a score chart and a footer sparkline.
// Charts are plain SVG drawn with the site's color tokens; no chart library.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import seed from "./readiness-seed.json";

export interface ReadinessPage { path: string; codingAgents: number; aiSearch: number }
export interface ReadinessRun {
  date: string;
  checkedAt?: string;
  cli?: string;
  engine?: string;
  codingAgents: number;
  aiSearch: number;
  /** Kept for the newest run only. */
  pages?: ReadinessPage[];
}
export interface ReadinessHistory { version: number; site: string; runs: ReadinessRun[] }

const isScore = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;

/** The history file comes from a bucket, so check its shape before drawing anything from it. */
export function parseHistory(data: unknown): ReadinessHistory | null {
  const d = data as Partial<ReadinessHistory> | null;
  if (!d || !Array.isArray(d.runs)) return null;
  const runs = d.runs.filter((r): r is ReadinessRun =>
    !!r && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isScore(r.codingAgents) && isScore(r.aiSearch))
    .map((r) => ({ ...r, pages: Array.isArray(r.pages) ? r.pages.filter((p) => p && typeof p.path === "string" && isScore(p.codingAgents) && isScore(p.aiSearch)) : undefined }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!runs.length) return null;
  return { version: 1, site: typeof d.site === "string" ? d.site : "https://perseveranceai.com", runs };
}

const SEED = parseHistory(seed) as ReadinessHistory;

/** The first run, taken on 2026-11-10 before the site was rebuilt for crawlers. */
export const BASELINE = SEED.runs[0];

declare global { interface Window { __lensyReadiness?: ReadinessHistory } }

// scripts/prerender.js saves the history a page was rendered with in this tag,
// so the first render in the browser draws the same thing and hydration matches.
function embeddedHistory(): ReadinessHistory | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById("readiness-data");
  if (!el?.textContent) return null;
  try { return parseHistory(JSON.parse(el.textContent)); } catch { return null; }
}

let request: Promise<ReadinessHistory | null> | null = null;
function loadHistory(): Promise<ReadinessHistory | null> {
  if (!request) {
    request = fetch("/readiness/history.json", { cache: "no-cache" })
      .then((r) => (r.ok && /json/.test(r.headers.get("content-type") || "") ? r.json() : null))
      .then((d) => (d ? parseHistory(d) : null))
      .catch((error) => { console.warn("[Readiness] History not loaded, showing the saved copy", error); return null; });
  }
  return request;
}

/** Latest history: the copy saved in the page first, then the live file. */
export function useReadinessHistory(): ReadinessHistory {
  const [history, setHistory] = useState<ReadinessHistory>(() => embeddedHistory() || SEED);
  const initial = useRef(history);
  useEffect(() => {
    let live = true;
    loadHistory().then((loaded) => {
      if (!live) return;
      if (loaded) setHistory(loaded);
      window.__lensyReadiness = loaded || initial.current;
      document.documentElement.dataset.readiness = "ready";
    });
    return () => { live = false; };
  }, []);
  return history;
}

export const latestRun = (h: ReadinessHistory) => h.runs[h.runs.length - 1];

/** "Nov 10, 2026". Fixed locale and time zone, so saved HTML and the browser agree. */
export function formatRunDate(iso: string, withYear = true) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

const dayMs = 86400e3;
const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / dayMs;

interface Pt { x: number; y: number }

/**
 * A smooth line through the points that never overshoots them (monotone cubic,
 * Fritsch and Carlson), so a score of 100 never draws above 100.
 */
export function smoothPath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return "";
  const f = (v: number) => Math.round(v * 10) / 10;
  if (n === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x || 1e-6);
    m.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(pts[i].x + h)},${f(pts[i].y + t[i] * h)} ${f(pts[i + 1].x - h)},${f(pts[i + 1].y - t[i + 1] * h)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

// One run a day.
const RANGES: { id: string; label: string; aria: string; days: number | null }[] = [
  { id: "7d", label: "7D", aria: "Last 7 days", days: 7 },
  { id: "1m", label: "1M", aria: "Last month", days: 30 },
  { id: "3m", label: "3M", aria: "Last 3 months", days: 91 },
  { id: "1y", label: "1Y", aria: "Last year", days: 365 },
  { id: "all", label: "All", aria: "All runs", days: null },
];

const H = 240;
const PAD = { top: 22, right: 16, bottom: 30, left: 34 };

export function ScoreChart({ runs }: { runs: ReadinessRun[] }) {
  const id = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  // Fixed until mounted, so the saved HTML and the first browser render match.
  const [width, setWidth] = useState(720);
  const [range, setRange] = useState("all");
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Offer only the ranges that would hide some runs; until the history is longer
  // than a week there is nothing to choose, so no buttons show.
  const ranges = useMemo(() => {
    if (runs.length < 2) return [];
    const spanAll = dayOf(runs[runs.length - 1].date) - dayOf(runs[0].date);
    const cut = RANGES.filter((r) => r.days !== null && r.days <= spanAll);
    return cut.length ? [...cut, RANGES[RANGES.length - 1]] : [];
  }, [runs]);

  const shown = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)?.days;
    if (!days || !runs.length) return runs;
    const last = dayOf(runs[runs.length - 1].date);
    return runs.filter((r) => last - dayOf(r.date) < days);
  }, [runs, range]);
  useEffect(() => setActive(null), [range]);

  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const first = shown.length ? dayOf(shown[0].date) : 0;
  const span = shown.length > 1 ? dayOf(shown[shown.length - 1].date) - first : 0;
  const xOf = (r: ReadinessRun) => PAD.left + (span ? ((dayOf(r.date) - first) / span) * innerW : innerW / 2);
  const yOf = (v: number) => PAD.top + (1 - v / 100) * innerH;
  const coding = shown.map((r) => ({ x: xOf(r), y: yOf(r.codingAgents) }));
  const search = shown.map((r) => ({ x: xOf(r), y: yOf(r.aiSearch) }));
  const codingPath = smoothPath(coding);
  const areaPath = coding.length > 1 ? `${codingPath}L${coding[coding.length - 1].x},${PAD.top + innerH}L${coding[0].x},${PAD.top + innerH}Z` : "";
  const engineChanged = (i: number) => {
    const all = runs.indexOf(shown[i]);
    return all > 0 && !!shown[i].engine && !!runs[all - 1].engine && shown[i].engine !== runs[all - 1].engine;
  };

  // Date labels about 80px apart, at most 6, spread across the runs on show.
  const labelIdx = useMemo(() => {
    const n = shown.length;
    const max = Math.max(2, Math.min(6, Math.floor(innerW / 80)));
    if (n <= max) return shown.map((_, i) => i);
    return Array.from({ length: max }, (_, k) => Math.round((k * (n - 1)) / (max - 1)));
  }, [shown, innerW]);

  const pick = (e: PointerEvent<SVGRectElement>) => {
    if (!shown.length) return;
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    coding.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(coding[best].x - x)) best = i; });
    setActive(best);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!shown.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((cur) => Math.min(shown.length - 1, Math.max(0, cur === null ? (step > 0 ? 0 : shown.length - 1) : cur + step)));
    } else if (e.key === "Escape") setActive(null);
  };

  const run = active !== null ? shown[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(coding[active].x, 90), width - 90) : 0;
  const lastChecked = runs.length ? formatRunDate(runs[runs.length - 1].date) : "";

  return <div className="readiness-chart rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-[14px] font-medium tracking-[-.02em] text-[var(--ink)]">perseveranceai.com</p>
        <p className="mt-1 text-[12px] text-[var(--muted)]">Last checked {lastChecked}</p>
      </div>
      {ranges.length > 0 && <div role="group" aria-label="Time range" className="flex gap-1">
        {ranges.map((r) => <button key={r.id} type="button" aria-pressed={range === r.id} aria-label={r.aria} onClick={() => setRange(r.id)}
          style={{ fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.6 }}
          className={`rounded-full px-3 py-1 transition-colors ${range === r.id ? "bg-[var(--ink)] text-[var(--bg)]" : "text-[var(--ink-soft)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"}`}>{r.label}</button>)}
      </div>}
    </div>
    {runs.length > 0 && <p className="sr-only">Latest run, {lastChecked}: Coding agents {runs[runs.length - 1].codingAgents}, AI search {runs[runs.length - 1].aiSearch}{runs.length > 1 ? `. First run, ${formatRunDate(runs[0].date)}: Coding agents ${runs[0].codingAgents}, AI search ${runs[0].aiSearch}` : ""}.</p>}
    <p data-md-skip="true" className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[var(--ink-soft)]">
      <span className="inline-flex items-center gap-2"><svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" style={{ stroke: "var(--ink)" }} strokeWidth="2" /></svg>Coding agents: solid line</span>{" "}
      <span className="inline-flex items-center gap-2"><svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" style={{ stroke: "var(--accent)" }} strokeWidth="2" strokeDasharray="4 3" /></svg>AI search: dashed line</span>
    </p>
    <div ref={boxRef} tabIndex={0} onKeyDown={onKey} onBlur={() => setActive(null)} data-testid="score-chart" data-runs={shown.length}
      aria-label={`Score history chart, ${shown.length} run${shown.length === 1 ? "" : "s"} shown. Use the left and right arrow keys to read each run.`} role="group"
      className="relative mt-3 rounded-[var(--radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
      {shown.length === 0 ? <p className="py-16 text-center text-[13px] text-[var(--muted)]">No runs in this period.</p> :
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="block max-w-full" aria-hidden="true">
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--ink)", stopOpacity: 0.14 }} />
              <stop offset="100%" style={{ stopColor: "var(--ink)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {[0, 50, 100].map((v) => <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yOf(v)} y2={yOf(v)} style={{ stroke: "var(--line-soft)" }} strokeDasharray={v === 0 ? undefined : "3 4"} />
            <text x={PAD.left - 8} y={yOf(v) + 3.5} textAnchor="end" style={{ fill: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{v}</text>
          </g>)}
          <g key={range} className="chart-fade">
            {areaPath && <path d={areaPath} fill={`url(#fill-${id})`} />}
            <path d={smoothPath(search)} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
            <path d={codingPath} fill="none" style={{ stroke: "var(--ink)" }} strokeWidth="2" strokeLinecap="round" />
            {shown.length === 1 && <>
              <circle cx={coding[0].x} cy={coding[0].y} r="3.5" style={{ fill: "var(--ink)" }} />
              <circle cx={search[0].x} cy={search[0].y} r="3.5" style={{ fill: "var(--accent)" }} />
            </>}
            {shown.map((r, i) => engineChanged(i) && <g key={r.date} data-testid="engine-change">
              <line x1={coding[i].x} x2={coding[i].x} y1={PAD.top - 12} y2={PAD.top - 4} style={{ stroke: "var(--line-strong)" }} strokeWidth="1.5" />
              <circle cx={coding[i].x} cy={PAD.top - 14} r="2.5" style={{ fill: "var(--accent)" }} />
            </g>)}
          </g>
          {labelIdx.map((i) => <text key={shown[i].date} x={coding[i].x} y={H - 8} textAnchor={shown.length === 1 ? "middle" : i === 0 ? "start" : i === shown.length - 1 ? "end" : "middle"}
            style={{ fill: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{formatRunDate(shown[i].date, false)}</text>)}
          {active !== null && <g pointerEvents="none">
            <line x1={coding[active].x} x2={coding[active].x} y1={PAD.top} y2={PAD.top + innerH} style={{ stroke: "var(--line-strong)" }} />
            <circle cx={coding[active].x} cy={coding[active].y} r="4" style={{ fill: "var(--bg)", stroke: "var(--ink)" }} strokeWidth="2" />
            <circle cx={search[active].x} cy={search[active].y} r="4" style={{ fill: "var(--bg)", stroke: "var(--accent)" }} strokeWidth="2" />
          </g>}
          <rect x={PAD.left} y={0} width={innerW} height={H} fill="transparent" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setActive(null)} />
        </svg>}
      {run && <div role="status" data-testid="chart-tooltip" className="popup-shadow pointer-events-none absolute top-0 z-10 w-[176px] -translate-x-1/2 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2.5" style={{ left: tipLeft }}>
        <p className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--muted)]">{formatRunDate(run.date)}</p>
        <p className="mt-1.5 flex justify-between text-[12px] text-[var(--ink)]"><span>Coding agents</span><span className="tabular-nums">{run.codingAgents}</span></p>
        <p className="mt-0.5 flex justify-between text-[12px] text-[var(--ink-soft)]"><span>AI search</span><span className="tabular-nums">{run.aiSearch}</span></p>
        {engineChanged(active!) && <p className="mt-1.5 border-t border-[var(--line)] pt-1.5 text-[11px] leading-snug text-[var(--muted)]">Lensy&apos;s checks changed this week.</p>}
      </div>}
    </div>
  </div>;
}
