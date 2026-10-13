// "Download report" menu on the results page (H-001): Markdown for a coding
// agent, or PDF. While AI citations are being run for the download it shows
// how long it has waited and offers to download without them.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import type { ReportFormat } from "./useReportDownload";

const OPTIONS: Array<{ format: ReportFormat; label: string; hint: string }> = [
  { format: "md", label: "Markdown (.md)", hint: "For your coding agent" },
  { format: "pdf", label: "PDF", hint: "To read or send to your team" },
];

export function DownloadReportButton({
  onDownload,
  onSkipCitations,
  pending,
  waitingSince,
  building,
  error,
}: {
  onDownload: (format: ReportFormat) => void;
  onSkipCitations: () => void;
  pending: ReportFormat[];
  waitingSince: number | null;
  building: ReportFormat | null;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const waiting = pending.length > 0;

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Tick the elapsed time while waiting on citations.
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const elapsed = waitingSince ? Math.max(0, Math.round((now - waitingSince) / 1000)) : 0;
  const busy = waiting || building !== null;
  const label = waiting
    ? `Running AI citations, then downloading… ${elapsed}s`
    : building
      ? `Preparing ${building === "md" ? "Markdown" : "PDF"}…`
      : "Download report";

  return (
    <div ref={rootRef} className="relative inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        data-testid="download-report"
        className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        <Download className="size-3" strokeWidth={1.8} aria-hidden="true" />
        <span aria-live="polite">{label}</span>
        <ChevronDown className="size-3" strokeWidth={1.8} aria-hidden="true" />
      </button>
      {waiting && (
        <button
          type="button"
          onClick={onSkipCitations}
          className="text-[var(--ink-soft)] hover:text-[var(--accent)]"
          style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}
        >
          Download without citations
        </button>
      )}
      {error && <span role="alert" className="text-[var(--ink-soft)]">{error}</span>}
      {open && (
        <div
          role="menu"
          aria-label="Download report"
          className="absolute left-0 top-full z-50 mt-2 w-[240px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] shadow-[var(--shadow-float)]"
        >
          {OPTIONS.map((option) => (
            <button
              key={option.format}
              type="button"
              role="menuitem"
              disabled={pending.includes(option.format) || building === option.format}
              onClick={() => {
                setOpen(false);
                onDownload(option.format);
              }}
              className="block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--surface)] disabled:opacity-50"
            >
              <span className="block text-[13px] font-medium tracking-[-.02em] text-[var(--ink)]">{option.label}</span>
              <span className="mt-0.5 block text-[11px] text-[var(--ink-soft)]">{option.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
