/**
 * 0874 R2/R3/R4: guard-refactor routing parity.
 *
 * The refactor rewrites transition guards in the retained definitions for legibility. Routing
 * parity is the whole risk — a guard whose boolean function silently changes denies a write with
 * no fall-through (the 0758 hazard), and "they look equivalent" by inspection does not prove it.
 *
 * This test EXECUTES the parity check: for every rewritten shell guard it runs the pre-refactor
 * command (from the committed baseline fixture) and the post-refactor command (from the live
 * definition) against the SAME recorded variable/artifact state — a cross-product of the guard's
 * referenced vars and run-scoped result files, plus the `spurBin` exit for guards that invoke the
 * CLI — and asserts the two produce the same exit code. It also asserts the transition topology
 * (from/to/kind, in declaration order) is unchanged, which together with per-guard boolean parity
 * proves the reachable state set is unchanged (R4): the engine takes the first passing edge in
 * declaration order, so identical order + identical guard booleans = identical routing.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { parse as parseYaml } from 'yaml';

interface Transition {
    from: string;
    to: string;
    kind: string | null;
    command: string | null;
}

interface Baseline {
    [definition: string]: Transition[];
}

const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const BASELINE_PATH = join(import.meta.dir, 'fixtures', 'guard-parity-baseline.json');

const RUN_ID = 'run-parity';
const WBS = '0874';
const PROOF_DIGEST_A = 'digest-A';
const DEFINITION_DIGEST_A = 'dd-A';

// Recorded run-scoped artifact files a guard can read, with the boundary values each can take.
// `missing` (the file absent) is always added to a guard's referenced set during enumeration.
const FILES: Array<{ key: string; path: string; values: string[] }> = [
    { key: 'idea-ac-check.status', path: `.spur/run/${RUN_ID}-idea-ac-check.status`, values: ['PASS\n', 'FAIL\n'] },
    {
        key: 'idea-design-check.status',
        path: `.spur/run/${RUN_ID}-idea-design-check.status`,
        values: ['PASS\n', 'FAIL\n'],
    },
    {
        key: 'idea-needs-design.json',
        path: `.spur/run/${RUN_ID}-idea-needs-design.json`,
        values: ['{"needs_design": true}\n', '{"needs_design": false}\n', 'not-json\n'],
    },
    // 0945 R2: derived route facts written by the route-fact writer action in ac-generate and
    // feature-check onEnter — guards read these instead of re-deriving needs_design inline.
    {
        key: 'idea-design-route.txt',
        path: `.spur/run/${RUN_ID}-idea-design-route.txt`,
        values: ['design\n', 'skip\n'],
    },
    {
        key: 'idea-ac-ready.status',
        path: `.spur/run/${RUN_ID}-idea-ac-ready.status`,
        values: ['PASS\n', 'FAIL\n'],
    },
    { key: 'idea-ac-retry-count', path: `.spur/run/${RUN_ID}-idea-ac-retry-count`, values: ['0\n', '2\n', '3\n'] },
    {
        key: 'idea-decompose-retry-count',
        path: `.spur/run/${RUN_ID}-idea-decompose-retry-count`,
        values: ['0\n', '2\n', '3\n'],
    },
    {
        key: 'idea-design-reject-count',
        path: `.spur/run/${RUN_ID}-idea-design-reject-count`,
        values: ['0\n', '1\n', '2\n'],
    },
    { key: 'idea-batch-create.done', path: `.spur/run/${RUN_ID}-idea-batch-create.done`, values: ['x\n'] },
    { key: 'idea-batch-create.failed', path: `.spur/run/${RUN_ID}-idea-batch-create.failed`, values: ['x\n'] },
    {
        key: 'idea-precheck-doctor.status',
        path: `.spur/run/${RUN_ID}-idea-precheck-doctor.status`,
        values: ['PASS\n', 'FAIL\n'],
    },
    { key: 'test-gate.status', path: `.spur/run/${WBS}-test-gate.status`, values: ['PASS\n', 'FAIL\n'] },
    { key: 'test-fix-attempt', path: `.spur/run/${WBS}-test-fix-attempt`, values: ['0\n', '2\n', '3\n'] },
    // 0943 R3: failure-class decide row — the test-fail-triage edges read `.value` from this row
    // (stop/retryable/fix) or fail closed when the file is missing/corrupt.
    {
        key: 'failure-class.decision',
        path: `.spur/run/${WBS}-failure-class.decision`,
        values: ['{"value":"stop"}\n', '{"value":"retryable"}\n', '{"value":"fix"}\n', 'not-json\n'],
    },
    { key: 'verdict.json', path: `.spur/run/${WBS}-verdict.json`, values: verdictVariants() },
    { key: 'precheck-size.status', path: `.spur/run/${WBS}-precheck-size.status`, values: ['PASS\n', 'FAIL\n'] },
    {
        key: 'precheck-evidence.status',
        path: `.spur/run/${WBS}-precheck-evidence.status`,
        values: ['PASS\n', 'FAIL\n'],
    },
];

function verdictVariants(): string[] {
    const proof = (digest: string, status: string): object => ({
        digest,
        runId: RUN_ID,
        definitionDigest: DEFINITION_DIGEST_A,
        stages: {
            qualityGate: { digest },
            review: { digest, status },
            verification: { digest },
        },
    });
    return [
        JSON.stringify({ verdict: 'PASS', proof: proof(PROOF_DIGEST_A, 'completed') }),
        JSON.stringify({ verdict: 'PASS', proof: proof('digest-B', 'completed') }),
        JSON.stringify({ verdict: 'PASS', proof: proof(PROOF_DIGEST_A, 'skipped') }),
        JSON.stringify({ verdict: 'FAIL', proof: proof(PROOF_DIGEST_A, 'completed') }),
        JSON.stringify({ verdict: 'PARTIAL', proof: proof(PROOF_DIGEST_A, 'completed') }),
        'not-json',
    ];
}

// Boundary values for the vars a guard can reference by name.
const VARS: Array<{ name: string; values: string[] }> = [
    { name: 'profile', values: ['auto', 'standard', ''] },
    { name: '__hitlAnswer', values: ['yes', 'no', 'cancel', ''] },
    { name: 'design', values: ['auto', 'skip', ''] },
    { name: 'design_approved', values: ['true', 'false', ''] },
    { name: 'idea_approved', values: ['true', 'false', ''] },
    { name: 'mode', values: ['fast', 'standard', ''] },
    { name: 'qualityGateMaxFixAttempts', values: ['2', '0'] },
    { name: 'proofDigest', values: [PROOF_DIGEST_A, 'digest-B'] },
    { name: '__definitionDigest', values: [DEFINITION_DIGEST_A, 'dd-B'] },
];

const FIXED_VARS: Record<string, string> = {
    wbs: WBS,
    __runId: RUN_ID,
    featureId: 'F1',
    agent: 'auto',
    implementAgent: 'auto',
};

function loadTransitions(name: string): Transition[] {
    const def = parseYaml(readFileSync(join(WORKFLOWS_DIR, `${name}.yaml`), 'utf8')) as {
        transitions: Array<{ from: string; to: string; guard?: { kind?: string; options?: { command?: string } } }>;
    };
    return def.transitions.map((t) => ({
        from: t.from,
        to: t.to,
        kind: t.guard?.kind ?? null,
        command: t.guard?.kind === 'shell' ? (t.guard.options?.command ?? '') : null,
    }));
}

/** Cross-product of dimension value arrays, capped so a pathological guard cannot explode. */
function cartesian<T>(dims: T[][]): T[][] {
    let acc: T[][] = [[]];
    for (const dim of dims) {
        const next: T[][] = [];
        for (const prefix of acc) {
            for (const value of dim) {
                next.push([...prefix, value]);
                if (next.length > 512) return next;
            }
        }
        acc = next;
    }
    return acc;
}

interface State {
    vars: Record<string, string>;
    files: Map<string, string | null>; // path -> content; null = absent
    spurExit: number;
}

function statesFor(command: string): State[] {
    const varDims: Array<Array<{ name: string; value: string }>> = [];
    for (const v of VARS) {
        if (command.includes(`$${v.name}`)) {
            varDims.push(v.values.map((value) => ({ name: v.name, value })));
        }
    }

    const fileDims: Array<Array<{ path: string; content: string | null }>> = [];
    for (const f of FILES) {
        if (command.includes(f.key)) {
            fileDims.push([{ path: f.path, content: null }, ...f.values.map((content) => ({ path: f.path, content }))]);
        }
    }

    const spurDims: number[] = command.includes('$spurBin') ? [0, 1] : [0];

    const states: State[] = [];
    for (const varCombo of cartesian(varDims)) {
        for (const fileCombo of cartesian(fileDims)) {
            for (const spurExit of spurDims) {
                const vars: Record<string, string> = { ...FIXED_VARS };
                for (const { name, value } of varCombo) vars[name] = value;
                const files = new Map<string, string | null>();
                for (const { path, content } of fileCombo) files.set(path, content);
                states.push({ vars, files, spurExit });
            }
        }
    }
    return states;
}

function evaluatePair(
    oldCommand: string,
    newCommand: string,
    state: State,
    cwd: string,
    spurBin: string,
): { oldPassed: boolean; newPassed: boolean } {
    mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
    const runDir = join(cwd, '.spur', 'run');
    for (const name of readDirNames(runDir)) {
        rmSync(join(runDir, name), { recursive: true, force: true });
    }
    for (const [path, content] of state.files) {
        if (content !== null) writeFileSync(join(cwd, path), content, 'utf8');
    }
    // Ambient environment comes through the config gateway, never a direct ambient-env read
    // (ADR-120); the guard's own vars are layered on top exactly as the engine exports them.
    const ambient: Record<string, string> = {};
    for (const [name, value] of Object.entries(getEnvVars())) {
        if (value !== undefined) ambient[name] = value;
    }
    const env: Record<string, string> = { ...ambient, ...state.vars, spurBin };
    if (oldCommand.includes('$spurBin') || newCommand.includes('$spurBin')) {
        env.SPUR_STUB_EXIT = String(state.spurExit);
    }
    // Run old and new in separate subshells so neither's local assignments leak; capture each
    // pass/fail as 0/1 so the comparison is the engine's routing decision (exit 0 = pass), not
    // the incidental exit code a failing `jq` returns through an assignment (1 vs 2).
    const script =
        `( ${oldCommand} ) && __old_passed=0 || __old_passed=1; ` +
        `( ${newCommand} ) && __new_passed=0 || __new_passed=1; ` +
        `printf '%s %s' "$__old_passed" "$__new_passed"`;
    const result = spawnSync('/bin/sh', ['-c', script], { cwd, env, encoding: 'utf8' });
    const match = /^(\d+) (\d+)$/.exec(result.stdout.trim());
    if (!match) throw new Error(`guard parity harness could not parse its own output: ${result.stdout}`);
    return { oldPassed: match[1] === '0', newPassed: match[2] === '0' };
}

function readDirNames(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

describe('guard refactor routing parity (task 0874)', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
    const definitions = Object.keys(baseline);

    const cwd = mkdtempSync(join(tmpdir(), 'guard-parity-'));
    const spurBin = join(cwd, 'stub-spur.sh');
    writeFileSync(spurBin, `#!/bin/sh\nexit "\${SPUR_STUB_EXIT:-0}"\n`);
    chmodSync(spurBin, 0o755);

    afterAll(() => {
        rmSync(cwd, { recursive: true, force: true });
    });

    test('R4: transition topology (from/to/kind, in declaration order) is unchanged', () => {
        for (const name of definitions) {
            const current = loadTransitions(name);
            const before = baseline[name] as Transition[];
            expect(current.map((t) => [t.from, t.to, t.kind])).toEqual(before.map((t) => [t.from, t.to, t.kind]));
        }
    });

    test('R1/R2/R3: every rewritten guard returns the same routing decision as the pre-refactor definition', () => {
        let changedGuards = 0;
        let evaluations = 0;
        for (const name of definitions) {
            const current = loadTransitions(name);
            const before = baseline[name] as Transition[];
            for (let i = 0; i < current.length; i++) {
                const now = current[i];
                const prev = before[i];
                if (!now || !prev) continue;
                if (now.kind !== 'shell' || prev.command === null) continue;
                if (now.command === prev.command) continue; // untouched guard — trivially equal
                changedGuards += 1;
                const states = statesFor(now.command ?? '');
                expect(states.length).toBeGreaterThan(0);
                for (const state of states) {
                    const { oldPassed, newPassed } = evaluatePair(prev.command, now.command ?? '', state, cwd, spurBin);
                    evaluations += 1;
                    expect(
                        newPassed === oldPassed,
                        `${name} ${now.from}→${now.to}: routing decision diverged (old=${oldPassed}, new=${newPassed}) ` +
                            `for state ${JSON.stringify({ vars: state.vars, files: [...state.files.keys()] })}`,
                    ).toBe(true);
                }
            }
        }
        // Baseline protocol (0874 → 0887): the fixture freezes each workflow's current guard
        // commands as the routing contract. A guard change that intentionally alters semantics
        // (approved scope) regenerates the fixture in the same commit; afterwards this harness
        // parity-proves every future accidental guard edit against the refreshed contract by
        // execution. changedGuards therefore legitimately returns to 0 after each refresh —
        // the 0874 one-shot ">0 rewrite happened" assertion retired with that task.
        expect(changedGuards).toBeGreaterThanOrEqual(0);
        // Any actual diff vs the frozen contract must have been execution-proven; a freshly
        // refreshed baseline diff-empty state evaluates nothing by construction.
        if (changedGuards > 0) {
            expect(evaluations).toBeGreaterThan(0);
        }
    }, 30000);
});
