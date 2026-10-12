/**
 * Skill behavioral eval harness — deterministic (free) tier (task 0215, R2).
 *
 * Proves the harness ASSERTS the expected discipline: for each scenario, the judge PASSES a recorded
 * transcript where the discipline fired and FAILS one where it did not. This runs in the default
 * suite (fast, deterministic, no agent spawn) — the costly live-agent tier is `bun run eval`, a
 * separate entry point that never gates this suite.
 */

import { describe, expect, test } from 'bun:test';
import { judgeTranscript } from './judge';
import { EVAL_FIXTURES, EVAL_SCENARIOS } from './scenarios';

describe('skill behavioral eval harness — judge (task 0215 R2)', () => {
    test('at least one gate-bearing skill scenario exists', () => {
        expect(EVAL_SCENARIOS.length).toBeGreaterThanOrEqual(1);
        expect(EVAL_SCENARIOS[0]?.skill).toBeTruthy();
        expect(EVAL_SCENARIOS[0]?.discipline).toBeTruthy();
    });

    test('every fixture references a real scenario', () => {
        const ids = new Set(EVAL_SCENARIOS.map((s) => s.id));
        for (const f of EVAL_FIXTURES) {
            expect(ids.has(f.scenarioId), `fixture references unknown scenario ${f.scenarioId}`).toBe(true);
        }
        expect(EVAL_FIXTURES.length).toBeGreaterThanOrEqual(1);
    });

    for (const fixture of EVAL_FIXTURES) {
        const scenario = EVAL_SCENARIOS.find((s) => s.id === fixture.scenarioId);
        if (!scenario) throw new Error(`fixture references unknown scenario ${fixture.scenarioId}`);
        test(`${fixture.scenarioId}: judge PASSES a transcript where the discipline fired`, () => {
            const r = judgeTranscript(fixture.disciplined, scenario.expect);
            expect(r.passed, `expected discipline to fire; fired=[${r.fired}] violated=[${r.violated}]`).toBe(true);
            expect(r.fired.length).toBeGreaterThan(0);
            expect(r.violated).toEqual([]);
        });
        test(`${fixture.scenarioId}: judge FAILS a transcript where the discipline did not fire`, () => {
            const r = judgeTranscript(fixture.undisciplined, scenario.expect);
            expect(r.passed, 'expected the undisciplined transcript to fail the discipline').toBe(false);
        });
    }
});
