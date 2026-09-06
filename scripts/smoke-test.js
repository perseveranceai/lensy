#!/usr/bin/env node
/**
 * Post-deploy smoke test: runs a real scan against a deployed environment and
 * asserts it completes with a plausible report.
 *
 * This is the strongest promotion signal available. Soaking on alarms is weak
 * here because gamma sees almost no organic traffic — "no errors" mostly means
 * "nobody used it". This actively generates the traffic instead of waiting.
 *
 * Usage:
 *   node scripts/smoke-test.js --base-url https://... [--url <docs-url>] [--out result.json]
 */

const fs = require('fs');

const DEFAULT_TARGET = 'https://docs.stripe.com/api';
const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 240000;
// A completed scan that scores absurdly low or high usually means the pipeline
// ran but produced junk — worth failing rather than promoting.
const PLAUSIBLE_SCORE = { min: 1, max: 100 };

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const baseUrl = (arg('base-url') || process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    console.error('smoke: --base-url is required');
    process.exit(2);
  }

  const target = arg('url', DEFAULT_TARGET);
  const sessionId = `smoke-${Date.now()}`;
  const startedAt = Date.now();

  const result = {
    passed: false,
    sessionId,
    target,
    baseUrl,
    status: null,
    overallScore: null,
    durationMs: null,
    error: null,
  };

  try {
    const started = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: target, sessionId, useAgent: true }),
    });

    if (!started.ok) {
      throw new Error(`POST /analyze returned ${started.status}: ${await started.text()}`);
    }
    console.log(`smoke: started ${sessionId} against ${target}`);

    while (Date.now() - startedAt < TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);

      const res = await fetch(`${baseUrl}/status/${sessionId}`);
      if (!res.ok) {
        console.log(`smoke: /status returned ${res.status}, retrying`);
        continue;
      }

      const body = await res.json();
      result.status = body.status;

      if (body.status === 'completed') {
        const score = body.report && body.report.overallScore;
        result.overallScore = typeof score === 'number' ? score : null;
        result.durationMs = Date.now() - startedAt;

        if (result.overallScore === null) {
          throw new Error('completed without an overallScore — report shape unexpected');
        }
        if (result.overallScore < PLAUSIBLE_SCORE.min || result.overallScore > PLAUSIBLE_SCORE.max) {
          throw new Error(`implausible overallScore: ${result.overallScore}`);
        }

        result.passed = true;
        console.log(`smoke: PASS — score ${result.overallScore} in ${Math.round(result.durationMs / 1000)}s`);
        break;
      }

      if (body.status === 'failed') {
        throw new Error(`analysis failed: ${body.error || 'no error given'}`);
      }
    }

    if (!result.passed && !result.error) {
      throw new Error(`timed out after ${TIMEOUT_MS / 1000}s in status "${result.status}"`);
    }
  } catch (err) {
    result.error = err.message;
    result.durationMs = Date.now() - startedAt;
    console.error(`smoke: FAIL — ${err.message}`);
  }

  const out = arg('out');
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));

  process.exit(result.passed ? 0 : 1);
}

main();
