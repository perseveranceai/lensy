#!/usr/bin/env node
/**
 * Classifies a deploy as low-risk (safe to auto-promote) or manual.
 *
 * Deliberately a standalone script rather than inline workflow YAML: it has to
 * be runnable locally, unit-testable, and replayable against historical rows in
 * LensyDeploymentDecisions so a candidate ruleset can be evaluated before it is
 * ever trusted with anything.
 *
 * Conservative by construction — anything unrecognised routes to manual.
 *
 * Usage:
 *   node scripts/assess-deploy-risk.js --base <sha> --head <sha> \
 *        [--cdk-diff <file>] [--author <login>] [--smoke <file>]
 *
 * Writes the full feature+verdict record as JSON to stdout.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

const CLASSIFIER_VERSION = 'v1';

// Paths whose contents can change behaviour in ways the smoke test won't catch.
const AUTH_SURFACE = [/isValidToken/i, /cloudfront-function/i, /access-?code/i];
const SAFE_PATH_PREFIXES = ['backend/lambda/', 'frontend/src/'];
// 08:00–22:00 ET expressed in UTC, which wraps past midnight (12:00 → 02:00).
const BUSINESS_HOURS_UTC = { start: 12, end: 2 };

// True when `hour` falls inside a window that may wrap around midnight.
function withinWrappingWindow(hour, { start, end }) {
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}
const MAX_FILES = 40;
const MAX_LINES = 1500;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function readIfPresent(path) {
  if (!path) return '';
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function collectFeatures({ base, head, cdkDiff, author, smoke }) {
  const nameOnly = git(['diff', '--name-only', `${base}..${head}`]);
  const files = nameOnly.split('\n').map((f) => f.trim()).filter(Boolean);

  let linesAdded = 0;
  let linesDeleted = 0;
  for (const line of git(['diff', '--numstat', `${base}..${head}`]).split('\n')) {
    const [add, del] = line.split('\t');
    if (add && add !== '-') linesAdded += Number(add) || 0;
    if (del && del !== '-') linesDeleted += Number(del) || 0;
  }

  // cdk diff is the only reliable read on blast radius. Absence of the file is
  // treated as unknown, not as safe.
  const cdkDiffAvailable = Boolean(cdkDiff);
  const cdkReplacements = /replace/i.test(cdkDiff);
  const cdkDeletions = /^\s*\[-\]/m.test(cdkDiff);
  const iamChanged = /IAM (Statement|Policy) Changes/i.test(cdkDiff);

  let smokePassed = false;
  let smokeScore = null;
  if (smoke) {
    try {
      const parsed = JSON.parse(smoke);
      smokePassed = parsed.passed === true;
      smokeScore = typeof parsed.overallScore === 'number' ? parsed.overallScore : null;
    } catch {
      smokePassed = false;
    }
  }

  const now = new Date();
  const hourUTC = now.getUTCHours();
  const day = now.getUTCDay();

  return {
    pathsTouched: files.slice(0, MAX_FILES),
    filesChanged: files.length,
    linesAdded,
    linesDeleted,
    cdkDiffAvailable,
    cdkReplacements,
    cdkDeletions,
    iamChanged,
    workflowsChanged: files.some((f) => f.startsWith('.github/workflows/')),
    depsChanged: files.some((f) => /(^|\/)(package(-lock)?\.json|yarn\.lock)$/.test(f)),
    authSurfaceTouched: files.some((f) => AUTH_SURFACE.some((re) => re.test(f)))
      || AUTH_SURFACE.some((re) => re.test(git(['diff', `${base}..${head}`, '--', 'backend/lib/']))),
    rateLimitChanged: /rate.?limit/i.test(git(['diff', `${base}..${head}`, '--', 'backend/'])),
    onlySafePaths: files.length > 0
      && files.every((f) => SAFE_PATH_PREFIXES.some((p) => f.startsWith(p)) || f.startsWith('docs/')),
    author: author || 'unknown',
    deployHourUTC: hourUTC,
    isWeekend: day === 0 || day === 6,
    smokePassed,
    smokeScore,
  };
}

function classify(f) {
  const blockers = [];

  // Any one of these forces a human, regardless of everything else.
  if (f.workflowsChanged) blockers.push('workflow-changed');
  if (f.iamChanged) blockers.push('iam-changed');
  if (f.authSurfaceTouched) blockers.push('auth-surface-touched');
  if (f.rateLimitChanged) blockers.push('rate-limit-changed');
  if (f.depsChanged) blockers.push('dependencies-changed');
  if (f.cdkReplacements) blockers.push('resource-replacement');
  if (f.cdkDeletions) blockers.push('resource-deletion');
  if (!f.cdkDiffAvailable) blockers.push('cdk-diff-unavailable');
  if (f.filesChanged > MAX_FILES) blockers.push('diff-too-large-files');
  if (f.linesAdded + f.linesDeleted > MAX_LINES) blockers.push('diff-too-large-lines');
  if (!f.onlySafePaths) blockers.push('touches-paths-outside-handler-and-ui');
  if (!f.smokePassed) blockers.push('smoke-test-not-green');
  if (f.isWeekend) blockers.push('weekend');
  if (!withinWrappingWindow(f.deployHourUTC, BUSINESS_HOURS_UTC)) {
    blockers.push('outside-business-hours');
  }

  return {
    version: CLASSIFIER_VERSION,
    verdict: blockers.length === 0 ? 'low' : 'manual',
    reasons: blockers.length === 0
      ? ['handler-or-ui-only', 'no-replacements', 'smoke-green']
      : blockers,
    wouldAutoPromote: blockers.length === 0,
  };
}

function main() {
  const base = arg('base', 'HEAD~1');
  const head = arg('head', 'HEAD');
  const features = collectFeatures({
    base,
    head,
    cdkDiff: readIfPresent(arg('cdk-diff')),
    author: arg('author'),
    smoke: readIfPresent(arg('smoke')),
  });
  const classifier = classify(features);

  const record = {
    deployId: `${new Date().toISOString()}#${head.slice(0, 7)}`,
    schemaVersion: 1,
    commitSha: head,
    baseSha: base,
    env: arg('env', 'prod'),
    features,
    classifier,
    decision: null,
    outcome: null,
  };

  process.stdout.write(JSON.stringify(record, null, 2));

  // Phase 4 runs this in shadow mode: the verdict is recorded and surfaced in
  // the run summary, but target_env stays 'production' until the decision log
  // says the classifier has earned it. Phase 5 flips this line.
  const SHADOW_MODE = process.env.CLASSIFIER_SHADOW_MODE !== 'false';
  const targetEnv = (!SHADOW_MODE && classifier.wouldAutoPromote)
    ? 'production-auto'
    : 'production';

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `deploy_id=${record.deployId}\n`
      + `verdict=${classifier.verdict}\n`
      + `target_env=${targetEnv}\n`
      + `shadow_mode=${SHADOW_MODE}\n`
      + `reasons=${classifier.reasons.join(',')}\n`);
  }
}

if (require.main === module) main();

module.exports = { collectFeatures, classify, CLASSIFIER_VERSION };
