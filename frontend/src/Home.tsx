import { FormEvent, useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  ArrowRight,
  Eye,
  Link2,
  Plus,
  ScanSearch,
  ChevronDown,
  ChevronRight
} from "lucide-react"
import { useAuditAllowance } from "./AppRoutes"
import { trackEvent } from "./analytics"

type IconName = "arrow" | "plus" | "link" | "eye" | "chevronDown" | "chevronRight"
function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const icons = {
    arrow: ArrowRight,
    plus: Plus,
    link: Link2,
    eye: Eye,
    chevronDown: ChevronDown,
    chevronRight: ChevronRight,
  }
  const Symbol = icons[name]
  return (
    <Symbol
      className={`size-4 ${className}`}
      strokeWidth={1.65}
      aria-hidden="true"
    />
  )
}

export function Home({ onScan, analysisState }: { onScan?: (urlOrOptions: any, options?: any) => void, analysisState?: any }) {
  const [playHeroIntro] = useState(true)
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [progressStep, setProgressStep] = useState(0)
  const [showAllowanceNotice, setShowAllowanceNotice] = useState(false)
  const [scanError, setScanError] = useState("")
  const [open, setOpen] = useState<number | null>(null)
  const [progressOpen, setProgressOpen] = useState(false)
  const navigate = useNavigate()
  const { remaining } = useAuditAllowance()
  const scanSteps = [
    ["Loading the page", "Checking if the URL works."],
    ["Checking bot access", "Reading your robots.txt file."],
    ["Scanning the page", "Finding headers, links, and structured data."],
    ["Writing the report", "Building your score and next steps."],
  ]

  useEffect(() => {
    if (analysisState?.status === 'analyzing') {
      setLoading(true);
      // Let the natural fake timers run, or we can map progress to actual analysisState progressMessages.
      // For now we rely on the same smooth transition but wait for completion.
    } else if (analysisState?.status === 'completed' && loading) {
      navigate('/results');
    } else if (analysisState?.status === 'error' || analysisState?.status === 'rate-limited') {
      setLoading(false);
      setScanError(analysisState.error || (analysisState.status === 'rate-limited' ? "You’ve used today’s free audits. Please try again tomorrow." : "Scan failed."));
      setShowAllowanceNotice(analysisState.status === 'rate-limited');
    }
    // NOTE: `url` is intentionally NOT a dependency. It's not read here, and
    // including it made every keystroke re-run this effect — which re-set
    // scanError right after onChange cleared it, so the error card flickered
    // back on each character while typing a new URL after a failed scan.
  }, [analysisState, loading, navigate]);

  // N-05: track the JS-render consent funnel on the Home prompt too (it was only
  // instrumented on the /results page). Fire js_render_prompt_shown once per
  // distinct prompt; the "Proceed" button fires js_render_consent_given.
  const jsRenderPromptTracked = useRef<string>("");
  useEffect(() => {
    const isJsRenderPrompt = ["js-render-required", "JavaScript-rendered", "JS-rendered"].some((t) => scanError.includes(t));
    if (isJsRenderPrompt && jsRenderPromptTracked.current !== url) {
      jsRenderPromptTracked.current = url;
      trackEvent("js_render_prompt_shown", { url: url.trim() });
    }
    if (!isJsRenderPrompt) jsRenderPromptTracked.current = "";
  }, [scanError, url]);

  useEffect(() => {
    const rememberIntro = window.setTimeout(() => {
      window.sessionStorage.setItem("lensy-home-intro-seen", "true")
    }, 0)
    return () => window.clearTimeout(rememberIntro)
  }, [])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    if (!url.trim()) {
      setScanError("Paste a documentation URL to start the scan.")
      return
    }
    setScanError("")
    if (remaining === 0) {
      setShowAllowanceNotice(true)
      return
    }
    setShowAllowanceNotice(false)
    setLoading(true)
    setProgressStep(0)
    window.setTimeout(() => setProgressStep(1), 340)
    window.setTimeout(() => setProgressStep(2), 700)
    window.setTimeout(() => setProgressStep(3), 1040)

    // Call real backend. We don't navigate immediately, we let the useEffect handle navigation when 'completed'.
    if (onScan) onScan(url.trim());
  }

  return (
    <>
      <section
        id="top"
        className="mx-auto grid max-w-[1240px] px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-12 lg:gap-8"
      >
        <div className="lg:col-span-8">
          <h1 className={`max-w-[760px] text-[clamp(3.25rem,7.8vw,7.45rem)] font-medium leading-[.88] tracking-[-.075em] ${playHeroIntro ? "hero-intro" : ""}`}>
            Your docs
            <br />
            <span className="text-[var(--accent)]">belong</span> in the
            <br />
            answer.
          </h1>
        </div>
        <div className="mt-10 flex flex-col justify-end lg:col-span-4 lg:mt-0">
          <p className="max-w-sm text-[15px] leading-[1.55] tracking-[-.02em] text-[var(--ink-soft)]">
            Lensy evaluates whether the documentation you already publish can be surfaced, understood, and cited by AI search.
          </p>
          <a
            href="#scan"
            className="btn-ink group mt-7 flex w-fit items-center gap-3 bg-[var(--panel-bg)] px-4 py-3 text-[12px] font-medium tracking-[-.025em] text-[var(--panel-fg)]"
          >
            Run a free check{" "}
            <Icon name="arrow" className="arrow-nudge size-3" />
          </a>
        </div>
      </section>

      <section
        id="scan"
        className="mx-auto max-w-[1240px] scroll-mt-28 px-5 py-8 sm:px-8 sm:py-12"
      >
        <div className="surface-shadow grid overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] lg:grid-cols-[.72fr_1.28fr]">
          <div className="border-b border-[var(--line)] bg-[var(--panel-bg)] p-6 text-[var(--panel-fg)] lg:border-b-0 lg:border-r lg:p-8">
            <div className="flex items-center gap-2 text-[12px] font-medium tracking-[-.025em] text-[var(--panel-muted-2)]">
              <Icon name="eye" className="size-3" /> Lensy scan
            </div>
            <p className="mt-12 max-w-[220px] text-[25px] font-medium leading-[1.05] tracking-[-.045em]">
              See what bots see.
            </p>
            <p className="mt-5 max-w-[230px] text-[12px] leading-relaxed text-[var(--panel-muted)]">
              Just paste a URL. We check the raw signals bots use to read and cite your content.
            </p>
          </div>
          <div className="p-6 sm:p-8">
            <div className="flex items-center justify-between text-[11px] font-medium tracking-[-.025em] text-[var(--muted)]">
              <span>Paste a documentation URL</span>
              <span>
                {remaining === null
                  ? "Checking audit allowance…"
                  : remaining === 0
                    ? "Free audits refresh tomorrow"
                    : `${remaining} free audits left`}
              </span>
            </div>
            <form noValidate onSubmit={submit} className="mt-10">
              <label className="field-shell flex items-center gap-3 border-b border-[var(--ink)] px-3 pb-3 pt-2">
                <Icon name="link" className="shrink-0 text-[var(--accent)]" />
                <input
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    setShowAllowanceNotice(false)
                    setScanError("")
                  }}
                  aria-label="Documentation URL"
                  aria-invalid={Boolean(scanError)}
                  aria-describedby={scanError ? "scan-error" : undefined}
                  placeholder="docs.yourcompany.com"
                  className="min-w-0 flex-1 bg-transparent text-[clamp(1.25rem,3vw,2rem)] tracking-[-.05em] outline-none placeholder:text-[var(--placeholder)]"
                />
              </label>
              {scanError && (
                <div id="scan-error" role="alert" className="audit-notice mt-3 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--tint)] px-3.5 py-3 text-[12px] font-medium tracking-[-.02em] text-[var(--ink)] flex flex-col items-start gap-2">
                  {(scanError.includes('js-render-required') || scanError.includes('JavaScript-rendered') || scanError.includes('JS-rendered')) ? (
                    <>
                      <div className="font-medium text-[13px] tracking-[-.02em] text-[var(--ink)]">This page is rendered by JavaScript</div>
                      <div className="text-[12px] text-[var(--ink-soft)] font-normal leading-[1.55] tracking-[-.01em]">Most AI bots (like GPTBot or ClaudeBot) do not execute JavaScript and cannot crawl your website. Consider Server-Side Rendering (SSR) for AI discoverability.</div>
                      <button
                        onClick={(e) => { e.preventDefault(); trackEvent("try_another_url_clicked", { action: "js-render", error: "This page is rendered by JavaScript" }); trackEvent("js_render_consent_given", { url: url.trim() }); onScan && onScan(url.trim(), { forceJsRender: true }); setLoading(true); setScanError(""); }}
                        className="mt-1 btn-ink shrink-0 bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium tracking-[-.025em] text-[var(--bg)]"
                      >
                        Proceed with analysis anyway
                      </button>
                    </>
                  ) : (
                    (() => {
                      // T-12: give Home the same friendly error card the /results
                      // page has (scans actually start and fail HERE). Map the
                      // raw backend error to a human title + description, then
                      // offer Try again / Try another URL / Report an issue.
                      const raw = (scanError || "").trim();
                      let title = "Something went wrong";
                      let description = raw || "The scan couldn't be completed. Please try again.";
                      if (/\b400\b/.test(raw) || /not a valid url/i.test(raw)) {
                        title = "That doesn't look like a valid URL";
                        description = "Please enter a valid documentation URL and try again.";
                      } else if (/\b404\b/.test(raw) || /unable to access|could not (?:be )?reach|unreachable|ENOTFOUND|ECONNREFUSED/i.test(raw)) {
                        title = "We couldn't reach that page";
                        description = "Double-check the URL is correct and publicly reachable, then try again.";
                      } else if (/\b429\b/.test(raw) || /rate.?limit/i.test(raw)) {
                        title = "Too many requests";
                        description = "The site is rate-limiting our scanner. Wait a moment and try again.";
                      } else if (/does not appear to be|not (?:a )?(?:technical )?doc|non-doc/i.test(raw)) {
                        title = "This doesn't look like a documentation page";
                        description = raw || "Try a URL that points at documentation content.";
                      }
                      return (
                        <>
                          <div className="font-medium text-[13px] tracking-[-.02em] text-[var(--ink)]">{title}</div>
                          <div className="text-[12px] text-[var(--ink-soft)] font-normal leading-[1.55] tracking-[-.01em]">{description}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <button
                              onClick={(e) => { e.preventDefault(); trackEvent("try_again_clicked", { url: url.trim(), error: raw }); setScanError(""); setLoading(true); onScan && onScan(url.trim()); }}
                              className="btn-ink shrink-0 bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium tracking-[-.025em] text-[var(--bg)]"
                            >
                              Try again
                            </button>
                            <button
                              onClick={(e) => { e.preventDefault(); trackEvent("try_another_url_clicked", { action: "error-recovery", error: raw }); setScanError(""); setUrl(""); }}
                              className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium tracking-[-.025em] text-[var(--ink)] transition-colors hover:bg-[var(--tint)]"
                            >
                              Try another URL
                            </button>
                            <a
                              href="/contact?ref=feedback"
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => trackEvent("report_issue_clicked", { url: url.trim(), error: raw })}
                              className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium tracking-[-.025em] text-[var(--ink)] transition-colors hover:bg-[var(--tint)]"
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
              <div className="mt-5 flex items-center justify-between gap-4">
                <p className="text-[11px] font-medium tracking-[-.025em] leading-relaxed text-[var(--muted)]">
                  We check bot access, content structure, structured data, and discoverability.
                </p>
                <button
                  type="submit"
                  disabled={loading}
                  aria-busy={loading}
                  className="scan-action btn-ink shrink-0 bg-[var(--accent)] px-4 py-2.5 text-[12px] font-medium tracking-[-.025em] text-[var(--accent-contrast)] disabled:cursor-wait disabled:opacity-75"
                >
                  <span>{loading ? "Checking…" : "Start scan"}</span>
                  {!loading && (
                    <ScanSearch
                      className="scan-action-icon size-3.5"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  )}
                </button>
              </div>
            </form>
            {showAllowanceNotice && (
              <div
                role="status"
                className="audit-notice mt-5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--tint)] px-4 py-3"
              >
                <p className="text-[12px] leading-relaxed text-[var(--ink-soft)]">
                  You’ve used today’s free audits.{" "}
                  <Link
                    to="/contact"
                    className="font-medium text-[var(--ink)] underline underline-offset-2"
                  >
                    Join the waitlist
                  </Link>{" "}
                  for more access, or come back tomorrow for another free scan.
                </p>
              </div>
            )}
            {loading && (
              <div
                aria-live="polite"
                className="mt-8 pt-2"
              >
                <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg)] overflow-hidden transition-all duration-300">
                  <button 
                    type="button"
                    onClick={() => setProgressOpen(!progressOpen)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--tint)] transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      {/* Glowing indicator (inline styles: the built tailwind.css lacks animate-ping/h-2/w-2/w-3, so these would collapse to 0x0).
                          ml-1 gives the scaling ping ring room so its left edge isn't clipped by the parent's overflow-hidden. */}
                      <span className="relative ml-1 flex items-center justify-center shrink-0" style={{ width: 8, height: 8 }}>
                        <span className="absolute inline-flex rounded-full bg-[var(--accent)]" style={{ width: "100%", height: "100%", opacity: 0.75, animation: "scanping 1s cubic-bezier(0,0,0.2,1) infinite" }}></span>
                        <span className="relative inline-flex rounded-full bg-[var(--accent)]" style={{ width: 8, height: 8 }}></span>
                      </span>
                      <style>{`@keyframes scanping{75%,100%{transform:scale(1.8);opacity:0}}`}</style>
                      <span className="text-[13px] font-medium text-[var(--ink)] truncate">
                        {analysisState?.progressMessages?.length > 0 
                          ? analysisState.progressMessages[analysisState.progressMessages.length - 1].message 
                          : scanSteps[progressStep][0]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-[var(--muted)] font-medium">
                        {analysisState?.progressMessages ? analysisState.progressMessages.length : (progressStep + 1)} steps
                      </span>
                      <Icon name={progressOpen ? "chevronDown" : "chevronRight"} className="text-[var(--muted)]" />
                    </div>
                  </button>
                  
                  <div 
                    className={`transition-all duration-300 ease-in-out overflow-hidden ${progressOpen ? "opacity-100 border-t border-[var(--line)]" : "opacity-0 border-transparent"}`}
                    style={{ maxHeight: progressOpen ? '300px' : '0px' }}
                  >
                    <div className="overflow-y-auto max-h-[300px]">
                      <ol className="p-4 grid gap-3">
                      {analysisState?.progressMessages?.length > 0 ? (
                        analysisState.progressMessages.map((msg: any, index: number) => {
                          const isLast = index === analysisState.progressMessages.length - 1;
                          return (
                            <li
                              key={index}
                              className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2 text-[11px] font-medium tracking-[-.025em] text-[var(--ink-soft)]"
                            >
                              <span
                                className={`mt-px grid size-3.5 place-items-center rounded-full text-[8px] ${!isLast
                                  ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                                  : "border border-[var(--accent)] text-[var(--accent)]"
                                  }`}
                              >
                                {!isLast ? "✓" : "•"}
                              </span>
                              <span>
                                <span className="block">{msg.message}</span>
                              </span>
                              <span className="pt-px text-[9px]">
                                {!isLast ? "Done" : "Working"}
                              </span>
                            </li>
                          )
                        })
                      ) : scanSteps.map(([step, detail], index) => {
                        const complete = index < progressStep
                        const active = index === progressStep
                        return (
                          <li
                            key={step}
                            className={`grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2 text-[11px] font-medium tracking-[-.025em] ${index > progressStep
                              ? "text-[var(--placeholder)]"
                              : "text-[var(--ink-soft)]"
                              }`}
                          >
                            <span
                              className={`mt-px grid size-3.5 place-items-center rounded-full text-[8px] ${complete
                                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                                : active
                                  ? "border border-[var(--accent)] text-[var(--accent)]"
                                  : "border border-[var(--line)]"
                                }`}
                            >
                              {complete ? "✓" : active ? "•" : ""}
                            </span>
                            <span>
                              <span className="block">{step}</span>
                              <span className="mt-0.5 block text-[9px] opacity-70">
                                {detail}
                              </span>
                            </span>
                            <span className="pt-px text-[9px]">
                              {complete ? "Done" : active ? "Working" : "Next"}
                            </span>
                          </li>
                        )
                      })}
                        </ol>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        data-reveal
        className="mx-auto grid max-w-[1240px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-12 lg:py-28"
      >
        <div className="lg:col-span-4">
          <p className="text-[12px] font-medium tracking-[-.025em] text-[var(--muted)]">The shift</p>
          <h2 className="mt-5 text-[clamp(2.4rem,4.5vw,4.6rem)] font-medium leading-[.9] tracking-[-.065em]">
            Search results became conversations.
          </h2>
        </div>
        <div className="grid content-end gap-6 lg:col-span-6 lg:col-start-7">
          <p className="text-[21px] leading-[1.28] tracking-[-.04em]">
            Developers are finding documentation through ChatGPT, Perplexity,
            Claude, and other AI tools. The useful question is whether those
            systems can make sense of yours.
          </p>
          <p className="max-w-lg text-[14px] leading-relaxed text-[var(--ink-soft)]">
            Lensy is not about shortcuts or prompt tricks. It shows where the
            knowledge in your docs is hard to reach—and what makes it clearer
            for a system trying to give someone a trustworthy answer.
          </p>
          <Link
            to="/how-it-works"
            className="group mt-2 inline-flex w-fit items-center gap-2 border-b border-[var(--accent)] pb-1 text-[12px] font-medium tracking-[-.025em] text-[var(--accent)]"
          >
            See how Lensy checks{" "}
            <Icon name="arrow" className="arrow-nudge size-3" />
          </Link>
        </div>
      </section>

      <section
        id="questions"
        data-reveal
        className="mx-auto grid max-w-[1240px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-12"
      >
        <h2 className="text-[clamp(2.5rem,5vw,5rem)] font-medium leading-[.9] tracking-[-.07em] lg:col-span-4">
          A few good questions.
        </h2>
        <div className="lg:col-span-7 lg:col-start-6">
          {[
            [
              "What does Lensy check?",
              "Lensy assesses the bot access, content structure, and discoverability signals that help AI answer engines find, read, and cite technical documentation.",
            ],
            [
              "Is the initial check free?",
              "Yes. Enter a documentation URL for the initial view, then decide whether a deeper ongoing assessment is useful.",
            ],
            [
              "Do we need a new documentation platform?",
              "No. Lensy is designed to work with the documentation you already publish and point toward the changes that matter most.",
            ],
          ].map(([q, a], i) => (
            <div key={q} className="border-t border-[var(--line)]">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                className="flex w-full items-center justify-between gap-6 py-5 text-left text-[16px] tracking-[-.025em] hover:text-[var(--accent)]"
              >
                <span>{q}</span>
                <Icon
                  name="plus"
                  className={`shrink-0 ${open === i ? "rotate-45 text-[var(--accent)]" : ""
                    }`}
                />
              </button>
              <div className={`acc ${open === i ? "open" : ""}`}>
                <div>
                  <p className="max-w-xl pb-6 text-[13px] leading-relaxed text-[var(--ink-soft)]">
                    {a}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
