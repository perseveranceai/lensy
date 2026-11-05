// SPDX-License-Identifier: MIT
// Parity (Req 1.2, tasks 4.5): for every saved fixture, lensy-core gives the
// same per-check points, details and fixes as the website's engine run, and
// the same points as the prototype's expected.json. Stop and report on any
// difference.
import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { checkFromPage } from '../src/check';
import { buildScoringV2, collectSignalsV2 } from '../src/engine';
import { FIXTURE_DIR, loadFixture, pageInputFromFixture, replayFetch } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';
import { afdocsFixtures, loadAfdocsRun, replayAfdocs } from './afdocs-replay';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const fixtures = fs.readdirSync(FIXTURE_DIR).filter(d => fs.existsSync(`${FIXTURE_DIR}/${d}/expected.json`)).sort();
const row = (x: { id: string; points: number | null; detail: string; fix?: string; source?: string }) => [x.id, x.points, x.detail, x.fix, x.source ?? 'lensy'];

test('all 15 fixtures are present', () => {
  expect(fixtures).toHaveLength(15);
});

// Lensy's own checks (C1-C6, S1-S6), with AFDocs off.
describe.each(fixtures)('%s', (name) => {
  test('same checks as the website engine and expected.json', async () => {
    const { entries, expected } = loadFixture(name);
    const page = pageInputFromFixture(entries, expected.url);

    // The website: default options (Lensy/1.0, browser fallback on).
    const web = buildScoringV2(await collectSignalsV2(page, { fetchImpl: replayFetch(entries), now: NOW }));
    const cli = await checkFromPage(page, { fetchImpl: replayFetch(entries), now: NOW, afdocs: false });

    expect(cli.status).toBe('ok');
    for (const key of ['codingAgents', 'aiSearch'] as const) {
      const w = web.scores[key];
      const c = cli.scores[key];
      expect(c.score).toBe(w.score);
      expect(c.coveredMax).toBe(100);
      expect(c.label).toBeUndefined();
      expect(c.checks.map(x => [x.id, x.points, x.detail, x.fix])).toEqual(w.checks.map(x => [x.id, x.points, x.detail, x.fix]));
    }
    expect(cli.scores.codingAgents.score).toBe(expected.coding.total);
    expect(cli.scores.aiSearch.score).toBe(expected.search.total);
    expect(cli.tips).toEqual(web.tips);
    expect(cli.agentPreview).toEqual(web.agentPreview);
    expect(cli.gate.state).toBe(web.gate.state);
  });
});

// Coding agents on AFDocs (docs/coding-agents-afdocs/spec.md criterion 1): the
// same saved AFDocs run gives the CLI and the website the same checks and score.
test('AFDocs runs are saved for 5 pages', () => {
  expect(afdocsFixtures).toEqual(['branch-onboarding', 'docusaurus-docs', 'react-learn', 'stripe-payments', 'vitest-guide']);
});

describe.each(afdocsFixtures)('%s with AFDocs', (name) => {
  test('same Coding agents checks and score as the website engine', async () => {
    const { entries, expected } = loadFixture(name);
    const page = pageInputFromFixture(entries, expected.url);
    const run = loadAfdocsRun(name);

    const web = buildScoringV2(await collectSignalsV2(page, { fetchImpl: replayFetch(entries), now: NOW }), run);
    const cli = await checkFromPage(page, { fetchImpl: replayFetch(entries), now: NOW, loadAfdocs: replayAfdocs(name) });

    expect(cli.status).toBe('ok');
    const c = cli.scores.codingAgents;
    const w = web.scores.codingAgents;
    expect(c.score).toBe(w.score);
    expect(c.coveredMax).toBe(100);
    expect(c.checks.map(row)).toEqual(w.checks.map(row));
    expect(c.checks.filter(x => x.id !== 'lensy-headings').every(x => x.source === 'afdocs')).toBe(true);
    expect(c.checks.some(x => /^C\d$/.test(x.id))).toBe(false);
    // AI search stays Lensy's own.
    expect(cli.scores.aiSearch.score).toBe(expected.search.total);
    expect(cli.scores.aiSearch.checks.map(x => x.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  });
});
