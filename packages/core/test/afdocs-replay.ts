// SPDX-License-Identifier: MIT
// A stand-in for the afdocs module that returns saved AFDocs 0.23.0 runs
// (backend tools/__tests__/fixtures/afdocs), so tests score the AFDocs path
// without the network. A page with no saved run fails, so its Coding agents
// score falls back to C1-C6, as when AFDocs fails for real.
import fs from 'node:fs';
import path from 'node:path';
import type { AfdocsModule } from '../src/engine';
import type { AfdocsRun } from '../../../backend/lambda/agent-handler/tools/afdocs-page';
import { FIXTURE_DIR } from '../../../backend/lambda/agent-handler/tools/__tests__/replay';

export const AFDOCS_FIXTURE_DIR = path.join(FIXTURE_DIR, 'afdocs');
export const afdocsFixtures = fs.readdirSync(AFDOCS_FIXTURE_DIR).map(f => f.replace(/\.json$/, '')).sort();

export function loadAfdocsRun(name: string): AfdocsRun {
  return JSON.parse(fs.readFileSync(path.join(AFDOCS_FIXTURE_DIR, `${name}.json`), 'utf8'));
}

export function replayAfdocs(...names: string[]): () => Promise<AfdocsModule> {
  const runs = new Map(names.map(n => loadAfdocsRun(n)).map(r => [r.url, r]));
  const mod: AfdocsModule = {
    runChecks: async (url) => {
      const run = runs.get(url);
      if (!run) throw new Error(`no saved AFDocs run for ${url}`);
      return { url, results: run.results, requestSummary: { requests: run.requests } };
    },
    computeScore: (report) => runs.get(report.url)!.score,
  };
  return async () => mod;
}
