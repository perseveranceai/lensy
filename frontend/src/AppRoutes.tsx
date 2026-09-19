import { createBrowserRouter, Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Home } from "./Home";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Check, Menu, Send, Monitor, Moon, Sun, X, CheckCircle2, AlertTriangle, Info, XCircle, MinusCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Tooltip from "@mui/material/Tooltip";
import { trackEvent } from "./analytics";
const logo = `${process.env.PUBLIC_URL}/logo.png`;

// Report signal status → icon. Four distinct SHAPES so each state is legible on
// its own, all drawn in the logo cement color (no warm green/amber/red):
//   pass    → check-circle (verified / good)
//   warn    → triangle     (present but needs improvement)
//   neutral → minus-circle (informational / optional; absence is not a failure)
//   fail    → x-circle     (missing / blocking)
// Note: neutral deliberately does NOT use the Info (ⓘ) glyph — that glyph is
// reserved for the tooltip trigger beside every row, so reusing it here would
// read as "more info" rather than "optional / not applicable".
type ReportSignalStatus = "pass" | "warn" | "neutral" | "fail";

function SignalStatusIcon({ status, className }: { status: ReportSignalStatus; className?: string }) {
  const cls = className ?? "size-4 shrink-0";
  // Monochrome by design: every icon uses the logo cement color. Meaning is
  // carried by the distinct SHAPE, not by color, to fit the site's
  // black/white/cement palette.
  switch (status) {
    case "pass":
      return <CheckCircle2 className={cls} style={{ color: "var(--accent)" }} strokeWidth={2} aria-label="Pass" />;
    case "warn":
      return <AlertTriangle className={cls} style={{ color: "var(--accent)" }} strokeWidth={2} aria-label="Needs improvement" />;
    case "neutral":
      return <MinusCircle className={cls} style={{ color: "var(--accent)" }} strokeWidth={2} aria-label="Optional" />;
    default:
      return <XCircle className={cls} style={{ color: "var(--accent)" }} strokeWidth={2} aria-label="Not found" />;
  }
}

// A card's header icon aggregates the state of its signals: any warn/fail →
// warning, otherwise all-clear → pass, otherwise informational only → info.
function aggregateStatus(statuses: ReportSignalStatus[]): ReportSignalStatus {
  if (statuses.some((s) => s === "warn" || s === "fail")) return "warn";
  if (statuses.some((s) => s === "pass")) return "pass";
  return "neutral";
}

// ── v2 evidence-aware detection model (mirrors backend detection-types.ts) ──
// The backend's check_ai_readiness emits a `detection` report with evidence for
// each signal. Restored here so the results page can show WHY Lensy believes a
// signal (Verified / Advertised / Mapped / Not verified / Experimental) and who
// benefits (AI search / Coding agents / Both) — the badges lost in the redesign.
type EvidenceStatus = "verified" | "advertised" | "mapped" | "not_verified" | "experimental";

interface DetectionSignal {
  status: EvidenceStatus;
  method?: string;
  validatedUrl?: string | null;
  audience?: "ai_search" | "coding_agents" | "both";
  note?: string | null;
}

interface DetectionData {
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

const EVIDENCE_LABELS: Record<EvidenceStatus, string> = {
  verified: "Verified",
  advertised: "Advertised",
  mapped: "Mapped",
  not_verified: "Not verified",
  experimental: "Experimental",
};

const AUDIENCE_LABELS: Record<string, string> = {
  ai_search: "AI search",
  coding_agents: "Coding agents",
  both: "Both",
};

// Shared pill treatment for signal metadata badges. Comfortable padding so the
// label sits in the middle of the pill rather than feeling boxed-in.
const BADGE_BASE =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-medium leading-none tracking-[-.02em]";

// Per-status glyph so each evidence state is visually distinct — "mapped" is a
// weaker confirmation than "verified" (matched via llms.txt content rather than
// a direct probe) and must not borrow the verified ✓.
//   verified     → ✓  direct probe confirmed
//   mapped       → ◉  circle-with-dot: matched via mapping, not a hard verify
//   advertised   → ⚠  claimed (header/reference) but not validated
//   experimental → ◇  emerging standard, not scored
//   not_verified → ✗  not found on tested paths
const EVIDENCE_GLYPHS: Record<EvidenceStatus, string> = {
  verified: "✓",
  mapped: "◉",
  advertised: "⚠",
  experimental: "◇",
  not_verified: "✗",
};

// Small pill next to a signal label showing HOW it was detected. All-cement to
// match the palette; meaning comes from the glyph + label, not color.
function EvidenceBadge({ signal }: { signal?: DetectionSignal }) {
  if (!signal) return null;
  const affirmative = signal.status === "verified" || signal.status === "mapped" || signal.status === "advertised";
  const color = affirmative ? "var(--accent)" : "var(--ink-soft)";
  return (
    <span className={BADGE_BASE} style={{ color }}>
      <span aria-hidden="true">{EVIDENCE_GLYPHS[signal.status]}</span>
      {EVIDENCE_LABELS[signal.status]}
    </span>
  );
}

// Small muted pill showing who benefits from a signal (AI search / Coding agents / Both).
function AudienceBadge({ audience }: { audience?: string }) {
  if (!audience) return null;
  return <span className={`${BADGE_BASE} text-[var(--ink-soft)]`}>{AUDIENCE_LABELS[audience] || audience}</span>;
}

// Small muted pill showing how much a missing signal matters (e.g. "Low–medium
// impact"). Restored from the pre-redesign UI, where it sat beside the audience
// pill on failing structured-data signals.
function ImpactBadge({ impact }: { impact?: string }) {
  if (!impact) return null;
  return <span className={`${BADGE_BASE} text-[var(--ink-soft)] opacity-80`}>{impact} impact</span>;
}

// The ⓘ beside every finding. Uses MUI Tooltip (same as the production UI) so it
// renders in a portal above the item — never trapped in the flex row, never
// collapsing to one word per line, never pushing sibling text.
function InfoHint({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <Tooltip
      title={text}
      placement="top"
      arrow
      enterTouchDelay={0}
      leaveTouchDelay={3000}
      componentsProps={{
        tooltip: {
          sx: {
            maxWidth: 260,
            bgcolor: "var(--panel-bg)",
            color: "var(--panel-fg)",
            fontSize: "12px",
            fontWeight: 400,
            lineHeight: 1.5,
            letterSpacing: "-0.01em",
            px: 1.5,
            py: 1,
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-float)",
          },
        },
        arrow: { sx: { color: "var(--panel-bg)" } },
      }}
    >
      <span tabIndex={0} role="button" aria-label={text} className="inline-flex cursor-help text-[var(--muted)] outline-none transition-colors hover:text-[var(--ink)] focus-visible:text-[var(--ink)]">
        <Info className="size-3" strokeWidth={2} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

const API_BASE_URL = process.env.REACT_APP_API_URL || "https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com";
const AuditAllowanceContext = createContext<{ remaining: number | null } | null>(null);

export function AuditAllowanceProvider({ children }: { children: ReactNode }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const fetchUsage = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/usage`);
      if (response.ok) setRemaining((await response.json()).remaining);
    } catch {
      console.warn("[AuditAllowance] Unable to load audit allowance");
    }
  }, []);

  useEffect(() => {
    fetchUsage();
    window.addEventListener("lensy:usage-changed", fetchUsage);
    return () => window.removeEventListener("lensy:usage-changed", fetchUsage);
  }, [fetchUsage]);

  const value = useMemo(() => ({ remaining }), [remaining]);
  return <AuditAllowanceContext.Provider value={value}>{children}</AuditAllowanceContext.Provider>;
}

export function useAuditAllowance() {
  const context = useContext(AuditAllowanceContext);
  if (!context) throw new Error("useAuditAllowance must be used inside AuditAllowanceProvider");
  return context;
}

function useReveal() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);
}

type Theme = "system" | "light" | "dark";
type ViewTransition = { finished: Promise<void>; ready: Promise<void> };
type ThemeTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransition;
};
function applyTheme(t: Theme) {
  const nextTheme = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  const updateTheme = () => {
    document.documentElement.setAttribute("data-theme", nextTheme);
    document.documentElement.style.colorScheme = nextTheme;
  };

  // Do not animate the initial paint or duplicate Strict Mode effect. On a user
  // change, animate the entire document once instead of every nested element.
  if (document.documentElement.getAttribute("data-theme") === nextTheme) {
    updateTheme();
    return;
  }

  const themeDocument = document as ThemeTransitionDocument;
  if (themeDocument.startViewTransition) {
    const transition = themeDocument.startViewTransition.call(document, updateTheme);
    // When a rapid second toggle interrupts an in-flight transition, the browser
    // rejects these promises with "Transition was skipped". That is expected —
    // swallow it so it never surfaces as an uncaught runtime error.
    transition.finished.catch(() => { });
    transition.ready.catch(() => { });
  } else {
    updateTheme();
  }
}
function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  useLayoutEffect(() => {
    applyTheme(theme);
    localStorage.setItem("theme", theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);
  return { theme, setTheme };
}

const themeIcon: Record<Theme, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const options: Theme[] = ["system", "light", "dark"];
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeOnOutsideClick); document.removeEventListener("keydown", closeOnEscape); };
  }, []);
  const labels: Record<Theme, [string, string]> = {
    system: ["System", "Follow your device"],
    light: ["Light", "Always use light"],
    dark: ["Dark", "Always use dark"],
  };
  const ActiveThemeIcon = themeIcon[theme];
  return <div ref={pickerRef} className="relative">
    <button type="button" aria-label="Change color theme" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)} className={`theme-trigger flex size-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--ink)] ${open ? "is-open" : ""}`}>
      <ActiveThemeIcon className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
    </button>
    {open && <div role="dialog" aria-label="Color theme" className="popup-shadow theme-menu absolute right-0 top-[calc(100%+10px)] z-30 w-52 rounded-[var(--radius-md)] border border-[var(--line-strong)] bg-[var(--bg)] p-2">
      <div className="px-2 pb-2 pt-1"><p className="text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">Appearance</p></div>
      <div role="radiogroup" aria-label="Color theme" className="space-y-0.5">
        {options.map((opt) => {
          const active = theme === opt;
          const [label, detail] = labels[opt];
          const ThemeOptionIcon = themeIcon[opt];
          return <button key={opt} type="button" role="radio" aria-checked={active} onClick={() => { setTheme(opt); setOpen(false); }} className={`theme-choice flex w-full items-center gap-3 px-2 py-2 text-left transition-colors ${active ? "bg-[var(--surface-2)] text-[var(--ink)]" : "text-[var(--ink-soft)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"}`}>
            <span className={`grid size-7 shrink-0 place-items-center rounded-[var(--radius-xs)] border ${active ? "border-[var(--accent)] bg-[var(--ink)] text-[var(--bg)]" : "border-[var(--line)]"}`}><ThemeOptionIcon className="size-3.5" strokeWidth={1.65} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[12px] font-medium tracking-[-.02em]">{label}</span><span className="mt-0.5 block text-[10px] font-medium tracking-[-.02em] text-[var(--muted)]">{detail}</span></span>
            <span aria-hidden="true" className={`text-[12px] font-medium tracking-[-.025em] ${active ? "text-[var(--accent)]" : "opacity-0"}`}>✓</span>
          </button>;
        })}
      </div>
    </div>}
  </div>;
}

export function NavLink({ to, label, badge }: { to: string; label: string; badge?: string }) {
  const { pathname } = useLocation();
  const active = pathname === to || pathname.startsWith(to + "/");
  return <Link to={to} data-nav-active={active} className={`nav-item relative z-10 inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2.5 py-1.5 ${active ? "is-active text-[var(--bg)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"}`} aria-current={active ? "page" : undefined}>{label}{badge && <span className={`rounded-[var(--radius-sm)] px-1 py-0.5 text-[8px] font-semibold uppercase leading-none tracking-[.08em] ${active ? "bg-[var(--bg)]/20 text-[var(--bg)]" : "bg-[var(--surface-2)] text-[var(--accent)]"}`}>{badge}</span>}</Link>;
}

export function NavRail() {
  const { pathname } = useLocation();
  const railRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });
  useLayoutEffect(() => {
    const updateIndicator = () => {
      const rail = railRef.current;
      const active = rail?.querySelector<HTMLElement>("[data-nav-active='true']");
      if (!rail || !active) { setIndicator((current) => ({ ...current, ready: false })); return; }
      const railBounds = rail.getBoundingClientRect();
      const activeBounds = active.getBoundingClientRect();
      setIndicator({ left: activeBounds.left - railBounds.left, width: activeBounds.width, ready: true });
    };
    const animationFrame = window.requestAnimationFrame(updateIndicator);
    window.addEventListener("resize", updateIndicator);
    const resizeObserver = new ResizeObserver(updateIndicator);
    if (railRef.current) resizeObserver.observe(railRef.current);
    return () => { window.cancelAnimationFrame(animationFrame); window.removeEventListener("resize", updateIndicator); resizeObserver.disconnect(); };
  }, [pathname]);
  return <div ref={railRef} className="nav-rail relative flex min-w-max items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-1">
    <span aria-hidden="true" className={`nav-indicator ${indicator.ready ? "is-ready" : ""}`} style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }} />
    <NavLink to="/" label="Lensy" badge="Beta" />
    <NavLink to="/how-it-works" label="How it works" />
    <NavLink to="/education" label="Education" />
    <NavLink to="/contact" label="Contact" />
  </div>;
}

export function MobileNav({ remaining }: { remaining: number }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);
  const links = [
    ["/", "Lensy"],
    ["/how-it-works", "How it works"],
    ["/education", "Education"],
    ["/contact", "Contact"],
  ];

  return <div className="relative md:hidden">
    <button type="button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen((current) => !current)} className="theme-trigger grid size-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--ink)]">
      {open ? <X className="size-3.5" strokeWidth={1.75} aria-hidden="true" /> : <Menu className="size-3.5" strokeWidth={1.75} aria-hidden="true" />}
    </button>
    {open && <div id="mobile-navigation" className="popup-shadow mobile-nav-menu absolute right-0 top-[calc(100%+10px)] z-30 w-52 overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-strong)] bg-[var(--bg)] p-1.5">
      <div className="space-y-0.5">
        {links.map(([to, label]) => {
          const active = pathname === to || (to !== "/" && pathname.startsWith(to + "/"));
          return <Link key={to} to={to} className={`flex items-center justify-between rounded-[var(--radius-xs)] px-3 py-2.5 text-[13px] font-medium tracking-[-.025em] transition-colors ${active ? "bg-[var(--ink)] text-[var(--bg)]" : "text-[var(--ink-soft)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"}`} aria-current={active ? "page" : undefined}>{label}{active && <Check className="size-3.5" strokeWidth={1.8} aria-hidden="true" />}</Link>;
        })}
      </div>
      <p className="mt-1.5 border-t border-[var(--line)] px-3 py-2.5 text-[11px] font-medium tracking-[-.02em] text-[var(--muted)]">Free tier — {remaining} audits left</p>
    </div>}
  </div>;
}

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const closeTimer = useRef<number | null>(null);
  const close = () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); setClosing(true); closeTimer.current = window.setTimeout(() => { setOpen(false); setSent(false); setSendError(""); setClosing(false); closeTimer.current = null; }, 180); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    setSendError("");
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL || "https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com"}/console/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim(), email: email.trim() || undefined, pageUrl: window.location.href }),
      });
      if (!response.ok) throw new Error(`Feedback request failed with ${response.status}`);
      console.log("[Feedback] Submission accepted");
      setSent(true);
      closeTimer.current = window.setTimeout(close, 1000);
    } catch (error) {
      console.error("[Feedback] Submission failed", error);
      setSendError("We could not send feedback. Please try again.");
    } finally {
      setSending(false);
    }
  };
  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);
  return <div className="fixed bottom-5 left-5 z-40 flex max-w-[calc(100vw-2.5rem)] flex-col items-start">
    {open && <div id="feedback-panel" className={`feedback-panel popup-shadow mb-2.5 w-[304px] max-w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-strong)] bg-[var(--bg)] ${closing ? "is-closing" : ""}`}>
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3.5 py-2.5"><p className="text-[13px] font-medium tracking-[-.025em]">Share feedback</p><button type="button" onClick={close} aria-label="Close feedback" className="grid size-6 place-items-center rounded-[var(--radius-xs)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"><X className="size-3" strokeWidth={1.8} aria-hidden="true" /></button></div>
      {sent ? <div role="status" aria-live="polite" className="feedback-success flex items-center gap-3 px-4 py-5"><span className="grid size-7 place-items-center rounded-full bg-[var(--tint)] text-[var(--accent)]"><Check className="size-3.5" strokeWidth={1.9} aria-hidden="true" /></span><p className="text-[13px] font-medium tracking-[-.02em]">Feedback sent.</p></div> : <form onSubmit={submit} className="p-4"><label className="sr-only" htmlFor="feedback-message">Feedback</label><textarea id="feedback-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What would make Lensy more useful?" className="feedback-field min-h-28 w-full resize-y rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]" /><label className="sr-only" htmlFor="feedback-email">Email address</label><input id="feedback-email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Email (optional, for follow-up)" className="feedback-field mt-3 w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]" /><button type="submit" disabled={!message.trim() || sending} className="feedback-submit btn-ink mt-3 flex w-full items-center justify-center gap-2 bg-[var(--panel-bg)] px-4 py-2.5 text-[13px] font-medium tracking-[-.02em] text-[var(--panel-fg)] disabled:cursor-not-allowed disabled:opacity-40">{sending ? "Sending…" : <>Send feedback <Send className="size-3" strokeWidth={1.8} aria-hidden="true" /></>}</button>{sendError && <p role="alert" className="mt-3 text-[12px] text-[var(--ink-soft)]">{sendError}</p>}</form>}
    </div>}
    <button type="button" onClick={() => open ? close() : setOpen(true)} aria-expanded={open} aria-controls="feedback-panel" className="feedback-launch inline-flex rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2 text-[13px] font-medium tracking-[-.02em] text-[var(--ink)]">Feedback</button>
  </div>;
}

export function ShellContent() {
  useReveal();
  const { pathname } = useLocation();
  const { remaining } = useAuditAllowance();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 12);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return <div className="flex min-h-full flex-col bg-[var(--bg)] text-[var(--ink)]">
    <header className={`shell-header sticky top-0 z-20 border-b border-[var(--line-soft)] ${scrolled ? "is-scrolled" : ""}`}>
      <nav className="relative mx-auto flex max-w-[1240px] items-center px-5 py-2.5 sm:px-8">
        <Link to="/" className="flex items-center gap-2 text-[15px] font-medium tracking-[-.04em]"><img src={logo} alt="Perseverance AI" style={{ width: "clamp(42px, 4.2vw, 55px)", height: "clamp(42px, 4.2vw, 55px)" }} className="logo-mark object-contain transition-transform duration-300 hover:scale-110" />Perseverance AI</Link>
        <div className="absolute left-1/2 hidden -translate-x-1/2 text-[12px] font-medium tracking-[-.025em] md:flex">
          <NavRail />
        </div>
        <div className="ml-auto flex items-center gap-2"><ThemeToggle /><MobileNav remaining={remaining ?? 0} /><span className="hidden rounded-[var(--radius-sm)] border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium tracking-[-.025em] text-[var(--ink-soft)] md:inline-flex">Free tier — {remaining === null ? "checking…" : `${remaining} audits left`}</span></div>
      </nav>
    </header>
    <main className="flex-1"><div key={pathname} className="route-enter"><Outlet /></div></main>
    <FeedbackWidget />
    <footer className="border-t border-[var(--line)] px-5 py-6 sm:px-8">
      <div className="mx-auto flex max-w-[1400px] flex-col items-center gap-4 text-center">
        <Link to="/" aria-label="Perseverance AI home" className="inline-flex w-full justify-center opacity-80 transition-opacity hover:opacity-100">
          <img src={logo} alt="Perseverance AI" className="logo-mark size-[60px] translate-x-1 object-contain" />
        </Link>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13px] font-medium text-[var(--ink-soft)]">
          <a href="https://www.linkedin.com/company/getperseverance/" target="_blank" rel="noopener noreferrer" className="link-sweep hover:text-[var(--accent)]">LinkedIn</a>
          <a href="https://x.com/getperseverance" target="_blank" rel="noopener noreferrer" className="link-sweep hover:text-[var(--accent)]">X</a>
          <a href="https://calendly.com/getperseverance" target="_blank" rel="noopener noreferrer" className="link-sweep hover:text-[var(--accent)]">Schedule a conversation</a>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px] text-[var(--muted)]">
          <span>© {new Date().getFullYear()} Perseverance AI. All rights reserved.</span>
          <Link to="/terms" className="link-sweep text-[var(--ink-soft)] hover:text-[var(--accent)]">Terms and Policy</Link>
        </div>
        <p className="max-w-[640px] text-[11px] leading-relaxed text-[var(--muted)]">Lensy is in beta. Results are generated automatically and may not always be accurate — treat them as guidance, not a definitive audit.</p>
      </div>
    </footer>
  </div>;
}

export function Shell() {
  return (
    <AuditAllowanceProvider>
      <ShellContent />
    </AuditAllowanceProvider>
  );
}

// ---- Scan prototype ----

function getScanProfile(rawUrl: string) {
  const supplied = rawUrl || "docs.example.com";
  let displayUrl = supplied;
  try {
    const parsed = new URL(/^https?:\/\//.test(supplied) ? supplied : `https://${supplied}`);
    displayUrl = (parsed.hostname + parsed.pathname).replace(/^www\./, "").replace(/\/$/, "");
  } catch {
    displayUrl = supplied.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  }
  const seed = Array.from(displayUrl).reduce((total, character) => total + character.charCodeAt(0), 0);
  const score = 72 + (seed % 17);
  return { hostname: displayUrl, score };
}

export function ScanReport({
  url,
  analysisState,
  citationData,
  overallScoreData,
  detectionData,
  citationsLoading = false,
  onRunCitations,
  onScan,
}: {
  url?: string;
  analysisState?: any;
  citationData?: any;
  overallScoreData?: any;
  detectionData?: DetectionData;
  citationsLoading?: boolean;
  onRunCitations?: () => void;
  onScan?: (url: string, options?: { forceJsRender?: boolean }) => void;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const urlParam = params.get("url") || analysisState?.report?.url || url || "";
  const { hostname } = getScanProfile(urlParam);
  const [view, setView] = useState<"readiness" | "citations-loading" | "citations" | "recommendations">("readiness");
  const citationRequestStarted = useRef(false);
  useEffect(() => {
    if (citationsLoading) citationRequestStarted.current = true;
    if (view === "citations-loading" && citationRequestStarted.current && !citationsLoading) setView("citations");
  }, [citationsLoading, view]);

  // The scan hit a JS-rendered page: the backend returns an error naming the
  // condition, and we surface the "Proceed with analysis anyway" consent step.
  const isJsRenderPrompt =
    analysisState?.status === "error" &&
    (["js-render-required", "JavaScript-rendered", "JS-rendered"].some((token) => (analysisState.error || "").includes(token)));

  // Fire `js_render_prompt_shown` once each time the consent prompt appears for
  // a URL — this is the top of the JS-render consent funnel (prompt shown →
  // consent given → results). New instrumentation: this flow was never tracked
  // pre-redesign. Keyed on urlParam so a re-scan of the same URL re-arms it.
  const jsRenderPromptTracked = useRef<string | null>(null);
  useEffect(() => {
    if (isJsRenderPrompt && jsRenderPromptTracked.current !== urlParam) {
      jsRenderPromptTracked.current = urlParam;
      trackEvent("js_render_prompt_shown", { url: urlParam });
    }
    if (!isJsRenderPrompt) jsRenderPromptTracked.current = null;
  }, [isJsRenderPrompt, urlParam]);

  let robotsUrl = "#";
  try {
    if (urlParam) {
      const parsedUrlForRobots = new URL(/^https?:\/\//.test(urlParam) ? urlParam : `https://${urlParam}`);
      robotsUrl = `${parsedUrlForRobots.protocol}//${parsedUrlForRobots.hostname}/robots.txt`;
    }
  } catch (e) {
    console.error("Invalid URL for robots.txt:", urlParam);
  }

  // Map a raw scan error (which can be a bare "HTTP 400", an unreachable-host
  // message, or a non-doc rejection) to a human-readable title + description so
  // the error card never shows a raw status code. Falls back to the raw message.
  const describeScanError = (raw?: string): { title: string; description: string } => {
    const msg = (raw || "").trim();
    if (/\b400\b/.test(msg)) {
      return { title: "That doesn't look like a valid URL", description: "Please enter a valid documentation URL and try again." };
    }
    if (/\b(404)\b/.test(msg)) {
      return { title: "We couldn't find that page", description: "The URL returned a 404. Double-check the address and try again." };
    }
    if (/\b(429)\b/.test(msg)) {
      return { title: "Too many requests", description: "The site is rate-limiting our scanner. Wait a moment and try again." };
    }
    if (/\b5\d\d\b/.test(msg) || /unreachable|ENOTFOUND|ECONNREFUSED|timed? ?out|timeout/i.test(msg)) {
      return { title: "We couldn't reach that site", description: "The server didn't respond. Check the URL is correct and reachable, then try again." };
    }
    if (/not a doc|non-doc|documentation/i.test(msg) && !/valid documentation URL/i.test(msg)) {
      return { title: "This doesn't look like a documentation page", description: msg || "Try a URL that points at documentation content." };
    }
    return { title: "Something went wrong", description: msg || "The scan couldn't be completed. Please try again." };
  };

  const report = analysisState?.report;
  const realScore = typeof report?.overallScore === "number" ? report.overallScore : null;
  const hasReport = Boolean(report);

  // Preserve the Figma three-card report layout. Every item below comes from
  // the completed agent report; omitted checks are never represented by mock rows.
  // Signal status mirrors the pre-redesign report: a real 4-state model, not a
  // pass/fail boolean. 'pass' = verified/good, 'warn' = present but sub-optimal,
  // 'neutral' = informational/optional (absence is not a failure), 'fail' = missing.
  type SignalStatus = ReportSignalStatus;
  // A signal now carries the same rich metadata the old UI showed: an evidence
  // signal (for the ✓ Verified / ✗ Not verified badge), an audience, an info
  // tooltip, and an optional "we can help" waitlist link.
  type Signal = {
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
  };

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

  const signalGroups: Array<{ title: string; sections: Array<{ title: string; signals: Signal[] }> }> = [];
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
  const botAccessState =
    report?.overallScore?.botAccessState ?? (isJsRendered ? "js_blocked" : undefined);

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

  if (categories?.structuredData) {
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

  if (categories?.discoverability) {
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

  if (categories?.consumability) {
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

  if (!categories && report?.dimensions) {
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
  type Rec = { category?: string; priority?: string; issue?: string; title?: string; fix?: string; description?: string; codeSnippet?: string };
  let allRecs: Rec[] = report?.recommendations || [];
  if (allRecs.length === 0 && report?.dimensions) {
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
    if (issue.includes("llms.txt")) return { href: "/contact?ref=llmstxt", label: "We can help you generate one" };
    if (issue.includes("markdown")) return { href: "/contact?ref=markdown", label: "We can help you generate markdown" };
    return null;
  };
  const totalRecCount = allRecs.length;

  // T-06: surface the real backend fix guidance directly under each failing/
  // warning signal (previously it lived only in the "All recommendations" view).
  // We match a signal to its recommendation by the same fuzzy identity used for
  // impact, so the guidance stays in sync with the backend and is never hardcoded.
  const fixForSignal = (label: string): string | undefined => {
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
        || (key === "page markdown" && hay.includes("markdown"));
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
  const TIER_LABELS: Record<string, string> = { high: "High intent", mid: "Mid intent", low: "Low intent" };
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
  const startCitationTest = () => {
    if (aiDisc) {
      setView("citations");
      return;
    }
    citationRequestStarted.current = false;
    setView("citations-loading");
    if (!citationsLoading) onRunCitations?.();
  };
  const backToReadiness = () => setView("readiness");
  const heading = view === "recommendations" ? "All recommendations" : view === "citations" || view === "citations-loading" ? "Where am I invisible?" : "What Lensy found";

  // A single scored recommendation card: title, impact/effort/category chips,
  // the fix text, an optional "we can help" link, and a code snippet when present.
  const chipClass = "inline-flex items-center rounded-full border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-medium leading-none tracking-[-.02em] text-[var(--ink-soft)]";
  const renderRec = (rec: Rec, key: string) => {
    const link = actionLink(rec);
    return (
      <article key={key} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--line-strong)]">
        <p className="text-[15px] font-medium leading-snug tracking-[-.03em] text-[var(--ink)]">{recIssue(rec)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className={chipClass}>{impactLabel(rec)}</span>
          <span className={chipClass}>{effortLabel(rec)}</span>
          {rec.category && <span className={chipClass}>{rec.category}</span>}
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--ink-soft)]">{recFix(rec)}</p>
        {link && <a href={link.href} target="_blank" rel="noopener noreferrer" className="group mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium tracking-[-.02em] text-[var(--accent)] hover:text-[var(--accent-hover)]"><span style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>{link.label}</span><ArrowRight className="arrow-nudge size-3" strokeWidth={1.8} aria-hidden="true" /></a>}
        {rec.codeSnippet && <pre className="mt-4 overflow-x-auto rounded-[var(--radius-md)] text-[12px] leading-[1.7]" style={{ background: "var(--panel-bg)", color: "var(--panel-fg)", fontFamily: "var(--font-mono, ui-monospace, monospace)", whiteSpace: "pre-wrap", padding: "16px 18px" }}>{rec.codeSnippet}</pre>}
      </article>
    );
  };

  // Citations results as a semantic <table> (T-10): proper thead/th scope/tbody/
  // tr/td for screen readers, an engine-named result column (T-09), and an
  // intent-tier badge per row (T-08). `resultHeader` names the engine tested.
  const renderCitationRow = (result: any) => (
    <tr key={`${result.engine}-${result.query}`} className="border-b border-[var(--line)] align-top last:border-b-0">
      <td className="px-4 py-5">
        <p className="text-[15px] tracking-[-.03em]">“{result.query}”</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {result.tier && <span className={chipClass}>{TIER_LABELS[result.tier]}</span>}
        </div>
        {result.citedUrl && <p className="mt-2 text-[12px] leading-relaxed text-[var(--ink-soft)]">Cited URL: {result.citedUrl}</p>}
        {result.competingDomains?.length > 0 && <p className="mt-2 text-[12px] leading-relaxed text-[var(--ink-soft)]">Cited instead: {result.competingDomains.join(", ")}</p>}
      </td>
      <td className="px-4 py-5 text-right align-middle">
        <span className="inline-flex rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-medium tracking-[-.025em] text-[var(--ink-soft)]">{result.cited ? "Cited" : "Not cited"}</span>
      </td>
    </tr>
  );
  const renderCitationTable = () => (
    <div className="mt-6 overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)]">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--line)] text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">
            <th scope="col" className="px-4 py-3 font-medium">Query</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">{testedEngineLabel || "Result"}</th>
          </tr>
        </thead>
        {citationsByTier.length > 0 ? (
          citationsByTier.map((group) => (
            <tbody key={group.tier}>
              <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]">
                <th scope="colgroup" colSpan={2} className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[.08em] text-[var(--muted)]">{TIER_LABELS[group.tier]}</th>
              </tr>
              {group.rows.map(renderCitationRow)}
            </tbody>
          ))
        ) : (
          <tbody>{citationResults.map(renderCitationRow)}</tbody>
        )}
        {citationsByTier.length > 0 && citationsUntiered.length > 0 && <tbody>{citationsUntiered.map(renderCitationRow)}</tbody>}
      </table>
    </div>
  );

  return <section className="mx-auto max-w-[1240px] px-5 pb-20 pt-12 sm:px-8 sm:pb-28 sm:pt-16">
    <div className="mb-10">
      <Link to="/" className="inline-flex items-center gap-2 text-[12px] font-medium tracking-[-.025em] text-[var(--muted)] transition-colors hover:text-[var(--accent)]">
        <ArrowLeft className="size-3" strokeWidth={1.8} aria-hidden="true" />Back to Lensy
      </Link>
    </div>

    {analysisState?.status === 'error' && (
      <div id="scan-error" role="alert" className="mb-8 mt-3 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--tint)] px-5 py-4 text-[12px] font-medium tracking-[-.02em] text-[var(--ink)] flex flex-col items-start gap-2">
        {isJsRenderPrompt ? (
          <>
            <div className="font-medium text-[15px] tracking-[-.02em] text-[var(--ink)]">This page is rendered by JavaScript</div>
            <div className="text-[13px] text-[var(--ink-soft)] font-normal leading-[1.55] tracking-[-.01em]">Most AI bots (like GPTBot or ClaudeBot) do not execute JavaScript and cannot crawl your website. Consider Server-Side Rendering (SSR) for AI discoverability.</div>
            <button
              onClick={(e) => {
                e.preventDefault();
                // Legacy event kept for continuity + the dedicated consent event
                // that measures the JS-render funnel conversion.
                trackEvent("try_another_url_clicked", { action: "js-render", error: "This page is rendered by JavaScript" });
                trackEvent("js_render_consent_given", { url: urlParam });
                onScan?.(urlParam, { forceJsRender: true });
              }}
              className="mt-2 btn-ink shrink-0 bg-[var(--ink)] px-4 py-2 text-[12px] font-medium tracking-[-.025em] text-[var(--bg)]"
            >
              Proceed with analysis anyway
            </button>
          </>
        ) : (
          (() => {
            const { title, description } = describeScanError(analysisState.error);
            return (
              <>
                <div className="font-medium text-[15px] tracking-[-.02em] text-[var(--ink)]">{title}</div>
                <div className="text-[13px] text-[var(--ink-soft)] font-normal leading-[1.55] tracking-[-.01em]">{description}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      trackEvent("try_again_clicked", { url: urlParam, error: analysisState.error });
                      onScan?.(urlParam);
                    }}
                    className="btn-ink shrink-0 bg-[var(--ink)] px-4 py-2 text-[12px] font-medium tracking-[-.025em] text-[var(--bg)]"
                  >
                    Try again
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      // "Try another URL" clears the input by returning home (Home clears session on mount).
                      trackEvent("try_another_url_clicked", { action: "error-recovery", error: analysisState.error });
                      navigate("/");
                    }}
                    className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-2 text-[12px] font-medium tracking-[-.025em] text-[var(--ink)] transition-colors hover:bg-[var(--tint)]"
                  >
                    Try another URL
                  </button>
                  <a
                    href="/contact?ref=feedback"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackEvent("report_issue_clicked", { url: urlParam, error: analysisState.error })}
                    className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-2 text-[12px] font-medium tracking-[-.025em] text-[var(--ink)] transition-colors hover:bg-[var(--tint)]"
                  >
                    Report an issue
                  </a>
                </div>
              </>
            );
          })()
        )}
      </div>
    )}

    <div className="flex flex-col gap-5 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-[12px] font-medium tracking-[-.025em] text-[var(--accent)]">Lensy scan / AI readiness report</p><h1 className="mt-3 text-[clamp(2.4rem,5.5vw,5rem)] font-medium leading-[.93] tracking-[-.07em]">{heading}</h1></div>
      <div className="flex flex-col items-start sm:items-end gap-1.5 text-[12px] font-medium tracking-[-.025em] text-[var(--muted)]">
        <div><span>Scanned </span><span className="text-[var(--ink)]">{hostname}</span></div>
        {(view === "readiness" || view === "recommendations") && report?.analysisTime && <div><span>AI readiness Completed in </span><span className="text-[var(--ink)]">{(report.analysisTime / 1000).toFixed(1)}s</span></div>}
        {(view === "citations" || view === "citations-loading") && aiDisc && (aiDisc.analysisTime || aiDisc.processingTime || aiDisc.duration || aiDisc.executionTime || aiDisc.time) && <div><span>AI citations check completed in </span><span className="text-[var(--ink)]">{((aiDisc.analysisTime || aiDisc.processingTime || aiDisc.duration || aiDisc.executionTime || aiDisc.time) / 1000).toFixed(1)}s</span></div>}
      </div>
    </div>

    <div className="mt-8 grid gap-3 sm:grid-cols-2">
      <button onClick={backToReadiness} className={`rounded-[var(--radius-md)] border p-6 text-left transition-colors sm:p-7 ${view === "readiness" || view === "recommendations" ? "border-[var(--ink)] bg-[var(--panel-bg)] text-[var(--panel-fg)]" : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-2)]"}`}>
        <span className="text-[11px] font-medium tracking-[-.025em] opacity-65">AI readiness</span>
        <span className="mt-6 block text-[clamp(2.7rem,5vw,4.4rem)] font-medium leading-none tracking-[-.08em]">{realScore ?? "—"}<span className="ml-1 text-[15px] tracking-normal opacity-60">/100</span></span>
        <span className="mt-3 block text-[13px] leading-relaxed opacity-75">{hasReport ? `${failingSignalCount} signal${failingSignalCount === 1 ? "" : "s"} to improve across ${failingGroupCount} categor${failingGroupCount === 1 ? "y" : "ies"}` : "Waiting for the completed scan report"}</span>
      </button>
      <button onClick={startCitationTest} className={`rounded-[var(--radius-md)] border p-6 text-left transition-colors sm:p-7 ${view === "citations" || view === "citations-loading" ? "border-[var(--ink)] bg-[var(--panel-bg)] text-[var(--panel-fg)]" : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-2)]"}`}>
        {citationResults.length ? (<>
          <span className="text-[11px] font-medium tracking-[-.025em] opacity-65">AI citations</span>
          <span className="mt-6 block text-[clamp(2.7rem,5vw,4.4rem)] font-medium leading-none tracking-[-.08em]">{citedCount}/{citationResults.length}</span>
          <span className="mt-3 block text-[13px] leading-relaxed opacity-75">Cited in {citedCount} of {citationResults.length} tested queries</span>
        </>) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, width: '100%', minHeight: 80 }}>
            {citationsLoading ? <span style={{ display: 'inline-block', width: 28, height: 28, borderRadius: '50%', borderWidth: 3, borderStyle: 'solid', borderColor: 'var(--accent, #697075)', borderTopColor: 'transparent', animation: 'citationspin .8s linear infinite', flexShrink: 0 }} /> : <svg width="32" height="36" viewBox="0 0 24 24" style={{ flexShrink: 0, opacity: 0.5 }}><path d="M8 5.14v14l11-7-11-7z" fill="currentColor" /></svg>}
            <div>
              <span style={{ display: 'block', fontSize: 17, fontWeight: 500, letterSpacing: '-0.025em' }}>AI Citations</span>
              <span style={{ display: 'block', marginTop: 4, fontSize: 13, opacity: 0.65 }}>{citationsLoading ? "Testing citations with AI search" : "Run citation check"}</span>
            </div>
          </div>
        )}
        <style>{`@keyframes citationspin{to{transform:rotate(360deg)}}`}</style>
      </button>
    </div>

    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[var(--line)] pb-5 text-[12px] font-medium tracking-[-.025em]">
      {overallScoreData?.docConfidence ? (
        (() => {
          const rawScore = overallScoreData.docConfidence.score;
          const pct = rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore);
          const message = overallScoreData.docConfidence.label || (pct >= 75 ? "Likely a doc page" : pct >= 40 ? "May be a doc page" : "Unlikely a doc page");

          return (
            <div className="flex items-center gap-4">
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 text-[var(--ink)]">
                {message} ({pct}%)
              </span>
              <Tooltip
                placement="bottom"
                arrow
                enterTouchDelay={0}
                leaveTouchDelay={3000}
                title={
                  <ul className="list-outside list-disc space-y-1.5" style={{ paddingLeft: "1.15rem", margin: 0 }}>
                    {overallScoreData.docConfidence.signals.map((sig: string, i: number) => (
                      <li key={i}>{sig}</li>
                    ))}
                  </ul>
                }
                componentsProps={{
                  tooltip: {
                    sx: {
                      maxWidth: 340,
                      bgcolor: "var(--panel-bg)",
                      color: "var(--panel-fg)",
                      fontSize: "13px",
                      fontWeight: 400,
                      lineHeight: 1.6,
                      textAlign: "left",
                      p: 2,
                      borderRadius: "var(--radius-md)",
                      boxShadow: "var(--shadow-float)",
                    },
                  },
                  arrow: { sx: { color: "var(--panel-bg)" } },
                }}
              >
                <span tabIndex={0} className="inline-flex cursor-help items-center text-[var(--ink-soft)] underline decoration-[var(--ink-soft)] decoration-dotted underline-offset-4 outline-none transition-colors hover:text-[var(--ink)] focus-visible:text-[var(--ink)]">
                  {overallScoreData.docConfidence.signals.length} signals
                </span>
              </Tooltip>
            </div>
          );
        })()
      ) : (
        <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-[var(--ink-soft)]">
          {hasReport ? "Scan report received" : "Report data unavailable"}
        </span>
      )}

      {(view === "readiness" || view === "citations" || view === "citations-loading") && totalRecCount > 0 && (
        <button onClick={() => { trackEvent("recommendations_viewed"); setView("recommendations"); }} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
          View all {totalRecCount} recommendations <ArrowRight className="size-3" strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {view === "recommendations" && (
        <button onClick={backToReadiness} className="link-sweep inline-flex items-center gap-2 text-[var(--ink-soft)] hover:text-[var(--accent)]">
          <ArrowLeft className="size-3" strokeWidth={1.8} aria-hidden="true" />Back to readiness
        </button>
      )}
    </div>

    {view === "readiness" && <><div className="mt-6 flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-[11px] font-medium tracking-[-.025em] text-[var(--ink)]">{botAccessState === 'js_blocked' ? "! AI bot access is blocked by JavaScript" : (botAccess ? `${botAccess.robotsTxtFound ? "✓" : "!"} Bot access: ${botAccess.allowedCount} / ${botAccess.allowedCount + botAccess.blockedCount} allowed` : "Bot access data unavailable")}</span>{botAccess?.robotsTxtFound ? <a href={robotsUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] font-medium tracking-[-.025em] text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]" style={{ textDecoration: "underline", textUnderlineOffset: "4px" }}>robots.txt</a> : <span className="ml-auto text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">No robots.txt found</span>}</div>{(botAccessState === 'js_blocked' || !botAccess?.bots?.length) && <span className="text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">{botAccessState === 'js_blocked' ? "This page is a JavaScript-rendered SPA. Most AI bots do not execute JavaScript, making your content invisible to them regardless of your robots.txt configuration. Lensy rendered this page for content analysis; most AI bots cannot." : hasReport ? "No checked crawler names were returned." : "No bot access data returned."}</span>}{botAccess?.bots?.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{botAccess.bots.map((bot: any, i: number) => { const blocked = botAccessState === 'js_blocked' || !(bot.status === 'allowed' || bot.status === 'not-mentioned'); return <span key={i} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-medium leading-none tracking-[-.02em] text-[var(--ink-soft)]">{blocked ? <XCircle className="size-3 shrink-0" style={{ color: "var(--ink-soft)" }} strokeWidth={2} aria-hidden="true" /> : <CheckCircle2 className="size-3 shrink-0" style={{ color: "var(--accent)" }} strokeWidth={2} aria-hidden="true" />}{bot.name}</span>; })}</div>}</div><div className="mt-5 grid items-start gap-3 lg:grid-cols-3">{signalGroups.map((group) => <section key={group.title} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-6"><div className="flex items-center justify-between border-b border-[var(--line)] pb-4"><h2 className="text-[11px] font-medium tracking-[-.025em] text-[var(--ink-soft)]">{group.title}</h2><SignalStatusIcon status={(() => { const all = group.sections.flatMap((s: any) => s.signals as Signal[]); if (group.title === "Structured data") return headerStatus("structuredData", 15, all); if (group.title === "Discoverability") return headerStatus("discoverability", 30, all); if (group.title === "Content quality") return headerStatus("consumability", 32, all); return aggregateStatus(all.map((x) => x.status)); })()} className="size-4 shrink-0" /></div>{group.sections.map((section: any) => <div key={section.title || group.title} className="mt-5 first:mt-5"><p className={`text-[11px] font-medium uppercase tracking-[.08em] text-[var(--muted)] ${section.title ? "mb-4" : "sr-only"}`}>{section.title || "Signals"}</p><ul className="space-y-5">{section.signals.map((sig: Signal) => <li key={sig.label} className="flex gap-2.5"><SignalStatusIcon status={sig.status} className="mt-0.5 size-4 shrink-0" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-3 gap-y-2"><p className="text-[14px] tracking-[-.025em]">{sig.label}</p><EvidenceBadge signal={sig.signal} /><AudienceBadge audience={sig.signal?.audience || sig.audience} />{sig.status !== "pass" && <ImpactBadge impact={resolveImpact(sig.label)} />}<InfoHint text={sig.info} /></div><p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-soft)]">{sig.detail}</p>{sig.status !== "pass" && (() => { const fix = fixForSignal(sig.label); return fix ? <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ink)]"><span className="font-medium">Fix: </span>{fix}</p> : null; })()}{sig.signal?.note && <p className="mt-1 text-[11px] italic leading-relaxed" style={{ color: "var(--ink-soft)" }}>{sig.signal.note}</p>}{sig.waitlist && <a href={`/contact?ref=${sig.waitlist}`} target="_blank" rel="noopener noreferrer" className="group mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium tracking-[-.02em] text-[var(--accent)] hover:text-[var(--accent-hover)]"><span style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>{sig.waitlist === "llmstxt" ? "We can help you generate one" : "We can help you generate markdown"}</span><ArrowRight className="arrow-nudge size-3" strokeWidth={1.8} aria-hidden="true" /></a>}</div></li>)}</ul></div>)}</section>)}</div></>}

    {view === "citations-loading" && <div className="mt-10"><p className="text-[15px] leading-relaxed text-[var(--ink-soft)]">AI-generated queries are being tested against configured AI search engines.</p><p className="mt-10 text-center text-[12px] font-medium tracking-[-.025em] text-[var(--accent)]">Testing citation queries…</p><div className="mt-6 grid gap-3">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="grid grid-cols-[1.5fr_.65fr] gap-5 border-t border-[var(--line)] py-4"><span className="h-3 animate-pulse bg-[var(--surface-2)]" /><span className="h-3 animate-pulse bg-[var(--surface-2)]" /></div>)}</div></div>}

    {view === "citations" && <div className="mt-10"><p className="text-[15px] leading-relaxed text-[var(--ink-soft)]">{citationsLoading ? "AI search is checking the generated queries. Results will appear here when the scan controller receives them." : citationResults.length ? "Citation results returned by the completed AI search check." : citationsReturned && availableCitationEngines.length === 0 ? "The citation check completed, but no configured AI search engine was available to test this documentation." : citationsReturned ? "The citation check completed but did not return query-level results." : "Start the citation check to test whether AI search can find and cite your documentation."}</p>{citationResults.length > 0 && <><div className="mt-6 inline-flex rounded-full bg-[var(--surface-2)] px-3 py-1 text-[11px] font-medium tracking-[-.025em] text-[var(--ink-soft)]">Cited: {citedCount} / {citationResults.length} tested queries</div>{renderCitationTable()}</>}{citationsReturned && citationResults.length === 0 && aiDisc?.recommendations?.length > 0 && <div className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]">{aiDisc.recommendations.map((recommendation: any) => <div key={recommendation.issue} className="py-4"><p className="text-[14px] tracking-[-.025em]">{recommendation.issue}</p><p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-soft)]">{recommendation.fix}</p></div>)}</div>}</div>}

    {view === "recommendations" && <div className="mt-10">
      <h2 className="text-[19px] font-medium tracking-[-.04em]">All recommendations <span className="text-[var(--muted)]">({totalRecCount})</span></h2>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-soft)]" style={{ maxWidth: "none" }}>Quick Wins and Deeper Improvements affect your score. Things to Watch are informational and don't impact scoring.</p>

      {totalRecCount === 0 && <p className="mt-8 text-[14px] text-[var(--ink-soft)]">No recommendations — this page is well-optimized for AI tools.</p>}

      {quickWins.length > 0 && <div className="mt-12">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[.09em] text-[var(--ink)]">Quick Wins</h3>
          <span className="text-[11px] font-medium tabular-nums text-[var(--muted)]">{quickWins.length}</span>
        </div>
        <div className="mt-5 grid gap-3">{quickWins.map((rec, i) => renderRec(rec, `qw-${i}`))}</div>
      </div>}

      {deeperImprovements.length > 0 && <div className="mt-12">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[.09em] text-[var(--ink)]">Deeper Improvements</h3>
          <span className="text-[11px] font-medium tabular-nums text-[var(--muted)]">{deeperImprovements.length}</span>
        </div>
        <div className="mt-5 grid gap-3">{deeperImprovements.map((rec, i) => renderRec(rec, `di-${i}`))}</div>
      </div>}

      {thingsToWatch.length > 0 && <div className="mt-12">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[.09em] text-[var(--muted)]">Things to Watch</h3>
          <span className="text-[11px] font-medium tabular-nums text-[var(--muted)]">{thingsToWatch.length}</span>
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--muted)]">Emerging patterns that don't affect your score</p>
        <div className="mt-5 grid gap-3">{thingsToWatch.map((rec, i) => <article key={`ttw-${i}`} className="rounded-[var(--radius-md)] border border-dashed border-[var(--line)] bg-[var(--surface)] p-5"><p className="text-[15px] font-medium leading-snug tracking-[-.03em] text-[var(--ink)]">{recIssue(rec)}</p>{rec.category && <div className="mt-3"><span className={chipClass}>{rec.category}</span></div>}<p className="mt-3 text-[13px] leading-relaxed text-[var(--ink-soft)]">{recFix(rec)}</p></article>)}</div>
      </div>}
    </div>}

    {/* Shared footer note — shown on all three views (readiness, recommendations, citations),
        carrying the standing scan note and a Share feedback link. */}
    {(view === "readiness" || view === "recommendations" || view === "citations" || view === "citations-loading") && (
      <div className="mt-12 border-l-2 border-[var(--accent)] bg-[var(--surface)] px-5 py-4 text-[12px] leading-relaxed text-[var(--ink-soft)]">
        Results above are generated from the completed Lensy scan. Citation results appear only after the citation check returns data. <a href="/contact?ref=feedback" target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--accent)] hover:text-[var(--accent-hover)]" style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>Share feedback</a>
      </div>
    )}
  </section>;
}

export function HowItWorks() {
  const steps = [
    ["Paste a URL", "Enter any docs page. API references, guides, or tutorials."],
    ["Lensy scans the page", "We check bot access, content structure, structured data, and discoverability in real time."],
    ["Get your score", "See how you score out of 100, with exact steps to fix any issues."],
    ["Check citations", "Find out if AI search engines like Perplexity actually cite your page right now."],
  ];
  const flow = [
    ["01", "Paste Documentation URL", "docs.example.com/api"],
    ["02", "Content Validation", "Is this technical documentation?"],
    ["04", "AI Citation Check", "Perplexity AI Search"],
    ["05", "Score + Recommendations", ""],
  ];

  return <>
    <header className="mx-auto grid max-w-[1240px] gap-8 border-b border-[var(--line)] px-5 pb-14 pt-16 sm:px-8 sm:pb-20 sm:pt-24 lg:grid-cols-12">
      <h1 style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }} className="hero-intro max-w-3xl font-medium leading-[.88] tracking-[-.075em] lg:col-span-8">See exactly how bots <span className="text-[var(--accent)]">read your docs.</span></h1>
      <p className="self-end text-[15px] leading-relaxed text-[var(--ink-soft)] lg:col-span-4">Give Lensy a URL, and it shows you exactly how AI search engines read and cite your page.</p>
    </header>
    <section data-reveal className="mx-auto grid max-w-[1240px] gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-12 lg:gap-16">
      <div className="lg:col-span-5"><p className="text-[12px] font-medium tracking-[-.025em] text-[var(--muted)]">The process</p><ol className="mt-7 border-t border-[var(--line)]">{steps.map(([title, description], index) => <li key={title} className="grid grid-cols-[32px_minmax(0,1fr)] gap-4 border-b border-[var(--line)] py-6"><span className="text-[11px] font-medium tracking-[-.025em] text-[var(--accent)]">0{index + 1}</span><div><h2 className="text-[19px] font-light tracking-[-.04em]">{title}</h2><p className="mt-2 max-w-md text-[13px] leading-relaxed text-[var(--ink-soft)]">{description}</p></div></li>)}</ol><Link to="/#scan" className="btn-ink group mt-8 inline-flex items-center gap-2 bg-[var(--panel-bg)] px-4 py-3 text-[12px] font-medium tracking-[-.025em] text-[var(--panel-fg)]">Run a free scan <ArrowRight className="arrow-nudge size-3" strokeWidth={1.8} aria-hidden="true" /></Link></div>
      <div className="lg:col-span-6 lg:col-start-7">
        <div className="flex items-baseline justify-between border-b border-[var(--line)] pb-4">
          <p className="text-[12px] font-medium tracking-[-.025em] text-[var(--muted)]">From page to report</p>
          <p className="text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">5 stages</p>
        </div>
        <div className="mt-7 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-8">
          <div className="mx-auto max-w-[420px]">
            {flow.slice(0, 2).map(([number, title, detail]) => <div key={title}>
              <FlowNode number={number} title={title} detail={detail} />
              <FlowConnector />
            </div>)}
            <div className="rounded-[var(--radius-md)] border border-[var(--ink)] bg-[var(--bg)] p-5">
              <div className="flex items-start justify-between gap-6"><div><p className="text-[11px] font-medium tracking-[-.025em] text-[var(--accent)]">03</p><h2 className="mt-3 text-[19px] font-light tracking-[-.045em]">AI Readiness Analysis</h2></div><span className="text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">parallel analysis</span></div>
              <div className="mt-5 grid grid-cols-3 border-y border-[var(--line)]">
                {["Discoverability", "Content quality", "Structured data"].map((signal, index) => <div key={signal} className={`py-3 text-center text-[10px] font-medium leading-snug tracking-[-.02em] text-[var(--ink-soft)] ${index ? "border-l border-[var(--line)]" : ""}`}>{signal}</div>)}
              </div>
              <p className="mt-4 text-center text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">+ bot access prerequisite check</p>
            </div>
            <FlowConnector />
            {flow.slice(2).map(([number, title, detail], index) => <div key={title}>
              <FlowNode number={number} title={title} detail={detail} final={index === 1} />
              {index === 0 && <FlowConnector />}
            </div>)}
          </div>
        </div>
      </div>
    </section>
  </>;
}

export function FlowConnector() {
  return <div className="flex h-9 flex-col items-center justify-center" aria-hidden="true"><span className="h-4 border-l border-[var(--line)]" /><ArrowDown className="size-3 text-[var(--accent)]" strokeWidth={1.8} /></div>;
}

export function FlowNode({ number, title, detail, final = false }: { number: string; title: string; detail: string; final?: boolean }) {
  return <div className={`rounded-[var(--radius-md)] border px-5 py-4 ${final ? "border-[var(--ink)] bg-[var(--panel-bg)] text-[var(--panel-fg)]" : "border-[var(--line)] bg-[var(--bg)]"}`}><div className="flex items-start gap-4"><span className={`mt-0.5 text-[11px] font-medium tracking-[-.025em] ${final ? "opacity-60" : "text-[var(--accent)]"}`}>{number}</span><div><h2 className="text-[16px] font-light tracking-[-.04em]">{title}</h2>{detail && <p className="mt-1 text-[12px] leading-relaxed opacity-70">{detail}</p>}</div></div></div>;
}

// ---- Education ----

type ArticleData = {
  slug: string;
  title: string;
  tag: string;
  readTime: string;
  description: string;
  body: React.ReactNode;
};

const ARTICLES: ArticleData[] = [
  {
    slug: "what-changed-in-lensy-after-rechecking-ai-ready-docs-signals",
    title: "What Changed in Lensy After Re-checking AI-Ready Docs Signals",
    tag: "AI Readiness",
    readTime: "4 min read",
    description: "Markdown discoverability goes beyond .md files. How llms.txt, content negotiation, Link headers, and page-level mapping changed what Lensy checks.",
    body: <>
      <Prose>
        <p>When we shipped the first version of Lensy, the discoverability checks were straightforward: does the page render in a headless browser, is it accessible to known AI crawlers, does it have a robots.txt that permits indexing. Those checks are necessary, but they aren't enough.</p>
        <p>A second pass at the signals that actually predict AI citation rates revealed a gap. The original checks treated Markdown support as binary: either the page serves a <code>.md</code> file or it does not. That framing is wrong.</p>

        <h2>llms.txt and the explicit declaration pattern</h2>
        <p>The <a href="https://llmstxt.org" target="_blank" rel="noopener noreferrer">llms.txt proposal</a> formalizes a pattern used by Anthropic, Cloudflare, Vercel, and Stripe. It's a plain text manifest at the root of a site that lists which pages exist, what they contain, and what order to read them in.</p>
        <p>The file does two things. For retrieval-augmented systems, it provides a curated index that a model can read before deciding which pages to fetch. For citation systems, it establishes a canonical hierarchy that helps a model explain <em>where</em> it found something. Lensy now checks for <code>/llms.txt</code> and <code>/llms-full.txt</code> at the domain root and scores their completeness.</p>

        <h2>Content negotiation and the Accept header</h2>
        <p>Some documentation platforms — notably those built on Mintlify, Nextra, and Docusaurus with the right plugins — will return Markdown when a request includes <code>Accept: text/markdown</code> in the header. This is simple content negotiation. It helps an AI agent ingest clean, structured content without parsing HTML.</p>
        <p>Lensy now sends a content-negotiation request alongside its standard HTML fetch and reports whether the server honours it. Sites that do tend to score significantly higher on the context dimension of the audit.</p>

        <h2>Link headers for structured navigation</h2>
        <p>HTTP <code>Link</code> headers can declare relationships between pages: <code>rel="next"</code>, <code>rel="prev"</code>, <code>rel="up"</code>. These are standard mechanisms for communicating document structure at the protocol layer — before any HTML is parsed. Documentation sites that emit these headers make it straightforward for a crawler to discover a full guide by following links rather than parsing a sidebar.</p>
        <p>We added a Link header check after noticing that documentation sites with clear structural navigation were consistently cited more accurately — even when their on-page HTML structure was ambiguous.</p>

        <h2>Page-level topic mapping</h2>
        <p>The original audit scored metadata at the page level in a binary way: either there is a <code>description</code> meta tag or there is not. The updated check goes further. Lensy now extracts the declared topic from <code>og:description</code>, Schema.org <code>TechArticle</code> markup, and any explicit <code>keywords</code> meta field, and then compares those declared topics against the actual heading structure and first-paragraph content of the page.</p>
        <p>Pages where the declared topic and the content diverge — a common symptom of boilerplate meta descriptions — score lower on the context dimension. This turned out to explain a meaningful fraction of the variance between sites that get cited and sites that do not.</p>

        <h2>What stayed the same</h2>
        <p>Bot access comes first. It must pass before we evaluate anything else. If ClaudeBot, OAI-SearchBot, or Google-Extended are blocked by <code>robots.txt</code> or rate-limiting, the rest of the audit is moot. The access check is unchanged. The structure and citation dimensions retain their original logic; the new checks sit within the context dimension.</p>
        <p>The scoring weights shifted to reflect the updated signals. Access remains necessary but not weighted heavily once it passes. Context — which now includes llms.txt, content negotiation, Link headers, and topic mapping — carries more weight than before. Citation readiness, which measures whether a page provides a clear, directly quotable answer to the question a page title implies, remains the highest-weighted dimension.</p>
      </Prose>
    </>,
  },
  {
    slug: "research-behind-ai-ready-docs",
    title: "The Research Behind AI-Ready Documentation",
    tag: "AI Readiness",
    readTime: "3 min read",
    description: "The research behind the four things Lensy measures: bot access, content structure, structured data, and discoverability.",
    body: <>
      <Prose>
        <TlDr items={[
          "Document structure directly affects AI retrieval quality. DeepRead showed 10.3% improvement and RAPTOR showed 20% improvement with structure-aware processing.",
          "ClaudeBot is blocked by 69% of websites and GPTBot by 62%. 71% of sites that block training bots also block search crawlers, removing themselves from AI results entirely.",
          "JSON-LD markup increases rich snippet visibility by 20–30%. Structured data, heading hierarchies, and proper canonicalisation all contribute to higher citation rates.",
        ]} />

        <h2>Why Document Structure Matters</h2>
        <p>Most AI search engines use Retrieval-Augmented Generation (RAG). They break documents into chunks, embed them in vector space, retrieve relevant chunks for a query, and feed those chunks to a language model. The quality of that chunking, and the structural signals available to guide it, directly affects answer quality.</p>
        <p>DeepRead [1] found that preserving heading hierarchy during HTML-to-Markdown conversion enables a "locate-then-read" paradigm, improving retrieval by 10.3% over baseline agentic search. RAPTOR [2] showed 20% improvement on multi-step reasoning by building recursive tree structures from document hierarchies. The DUE benchmark [3] further established that document understanding requires explicit layout awareness across tasks spanning VQA, key information extraction, and machine reading comprehension.</p>
        <p>Snowflake's engineering team [4] confirmed that Markdown-aware chunking provides 5–10% accuracy improvement in RAG quality for complex documents, and that retrieval strategy matters even with long-context LLMs.</p>

        <h2>Bot Access: The Crawler Gate</h2>
        <p>Major AI companies operate multiple crawlers with distinct purposes. Anthropic runs ClaudeBot (training), Claude-User (real-time fetches), and Claude-SearchBot (indexing). OpenAI separates GPTBot (training) from OAI-SearchBot (search results). Google separates Googlebot (search ranking) from Google-Extended (Gemini training) [7].</p>
        <p>Industry analysis shows ClaudeBot is blocked by approximately 69% of websites and GPTBot by 62% [5]. More critically, 71% of sites that block training bots also inadvertently block search and retrieval bots [6], effectively removing themselves from AI-powered search results. OpenAI has stated that sites blocking OAI-SearchBot will not appear in ChatGPT search answers.</p>

        <h2>Structured Data</h2>
        <p>JSON-LD uses the Schema.org vocabulary to declare page types (<code>TechArticle</code>, <code>APIReference</code>), authors, publication dates, and topic relationships. BrightEdge research [8] shows pages with proper Schema.org markup see a 20–30% increase in rich snippet visibility. Google's Search Central documentation [9] confirms that structured data directly affects how content appears in search results and AI overviews.</p>
        <p>OpenGraph meta tags influence how AI-powered preview systems and content aggregation tools summarise your content. Canonical URLs consolidate link equity and prevent AI engines from indexing duplicate versions [10], which is especially important for documentation sites serving versioned or localised content.</p>

        <h2>What This Means</h2>
        <p>84% of developers now use or plan to use AI tools [11]. Documentation that meets structural, access, and metadata standards gets cited. Documentation that does not is invisible to this growing majority.</p>

        <References items={[
          { n: 1, text: 'Li et al. "DeepRead: Document Structure-Aware Reasoning." arXiv:2602.05014, 2026.', href: "https://arxiv.org/abs/2602.05014" },
          { n: 2, text: 'Sarthi et al. "RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval." ICLR 2024.', href: "https://arxiv.org/abs/2401.18059" },
          { n: 3, text: 'Borchmann et al. "DUE: End-to-End Document Understanding Benchmark." NeurIPS 2021.', href: "https://datasets-benchmarks-proceedings.neurips.cc/paper/2021/hash/069059b7ef840f0c74a814ec9237b6ec-Abstract-round2.html" },
          { n: 4, text: 'Snowflake. "How Retrieval & Chunking Impact Finance RAG." 2024.', href: "https://www.snowflake.com/en/engineering-blog/impact-retrieval-chunking-finance-rag/" },
          { n: 5, text: 'ALM Corp. "ClaudeBot, Claude-User & Claude-SearchBot: Anthropic\'s Three-Bot Framework." 2025.', href: "https://almcorp.com/blog/anthropic-claude-bots-robots-txt-strategy/" },
          { n: 6, text: 'Search Engine Journal. "Anthropic\'s Claude Bots Make Robots.txt Decisions More Granular." 2025.', href: "https://www.searchenginejournal.com/anthropics-claude-bots-make-robots-txt-decisions-more-granular/568253/" },
          { n: 7, text: "Google. \"Google's Common Crawlers.\" Google for Developers, 2025.", href: "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers" },
          { n: 8, text: 'BrightEdge. "Structured Data in the AI Search Era." 2025.', href: "https://www.brightedge.com/blog/structured-data-ai-search-era" },
          { n: 9, text: 'Google. "Introduction to Structured Data." Search Central.', href: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data" },
          { n: 10, text: 'Google. "Canonicalisation." Search Central.', href: "https://developers.google.com/search/docs/crawling-indexing/canonicalization" },
          { n: 11, text: 'Stack Overflow. "2025 Developer Survey Results." 2025.', href: "https://survey.stackoverflow.co/2025/" },
        ]} />
      </Prose>
    </>,
  },
  {
    slug: "how-ai-search-finds-and-cites-docs",
    title: "How AI Search Finds, Processes, and Cites Your Docs",
    tag: "AI Discoverability",
    readTime: "3 min read",
    description: "Inside the RAG pipeline: crawling, chunking, retrieval, and citation. What llms.txt changes, and how platforms like Perplexity and ChatGPT decide what to cite.",
    body: <>
      <Prose>
        <TlDr items={[
          "Chunking strategy matters. Element-based chunking that respects document structure achieved 84.4% page-level accuracy, while 512-token windows with 200-token overlap scored highest across 90 configurations.",
          "llms.txt lets you serve Markdown directly to AI agents. Fern reports over 90% reduction in token consumption. Twilio, Stripe, and Cloudflare have also adopted it.",
          "Perplexity cites sources on nearly every response. Brands mentioned positively across 4+ platforms are 2.8× more likely to appear in ChatGPT responses.",
        ]} />

        <h2>How Chunking Works</h2>
        <p>AI search engines crawl your page, convert HTML to text or Markdown, split it into chunks, embed those chunks in vector space, and retrieve relevant pieces to generate an answer. Each stage is sensitive to document quality.</p>
        <p>Jimeno-Yepes et al. [1] demonstrated that element-based chunking that respects document structure — headings, paragraphs, code blocks — rather than splitting at arbitrary character boundaries achieved 84.4% accuracy at page level and improved ROUGE and BLEU scores over naive splitting. Stäbler and Turnbull [2] benchmarked 90 chunker-model configurations across 7 domains and found sentence-based splitting with 512-token windows and 200-token overlap achieved the highest retrieval accuracy. Vectara's study [3] tested 25 chunking configurations across 48 embedding models and confirmed that fixed-size chunking at 256–512 tokens consistently outperformed more computationally expensive semantic chunking.</p>

        <h2>llms.txt and Markdown Alternate Links</h2>
        <p>Proposed by Jeremy Howard of Answer.AI in September 2024, <code>llms.txt</code> [4] is a Markdown file that helps LLMs navigate websites by providing structured links to content instead of requiring models to parse HTML boilerplate. Adoption has been rapid:</p>
        <ul>
          <li><strong>Twilio</strong> [5] exposes Markdown versions of all docs (append <code>.md</code> to any URL) plus a curated <code>llms.txt</code> sitemap.</li>
          <li><strong>Fern</strong> [6] serves two variants: lightweight <code>/llms.txt</code> with summaries and comprehensive <code>/llms-full.txt</code>. Markdown serving reduces token consumption by over 90%.</li>
          <li><strong>Stripe's</strong> <code>llms.txt</code> includes an "instructions" section that guides AI to the right integration path.</li>
          <li><strong>Cloudflare</strong> organised theirs by service category for selective retrieval.</li>
        </ul>
        <p>Beyond <code>llms.txt</code>, individual pages can signal Markdown availability using <code>{"<link rel=\"alternate\" type=\"text/markdown\" href=\"/path/to/page.md\">"}</code> in the HTML head. This per-page approach complements <code>llms.txt</code> by letting AI agents discover the Markdown version of any specific page they land on, without needing to consult a central index first.</p>

        <h2>How Platforms Decide What to Cite</h2>
        <p>Citation behaviour varies significantly across platforms. Perplexity is retrieval-first and cites sources on nearly every response, with Reddit as its most-cited source at 6.6% of all citations [7]. ChatGPT cites when browsing is enabled, with Wikipedia leading at 7.8% [7]. Google AI Overviews distributes citations more evenly across sources.</p>
        <p>Several patterns emerge. Pages with clear headings, code examples, and step-by-step instructions get cited more than dense prose. Technical reference queries trigger citations more reliably than generic how-tos. Brands mentioned positively across 4+ non-affiliated platforms are 2.8× more likely to appear in ChatGPT responses [8].</p>

        <References items={[
          { n: 1, text: 'Jimeno-Yepes et al. "Financial Report Chunking for Effective RAG." arXiv:2402.05131, 2024.', href: "https://arxiv.org/abs/2402.05131" },
          { n: 2, text: 'Stäbler, Turnbull et al. "Chunking Strategies for Domain-Specific IR in RAG." IEEE, 2024.', href: "https://ieeexplore.ieee.org/document/11125724" },
          { n: 3, text: 'Qu et al. "Is Semantic Chunking Worth the Computational Cost?" NAACL 2025.', href: "https://arxiv.org/abs/2410.13070" },
          { n: 4, text: 'Howard, J. "llms.txt: A Proposal to Help LLMs Use Websites." Answer.AI, 2024.', href: "https://www.answer.ai/posts/2024-09-03-llmstxt.html" },
          { n: 5, text: 'Twilio. "Docs Support for llms.txt and Markdown." 2024.', href: "https://www.twilio.com/en-us/blog/developers/docs-llms-txt-markdown-support" },
          { n: 6, text: 'Fern. "Markdown for LLMs." 2025.', href: "https://buildwithfern.com/learn/docs/ai-features/llms-txt" },
          { n: 7, text: 'Yext. "How AI Engines Decide What to Cite." 2026.', href: "https://www.yext.com/blog/2026/03/how-chatgpt-perplexity-gemini-claude-decide-what-to-cite" },
          { n: 8, text: 'XFunnel. "What Sources Do AI Search Engines Cite?" 2026.', href: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose" },
        ]} />
      </Prose>
    </>,
  },
];

export function TlDr({ items }: { items: string[] }) {
  return <div className="not-prose mb-10 border-l-2 border-[var(--accent)] bg-[var(--surface)] px-5 py-5">
    <p className="text-[11px] font-medium tracking-[-.025em] text-[var(--accent)] mb-3">TL;DR</p>
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-[var(--ink-soft)]"><span className="mt-0.5 shrink-0 text-[11px] font-medium tracking-[-.025em] text-[var(--accent)]">·</span>{item}</li>)}
    </ul>
  </div>;
}

export function References({ items }: { items: { n: number; text: string; href: string }[] }) {
  return <div className="not-prose mt-12 border-t border-[var(--line)] pt-8">
    <p className="text-[11px] font-medium tracking-[-.025em] text-[var(--muted)] mb-4">References</p>
    <ol className="flex flex-col gap-2">
      {items.map(({ n, text, href }) => <li key={n} className="flex gap-3 text-[12px] leading-relaxed text-[var(--ink-soft)]">
        <span className="shrink-0 text-[11px] font-medium tracking-[-.025em] text-[var(--accent)]">[{n}]</span>
        <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)] underline underline-offset-2 decoration-[var(--line-strong)]">{text}</a>
      </li>)}
    </ol>
  </div>;
}

export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="prose-lensy">{children}</div>;
}

export function Education() {
  return <Page
    titleStyle={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}
    title={<>Education<br />on <span className="text-[var(--accent)]">AI-ready</span> docs.</>}
    intro="What we are learning about making docs readable for AI search."
  >
    <section className="mt-16 pb-20 sm:mt-20 sm:pb-28">
      <div className="flex items-end justify-between border-b border-[var(--line)] pb-4 text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">
        <span>Reading list</span>
        <span>{ARTICLES.length} articles</span>
      </div>
      <div>
        {ARTICLES.map((article, i) => (
          <article key={article.slug} data-reveal style={{ "--reveal-delay": `${i * 70}ms` } as React.CSSProperties} className="group border-b border-[var(--line)]">
            <Link to={`/education/${article.slug}`} className="soft-card grid gap-4 py-8 transition-colors hover:bg-[var(--surface-2)] rounded-[var(--radius-md)] sm:grid-cols-[42px_minmax(0,1fr)_auto] sm:gap-6 sm:-mx-5 sm:px-5">
              <p className="text-[11px] font-medium tracking-[-.025em] text-[var(--accent)]">0{i + 1}</p>
              <div>
                <p className="text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">{article.tag} <span className="mx-1.5 text-[var(--line-strong)]">/</span> {article.readTime}</p>
                <h2 className="mt-4 max-w-2xl text-[clamp(1.35rem,2.2vw,1.8rem)] leading-[1.08] tracking-[-.05em] transition-colors group-hover:text-[var(--accent)]">{article.title}</h2>
                <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--ink-soft)]">{article.description}</p>
              </div>
              <span className="link-sweep flex w-fit items-center gap-1.5 text-[12px] font-medium tracking-[-.025em] text-[var(--accent)] sm:self-end sm:pb-1 group-hover:text-[var(--ink)]">Read <ArrowRight className="arrow-nudge size-3" strokeWidth={1.8} aria-hidden="true" /></span>
            </Link>
          </article>
        ))}
      </div>
    </section>
  </Page>;
}

export function ArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const article = ARTICLES.find((a) => a.slug === slug);

  // Fire the GA4 `article_read_complete` event once the reader scrolls the CTA
  // into view. Ported from the pre-redesign frontend/src/pages/ArticlePage.tsx;
  // the redesign rewrite of this component had dropped the observer, the CTA,
  // and the analytics import, so the event never fired (PR 22 review).
  const ctaRef = useRef<HTMLDivElement>(null);
  const trackedRef = useRef(false);
  useEffect(() => {
    trackedRef.current = false;
    const el = ctaRef.current;
    if (!el || !slug) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !trackedRef.current) {
        trackedRef.current = true;
        trackEvent("article_read_complete", { article_slug: slug });
      }
    }, { threshold: 0.5 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [slug]);

  if (!article) return <NotFound />;

  const idx = ARTICLES.indexOf(article);
  const prev = ARTICLES[idx - 1];
  const next = ARTICLES[idx + 1];

  return <>
    <header className="border-b border-[var(--line)] px-5 pb-12 pt-14 sm:px-8 sm:pb-16 sm:pt-20">
      <div className="mx-auto max-w-[760px]">
        <Link to="/education" className="inline-flex items-center gap-2 text-[12px] font-medium tracking-[-.025em] text-[var(--muted)] transition-colors hover:text-[var(--accent)]">
          <ArrowLeft className="size-3" strokeWidth={1.8} aria-hidden="true" /> Education
        </Link>
        <div className="mt-10 flex items-center gap-3 text-[12px] font-medium tracking-[-.025em] text-[var(--accent)]">
          <span>{article.tag}</span>
          <span className="text-[var(--line-strong)]">/</span>
          <span>{article.readTime}</span>
        </div>
        <h1 className="mt-5 text-[clamp(2.35rem,5vw,4.6rem)] font-medium leading-[.95] tracking-[-.065em]">{article.title}</h1>
        <p className="mt-7 max-w-[650px] text-[16px] leading-relaxed text-[var(--ink-soft)]">{article.description}</p>
      </div>
    </header>

    <div className="mx-auto max-w-[760px] px-5 sm:px-8">
      <div data-reveal className="py-12 sm:py-16">
        {article.body}
      </div>

      {/* CTA — also the scroll target that fires `article_read_complete`. */}
      <div ref={ctaRef} data-reveal className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] px-6 py-10 text-center sm:px-10 sm:py-12">
        <p className="mx-auto max-w-[440px] text-[clamp(1.35rem,2.6vw,1.9rem)] font-medium leading-tight tracking-[-.04em]">Check your documentation's AI readiness.</p>
        <Link to="/" className="btn-ink mt-7 inline-flex items-center gap-2 bg-[var(--panel-bg)] px-5 py-3 text-[13px] font-medium tracking-[-.02em] text-[var(--panel-fg)]">
          Try Lensy Free <ArrowRight className="arrow-nudge size-4" strokeWidth={1.8} aria-hidden="true" />
        </Link>
      </div>

      {(prev || next) && (
        <nav data-reveal className="grid gap-px border-t border-[var(--line)] py-10 sm:grid-cols-2">
          {prev ? (
            <Link to={`/education/${prev.slug}`} className="group flex flex-col gap-2 py-6 pr-8 transition-colors hover:text-[var(--accent)]">
              <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]"><ArrowLeft className="size-3" strokeWidth={1.8} aria-hidden="true" />Previous</span>
              <span className="text-[16px] leading-snug tracking-[-.03em]">{prev.title}</span>
            </Link>
          ) : <div />}
          {next ? (
            <Link to={`/education/${next.slug}`} className="group flex flex-col gap-2 border-t border-[var(--line)] py-6 pl-0 text-right transition-colors hover:text-[var(--accent)] sm:border-l sm:border-t-0 sm:pl-8">
              <span className="flex items-center justify-end gap-1.5 text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">Next<ArrowRight className="size-3" strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="text-[16px] leading-snug tracking-[-.03em]">{next.title}</span>
            </Link>
          ) : <div className="sm:border-l border-[var(--line)]" />}
        </nav>
      )}
    </div>
  </>;
}

// ---- Contact ----

export function Field({ label, hint, error, noBorder, children }: { label: string; hint?: string; error?: string; noBorder?: boolean; children: React.ReactNode }) {
  return <label className={`field-shell block px-3 py-5 transition-colors focus-within:border-[var(--accent)] ${noBorder ? '' : 'border-b border-[var(--line)]'}`}>
    <span className="flex items-baseline justify-between text-[12px] font-medium tracking-[-.025em] text-[var(--muted)]"><span>{label}</span>{hint && <span className="text-[10px] text-[var(--placeholder)]">{hint}</span>}</span>
    {children}
    {error && <span role="alert" className="audit-notice mt-3 block rounded-[var(--radius-xs)] bg-[var(--tint)] px-2.5 py-2 text-[11px] font-medium leading-relaxed tracking-[-.02em] text-[var(--ink)]">{error}</span>}
  </label>;
}

export function Contact() {
  const [searchParams] = useSearchParams();
  const ref = searchParams.get("ref") || "default";
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const isFeedback = ref === "feedback";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if ((!isFeedback && !website.trim()) || (isFeedback && !message.trim()) || !name.trim() || !email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setFormError("validation");
      return;
    }
    setFormError("");
    setSending(true);
    try {
      const response = await fetch("https://www.perseveranceai.com/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_url: website.trim(), name: name.trim(), email: email.trim(), organization: organization.trim(), message: message.trim() || undefined, ref }),
      });
      if (!response.ok) throw new Error(`Contact request failed with ${response.status}`);
      setSent(true);
    } catch (error) {
      console.error("[Contact] Submission failed", error);
      setFormError("We could not submit your request. Please try again or email hello@perseveranceai.com.");
    } finally {
      setSending(false);
    }
  };
  const websiteError = formError && !website.trim() ? "Add your developer portal or website URL to continue." : "";
  const nameError = formError && !name.trim() ? "Add your name so we know who to contact." : "";
  const emailError = formError && (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) ? "Enter a valid email address to join the waitlist." : "";
  const messageError = formError && !message.trim() ? "Share your feedback to continue." : "";
  const networkError = formError && formError !== "validation" ? formError : "";
  const inputCls = "mt-3 block w-full bg-transparent font-sans text-xl tracking-[-.035em] text-[var(--ink)] outline-none placeholder:text-[var(--placeholder)]";

  return <Page
    titleStyle={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}
    title={<>Join the<br /><span className="text-[var(--accent)]">Waitlist.</span></>}
    intro="Join the waitlist to get higher limits and get access to upcoming products."
  >
    <div className="grid gap-12 py-20 lg:grid-cols-12 lg:gap-16">
      <aside data-reveal className="flex flex-col gap-10 lg:col-span-4">
        <div>
          <p className="text-[12px] font-medium tracking-[-.025em] text-[var(--muted)]">Or schedule a demo</p>
          <a href="https://calendly.com/getperseverance" target="_blank" rel="noopener noreferrer" className="link-sweep mt-3 inline-flex items-center gap-2 text-[19px] tracking-[-.03em] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors">
            Pick a time <ArrowRight className="arrow-nudge size-4" strokeWidth={1.8} aria-hidden="true" />
          </a>
        </div>
        <div>
          <p className="text-[12px] font-medium tracking-[-.025em] text-[var(--muted)]">Prefer email?</p>
          <a href="mailto:hello@perseveranceai.com" className="link-sweep mt-3 inline-block text-[17px] tracking-[-.03em] text-[var(--accent)]">hello@perseveranceai.com</a>
        </div>
      </aside>

      <div data-reveal style={{ "--reveal-delay": "120ms" } as React.CSSProperties} className="lg:col-span-7 lg:col-start-6">
        {sent ? (
          <div className="raised-shadow rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-8 [animation:scan-in_.45s_var(--ease)] sm:p-10">
            <span className="grid size-8 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)]"><Check className="size-4" strokeWidth={1.8} aria-hidden="true" /></span>
            <h2 className="mt-8 text-[28px] font-medium leading-tight tracking-[-.045em]">You&apos;re on the list.</h2>
            <p className="mt-3 max-w-md text-[14px] leading-relaxed text-[var(--ink-soft)]">We&apos;ll be in touch with early access details at the address you shared.</p>
            <button onClick={() => setSent(false)} className="mt-8 inline-flex items-center gap-2 border-b border-[var(--ink)] pb-1 text-[12px] font-medium tracking-[-.025em] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">Submit another</button>
          </div>
        ) : (
          <form noValidate onSubmit={submit}>
            <div>
              {networkError && <p className="audit-notice mb-4 rounded-[var(--radius-xs)] bg-[var(--tint)] px-3 py-2.5 text-[12px] font-medium text-[var(--ink)]">{networkError}</p>}
              {!isFeedback && <Field label="Developer Portal or Website URL" error={websiteError}><input value={website} onChange={(event) => { setWebsite(event.target.value); setFormError(""); }} aria-invalid={Boolean(websiteError)} className={inputCls} placeholder="docs.yourcompany.com" /></Field>}
              <div className="sm:grid sm:grid-cols-2 sm:gap-x-8">
                <Field label="Name" error={nameError}><input value={name} onChange={(event) => { setName(event.target.value); setFormError(""); }} aria-invalid={Boolean(nameError)} className={inputCls} placeholder="Ada Lovelace" /></Field>
                <Field label="Email" error={emailError}><input value={email} onChange={(event) => { setEmail(event.target.value); setFormError(""); }} aria-invalid={Boolean(emailError)} type="email" className={inputCls} placeholder="you@company.com" /></Field>
              </div>
              <Field label="Organization / Company" noBorder={!isFeedback}><input value={organization} onChange={(event) => { setOrganization(event.target.value); setFormError(""); }} className={inputCls} placeholder="Acme Corp" /></Field>
              {isFeedback && <Field label="Your feedback" error={messageError} noBorder><textarea value={message} onChange={(event) => { setMessage(event.target.value); setFormError(""); }} aria-invalid={Boolean(messageError)} className={`${inputCls} min-h-32 resize-y`} placeholder="What worked, what didn’t, or what should we build next?" /></Field>}
            </div>
            <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xs text-[11px] font-medium tracking-[-.025em] leading-relaxed text-[var(--muted)]">Your inbox is safe with us. We only use this to get in touch.</p>
              <button disabled={sending} className="btn-ink group inline-flex items-center gap-2 bg-[var(--panel-bg)] px-5 py-3 text-[12px] font-medium tracking-[-.025em] text-[var(--panel-fg)] disabled:cursor-wait disabled:opacity-70">{sending ? "Joining…" : <>Join waitlist <ArrowRight className="arrow-nudge size-3.5" strokeWidth={1.8} aria-hidden="true" /></>}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  </Page>;
}

// ---- Legal ----

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const isTerms = pathname === "/terms";
  return <>
    <header className="mx-auto grid max-w-[1240px] gap-8 border-b border-[var(--line)] px-5 pb-14 pt-16 sm:px-8 sm:pb-20 sm:pt-24 lg:grid-cols-12">
      <div className="lg:col-span-3"><Link to="/" className="inline-flex items-center gap-2 text-[12px] font-medium tracking-[-.025em] text-[var(--muted)] transition-colors hover:text-[var(--accent)]"><ArrowLeft className="size-3" strokeWidth={1.8} aria-hidden="true" />Back to Lensy</Link><p className="mt-7 text-[12px] font-medium tracking-[-.025em] text-[var(--accent)]">Legal documents</p></div>
      <div className="lg:col-span-6"><h1 className="text-[clamp(3.25rem,6.4vw,6.25rem)] font-medium leading-[.88] tracking-[-.075em]">{title}</h1><p className="mt-6 max-w-md text-[15px] leading-relaxed text-[var(--ink-soft)]">The terms that explain how Perseverance AI and Lensy are offered, and how information is handled.</p></div>
      <div className="self-end border-l border-[var(--line)] pl-4 text-[11px] font-medium tracking-[-.025em] leading-relaxed text-[var(--muted)] lg:col-span-3"><span className="block">Last updated</span><span className="mt-1 block text-[var(--ink-soft)]">{updated}</span></div>
    </header>
    <section className="mx-auto grid max-w-[1240px] gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-12 lg:gap-16">
      <aside className="lg:col-span-3 lg:sticky lg:top-28 lg:self-start">
        <p className="text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">In this section</p>
        <nav className="mt-4 flex border-y border-[var(--line)] py-1.5 lg:flex-col" aria-label="Legal documents">
          <Link to="/terms" aria-current={isTerms ? "page" : undefined} className={`rounded-[var(--radius-xs)] px-3 py-2.5 text-[13px] transition-colors ${isTerms ? "bg-[var(--surface-2)] text-[var(--ink)]" : "text-[var(--ink-soft)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"}`}>Terms of Use</Link>
          <Link to="/privacy" aria-current={!isTerms ? "page" : undefined} className={`rounded-[var(--radius-xs)] px-3 py-2.5 text-[13px] transition-colors ${!isTerms ? "bg-[var(--surface-2)] text-[var(--ink)]" : "text-[var(--ink-soft)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"}`}>Privacy Policy</Link>
        </nav>
        <p className="mt-7 max-w-[15rem] text-[12px] leading-relaxed text-[var(--muted)]">Questions about this document? <a href="mailto:hello@perseveranceai.com" className="text-[var(--ink-soft)] underline underline-offset-2 hover:text-[var(--accent)]">Get in touch</a>.</p>
      </aside>
      <article key={pathname} data-reveal className="surface-shadow rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-10 lg:col-span-7 lg:col-start-5">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-4 text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]"><span>Perseverance AI</span><span>{isTerms ? "Terms" : "Privacy"}</span></div>
        <div className="legal-prose prose-lensy pt-8">{children}</div>
      </article>
    </section>
  </>;
}

export function Terms() {
  return <LegalPage title="Terms of Use" updated="February 10, 2026">
    <p>These Terms of Use ("Terms") govern your access to and use of the Perseverance AI Console and all associated services, including Lensy ("Services"), operated by Perseverance AI ("Company", "we", "our", or "us"). By accessing or using the Services, you agree to be bound by these Terms.</p>

    <h2>1. Beta Program &amp; Access</h2>
    <p>The Services are in private beta. Access is granted on an invitation-only basis via access codes. Your access code is personal, non-transferable, and confidential. Keep your access code private. We can revoke access at any time.</p>

    <h2>2. Confidentiality</h2>
    <p>As a beta participant, you acknowledge that the Services, including their features, functionality, design, user interface, architecture, and all related documentation, constitute confidential and proprietary information of Perseverance AI. You agree to:</p>
    <ul>
      <li>Not disclose, publish, or share any information about the Services with any third party</li>
      <li>Not take screenshots, recordings, or other reproductions of the Services for distribution</li>
      <li>Not discuss the features, capabilities, or design of the Services publicly (including social media, forums, or blog posts)</li>
      <li>Provide feedback only through authorized channels (hello@perseveranceai.com)</li>
    </ul>

    <h2>3. Intellectual Property</h2>
    <p>All intellectual property rights in and to the Services — including but not limited to the software, algorithms, user interface design, visual design, branding, logos, documentation, and all underlying technology — are and shall remain the exclusive property of Perseverance AI. Nothing in these Terms grants you any right, title, or interest in our intellectual property beyond the limited right to use the Services during the beta period.</p>
    <p>Do not:</p>
    <ul>
      <li>Copy, reproduce, modify, or create derivative works based on the Services</li>
      <li>Reverse engineer, decompile, disassemble, or otherwise attempt to discover the source code or underlying technology</li>
      <li>Replicate, imitate, or create competing products or services based on the concepts, features, or design of the Services</li>
      <li>Remove, alter, or obscure any copyright, trademark, or proprietary notices</li>
      <li>Use any proprietary information to build a similar or competing service</li>
    </ul>

    <h2>4. Acceptable Use</h2>
    <p>You agree to use the Services only for their intended purpose — evaluating and improving documentation quality. You shall not:</p>
    <ul>
      <li>Use the Services for any unlawful purpose or in violation of any applicable law</li>
      <li>Attempt to gain unauthorized access to any systems or networks</li>
      <li>Interfere with or disrupt the integrity or performance of the Services</li>
      <li>Use the Services to process, store, or transmit malicious code</li>
      <li>Resell, sublicense, or commercially exploit the Services without prior written consent</li>
    </ul>

    <h2>5. Data &amp; Privacy</h2>
    <p>Our collection and use of information is described in our <Link to="/privacy" className="text-[var(--accent)] underline underline-offset-2">Privacy Policy</Link>. By using the Services, you consent to such collection and use.</p>

    <h2>6. Disclaimer of Warranties</h2>
    <p>We provide the Services "as is" and "as available" without any warranties, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not guarantee that the Services will be uninterrupted, error-free, or secure.</p>

    <h2>7. Limitation of Liability</h2>
    <p>To the maximum extent permitted by law, Perseverance AI shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or business opportunities arising out of or related to your use of the Services.</p>

    <h2>8. Termination</h2>
    <p>We may terminate or suspend your access to the Services immediately, without prior notice, for any reason, including without limitation if you breach these Terms. Upon termination, your right to use the Services will cease immediately. Sections 2 (Confidentiality), 3 (Intellectual Property), 6, 7, and 9 shall survive termination.</p>

    <h2>9. Governing Law</h2>
    <p>These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of law provisions. Any disputes arising under these Terms shall be subject to the exclusive jurisdiction of the courts located in Delaware.</p>

    <h2>10. Changes to Terms</h2>
    <p>We reserve the right to modify these Terms at any time. Changes will be effective immediately upon posting. Your continued use of the Services after any changes constitutes acceptance of the revised Terms.</p>

    <h2>Contact</h2>
    <p>Questions about these Terms? Contact us at <a href="mailto:hello@perseveranceai.com" className="text-[var(--accent)] underline underline-offset-2">hello@perseveranceai.com</a></p>
    <p className="text-[var(--muted)]">© 2026 Perseverance AI. All rights reserved. Confidential &amp; Proprietary.</p>
  </LegalPage>;
}

export function Privacy() {
  return <LegalPage title="Privacy Policy" updated="February 10, 2026">
    <p>Perseverance AI ("Company", "we", "our", or "us") is committed to protecting your privacy. This Privacy Policy describes how we collect, use, and safeguard information when you use the Perseverance AI Console and associated services ("Services").</p>

    <h2>1. Information We Collect</h2>
    <p>We only collect what we need to run the Services:</p>
    <ul>
      <li><strong>Authentication Data:</strong> An access code cookie stored in your browser to maintain your session. We do not collect usernames, email addresses, or passwords through the Services.</li>
      <li><strong>Usage Data:</strong> URLs of documentation pages you submit for analysis, analysis results, and generated fixes.</li>
      <li><strong>Technical Data:</strong> Standard web server logs including IP addresses, browser type, and access timestamps, collected automatically by our hosting infrastructure (AWS CloudFront).</li>
    </ul>

    <h2>2. Cookies</h2>
    <p>We use one cookie (<code>perseverance_console_token</code>) to keep you logged in. It expires after 48 hours. We don't track you or run ads.</p>

    <h2>3. How We Use Information</h2>
    <p>We use the information we collect to:</p>
    <ul>
      <li>Provide, operate, and maintain the Services</li>
      <li>Authenticate your access and maintain session security</li>
      <li>Process documentation analysis requests</li>
      <li>Improve and optimize the Services during the beta period</li>
      <li>Detect and prevent technical issues or abuse</li>
    </ul>

    <h2>4. Data Sharing</h2>
    <p>We do not sell, rent, or trade your information. We may share data only in these limited circumstances:</p>
    <ul>
      <li><strong>Service Providers:</strong> AWS (hosting, CDN, compute). Documentation URLs you submit are processed through AWS Bedrock AI models for analysis.</li>
      <li><strong>Legal Requirements:</strong> If required by law, regulation, legal process, or governmental request.</li>
      <li><strong>Business Transfer:</strong> In connection with a merger, acquisition, or sale of assets, with appropriate confidentiality protections.</li>
    </ul>

    <h2>5. Data Security</h2>
    <p>We use standard security measures like HTTPS encryption to protect your data. However, nothing on the internet is 100% secure.</p>

    <h2>6. Data Retention</h2>
    <p>Authentication cookies expire after 48 hours. Analysis session data is retained for 30 days to support re-scanning and report generation, then automatically deleted. Server logs are retained for up to 90 days for security and debugging purposes.</p>

    <h2>7. Your Rights</h2>
    <p>Depending on your jurisdiction, you may have rights regarding your personal data including the right to access, correct, or delete your data. To exercise these rights, contact us at <a href="mailto:hello@perseveranceai.com" className="text-[var(--accent)] underline underline-offset-2">hello@perseveranceai.com</a>.</p>

    <h2>8. Children&apos;s Privacy</h2>
    <p>The Services are not intended for use by individuals under the age of 18. We do not knowingly collect personal information from children.</p>

    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. Changes will be effective immediately upon posting. We encourage you to review this page periodically.</p>

    <h2>Contact</h2>
    <p>Questions about this Privacy Policy? Contact us at <a href="mailto:hello@perseveranceai.com" className="text-[var(--accent)] underline underline-offset-2">hello@perseveranceai.com</a></p>
    <p className="text-[var(--muted)]">© 2026 Perseverance AI. All rights reserved. Confidential &amp; Proprietary.</p>
  </LegalPage>;
}

// ---- Shared ----

export function Page({ title, intro, children, titleSize = "", titleStyle = { fontSize: "clamp(3rem, 7vw, 6.5rem)" } }: { title: React.ReactNode; intro: string; children: React.ReactNode; titleSize?: string; titleStyle?: React.CSSProperties }) {
  return <>
    <header className="mx-auto grid max-w-[1240px] gap-8 border-b border-[var(--line)] px-5 pb-16 pt-20 sm:px-8 lg:grid-cols-12 lg:pb-20">
      <h1 style={titleStyle} className={`hero-intro ${titleSize} font-medium leading-[.88] tracking-[-.075em] lg:col-span-8`}>{title}</h1>
      <p className="self-end text-[15px] leading-relaxed text-[var(--ink-soft)] lg:col-span-4">{intro}</p>
    </header>
    <div className="mx-auto max-w-[1240px] px-5 sm:px-8">{children}</div>
  </>;
}

export function NotFound() {
  return <Page title={<>Nothing<br /><span className="text-[var(--accent)]">here.</span></>} intro="This page does not exist.">
    <Link className="btn-ink my-16 inline-block bg-[var(--panel-bg)] px-4 py-3 text-[12px] font-medium tracking-[-.025em] text-[var(--panel-fg)]" to="/">Back to Lensy</Link>
  </Page>;
}

export const router = createBrowserRouter([{
  path: "/",
  Component: Shell,
  children: [
    { index: true, Component: Home },
    { path: "scan", Component: ScanReport },
    { path: "how-it-works", Component: HowItWorks },
    { path: "education", Component: Education },
    { path: "education/:slug", Component: ArticlePage },
    { path: "contact", Component: Contact },
    { path: "terms", Component: Terms },
    { path: "privacy", Component: Privacy },
    { path: "*", Component: NotFound },
  ],
}]);
