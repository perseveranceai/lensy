// Run with: node --test scripts/site-readiness.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFromReport, addRun } from './site-readiness.mjs';

const page = (url, ca, ai, status = 'ok') => ({ url, status, report: { scores: { codingAgents: { score: ca }, aiSearch: { score: ai } } } });
const report = (pages, checkedAt = '2026-11-16T06:01:00Z') => ({ toolVersion: '0.2.0', engineCommit: 'abc1234', checkedAt, pages });

test('a run averages the checked pages and keeps each page', () => {
  const run = runFromReport(report([page('https://perseveranceai.com/', 99, 100), page('https://perseveranceai.com/cli', 100, 100)]));
  assert.equal(run.date, '2026-11-16');
  assert.equal(run.codingAgents, 100); // 99.5 rounds up
  assert.equal(run.aiSearch, 100);
  assert.deepEqual(run.pages.map((p) => p.path), ['/', '/cli']);
  assert.equal(run.engine, 'abc1234');
  assert.equal(run.notChecked, undefined);
});

test('pages that could not be checked are listed, not averaged', () => {
  const run = runFromReport(report([page('https://perseveranceai.com/', 80, 60), page('https://perseveranceai.com/bot', 0, 0, 'unreachable')]));
  assert.equal(run.codingAgents, 80);
  assert.deepEqual(run.notChecked, ['/bot']);
});

test('a run with no checked page is refused', () => {
  assert.throws(() => runFromReport(report([page('https://perseveranceai.com/', 0, 0, 'blocked')])), /nothing to record/);
});

test('a second run on the same date replaces the first; runs stay in date order', () => {
  const seed = { version: 1, site: 'https://perseveranceai.com', runs: [{ date: '2026-11-10', codingAgents: 39, aiSearch: 55, pages: [] }] };
  const first = addRun(seed, { date: '2026-11-16', codingAgents: 90, aiSearch: 90, pages: [] });
  const again = addRun(first, { date: '2026-11-16', codingAgents: 100, aiSearch: 100, pages: [] });
  assert.deepEqual(again.runs.map((r) => [r.date, r.codingAgents]), [['2026-11-10', 39], ['2026-11-16', 100]]);
});
