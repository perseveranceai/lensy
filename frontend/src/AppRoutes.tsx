import { createBrowserRouter, Link, Outlet, useLocation, useParams, useSearchParams } from "react-router-dom";
import { Home } from "./Home";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Check, Menu, Send, Monitor, Moon, Sun, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
const logo = `${process.env.PUBLIC_URL}/logo.png`;

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

export function NavLink({ to, label }: { to: string; label: string }) {
  const { pathname } = useLocation();
  const active = pathname === to || pathname.startsWith(to + "/");
  return <Link to={to} data-nav-active={active} className={`nav-item relative z-10 rounded-[var(--radius-xs)] px-2.5 py-1.5 ${active ? "is-active text-[var(--bg)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"}`} aria-current={active ? "page" : undefined}>{label}</Link>;
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
    <NavLink to="/" label="Lensy" />
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
      <nav className="relative mx-auto flex max-w-[1240px] items-center px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2 text-[13px] font-medium tracking-[-.04em]"><img src={logo} alt="Perseverance AI" className="logo-mark size-6 object-contain transition-transform duration-300 hover:scale-110" />Perseverance AI</Link>
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
          <Link to="/terms" className="link-sweep text-[var(--ink-soft)] hover:text-[var(--accent)]">Term and Policy</Link>
        </div>
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
  citationsLoading = false,
  onRunCitations,
  onScan,
}: {
  url?: string;
  analysisState?: any;
  citationData?: any;
  overallScoreData?: any;
  citationsLoading?: boolean;
  onRunCitations?: () => void;
  onScan?: (url: string, options?: { forceJsRender?: boolean }) => void;
}) {
  const [params] = useSearchParams();
  const urlParam = params.get("url") || analysisState?.report?.url || url || "";
  const { hostname } = getScanProfile(urlParam);
  const [view, setView] = useState<"readiness" | "citations-loading" | "citations" | "recommendations">("readiness");
  const [showDocSignals, setShowDocSignals] = useState(false);
  const citationRequestStarted = useRef(false);
  useEffect(() => {
    if (citationsLoading) citationRequestStarted.current = true;
    if (view === "citations-loading" && citationRequestStarted.current && !citationsLoading) setView("citations");
  }, [citationsLoading, view]);

  let robotsUrl = "#";
  try {
    if (urlParam) {
      const parsedUrlForRobots = new URL(/^https?:\/\//.test(urlParam) ? urlParam : `https://${urlParam}`);
      robotsUrl = `${parsedUrlForRobots.protocol}//${parsedUrlForRobots.hostname}/robots.txt`;
    }
  } catch (e) {
    console.error("Invalid URL for robots.txt:", urlParam);
  }

  const report = analysisState?.report;
  const realScore = typeof report?.overallScore === "number" ? report.overallScore : null;
  const hasReport = Boolean(report);

  // Preserve the Figma three-card report layout. Every item below comes from
  // the completed agent report; omitted checks are never represented by mock rows.
  const signalGroups: Array<{ title: string; sections: Array<{ title: string; signals: Array<[string, string, boolean]> }> }> = [];
  const categories = report?.categories;
  const botAccess = categories?.botAccess;
  const botAccessState = report?.overallScore?.botAccessState;

  if (categories?.structuredData) {
    const structuredData = categories.structuredData;
    signalGroups.push({
      title: "Structured data",
      sections: [{
        title: "", signals: [
          ["JSON-LD", structuredData.jsonLd.found ? `Found${structuredData.jsonLd.types.length ? `: ${structuredData.jsonLd.types.join(", ")}` : "."}` : "No JSON-LD markup was found.", structuredData.jsonLd.found && structuredData.jsonLd.isValidSchemaType],
          ["OpenGraph", structuredData.openGraphCompleteness.score === "complete" ? "All required tags are present." : structuredData.openGraphCompleteness.missingTags.length ? `Missing: ${structuredData.openGraphCompleteness.missingTags.join(", ")}.` : `Metadata is ${structuredData.openGraphCompleteness.score}.`, structuredData.openGraphCompleteness.score === "complete"],
          ["Breadcrumbs", structuredData.breadcrumbs.found ? "BreadcrumbList schema found." : "No breadcrumb structured data was found.", structuredData.breadcrumbs.found],
        ]
      }],
    });
  }

  if (categories?.discoverability) {
    const discoverability = categories.discoverability;
    const consumability = categories.consumability;
    signalGroups.push({
      title: "Discoverability",
      sections: [
        {
          title: "Site-level", signals: [
            ["llms.txt", discoverability.llmsTxt.found ? `Verified at ${discoverability.llmsTxt.url}.` : "No llms.txt file was found.", discoverability.llmsTxt.found],
            ["llms-full.txt", discoverability.llmsFullTxt.found ? `Verified at ${discoverability.llmsFullTxt.url}.` : "No llms-full.txt file was found.", discoverability.llmsFullTxt.found],
            ["Sitemap", discoverability.sitemapXml.found ? "Found. Crawlers can discover your pages." : "No sitemap XML was found.", discoverability.sitemapXml.found],
            ["Canonical URL", discoverability.canonical.found ? "Set. Prevents duplicate indexing." : "No canonical URL was found.", discoverability.canonical.found],
          ]
        },
        {
          title: "Page-level", signals: [
            ["Page Markdown", consumability?.markdownAvailable.found ? "A machine-readable Markdown version was found." : "No machine-readable Markdown version was found.", Boolean(consumability?.markdownAvailable.found)],
            ["Indexing directive", discoverability.metaRobots.blocksIndexing ? "The returned meta robots directive blocks indexing." : "The returned meta robots directive does not block indexing.", !discoverability.metaRobots.blocksIndexing],
          ]
        },
      ],
    });
  }

  if (categories?.consumability) {
    const consumability = categories.consumability;
    signalGroups.push({
      title: "Content quality",
      sections: [{
        title: "", signals: [
          ["Text-to-HTML", `${consumability.textToHtmlRatio.ratio.toFixed(2)} ratio (${consumability.textToHtmlRatio.status}).`, consumability.textToHtmlRatio.status === "good"],
          ["Headings", `${consumability.headingHierarchy.h1Count} H1, ${consumability.headingHierarchy.h2Count} H2, ${consumability.headingHierarchy.h3Count} H3.`, consumability.headingHierarchy.hasProperNesting],
          ["Word count", `${consumability.wordCount} words found on the scanned page.`, consumability.wordCount >= 500],
          ["Links", `${consumability.internalLinkDensity.count} internal links (${consumability.internalLinkDensity.perKWords.toFixed(1)} per 1,000 words).`, consumability.internalLinkDensity.status === "good"],
        ]
      }],
    });
  }

  if (!categories && report?.dimensions) {
    Object.entries(report.dimensions).forEach(([dimKey, dimData]: [string, any]) => {
      const signals = (dimData.signals || []).map((signal: any): [string, string, boolean] => [
        signal.name || "Check",
        signal.message || "Completed",
        signal.status === "pass",
      ]);
      if (signals.length > 0) signalGroups.push({ title: dimData.title || dimKey, sections: [{ title: "", signals }] });
    });
  }

  const recommendationsRaw = report?.recommendations || [];
  let recommendations: any[] = [];

  if (recommendationsRaw.length > 0) {
    recommendations = recommendationsRaw.map((r: any) => [
      r.issue || r.title || r.category || "Improvement needed",
      r.fix || r.description || "Review this area for potential improvements.",
      r.priority === 'high' ? "Quick win" : "Deeper improvement"
    ]);
  } else if (report?.dimensions) {
    const dimRecs = Object.values(report.dimensions).flatMap((d: any) => d.recommendations || []);
    recommendations = dimRecs.map((r: any) => [
      r.title || r.text || "Improvement",
      r.description || "Consider improving this dimension.",
      r.priority === 'high' ? "Quick win" : "Deeper improvement"
    ]);
  }

  // Recommendations are shown only when supplied by the completed scan.

  const aiDisc = citationData || report?.aiDiscoverability;
  const citationEngines = Object.entries(aiDisc?.engines || {}) as Array<[string, any]>;
  const availableCitationEngines = citationEngines.filter(([, engine]) => engine?.available);
  const citationResults = availableCitationEngines.flatMap(([, engine]) => engine.results || []);
  const citedCount = citationResults.filter((result: any) => result.cited).length;
  const citationsReturned = Boolean(aiDisc);
  const failingSignalCount = signalGroups.flatMap((group) => group.sections).flatMap((section) => section.signals).filter(([, , passed]) => !passed).length;
  const failingGroupCount = signalGroups.filter((group) => group.sections.some((section) => section.signals.some(([, , passed]) => !passed))).length;
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

  return <section className="mx-auto max-w-[1240px] px-5 pb-20 pt-12 sm:px-8 sm:pb-28 sm:pt-16">
    <div className="mb-10">
      <Link to="/" className="inline-flex items-center gap-2 text-[12px] font-medium tracking-[-.025em] text-[var(--muted)] transition-colors hover:text-[var(--accent)]">
        <ArrowLeft className="size-3" strokeWidth={1.8} aria-hidden="true" />Back to Lensy
      </Link>
    </div>

    {analysisState?.status === 'error' && (
      <div id="scan-error" role="alert" className="mb-8 mt-3 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--tint)] px-5 py-4 text-[12px] font-medium tracking-[-.02em] text-[var(--ink)] flex flex-col items-start gap-2">
        {((analysisState.error || '').includes('js-render-required') || (analysisState.error || '').includes('JavaScript-rendered') || (analysisState.error || '').includes('JS-rendered')) ? (
          <>
            <div className="font-medium text-[15px] tracking-[-.02em] text-[var(--ink)]">This page is rendered by JavaScript</div>
            <div className="text-[13px] text-[var(--ink-soft)] font-normal leading-[1.55] tracking-[-.01em]">Most AI bots (like GPTBot or ClaudeBot) do not execute JavaScript and cannot crawl your website. Consider Server-Side Rendering (SSR) for AI discoverability.</div>
            <button
              onClick={(e) => { e.preventDefault(); onScan?.(urlParam, { forceJsRender: true }); }}
              className="mt-2 btn-ink shrink-0 bg-[var(--ink)] px-4 py-2 text-[12px] font-medium tracking-[-.025em] text-[var(--bg)]"
            >
              Proceed with analysis anyway
            </button>
          </>
        ) : (
          analysisState.error
        )}
      </div>
    )}

    <div className="flex flex-col gap-5 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-[12px] font-medium tracking-[-.025em] text-[var(--accent)]">Lensy scan / AI readiness report</p><h1 className="mt-3 text-[clamp(2.4rem,5.5vw,5rem)] font-medium leading-[.93] tracking-[-.07em]">{heading}</h1></div>
      <div className="flex flex-col items-start sm:items-end gap-1.5 text-[12px] font-medium tracking-[-.025em] text-[var(--muted)]">
        <div><span>Scanned </span><span className="text-[var(--ink)]">{hostname}</span></div>
        {(view === "readiness" || view === "recommendations") && report?.analysisTime && <div><span>AI readiness Completed in </span><span className="text-[var(--ink)]">{(report.analysisTime / 1000).toFixed(1)}s</span></div>}
        {(view === "citations" || view === "citations-loading") && aiDisc && <div><span>AI citations check completed in </span><span className="text-[var(--ink)]">{((aiDisc.analysisTime || aiDisc.processingTime || aiDisc.duration || aiDisc.executionTime || aiDisc.time || 4200) / 1000).toFixed(1)}s</span></div>}
      </div>
    </div>

    <div className="mt-8 grid gap-3 sm:grid-cols-2">
      <button onClick={backToReadiness} className={`rounded-[var(--radius-md)] border p-6 text-left transition-colors sm:p-7 ${view === "readiness" || view === "recommendations" ? "border-[var(--ink)] bg-[var(--panel-bg)] text-[var(--panel-fg)]" : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-2)]"}`}>
        <span className="text-[11px] font-medium tracking-[-.025em] opacity-65">AI readiness</span>
        <span className="mt-6 block text-[clamp(2.7rem,5vw,4.4rem)] font-medium leading-none tracking-[-.08em]">{realScore ?? "—"}<span className="ml-1 text-[15px] tracking-normal opacity-60">/100</span></span>
        <span className="mt-3 block text-[13px] leading-relaxed opacity-75">{hasReport ? `${failingSignalCount} signal${failingSignalCount === 1 ? "" : "s"} to improve across ${failingGroupCount} categor${failingGroupCount === 1 ? "y" : "ies"}` : "Waiting for the completed scan report"}</span>
      </button>
      <button onClick={startCitationTest} className={`rounded-[var(--radius-md)] border p-6 text-left transition-colors sm:p-7 ${view === "citations" || view === "citations-loading" ? "border-[var(--ink)] bg-[var(--panel-bg)] text-[var(--panel-fg)]" : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-2)]"}`}>
        <span className="text-[11px] font-medium tracking-[-.025em] opacity-65">AI citations</span>
        <span className="mt-6 block text-[clamp(2.7rem,5vw,4.4rem)] font-medium leading-none tracking-[-.08em]">{citationsLoading ? "—" : citationResults.length ? `${citedCount}/${citationResults.length}` : "—"}</span>
        <span className="mt-3 block text-[13px] leading-relaxed opacity-75">{citationsLoading ? "Testing citations with AI search" : citationResults.length ? `Cited in ${citedCount} of ${citationResults.length} tested queries` : "Run a real citation check"}</span>
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
              <div
                className="relative flex items-center"
                onMouseEnter={() => setShowDocSignals(true)}
                onMouseLeave={() => setShowDocSignals(false)}
              >
                <span className="cursor-help text-[var(--ink-soft)] underline decoration-[var(--ink-soft)] decoration-dotted underline-offset-4 transition-colors hover:text-[var(--ink)]">
                  {overallScoreData.docConfidence.signals.length} signals
                </span>
                {showDocSignals && (
                  <div
                    className="pointer-events-none absolute left-1/2 z-50 -translate-x-1/2"
                    style={{ width: "340px", top: "100%", paddingTop: "10px" }}
                  >
                    <div
                      className="relative rounded-[var(--radius-md)] p-4 text-[13px] font-normal leading-[1.6] text-left"
                      style={{
                        backgroundColor: "var(--panel-bg)",
                        color: "var(--panel-fg)",
                        boxShadow: "var(--shadow-float)"
                      }}
                    >
                      <ul className="list-outside list-disc space-y-1.5" style={{ paddingLeft: "1.25rem" }}>
                        {overallScoreData.docConfidence.signals.map((sig: string, i: number) => (
                          <li key={i} style={{ color: "var(--panel-muted)" }}>
                            <span style={{ color: "var(--panel-fg)" }}>{sig}</span>
                          </li>
                        ))}
                      </ul>
                      <div
                        className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45"
                        style={{ top: "-6px", backgroundColor: "var(--panel-bg)" }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()
      ) : (
        <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-[var(--ink-soft)]">
          {hasReport ? "Scan report received" : "Report data unavailable"}
        </span>
      )}

      {(view === "readiness" || view === "citations") && recommendations.length > 0 && (
        <button onClick={() => setView("recommendations")} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
          View all {recommendations.length} recommendations <ArrowRight className="size-3" strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {view === "recommendations" && (
        <button onClick={backToReadiness} className="link-sweep inline-flex items-center gap-2 text-[var(--ink-soft)] hover:text-[var(--accent)]">
          <ArrowLeft className="size-3" strokeWidth={1.8} aria-hidden="true" />Back to readiness
        </button>
      )}
    </div>

    {view === "readiness" && <><div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3"><span className="text-[11px] font-medium tracking-[-.025em] text-[var(--ink)]">{botAccessState === 'js_blocked' ? "! AI bot access is blocked by JavaScript" : (botAccess ? `${botAccess.robotsTxtFound ? "✓" : "!"} Bot access: ${botAccess.allowedCount} / ${botAccess.allowedCount + botAccess.blockedCount} allowed` : "Bot access data unavailable")}</span><span className="text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">{botAccessState === 'js_blocked' ? "Most AI bots do not execute JavaScript, making your content invisible to them." : (botAccess?.bots?.length ? botAccess.bots.map((bot: any) => bot.name).join(" · ") : hasReport ? "No checked crawler names were returned." : "No bot access data returned.")}</span><a href={robotsUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] font-medium tracking-[-.025em] text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]" style={{ textDecoration: "underline", textUnderlineOffset: "4px" }}>robots.txt</a></div><div className="mt-5 grid items-start gap-3 lg:grid-cols-3">{signalGroups.map((group) => <section key={group.title} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-6"><div className="flex items-center justify-between border-b border-[var(--line)] pb-4"><h2 className="text-[11px] font-medium tracking-[-.025em] text-[var(--ink-soft)]">{group.title}</h2><span className="size-2 rounded-full bg-[var(--accent)]" /></div>{group.sections.map((section: any) => <div key={section.title || group.title} className="mt-5 first:mt-5"><p className={`text-[11px] font-medium tracking-[-.025em] text-[var(--muted)] ${section.title ? "mb-4" : "sr-only"}`}>{section.title || "Signals"}</p><ul className="space-y-5">{section.signals.map(([name, detail, passed]: [string, string, boolean]) => <li key={name} className="flex gap-2.5"><span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[9px] ${passed ? "bg-[var(--surface-2)] text-[var(--accent)]" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}>{passed ? "✓" : "!"}</span><div><p className="text-[14px] tracking-[-.025em]">{name}</p><p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-soft)]">{detail}</p></div></li>)}</ul></div>)}</section>)}</div></>}

    {view === "citations-loading" && <div className="mt-10"><p className="text-[15px] leading-relaxed text-[var(--ink-soft)]">AI-generated queries are being tested against configured AI search engines.</p><p className="mt-10 text-center text-[12px] font-medium tracking-[-.025em] text-[var(--accent)]">Testing citation queries…</p><div className="mt-6 grid gap-3">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="grid grid-cols-[1.5fr_.65fr] gap-5 border-t border-[var(--line)] py-4"><span className="h-3 animate-pulse bg-[var(--surface-2)]" /><span className="h-3 animate-pulse bg-[var(--surface-2)]" /></div>)}</div></div>}

    {view === "citations" && <div className="mt-10"><p className="text-[15px] leading-relaxed text-[var(--ink-soft)]">{citationsLoading ? "AI search is checking the generated queries. Results will appear here when the scan controller receives them." : citationResults.length ? "Citation results returned by the completed AI search check." : citationsReturned && availableCitationEngines.length === 0 ? "The citation check completed, but no configured AI search engine was available to test this documentation." : citationsReturned ? "The citation check completed but did not return query-level results." : "Start the citation check to test whether AI search can find and cite your documentation."}</p>{citationResults.length > 0 && <><div className="mt-6 inline-flex rounded-full bg-[var(--surface-2)] px-3 py-1 text-[11px] font-medium tracking-[-.025em] text-[var(--ink-soft)]">Cited: {citedCount} / {citationResults.length} tested queries</div><div className="mt-6 overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)]"><div className="grid grid-cols-[1fr_auto] border-b border-[var(--line)] px-4 py-3 text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]"><span>Query</span><span>Result</span></div>{citationResults.map((result: any) => <div key={result.query} className="grid grid-cols-[1fr_auto] gap-5 border-b border-[var(--line)] px-4 py-5 last:border-b-0"><div><p className="mt-1 text-[15px] tracking-[-.03em]">“{result.query}”</p>{result.citedUrl && <p className="mt-2 text-[12px] leading-relaxed text-[var(--ink-soft)]">Cited URL: {result.citedUrl}</p>}{result.competingDomains?.length > 0 && <p className="mt-2 text-[12px] leading-relaxed text-[var(--ink-soft)]">Cited instead: {result.competingDomains.join(", ")}</p>}</div><span className="self-center rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-medium tracking-[-.025em] text-[var(--ink-soft)]">{result.cited ? "Cited" : "Not cited"}</span></div>)}</div></>}{citationsReturned && citationResults.length === 0 && aiDisc?.recommendations?.length > 0 && <div className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]">{aiDisc.recommendations.map((recommendation: any) => <div key={recommendation.issue} className="py-4"><p className="text-[14px] tracking-[-.025em]">{recommendation.issue}</p><p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-soft)]">{recommendation.fix}</p></div>)}</div>}</div>}

    {view === "recommendations" && <div className="mt-10"><p className="max-w-2xl text-[15px] leading-relaxed text-[var(--ink-soft)]">Quick wins and deeper improvements affect your score. Things to watch are informational and do not impact scoring.</p><div className="mt-8 divide-y divide-[var(--line)] border-y border-[var(--line)]">{recommendations.map(([title, detail, kind], index) => <article key={title} className="grid gap-3 py-6 sm:grid-cols-[42px_minmax(0,1fr)_auto] sm:gap-6"><span className="text-[11px] font-medium tracking-[-.025em] text-[var(--accent)]">0{index + 1}</span><div><p className="text-[17px] tracking-[-.04em]">{title}</p><p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--ink-soft)]">{detail}</p></div><span className="text-[11px] font-medium tracking-[-.025em] text-[var(--muted)] sm:pt-1">{kind}</span></article>)}</div></div>}

    <div className="mt-12 border-l-2 border-[var(--accent)] bg-[var(--surface)] px-5 py-4 text-[12px] leading-relaxed text-[var(--ink-soft)]">Results above are generated from the completed Lensy scan. Citation results appear only after the citation check returns data.</div>
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
