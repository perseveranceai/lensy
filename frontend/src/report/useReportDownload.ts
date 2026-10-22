// The report download flow (H-001).
//
// - Citations already here (or already known to have failed): build the file in
//   the browser and save it at once. No network call.
// - Citations running: wait for that same run, then save.
// - Citations not run: start them (the citations card fills in too), wait, then
//   save. If they can't start, fail, or don't finish in time, the file is still
//   saved and says "AI citations could not run", never "not cited".
//
// Analytics fire only from a click and its outcome, never from an effect that
// a reload could replay (N-06).
//
// With citations off (REACT_APP_CITATIONS_ENABLED, spec §8.3) the file is
// always saved at once and never starts a citations run.
import { useCallback, useEffect, useRef, useState } from "react";
import { trackEvent } from "../analytics";
import { buildExportReport, reportFileName } from "./exportReport";
import { CITATIONS_ENABLED } from "./flags";
import type { ExportInput } from "./exportReport";

export type ReportFormat = "md" | "pdf";
export type RunCitationsResult = "done" | "started" | "running" | "unavailable";

interface Pending {
  format: ReportFormat;
  startedAt: number;
}

export interface UseReportDownloadArgs {
  input: Omit<ExportInput, "citationsReason" | "citationsSkipped" | "now" | "origin">;
  citationsLoading: boolean;
  onRunCitations?: (trigger?: "card" | "download") => Promise<RunCitationsResult> | void;
  view: string;
}

function saveBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export async function buildReportFile(input: ExportInput, format: ReportFormat): Promise<{ blob: Blob; fileName: string }> {
  const data = buildExportReport(input);
  if (format === "md") {
    const { renderMarkdown } = await import("./markdown");
    return { blob: new Blob([renderMarkdown(data)], { type: "text/markdown;charset=utf-8" }), fileName: reportFileName(data, "md") };
  }
  const [{ renderPdf }, fonts] = await Promise.all([
    import("./pdf"),
    import("../jakartaFonts").then((m) => ({ regular: m.JAKARTA_REGULAR, bold: m.JAKARTA_BOLD })).catch(() => null),
  ]);
  const doc = await renderPdf(data, { fonts });
  return { blob: doc.output("blob") as Blob, fileName: reportFileName(data, "pdf") };
}

export function useReportDownload({ input, citationsLoading, onRunCitations, view }: UseReportDownloadArgs) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [building, setBuilding] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Latest values for async callbacks and the unmount cleanup.
  const inputRef = useRef(input);
  inputRef.current = input;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // True once a citations run we are waiting on is actually in flight, so
  // "loading went false without data" can be read as "it didn't finish".
  const waitingOnRunRef = useRef(false);
  const url = input.report?.scope?.url || input.report?.url || input.url || "";

  const hasCitations = Boolean(input.citationData || input.report?.aiDiscoverability);

  const finish = useCallback(async (item: Pending, citationsReason?: string, skipped = false) => {
    setBuilding(item.format);
    setError(null);
    const current = inputRef.current;
    const citationData = current.citationData || current.report?.aiDiscoverability;
    let stage: "build" | "save" = "build";
    try {
      const { blob, fileName } = await buildReportFile({ ...current, citationsReason, citationsSkipped: skipped }, item.format);
      stage = "save";
      saveBlob(blob, fileName);
      trackEvent("report_download_completed", {
        format: item.format,
        citations_included: CITATIONS_ENABLED && Boolean(citationData) && citationData?.status !== "error",
        citations_skipped: skipped,
        wait_ms: Date.now() - item.startedAt,
        file_kb: Math.max(1, Math.round(blob.size / 1024)),
      });
    } catch (e) {
      console.error("[Download] Report download failed:", e);
      setError("The report could not be downloaded. Please try again.");
      trackEvent("report_download_failed", {
        format: item.format,
        stage,
        error: e instanceof Error ? e.name : "error",
      });
    } finally {
      setBuilding(null);
    }
  }, []);

  const flush = useCallback(async (citationsReason?: string, skipped = false) => {
    const items = pendingRef.current;
    if (!items.length) return;
    pendingRef.current = [];
    setPending([]);
    setWaitingSince(null);
    waitingOnRunRef.current = false;
    for (const item of items) await finish(item, citationsReason, skipped);
  }, [finish]);

  // Citations arrived (WebSocket or polling): save everything that was waiting.
  useEffect(() => {
    if (pending.length && hasCitations) void flush();
  }, [pending.length, hasCitations, flush]);

  // Mark the run as in flight once loading turns on, then treat loading going
  // off without a result as "did not finish" (the 90s timeout, or an error).
  useEffect(() => {
    if (!pending.length) return;
    if (citationsLoading) {
      waitingOnRunRef.current = true;
      return;
    }
    if (waitingOnRunRef.current && !hasCitations) {
      void flush("the check did not finish in time");
    }
  }, [pending.length, citationsLoading, hasCitations, flush]);

  // A new scan replaced the report while a file was waiting: drop it, so a
  // file for the old page never appears with the new page's data.
  const reportRef = useRef(input.report);
  useEffect(() => {
    if (reportRef.current === input.report) return;
    reportRef.current = input.report;
    if (!pendingRef.current.length) return;
    for (const item of pendingRef.current) trackEvent("report_download_cancelled", { format: item.format, reason: "new_scan" });
    pendingRef.current = [];
    setPending([]);
    setWaitingSince(null);
    waitingOnRunRef.current = false;
  }, [input.report]);

  // Leaving the page while waiting cancels the file.
  useEffect(() => () => {
    for (const item of pendingRef.current) {
      trackEvent("report_download_cancelled", { format: item.format, reason: "left_page" });
    }
  }, []);

  const download = useCallback(async (format: ReportFormat) => {
    const current = inputRef.current;
    const citationData = current.citationData || current.report?.aiDiscoverability;
    const citationsState = !CITATIONS_ENABLED ? "off" : citationData ? (citationData.status === "error" ? "unavailable" : "done") : citationsLoading ? "running" : "not_run";
    trackEvent("report_download_clicked", { format, citations_state: citationsState, view, url });
    const item: Pending = { format, startedAt: Date.now() };

    // Citations off, done, or already known to have failed: no waiting.
    if (!CITATIONS_ENABLED || citationData) {
      await finish(item);
      return;
    }
    // One wait serves every format asked for meanwhile.
    if (pendingRef.current.some((p) => p.format === format)) return;
    const alreadyWaiting = pendingRef.current.length > 0;
    pendingRef.current = [...pendingRef.current, item];
    setPending(pendingRef.current);
    setWaitingSince((t) => t ?? item.startedAt);
    if (alreadyWaiting) return;

    if (citationsLoading) {
      waitingOnRunRef.current = true;
      return;
    }
    let result: RunCitationsResult | void = "unavailable";
    try {
      result = await onRunCitations?.("download");
    } catch {
      result = "unavailable";
    }
    if (result === "started" || result === "running") {
      waitingOnRunRef.current = true;
    } else if (result !== "done") {
      void flush("the check could not start");
    }
    // 'done': the result is already in state; the effect above saves the file.
  }, [citationsLoading, finish, flush, onRunCitations, url, view]);

  const skipCitations = useCallback(() => {
    void flush(undefined, true);
  }, [flush]);

  return { download, skipCitations, pending: pending.map((p) => p.format), waitingSince, building, error };
}
