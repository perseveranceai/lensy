// Scoring v2 against the reference prototype (spec docs/two-score-readiness §9.1, R7).
//
// Each fixture folder holds every response the prototype received for one page
// (captured by backend/scripts/capture-fixtures.mjs on 2026-10-22) and the
// prototype's own output when replayed from them. The collector and scorer run
// over the same responses and must give the same points for every check.
import fs from 'fs';
import { collectSignalsV2 } from '../collect-signals-v2';
import { scoreCodingAgents, scoreAiSearch, gateState, CheckId } from '../scoring-v2';
import { FIXTURE_DIR, loadFixture, pageInputFromFixture, replayFetch } from './replay';

// Prototype check labels, by check id.
const PROTOTYPE_LABEL: Record<CheckId, [bucket: 'coding' | 'search', label: string]> = {
    C1: ['coding', 'Content without JavaScript'],
    C2: ['coding', 'Markdown on Accept: text/markdown'],
    C3: ['coding', '.md version discoverable'],
    C4: ['coding', 'llms.txt usable'],
    C5: ['coding', 'Page fits one fetch'],
    C6: ['coding', 'Sections findable'],
    S1: ['search', 'AI search bots allowed'],
    S2: ['search', 'Content without JavaScript'],
    S3: ['search', 'Indexable'],
    S4: ['search', 'Freshness declared'],
    S5: ['search', 'Answer-ready sections'],
    S6: ['search', 'JSON-LD'],
};

// Spec §5 and §12 (prototype, 2026-10-22). Fixtures were captured the same day.
const SPEC_SCORES: Record<string, { coding: number; search: number }> = {
    'vitepress-getting-started': { coding: 85, search: 95 },
    'vitest-guide': { coding: 85, search: 68 },
    'mintlify-quickstart': { coding: 100, search: 100 },
    'fern-overview': { coding: 94, search: 90 },
    'stripe-payments': { coding: 87, search: 80 },
    'docusaurus-docs': { coding: 50, search: 98 },
    'react-learn': { coding: 95, search: 70 },
    'branch-home': { coding: 96, search: 75 },
    'branch-onboarding': { coding: 97, search: 78 },
    'u1-stripe-api': { coding: 94, search: 76 },
    'u2-github-rest': { coding: 96, search: 62 },
    'u4-redoc': { coding: 0, search: 30 },
    'u5-lua-manual': { coding: 28, search: 63 },
    'u6-reddit-api': { coding: 26, search: 48 },
    'u7-zoom-library': { coding: 91, search: 80 },
};

const fixtures = fs.readdirSync(FIXTURE_DIR).filter(n => fs.existsSync(`${FIXTURE_DIR}/${n}/responses.json.gz`)).sort();

test('all 15 pages from spec §5 and §12 have fixtures', () => {
    expect(fixtures).toEqual(Object.keys(SPEC_SCORES).sort());
});

describe.each(fixtures)('%s', (name) => {
    const { entries, expected } = loadFixture(name);
    const misses: string[] = [];
    const result = (async () => {
        const signals = await collectSignalsV2(pageInputFromFixture(entries, expected.url), { fetchImpl: replayFetch(entries, misses), now: Date.parse('2026-10-22T12:00:00Z') });
        return { signals, coding: scoreCodingAgents(signals), search: scoreAiSearch(signals), gate: gateState(signals) };
    })();

    test('every request the collector makes was captured', async () => {
        await result;
        expect(misses).toEqual([]);
    });

    test.each(Object.keys(PROTOTYPE_LABEL) as CheckId[])('%s points equal the prototype within 0.5', async (id) => {
        const r = await result;
        const [bucket, label] = PROTOTYPE_LABEL[id];
        const mine = (bucket === 'coding' ? r.coding : r.search).checks.find(c => c.id === id)!;
        const theirs = expected[bucket].checks[label];
        expect(Math.abs(mine.points - theirs.pts)).toBeLessThanOrEqual(0.5);
        expect(mine.max).toBe(theirs.max);
    });

    test('totals and gate equal the prototype', async () => {
        const r = await result;
        expect(r.coding.score).toBe(expected.coding.total);
        expect(r.search.score).toBe(expected.search.total);
        expect(r.gate.state).toBe(expected.gate.state);
        expect(r.gate.robotsBlocks).toEqual(expected.gate.robotsBlocks);
    });

    test('scores are within 3 of the spec table', async () => {
        const r = await result;
        expect(Math.abs(r.coding.score - SPEC_SCORES[name].coding)).toBeLessThanOrEqual(3);
        // U-7's sitemap changed between the spec run and the capture: 80 then, 76 now (the
        // prototype gives 76 on the captured responses too). Its tolerance is widened, not hidden.
        expect(Math.abs(r.search.score - SPEC_SCORES[name].search)).toBeLessThanOrEqual(name === 'u7-zoom-library' ? 4 : 3);
    });
});
