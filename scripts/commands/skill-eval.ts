#!/usr/bin/env bun
/**
 * Skill behavioral eval runner — the cost-gated tier (task 0215 R2; relocated in task 1175).
 *
 * Entry point: `bun run eval`. For each scenario, it drives a gate-bearing skill against the scripted
 * pressure situation and judges whether the expected discipline fired, emitting a MARKDOWN report.
 *
 * Two tiers, per the free-vs-paid split (D4):
 *   • `--fixtures` (deterministic, free) — judge the recorded "disciplined" transcript for each
 *     scenario. No agent spawn; proves the harness end-to-end and always reproducible. Also what CI
 *     and a sandbox can run.
 *   • default (paid) — spawn `spur agent run "<prompt>"` per scenario and judge the live transcript.
 *     Requires an installed, authenticated coding agent.
 *
 * Failure contract (task 1175 R3) — the three outcomes are not interchangeable:
 *   • `SKIPPED` — the executor is *unavailable* (spawn ENOENT). A missing agent never turns a real
 *     gate red.
 *   • `FAIL` — the executor was present and the run did not produce a usable transcript: timeout,
 *     killed by signal, non-zero exit, or empty stdout. An unavailable agent and a broken run must
 *     not read the same. In `--fixtures` mode a missing or empty requested fixture is a FAIL too:
 *     that is corrupt fixture data, not an absent agent.
 *   • `PASS` — a transcript was produced and the scenario's discipline fired.
 * Exit code is 1 only when at least one row is `FAIL`.
 *
 * The scenario corpus and judge are repository-only fixtures under the plugin test owner
 * (`plugins/sp/tests/evals/`); this runner is not shipped, so importing them adds no shipped
 * dependency. It is NOT a `*.test.ts` file and is never picked up by the default `bun test` suite —
 * the deterministic assertion of the judge lives in `plugins/sp/tests/evals/judge.test.ts`.
 */

import { spawnSync } from 'node:child_process';
import { getEnvVar } from '@gobing-ai/ts-utils';
import { judgeTranscript } from '../../plugins/sp/tests/evals/judge';
import {
    EVAL_FIXTURES,
    EVAL_SCENARIOS,
    type EvalFixture,
    type EvalScenario,
} from '../../plugins/sp/tests/evals/scenarios';

export type Outcome = 'PASS' | 'FAIL' | 'SKIPPED';

export interface Row {
    scenario: EvalScenario;
    outcome: Outcome;
    detail: string;
}

/** Live-attempt budget; a timeout is a FAIL, not an unavailable executor. */
export const LIVE_TIMEOUT_MS = 120_000;

/** Detail cells land in a Markdown table row, so a detail is always one bounded line. */
const DETAIL_MAX_CHARS = 300;

/** Minimal shape of `spawnSync`'s result that this runner reads (injectable in tests). */
export interface SpawnResultLike {
    error?: { code?: string; message?: string } | null;
    status?: number | null;
    signal?: string | null;
    stdout?: string | null;
    stderr?: string | null;
}

export type SpawnLike = (cmd: string, args: string[], opts: { encoding: 'utf-8'; timeout: number }) => SpawnResultLike;

export interface SkillEvalDeps {
    scenarios?: EvalScenario[];
    fixtures?: EvalFixture[];
    spawn?: SpawnLike;
}

/** The live-attempt outcome: a transcript to judge, or why none exists. */
export type LiveAttempt =
    | { kind: 'transcript'; transcript: string }
    | { kind: 'unavailable'; detail: string }
    | { kind: 'failed'; detail: string };

/** Collapse to one line and cap it, so a stderr blob cannot break the report table. */
export function sanitizeDetail(text: string): string {
    const single = text.replace(/\s+/g, ' ').trim();
    return single.length <= DETAIL_MAX_CHARS ? single : `${single.slice(0, DETAIL_MAX_CHARS - 1)}…`;
}

/** Live tier: run the scenario prompt through the configured agent. `SPUR_BIN` may carry arguments. */
export function runLiveAttempt(
    scenario: EvalScenario,
    spawn: SpawnLike = spawnSync as unknown as SpawnLike,
): LiveAttempt {
    const spurBin = getEnvVar('SPUR_BIN') || 'spur';
    // Existing splitting contract: `SPUR_BIN` is split on spaces into cmd + leading args; no shell.
    const parts = spurBin.split(' ');
    const cmd = parts[0] ?? 'spur';
    const args = [...parts.slice(1), 'agent', 'run', scenario.prompt];
    const res = spawn(cmd, args, { encoding: 'utf-8', timeout: LIVE_TIMEOUT_MS });

    if (res.error?.code === 'ENOENT') {
        return { kind: 'unavailable', detail: `agent executor not found: ${cmd}` };
    }
    if (res.error?.code === 'ETIMEDOUT') {
        return { kind: 'failed', detail: `agent timed out after ${LIVE_TIMEOUT_MS} ms` };
    }
    if (res.error) {
        return {
            kind: 'failed',
            detail: sanitizeDetail(`spawn failed: ${res.error.message ?? res.error.code ?? 'unknown error'}`),
        };
    }
    if (res.signal) {
        return { kind: 'failed', detail: `agent killed by ${res.signal} (timed out after ${LIVE_TIMEOUT_MS} ms)` };
    }
    if (res.status !== 0) {
        const stderr = sanitizeDetail(res.stderr ?? '');
        return {
            kind: 'failed',
            detail: `agent exited ${String(res.status)}${stderr === '' ? '' : `: ${stderr}`}`,
        };
    }
    const transcript = `${res.stdout ?? ''}`;
    if (transcript.trim() === '') {
        return { kind: 'failed', detail: 'agent produced empty stdout' };
    }
    return { kind: 'transcript', transcript };
}

/** Judge a produced transcript into a row. */
function judgeRow(scenario: EvalScenario, transcript: string): Row {
    const result = judgeTranscript(transcript, scenario.expect);
    return {
        scenario,
        outcome: result.passed ? 'PASS' : 'FAIL',
        detail: result.passed
            ? `discipline fired: [${result.fired.join(', ')}]`
            : `discipline did NOT fire (fired=[${result.fired.join(', ')}] violated=[${result.violated.join(', ')}])`,
    };
}

export function evaluateRows(useFixtures: boolean, deps: SkillEvalDeps = {}): Row[] {
    const scenarios = deps.scenarios ?? EVAL_SCENARIOS;
    const fixtures = deps.fixtures ?? EVAL_FIXTURES;
    return scenarios.map((scenario) => {
        if (useFixtures) {
            const fixture = fixtures.find((f) => f.scenarioId === scenario.id);
            if (!fixture) {
                return {
                    scenario,
                    outcome: 'FAIL',
                    detail: `no recorded fixture for scenario ${scenario.id} (corrupt fixture data, not a missing agent)`,
                };
            }
            if (fixture.disciplined.trim() === '') {
                return { scenario, outcome: 'FAIL', detail: `recorded fixture for scenario ${scenario.id} is empty` };
            }
            return judgeRow(scenario, fixture.disciplined);
        }
        const attempt = runLiveAttempt(scenario, deps.spawn);
        if (attempt.kind === 'unavailable') return { scenario, outcome: 'SKIPPED', detail: attempt.detail };
        if (attempt.kind === 'failed') return { scenario, outcome: 'FAIL', detail: attempt.detail };
        return judgeRow(scenario, attempt.transcript);
    });
}

export function renderReport(rows: Row[], useFixtures: boolean): string {
    const tier = useFixtures ? 'deterministic (fixtures)' : 'live (agent)';
    const out: string[] = [
        `## Skill behavioral eval — ${tier} tier`,
        '',
        '| Scenario | Skill | Outcome | Detail |',
        '|---|---|---|---|',
    ];
    for (const r of rows) {
        out.push(`| ${r.scenario.id} | ${r.scenario.skill} | ${r.outcome} | ${r.detail} |`);
    }
    const failed = rows.filter((r) => r.outcome === 'FAIL').length;
    const skipped = rows.filter((r) => r.outcome === 'SKIPPED').length;
    out.push(
        '',
        `${rows.length} scenario(s): ${rows.length - failed - skipped} pass, ${failed} fail, ${skipped} skipped`,
    );
    if (!useFixtures && skipped === rows.length) {
        out.push('', 'Live tier skipped (no agent). Run `bun run eval -- --fixtures` for the deterministic tier.');
    }
    return `${out.join('\n')}\n`;
}

/** CLI entry: returns the exit code (1 only when a FAIL remains) and the Markdown report. */
export function runCli(
    argv: string[] = process.argv.slice(2),
    deps: SkillEvalDeps = {},
): { exitCode: number; stdout: string } {
    const useFixtures = argv.includes('--fixtures');
    const rows = evaluateRows(useFixtures, deps);
    return { exitCode: rows.some((r) => r.outcome === 'FAIL') ? 1 : 0, stdout: renderReport(rows, useFixtures) };
}

if (import.meta.main) {
    const { exitCode, stdout } = runCli();
    process.stdout.write(stdout);
    process.exit(exitCode);
}
