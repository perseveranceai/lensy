// SPDX-License-Identifier: MIT
// Registry coverage (Req 6.4): every check the engine returns has a registry
// entry with the same label and max, plus an explanation and evidence.
import { describe, expect, test } from 'vitest';
import { AFDOCS_CHECKS, CHECKS } from '../src/index';
import type { Check } from '../src/index';
import { checkFromPage } from '../src/check';
import { loadFixture, pageInputFromFixture, replayFetch } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';
import { afdocsFixtures, replayAfdocs } from './afdocs-replay';

const REGISTRY = [...CHECKS, ...AFDOCS_CHECKS];

function inRegistry(returned: Check[]) {
  for (const c of returned) {
    const meta = REGISTRY.find(m => m.id === c.id);
    expect(meta, `${c.id} is not in the registry`).toBeDefined();
    expect(c).toMatchObject({ label: meta!.label, source: meta!.source });
    expect(meta!.measures && meta!.why).toBeTruthy();
    expect(meta!.evidence.length).toBeGreaterThan(0);
  }
}

test('Lensy checks: every returned check is in the registry with the same label and max', async () => {
  const { entries, expected } = loadFixture('vitest-guide');
  const r = await checkFromPage(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries), now: 0, afdocs: false });
  const returned = [...r.scores.codingAgents.checks, ...r.scores.aiSearch.checks];
  expect(returned.map(c => c.id)).toEqual(CHECKS.map(c => c.id));
  inRegistry(returned);
  for (const c of returned) expect(c.max).toBe(CHECKS.find(m => m.id === c.id)!.max);
});

// AFDocs' per-check max depends on how many checks ran, so only label and source are compared.
describe.each(afdocsFixtures)('%s with AFDocs', (name) => {
  test('every returned check is in the registry with the same label and source', async () => {
    const { entries, expected } = loadFixture(name);
    const r = await checkFromPage(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries), now: 0, loadAfdocs: replayAfdocs(name) });
    inRegistry([...r.scores.codingAgents.checks, ...r.scores.aiSearch.checks]);
    expect(r.scores.codingAgents.checks.map(c => c.source)).toContain('afdocs');
  });
});
