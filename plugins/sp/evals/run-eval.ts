#!/usr/bin/env bun
/**
 * Skill behavioral eval runner — the cost-gated tier (task 0215, R2).
 *
 * Entry point: `bun run eval`. For each scenario, it drives a gate-bearing skill against the scripted
 * pressure situation and judges whether the expected discipline fired, emitting a MARKDOWN report.
 *
 * Two tiers, per the free-vs-paid split (D4):
 *   • `--fixtures` (deterministic, free) — judge the recorded "disciplined" transcript for each
 *     scenario. No agent spawn; proves the harness end-to-end and always reproducible. Also what CI
 *     and a sandbox can run.
 *   • default (paid) — spawn `spur agent run "<prompt>"` per scenario and judge the live transcript.
 *     Requires an installed, authenticated coding agent; when none is available it reports SKIPPED
 *     rather than failing, so a missing agent never turns a real gate red.
 *
 * This runner is NOT a `*.test.ts` file and is never imported by the default `bun test` suite — it is
 * a separate entry point, so the behavioral tier never slows or entangles the always-on structural
 * suite (the deterministic assertion of the judge lives in `judge.test.ts`).
 */

import { spawnSync } from 'node:child_process';
import { judgeTranscript } from './judge';
import { EVAL_FIXTURES, EVAL_SCENARIOS, type EvalScenario } from './scenarios';

type Outcome = 'PASS' | 'FAIL' | 'SKIPPED';

interface Row {
    scenario: EvalScenario;
    outcome: Outcome;
    detail: string;
}

/** Live tier: run the scenario prompt through the configured agent and return its transcript. */
function runLive(scenario: EvalScenario): string | null {
    const spurBin = process.env.SPUR_BIN || 'spur';
    const parts = spurBin.split(' ');
    const cmd = parts[0] ?? 'spur';
    const args = [...parts.slice(1), 'agent', 'run', scenario.prompt];
    const res = spawnSync(cmd, args, { encoding: 'utf-8', timeout: 120_000 });
    if (res.error || typeof res.status !== 'number' || res.status !== 0) return null;
    return `${res.stdout ?? ''}`;
}

function evaluate(useFixtures: boolean): Row[] {
    return EVAL_SCENARIOS.map((scenario) => {
        let transcript: string | null;
        if (useFixtures) {
            transcript = EVAL_FIXTURES.find((f) => f.scenarioId === scenario.id)?.disciplined ?? null;
        } else {
            transcript = runLive(scenario);
        }
        if (transcript === null || transcript.trim() === '') {
            return { scenario, outcome: 'SKIPPED', detail: 'no transcript (agent unavailable or no fixture)' };
        }
        const result = judgeTranscript(transcript, scenario.expect);
        return {
            scenario,
            outcome: result.passed ? 'PASS' : 'FAIL',
            detail: result.passed
                ? `discipline fired: [${result.fired.join(', ')}]`
                : `discipline did NOT fire (fired=[${result.fired.join(', ')}] violated=[${result.violated.join(', ')}])`,
        };
    });
}

function report(rows: Row[], useFixtures: boolean): void {
    const tier = useFixtures ? 'deterministic (fixtures)' : 'live (agent)';
    process.stdout.write(`## Skill behavioral eval — ${tier} tier\n\n`);
    process.stdout.write('| Scenario | Skill | Outcome | Detail |\n|---|---|---|---|\n');
    for (const r of rows) {
        process.stdout.write(`| ${r.scenario.id} | ${r.scenario.skill} | ${r.outcome} | ${r.detail} |\n`);
    }
    const failed = rows.filter((r) => r.outcome === 'FAIL').length;
    const skipped = rows.filter((r) => r.outcome === 'SKIPPED').length;
    process.stdout.write(
        `\n${rows.length} scenario(s): ${rows.length - failed - skipped} pass, ${failed} fail, ${skipped} skipped\n`,
    );
    if (!useFixtures && skipped === rows.length) {
        process.stdout.write(
            '\nLive tier skipped (no agent). Run `bun run eval -- --fixtures` for the deterministic tier.\n',
        );
    }
}

function main(): void {
    const useFixtures = process.argv.includes('--fixtures');
    const rows = evaluate(useFixtures);
    report(rows, useFixtures);
    // Only a real FAIL (discipline did not fire) is a non-zero exit; SKIPPED never fails the run.
    process.exit(rows.some((r) => r.outcome === 'FAIL') ? 1 : 0);
}

if (import.meta.main) main();
