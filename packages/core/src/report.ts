// SPDX-License-Identifier: MIT
// The CLI's Report: the stable shape behind the HTML and Markdown reports
// (reportVersion 1, additive changes only; Req 3.6, 7.1-7.4). Built from the
// engine's ScoringV2Fields. Never computes a check: points, findings and fixes
// are the engine's, unchanged. The only arithmetic here is re-scoring over the
// checks that ran when some are unknown (design "Score rule").
import { CHECKS_BY_ID } from './engine';
import type { CheckResult, Platform, ScoreResult, ScoringV2Fields, SignalsV2 } from './engine';

export type Mode = 'url' | 'local' | 'source';
export type PageStatus = 'ok' | 'blocked' | 'unreachable' | 'not-html';

export interface Check {
  id: string;
  source: 'lensy' | string;
  label: string;
  max: number;
  /** null when skipped or unknown */
  points: number | null;
  status: 'pass' | 'warn' | 'fail' | 'skipped' | 'unknown';
  detail: string;
  fix?: string;
  note?: string;
}

export interface Score {
  /** null only when status !== 'ok' */
  score: number | null;
  label?: 'local' | 'source' | 'partial';
  /** 100 unless checks are skipped, unknown or partial */
  coveredMax: number;
  /** Req 7.2; unused in phase 1 */
  categories?: { id: string; label: string; score: number }[];
  checks: Check[];
  /** 'afdocs' when Coding agents comes from AFDocs (docs/coding-agents-afdocs/spec.md); absent for Lensy's C1-C6 */
  source?: 'afdocs';
}

export interface Report {
  reportVersion: 1;
  url: string;
  finalUrl: string;
  checkedAt: string;
  engine: { scoringVersion: 2; commit: string };
  mode: Mode;
  /** 'site' reserved (Req 7.3) */
  scope: 'page';
  status: PageStatus;
  platform: Platform;
  gate: { state: 'pass' | 'warn' | 'blocked' | 'skipped'; via?: 'honest' | 'browser'; honestStatus?: number; robotsBlocks: string[]; mismatch?: string };
  scores: { codingAgents: Score; aiSearch: Score };
  tips: { id: string; text: string }[];
  agentPreview?: { format: 'markdown' | 'html'; chars: number; approxTokens: number; windowShare: number; url: string };
  notes: string[];
  netErrors: string[];
}

/** Every ScoringV2Fields key is mapped into Report (keys here) or website-only (Req 6.5). */
export const MAPPED_FIELDS = ['scoringVersion', 'scores', 'gate', 'tips', 'agentPreview'] as const;
export const WEBSITE_ONLY: readonly string[] = [];

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

function toCheck(c: CheckResult, unknown: boolean, failedUrl?: string): Check {
  const meta = CHECKS_BY_ID[c.id];
  const base = { id: c.id, source: c.source ?? meta?.source ?? 'lensy', label: c.label, max: c.max, detail: c.detail };
  if (unknown) {
    return { ...base, points: null, status: 'unknown', note: `network error${failedUrl ? `: ${failedUrl}` : ''}` };
  }
  return { ...base, points: c.points, status: c.status, ...(c.fix ? { fix: c.fix } : {}) };
}

export function toScore(engine: ScoreResult, unknownIds: Set<string>, failedUrl?: string): Score {
  const checks = engine.checks.map(c => toCheck(c, unknownIds.has(c.id), failedUrl));
  const source = 'source' in engine && engine.source === 'afdocs' ? { source: 'afdocs' as const } : {};
  const ran = checks.filter(c => c.points !== null);
  if (ran.length === checks.length) return { score: engine.score, coveredMax: 100, checks, ...source };
  const coveredMax = sum(ran.map(c => c.max));
  const earned = sum(ran.map(c => c.points as number));
  return { score: coveredMax ? Math.round((100 * earned) / coveredMax) : 0, label: 'partial', coveredMax, checks, ...source };
}

const emptyScore = (): Score => ({ score: null, coveredMax: 0, checks: [] });

export interface ReportBase {
  url: string;
  finalUrl: string;
  mode: Mode;
  commit: string;
  checkedAt: string;
  notes?: string[];
}

export function okReport(base: ReportBase, v2: ScoringV2Fields, signals: SignalsV2): Report {
  const unknown = new Set(signals.netErrorChecks);
  const failedUrl = signals.netErrors[0];
  const g = v2.gate;
  return {
    reportVersion: 1,
    url: base.url,
    finalUrl: base.finalUrl,
    checkedAt: base.checkedAt,
    engine: { scoringVersion: v2.scoringVersion, commit: base.commit },
    mode: base.mode,
    scope: 'page',
    status: 'ok',
    platform: signals.platform,
    gate: {
      state: g.state,
      via: g.via,
      honestStatus: g.honestStatus,
      robotsBlocks: g.robotsBlocks,
      ...(g.mismatch ? { mismatch: g.mismatch } : {}),
    },
    scores: {
      codingAgents: toScore(v2.scores.codingAgents, unknown, failedUrl),
      aiSearch: toScore(v2.scores.aiSearch, unknown, failedUrl),
    },
    tips: v2.tips,
    agentPreview: v2.agentPreview,
    notes: base.notes ?? [],
    netErrors: signals.netErrors,
  };
}

export function failedReport(base: ReportBase, status: Exclude<PageStatus, 'ok'>, honestStatus?: number): Report {
  return {
    reportVersion: 1,
    url: base.url,
    finalUrl: base.finalUrl,
    checkedAt: base.checkedAt,
    engine: { scoringVersion: 2, commit: base.commit },
    mode: base.mode,
    scope: 'page',
    status,
    platform: null,
    gate: { state: status === 'blocked' ? 'blocked' : 'skipped', ...(honestStatus ? { honestStatus } : {}), robotsBlocks: [] },
    scores: { codingAgents: emptyScore(), aiSearch: emptyScore() },
    tips: [],
    notes: base.notes ?? [],
    netErrors: [],
  };
}
