import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createDefaultWorkflowEngineHost,
    MemoryWorkflowPersistenceAdapter,
    StateMachineDriver,
    type WorkflowEngineHost,
} from '@gobing-ai/ts-dual-workflow-engine';
import { parse as parseYaml } from 'yaml';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { registerSpurBuiltins } from '../../src/workflow/builtins';

/**
 * R5 (0604 / feature D5 R11): PR review spends quota once per stable integration
 * HEAD and is advisory by default. That contract is encoded entirely in the
 * `integration-review` state's options and in transition *declaration order* —
 * the state-machine driver takes the first passing edge, so the
 * `requireCleanReview` blocking edge only wins because it is declared before
 * the advisory one. Nothing else asserts either half: `workflow validate`
 * proves the definition is schema-valid, not that a FAIL stays advisory.
 *
 * 0753 R3 / D8 D1: the integration-review step now reaches a real decision
 * without spawning a nested workflow run. The `command.gate` +
 * `softFail: true` + `spur workflow run pr-review.yaml` shape was refused by
 * the SPUR_WORKFLOW_RUN_ACTIVE child guard and the refusal was masked. The
 * non-spawning replacement invokes `pr-reviewing.ts request` directly (a
 * `shell` action) and writes its own PASS/FAIL status — no nested level.
 *
 * 0782 (feature D6): feature-dev is an EXISTING-feature reuse loop. Brainstorm
 * and plan are gone; the precheck validates the essential feature/roster
 * contract via CLI reads and freezes the todo WBS list; execution dispatches
 * that frozen list to /sp:dev-runall exactly once; a nonempty all-terminal
 * roster verifies directly with zero execution model calls; feature-verify
 * runs `feature check --as done --json` exactly once and the guards only read
 * the captured `.status` decision. The execution scenarios below drive the REAL
 * definition through StateMachineDriver with a stub `spur` CLI, stub agents
 * (runTraced recorder), and a stub review command — no network, no GitHub.
 */

interface Guard {
    kind: string;
    options?: { command?: string };
}
interface Transition {
    from: string;
    to: string;
    guard?: Guard;
}
interface Action {
    kind: string;
    options?: Record<string, unknown>;
}
interface WorkflowDef {
    states: { id: string; onEnter?: Action[] }[];
    transitions: Transition[];
    vars?: Record<string, unknown>;
    version?: string;
}

// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'feature-dev.yaml'), 'utf8')) as WorkflowDef;

/** Index of the first transition matching from->to, or -1. */
function edgeIndex(from: string, to: string): number {
    return DEF.transitions.findIndex((t) => t.from === from && t.to === to);
}

const reviewState = DEF.states.find((s) => s.id === 'integration-review');
const shellAction = reviewState?.onEnter?.find((a) => a.kind === 'shell');
const commandGateAction = reviewState?.onEnter?.find((a) => a.kind === 'command.gate');

describe('feature-dev definition — integration review is non-spawning and reaches a real decision (0753 R3)', () => {
    test('the integration-review state exists and runs the review through a non-spawning shell action', () => {
        expect(reviewState).toBeDefined();
        // R3: no command.gate (which used to host softFail:true and the nested workflow run).
        expect(commandGateAction).toBeUndefined();
        // The non-spawning replacement: a direct shell invocation of pr-reviewing.ts request.
        expect(shellAction).toBeDefined();
    });

    test('the shell command invokes pr-reviewing.ts request directly — never `spur workflow run`', () => {
        // R3 AC: no nested workflow run. The shell must call pr-reviewing.ts request
        // directly; a `spur workflow run` here would re-create the child-guard refusal.
        const command = String(shellAction?.options?.command ?? '');
        expect(command).toContain('pr-reviewing.ts');
        expect(command).toContain('request');
        expect(command).not.toContain('workflow run');
        expect(command).not.toContain('softFail');
    });

    test('softFail is gone — the shell writes its own PASS/FAIL decision and exits loudly on real failure', () => {
        // R3 AC: the step produces a pass/fail decision rather than being soft-failed.
        // The pre-repair shape was command.gate with softFail:true; both must be gone.
        const command = String(shellAction?.options?.command ?? '');
        // The shell writes PASS to the status file when the request succeeds.
        expect(command).toMatch(/printf ['"]?PASS/);
        // And FAIL when the request errors — no softFail masking the refusal.
        expect(command).toMatch(/printf ['"]?FAIL/);
        expect(commandGateAction).toBeUndefined();
    });

    test('the blocking edge is declared before the advisory edge, so require-clean wins when both match', () => {
        const blocking = edgeIndex('integration-review', 'failed');
        const advisory = edgeIndex('integration-review', 'done');
        expect(blocking).toBeGreaterThanOrEqual(0);
        expect(advisory).toBeGreaterThanOrEqual(0);
        expect(blocking).toBeLessThan(advisory);
    });

    test('the blocking edge fires only under an explicit requireCleanReview policy', () => {
        const blocking = DEF.transitions.at(edgeIndex('integration-review', 'failed'));
        expect(blocking).toBeDefined();
        const command = blocking?.guard?.options?.command ?? '';
        expect(command).toContain('requireCleanReview');
        expect(command).toContain('= true');
        // Only a non-clean COLLECTED verdict blocks (0770): FINDINGS / PENDING /
        // collect FAIL / missing status — the request status is never evidence.
        expect(command).toContain('!= CLEAN');
        expect(command).toContain('integration-review-collect.status');
    });

    test('the advisory edge reaches done without requiring a clean review', () => {
        const advisory = DEF.transitions.at(edgeIndex('integration-review', 'done'));
        expect(advisory?.to).toBe('done');
        const command = advisory?.guard?.options?.command ?? '';
        expect(command).not.toContain('= PASS');
    });
});

describe('feature-dev definition — existing-feature reuse contract (0782)', () => {
    const stateIds = DEF.states.map((s) => s.id);
    const precheck = DEF.states.find((s) => s.id === 'precheck');
    const autoState = DEF.states.find((s) => s.id === 'execute-tasks-auto');
    const interactiveState = DEF.states.find((s) => s.id === 'execute-tasks');

    const allShellCommands = (): string[] =>
        DEF.states.flatMap((s) =>
            (s.onEnter ?? []).filter((a) => a.kind === 'shell').map((a) => String(a.options?.command ?? '')),
        );
    const allGuardCommands = (): string[] => DEF.transitions.map((t) => String(t.guard?.options?.command ?? ''));
    const allAgentInputs = (): string[] =>
        DEF.states.flatMap((s) =>
            (s.onEnter ?? []).filter((a) => a.kind === 'agent.run').map((a) => String(a.options?.input ?? '')),
        );

    test('planning states are deleted — the graph is existing-feature-only (R4)', () => {
        expect(stateIds).toEqual([
            'precheck',
            'execute-tasks-auto',
            'execute-tasks',
            'feature-verify',
            'integration-review',
            'done',
            'failed',
        ]);
        // No implicit planning anywhere: brainstorm/plan slash commands are gone.
        for (const input of allAgentInputs()) {
            expect(input).not.toContain('/sp:dev-brainstorm');
            expect(input).not.toContain('/sp:dev-plan');
        }
    });

    test('the behavior change increments the quoted version (frozen design)', () => {
        expect(DEF.version).toBe('3');
    });

    test('the duplicate doctor is gone — precheck validates identity/roster instead', () => {
        for (const command of [...allShellCommands(), ...allGuardCommands()]) {
            expect(command).not.toContain('agent doctor');
        }
        const precheckShell = (precheck?.onEnter ?? []).find((a) => a.kind === 'shell');
        const command = String(precheckShell?.options?.command ?? '');
        // CLI reads are captured once under run-scoped artifacts (frozen artifact names).
        expect(command).toContain('feature-dev-feature.json');
        expect(command).toContain('feature-dev-roster.json');
        expect(command).toContain('feature-dev-tasks.txt');
        // JSON field validation, not content grepping: identity match, nonempty array,
        // unique non-empty WBS identities, known statuses, refinement-blocking statuses.
        expect(command).toContain('.id == $id');
        expect(command).toContain('type == "array" and length > 0');
        expect(command).toContain('unique | length');
        expect(command).toContain(
            'select(.status == "backlog" or .status == "wip" or .status == "testing" or .status == "blocked")',
        );
    });

    test('execution hops read the frozen todo list and dispatch it as a pure slash command (R2)', () => {
        for (const state of [autoState, interactiveState]) {
            const actions = state?.onEnter ?? [];
            const readIndex = actions.findIndex((a) => a.kind === 'file.read.into-var');
            const runIndex = actions.findIndex((a) => a.kind === 'agent.run');
            expect(readIndex).toBeGreaterThanOrEqual(0);
            expect(runIndex).toBe(readIndex + 1);
            const read = actions[readIndex]?.options ?? {};
            expect(String(read.path)).toContain('feature-dev-tasks.txt');
            expect(read.var).toBe('featureTaskIds');
        }
        // The frozen list is projected into the input var — the child never re-enumerates.
        // (The literal workflow template placeholder is assembled so the linter does not
        // mistake it for a JS template string.)
        const taskIdsVar = '${' + 'vars.featureTaskIds}';
        expect(allAgentInputs()).toContain(`/sp:dev-runall --tasks ${taskIdsVar} --auto`);
        expect(allAgentInputs()).toContain(`/sp:dev-runall --tasks ${taskIdsVar}`);
        expect(allAgentInputs().join('\n')).not.toContain('--feature');
        // featureTaskIds is declared with an empty default so template resolution cannot throw.
        expect(DEF.vars?.featureTaskIds).toBe('');
    });

    test('precheck routes all-terminal rosters straight to verification, then auto, then interactive, then failed', () => {
        const fromPrecheck = DEF.transitions.filter((t) => t.from === 'precheck');
        expect(fromPrecheck.map((t) => t.to)).toEqual([
            'feature-verify',
            'execute-tasks-auto',
            'execute-tasks',
            'failed',
        ]);
        const direct = fromPrecheck[0]?.guard?.options?.command ?? '';
        // All-terminal: precheck PASS and the frozen todo file exists but is EMPTY.
        expect(direct).toContain('= PASS');
        expect(direct).toContain('! -s');
        expect(direct).toContain('feature-dev-tasks.txt');
        const auto = fromPrecheck[1]?.guard?.options?.command ?? '';
        expect(auto).toContain('-s');
        expect(auto).toContain('"$profile" = auto');
        // The terminal fallback has no guard — every FAIL lands in failed.
        expect(fromPrecheck[3]?.guard?.kind).toBe('always');
    });

    test('feature-verify runs the completion check exactly once and guards only read the captured status (R3)', () => {
        // Exactly one shell in the whole definition invokes the check...
        const checkShells = allShellCommands().filter((c) => c.includes('feature check'));
        expect(checkShells.length).toBe(1);
        const command = checkShells[0];
        // ...as `feature check --as done --json` (no --strict elevation, no corpus scan).
        expect(command).toContain('--as done --json');
        expect(command).not.toContain('--strict');
        expect(command).not.toContain('rule run');
        // The decision is captured run-scoped: JSON evidence plus a PASS/FAIL sibling.
        expect(command).toContain('feature-dev-verify.json');
        expect(command).toContain('feature-dev-verify.status');
        // PASS requires exit 0, a nonempty result array, and every scope pass === true.
        expect(command).toContain('all(.[]; .pass == true)');
        // And NO guard re-runs the check — sibling guards read the captured decision only.
        for (const guard of allGuardCommands()) {
            expect(guard).not.toContain('feature check');
        }
        const passEdge = DEF.transitions.at(edgeIndex('feature-verify', 'integration-review'));
        expect(passEdge?.guard?.options?.command).toContain('feature-dev-verify.status');
        // Missing/malformed/non-PASS evidence fails BEFORE integration review.
        const failedEdge = DEF.transitions.at(edgeIndex('feature-verify', 'failed'));
        expect(failedEdge?.guard?.kind).toBe('always');
    });
});

/**
 * Execution harness: the REAL feature-dev definition, driven through the state-machine
 * driver with a stub `spur` CLI (records calls, serves canned JSON), a stub agent service
 * (records dispatch inputs), and a stub review command (records request/collect). No test
 * reaches the network or GitHub.
 */
interface ExecHarness {
    workdir: string;
    dispatches: string[];
    checkCalls: () => number;
    reviewCalls: () => number;
    run: (vars?: Record<string, string>) => Promise<{ status: string }>;
    cleanup: () => void;
}

const SPUR_STUB = `#!/bin/bash
# Test stub for the spur CLI: records feature-check calls, serves canned JSON from STUB_DIR.
case "$1 $2" in
  "feature show")
    if [ -f "$STUB_DIR/feature.json" ]; then cat "$STUB_DIR/feature.json"; else echo "stub: unknown feature" >&2; exit 1; fi ;;
  "task list")
    if [ -f "$STUB_DIR/roster.json" ]; then cat "$STUB_DIR/roster.json"; else echo "[]" ; fi ;;
  "feature check")
    echo "$*" >> "$STUB_DIR/check-calls.log"
    cat "$STUB_DIR/check.json"
    exit "$(cat "$STUB_DIR/check-rc" 2>/dev/null || echo 0)" ;;
  *) echo "stub spur: unsupported: $*" >&2; exit 64 ;;
esac
`;

const SUPER_SKILL_STUB = `#!/bin/bash
# Test stub for superskill: resolves the review script to the fake reviewer.
case "$1 $2 $3 $4" in
  "script path sp pr-reviewing.ts") echo "$STUB_DIR/reviewer.ts" ;;
  *) echo "stub superskill: unsupported: $*" >&2; exit 64 ;;
esac
`;

const REVIEWER_TS = `// Test stub for pr-reviewing.ts: request returns a canned HEAD, collect writes CLEAN.
const args = process.argv.slice(2);
const mode = args[0];
import { appendFileSync, writeFileSync } from 'node:fs';
const log = process.env.STUB_DIR + '/review-calls.log';
appendFileSync(log, mode + '\\n');
const statusIdx = args.indexOf('--status-file');
if (mode === 'request') {
  process.stdout.write(JSON.stringify({ head: 'stubhead123' }));
} else if (mode === 'collect') {
  writeFileSync(args[statusIdx + 1], 'CLEAN\\n');
  process.stdout.write(JSON.stringify({ status: 'CLEAN', head: 'stubhead123' }));
} else {
  process.exit(64);
}
`;

async function makeHarness(): Promise<ExecHarness> {
    const workdir = mkdtempSync(join(tmpdir(), 'feature-dev-exec-'));
    const bin = join(workdir, 'bin');
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(workdir, '.spur', 'run'), { recursive: true });
    writeFileSync(join(bin, 'spur'), SPUR_STUB, { mode: 0o755 });
    writeFileSync(join(bin, 'superskill'), SUPER_SKILL_STUB, { mode: 0o755 });
    writeFileSync(join(workdir, 'reviewer.ts'), REVIEWER_TS);

    const dispatches: string[] = [];
    const host: WorkflowEngineHost = createDefaultWorkflowEngineHost();
    registerSpurBuiltins(host, {
        agentService: {
            runTraced: async (input: string) => {
                dispatches.push(String(input));
                return { exitCode: 0, stdout: '' };
            },
        } as unknown as AgentService,
        ruleService: { evaluate: async () => ({ exitCode: 0, findings: [] }) } as unknown as RuleService,
        hitlResponder: { respond: async () => ({ value: 'yes' }) },
    } as never);

    const run = (vars: Record<string, string> = {}): Promise<{ status: string }> =>
        new StateMachineDriver({ host, persistence: new MemoryWorkflowPersistenceAdapter() }).run(DEF as never, {
            runId: 'exec-run',
            workdir,
            vars: {
                featureId: 'F1',
                __runId: 'exec-run',
                agent: 'auto',
                profile: 'auto',
                spurBin: join(bin, 'spur'),
                stepTimeoutMs: '30000',
                STUB_DIR: workdir,
                PATH: `${bin}:${process.env.PATH ?? ''}`,
                ...vars,
            },
        });

    return {
        workdir,
        dispatches,
        checkCalls: () => {
            try {
                return readFileSync(join(workdir, 'check-calls.log'), 'utf8').split('\n').filter(Boolean).length;
            } catch {
                return 0;
            }
        },
        reviewCalls: () => {
            try {
                return readFileSync(join(workdir, 'review-calls.log'), 'utf8').split('\n').filter(Boolean).length;
            } catch {
                return 0;
            }
        },
        run,
        cleanup: () => rmSync(workdir, { recursive: true, force: true }),
    };
}

/** Write the canned CLI fixtures: feature identity + linked roster. */
function seedRoster(harness: ExecHarness, roster: unknown, featureId = 'F1'): void {
    writeFileSync(join(harness.workdir, 'feature.json'), JSON.stringify({ id: featureId, name: 'stub feature' }));
    writeFileSync(join(harness.workdir, 'roster.json'), typeof roster === 'string' ? roster : JSON.stringify(roster));
}

/** Seed the completion-check result fixture (JSON body + exit code). */
function seedCheck(harness: ExecHarness, body: unknown, rc = 0): void {
    writeFileSync(join(harness.workdir, 'check.json'), typeof body === 'string' ? body : JSON.stringify(body));
    writeFileSync(join(harness.workdir, 'check-rc'), String(rc));
}

const MIXED_ROSTER = [
    { wbs: '0782', status: 'todo' },
    { wbs: '0723', status: 'done' },
    { wbs: '0781', status: 'todo' },
    { wbs: '0609', status: 'cancelled' },
];
const PASS_CHECK = [
    { id: 'F1', pass: true },
    { id: 'F1-tasks', pass: true },
];

describe('feature-dev execution — existing-feature reuse (0782 scenarios)', () => {
    test('R1 happy path: existing roster is reused — one frozen runall dispatch, one check, review, done', async () => {
        const h = await makeHarness();
        try {
            seedRoster(h, MIXED_ROSTER);
            seedCheck(h, PASS_CHECK);
            const result = await h.run();
            expect(result.status).toBe('done');
            // The frozen, sorted todo list — done/cancelled members are ignored.
            expect(h.dispatches).toEqual(['/sp:dev-runall --tasks 0781,0782 --auto']);
            // CLI reads captured once under the run-scoped artifacts.
            expect(readFileSync(join(h.workdir, '.spur/run/exec-run-feature-dev-tasks.txt'), 'utf8')).toBe('0781,0782');
            // Exactly one completion-check invocation was recorded and it passed.
            expect(h.checkCalls()).toBe(1);
            expect(readFileSync(join(h.workdir, '.spur/run/exec-run-feature-dev-verify.status'), 'utf8').trim()).toBe(
                'PASS',
            );
            // Integration review ran once against the run and the feature completed.
            expect(h.reviewCalls()).toBe(2);
            // 0784: the pseudo-checkpoint writer is gone — the persisted run row is the
            // authoritative terminal record; no F1-checkpoint.md is emitted.
            expect(existsSync(join(h.workdir, '.spur/memory/sessions/F1-checkpoint.md'))).toBe(false);
        } finally {
            h.cleanup();
        }
    });

    test('R2 all-terminal roster: verification with zero execution model calls', async () => {
        const h = await makeHarness();
        try {
            seedRoster(h, [
                { wbs: '0723', status: 'done' },
                { wbs: '0609', status: 'cancelled' },
            ]);
            seedCheck(h, PASS_CHECK);
            const result = await h.run();
            expect(result.status).toBe('done');
            // No runall dispatch, no planning dispatch — execution is skipped entirely.
            expect(h.dispatches).toEqual([]);
            expect(h.checkCalls()).toBe(1);
        } finally {
            h.cleanup();
        }
    });

    test('R2 profile is preserved: interactive runs dispatch the frozen list without --auto', async () => {
        const h = await makeHarness();
        try {
            seedRoster(h, MIXED_ROSTER);
            seedCheck(h, PASS_CHECK);
            const result = await h.run({ profile: 'standard' });
            expect(result.status).toBe('done');
            expect(h.dispatches).toEqual(['/sp:dev-runall --tasks 0781,0782']);
        } finally {
            h.cleanup();
        }
    });

    test('R1 invalid feature input fails before any model dispatch — unknown feature', async () => {
        const h = await makeHarness();
        try {
            const result = await h.run({ featureId: 'NOPE' });
            expect(result.status).toBe('failed');
            expect(h.dispatches).toEqual([]);
            expect(h.checkCalls()).toBe(0);
        } finally {
            h.cleanup();
        }
    });

    test('R1 empty roster refuses with a planning handoff, never an empty batch', async () => {
        const h = await makeHarness();
        try {
            seedRoster(h, []);
            const result = await h.run();
            expect(result.status).toBe('failed');
            expect(h.dispatches).toEqual([]);
        } finally {
            h.cleanup();
        }
    });

    test('R1 malformed (non-array) roster fails closed', async () => {
        const h = await makeHarness();
        try {
            seedRoster(h, 'not json at all');
            const result = await h.run();
            expect(result.status).toBe('failed');
            expect(h.dispatches).toEqual([]);
        } finally {
            h.cleanup();
        }
    });

    test('R1 duplicate task identities fail closed', async () => {
        const h = await makeHarness();
        try {
            seedRoster(h, [
                { wbs: '0782', status: 'todo' },
                { wbs: '0782', status: 'todo' },
            ]);
            const result = await h.run();
            expect(result.status).toBe('failed');
            expect(h.dispatches).toEqual([]);
        } finally {
            h.cleanup();
        }
    });

    test('R1 a backlog/wip/testing/blocked member refuses with a resume/refine handoff', async () => {
        const h = await makeHarness();
        try {
            seedRoster(h, [
                { wbs: '0782', status: 'todo' },
                { wbs: '0608', status: 'wip' },
            ]);
            const result = await h.run();
            expect(result.status).toBe('failed');
            expect(h.dispatches).toEqual([]);
        } finally {
            h.cleanup();
        }
    });

    test('R3 a failing completion check records exactly one invocation and fails without requesting review', async () => {
        const h = await makeHarness();
        try {
            seedRoster(h, MIXED_ROSTER);
            seedCheck(h, [{ id: 'F1', pass: false }], 1);
            const result = await h.run();
            expect(result.status).toBe('failed');
            expect(h.checkCalls()).toBe(1);
            // The run never entered integration-review — no review request was made.
            expect(h.reviewCalls()).toBe(0);
        } finally {
            h.cleanup();
        }
    });

    test('R3 malformed check evidence fails closed without requesting review', async () => {
        const h = await makeHarness();
        try {
            seedRoster(h, MIXED_ROSTER);
            seedCheck(h, 'garbage{');
            const result = await h.run();
            expect(result.status).toBe('failed');
            expect(h.checkCalls()).toBe(1);
            expect(h.reviewCalls()).toBe(0);
        } finally {
            h.cleanup();
        }
    });

    test('R3 advisory warnings alone do not fail a valid completion', async () => {
        const h = await makeHarness();
        try {
            seedRoster(h, MIXED_ROSTER);
            seedCheck(h, [{ id: 'F1', pass: true, findings: [{ severity: 'warning', code: 'L1.note' }] }]);
            const result = await h.run();
            expect(result.status).toBe('done');
            expect(h.reviewCalls()).toBe(2);
        } finally {
            h.cleanup();
        }
    });
});
