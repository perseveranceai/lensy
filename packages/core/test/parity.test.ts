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

const NOW = Date.parse('2026-10-22T12:00:00Z');
const fixtures = fs.readdirSync(FIXTURE_DIR).filter(d => fs.existsSync(`${FIXTURE_DIR}/${d}/expected.json`)).sort();

test('all 15 fixtures are present', () => {
  expect(fixtures).toHaveLength(15);
});

describe.each(fixtures)('%s', (name) => {
  test('same checks as the website engine and expected.json', async () => {
    const { entries, expected } = loadFixture(name);
    const page = pageInputFromFixture(entries, expected.url);

    // The website: default options (Lensy/1.0, browser fallback on).
    const web = buildScoringV2(await collectSignalsV2(page, { fetchImpl: replayFetch(entries), now: NOW }));
    const cli = await checkFromPage(page, { fetchImpl: replayFetch(entries), now: NOW });

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
