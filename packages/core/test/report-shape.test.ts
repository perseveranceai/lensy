// SPDX-License-Identifier: MIT
// Report coverage (Req 6.5): every field the engine adds to its report output
// is mapped into the CLI's Report or listed as website-only.
import { expect, test } from 'vitest';
import { buildScoringV2, collectSignalsV2 } from '../src/engine';
import { checkFromPage } from '../src/check';
import { MAPPED_FIELDS, WEBSITE_ONLY } from '../src/report';
import { loadFixture, pageInputFromFixture, replayFetch } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';

test('every ScoringV2Fields key is mapped or website-only', async () => {
  const { entries, expected } = loadFixture('stripe-payments');
  const page = pageInputFromFixture(entries, expected.url);
  const v2 = buildScoringV2(await collectSignalsV2(page, { fetchImpl: replayFetch(entries), now: 0 }));
  const known = new Set<string>([...MAPPED_FIELDS, ...WEBSITE_ONLY]);
  for (const key of Object.keys(v2)) expect(known, `${key} is neither mapped nor website-only`).toContain(key);
});

test('report has the reportVersion 1 fields', async () => {
  const { entries, expected } = loadFixture('stripe-payments');
  const r = await checkFromPage(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries), now: 0 });
  expect(Object.keys(r).sort()).toEqual(['agentPreview', 'checkedAt', 'engine', 'finalUrl', 'gate', 'mode', 'netErrors', 'notes', 'platform', 'reportVersion', 'scope', 'scores', 'status', 'tips', 'url'].sort());
  expect(r).toMatchObject({ reportVersion: 1, mode: 'url', scope: 'page', engine: { scoringVersion: 2 } });
});
