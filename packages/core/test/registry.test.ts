// SPDX-License-Identifier: MIT
// Registry coverage (Req 6.4): every check the engine returns has a registry
// entry with the same label and max, plus an explanation and evidence.
import { expect, test } from 'vitest';
import { CHECKS } from '../src/index';
import { checkFromPage } from '../src/check';
import { loadFixture, pageInputFromFixture, replayFetch } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';

test('every returned check is in the registry with the same label and max', async () => {
  const { entries, expected } = loadFixture('vitest-guide');
  const r = await checkFromPage(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries), now: 0 });
  const returned = [...r.scores.codingAgents.checks, ...r.scores.aiSearch.checks];
  expect(returned.map(c => c.id)).toEqual(CHECKS.map(c => c.id));
  for (const c of returned) {
    const meta = CHECKS.find(m => m.id === c.id)!;
    expect(c).toMatchObject({ label: meta.label, max: meta.max, source: meta.source });
    expect(meta.measures && meta.why).toBeTruthy();
    expect(meta.evidence.length).toBeGreaterThan(0);
  }
});
