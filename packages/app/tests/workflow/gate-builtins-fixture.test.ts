/**
 * D65 1234 R1/R3 — deterministic workflow steps are typed engine builtins.
 *
 * The fixture (`fixtures/1234/gate-builtins-fixture.yaml`) expresses the quality gate, the
 * project check (`spur self exec <action>`), the corpus transition (`spur task update`) and the
 * commit guard (`spur workflow commit-guard`) as `command.gate` actions. This suite proves the
 * two contract halves:
 *   - shape: no shell action performs any of those verbs (R1);
 *   - outcome: each step's exit code becomes a typed PASS / FAIL / BLOCKED token in its
 *     `resultFile` and in the `action_runs` trace, and a non-PASS routes through the graph (R3).
 *
 * `spurBin` is a stub script here: the subject is the engine's outcome typing and routing, not
 * the verbs (their own suites own those). The run ids are pinned so the trace rows are exact.
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import type { StateMachineWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { loadWorkflowDefFromText } from '@gobing-ai/ts-dual-workflow-engine';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowAppService } from '../../src/services/workflow-service';

const FIXTURE = join(import.meta.dir, '..', 'fixtures', '1234', 'gate-builtins-fixture.yaml');
const DEF = loadWorkflowDefFromText(readFileSync(FIXTURE, 'utf8'), FIXTURE) as StateMachineWorkflowDef;

/** The fixture's `${vars.spurBin}` reference, spelled without a template literal. */
const SPUR_BIN_REF = `$${'{vars.spurBin}'}`;

/** Stub `spur` that answers each verb with the exit code the case under test wants. */
function stubSpur(dir: string, codes: { gate: number; check: number; transition: number; guard: number }): string {
    const path = join(dir, 'spur-stub.sh');
    writeFileSync(
        path,
        [
            '#!/bin/sh',
            'case "$1 $2" in',
            `  "task gate") echo gate-stub; exit ${codes.gate} ;;`,
            `  "self exec") echo check-stub; exit ${codes.check} ;;`,
            `  "task update") echo "illegal transition" >&2; exit ${codes.transition} ;;`,
            `  "workflow commit-guard") echo "refused: foreign path" >&2; exit ${codes.guard} ;;`,
            'esac',
            'echo "unexpected: $*" >&2; exit 9',
            '',
        ].join('\n'),
    );
    chmodSync(path, 0o755);
    return path;
}

interface RunOutcome {
    finalState: string;
    rows: Array<{ node: string; kind: string; ok: number; data?: { status?: string; exitCode?: number } }>;
}

async function runFixture(dir: string, stub: string, runId: string): Promise<RunOutcome> {
    const db = await createMigratedDb({ url: ':memory:' });
    const svc = new WorkflowAppService({
        cwd: dir,
        getDb: async () => db,
        agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
        processExecutor: () => new NodeProcessExecutor(),
    });
    const result = await svc.run(FIXTURE, { runId, vars: { wbs: '1999', spurBin: stub, runStatus: 'wip' } });
    const rows = await db.queryAll<{
        node: string;
        kind: string;
        ok: number;
        result_json: string | null;
    }>('SELECT node, kind, ok, result_json FROM action_runs WHERE run_id = ? ORDER BY created_at, node', runId);
    return {
        finalState: String(result.finalState),
        rows: rows.map((row) => ({
            node: row.node,
            kind: row.kind,
            ok: row.ok,
            ...(row.result_json === null ? {} : { data: JSON.parse(row.result_json).data }),
        })),
    };
}

/** The stub's recorded exit code for one fixture step, read back from its resultFile token. */
function token(dir: string, runId: string, step: string): string {
    return readFileSync(join(dir, '.spur', 'run', `${runId}-${step}.status`), 'utf8').trim();
}

describe('gate-builtins fixture shape (R1)', () => {
    test('every deterministic step is a command.gate action invoking an existing verb', () => {
        const gates = DEF.states.flatMap((state) =>
            (state.onEnter ?? [])
                .filter((action) => action.kind === 'command.gate')
                .map((action) => ({
                    node: state.id,
                    options: action.options as { executable?: string; args?: string[] },
                })),
        );
        expect(gates.map((gate) => [gate.node, ...(gate.options.args ?? []).slice(0, 2)])).toEqual([
            ['gate', 'task', 'gate'],
            ['gate', 'self', 'exec'],
            ['transition', 'task', 'update'],
            ['commit-guard', 'workflow', 'commit-guard'],
        ]);
        // Each step runs the run's own spur entry (an existing verb), never a shell string.
        for (const gate of gates) expect(gate.options.executable).toBe(SPUR_BIN_REF);

        // No shell action performs a gate, a project command, a transition or a guard.
        const shells = DEF.states.flatMap((state) =>
            (state.onEnter ?? [])
                .filter((action) => action.kind === 'shell')
                .map((action) => String((action.options as { command: string }).command)),
        );
        expect(shells).toEqual([]);
    });

    test('each step declares the options the outcome typing depends on', () => {
        for (const state of DEF.states) {
            for (const action of (state.onEnter ?? []).filter((a) => a.kind === 'command.gate')) {
                const options = action.options as Record<string, unknown>;
                expect(typeof options.resultFile).toBe('string');
                // A gate/transition/guard refusal must route through the graph, not abort the run.
                expect(options.softFail).toBe(true);
                expect(typeof options.timeoutMs).toBe('number');
            }
        }
    });
});

describe('gate-builtins typed outcomes (R3)', () => {
    test('all steps green: exit 0 is PASS in every resultFile and every action row, run reaches done', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1234-fixture-'));
        try {
            const stub = stubSpur(dir, { gate: 0, check: 0, transition: 0, guard: 0 });
            const outcome = await runFixture(dir, stub, 'run-1234');
            expect(outcome.finalState).toBe('done');
            expect(
                outcome.rows.map((row) => [row.node, row.kind, row.ok, row.data?.status, row.data?.exitCode]),
            ).toEqual([
                ['gate', 'command.gate', 1, 'PASS', 0],
                ['gate', 'command.gate', 1, 'PASS', 0],
                ['transition', 'command.gate', 1, 'PASS', 0],
                ['commit-guard', 'command.gate', 1, 'PASS', 0],
            ]);
            for (const step of ['gate-step', 'project-check', 'transition', 'commit-guard']) {
                expect(token(dir, 'run-1234', step)).toBe('PASS');
            }
            // Each row carries its resultFile — the trace names the artifact it wrote.
            expect(
                outcome.rows.every((row) => typeof (row.data as { resultFile?: string }).resultFile === 'string'),
            ).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a project action that is not bound (exit 2) is BLOCKED, soft, and routes to failed', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1234-blocked-'));
        try {
            const stub = stubSpur(dir, { gate: 0, check: 2, transition: 0, guard: 0 });
            const outcome = await runFixture(dir, stub, 'run-1234');
            expect(outcome.finalState).toBe('failed');
            const blocked = outcome.rows.find((row) => row.node === 'gate' && row.data?.status === 'BLOCKED');
            expect(blocked).toBeDefined();
            // Blocked is not a failure of the step (softFail): the run keeps routing evidence.
            expect(blocked?.ok).toBe(1);
            expect(blocked?.data?.exitCode).toBe(2);
            expect(token(dir, 'run-1234', 'project-check')).toBe('BLOCKED');
            // Nothing downstream of the failed gate ran.
            expect(outcome.rows.some((row) => row.node === 'transition')).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a corpus transition refused by the lifecycle graph (exit 1) is FAIL and routes to failed', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1234-refused-'));
        try {
            const stub = stubSpur(dir, { gate: 0, check: 0, transition: 1, guard: 0 });
            const outcome = await runFixture(dir, stub, 'run-1234');
            expect(outcome.finalState).toBe('failed');
            const refused = outcome.rows.find((row) => row.node === 'transition');
            expect(refused?.data?.status).toBe('FAIL');
            expect(refused?.data?.exitCode).toBe(1);
            expect(token(dir, 'run-1234', 'transition')).toBe('FAIL');
            // The commit guard is downstream of the accepted transition only.
            expect(outcome.rows.some((row) => row.node === 'commit-guard')).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
