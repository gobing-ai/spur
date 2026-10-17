/**
 * task-pipeline evidence chain (D65 1239, ADR-140).
 *
 * RE-KEYED, not replaced: this suite used to pin the ADR-071 proof chain (one canonical
 * `proofDigest`, `proof.fingerprint` captures at quality-gate/review/verify entry, digest-bound
 * receipt preconditions, the `run.artifact` verdict registration). Task 1239 removed that chain
 * and this file now pins the evidence model that replaced it, on the same structural discipline:
 *
 * - the run's evidence is the tree-hash gate receipt (`spur task gate` writes
 *   `.spur/run/<wbs>-check-receipt.json` keyed by the git tree it captures itself, D65 R11), the
 *   review verdict artifact (`spur task verdict --from-answer` over the reviewer's requirement
 *   traceability, D65 R2), and the status tokens the transitions read;
 * - nothing reads a proof digest; the retired names must not come back silently;
 * - every guard is EXECUTED against staged artifacts (the 0943/0874 discipline), so a guard whose
 *   boolean silently changes fails here.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { parse as parseYaml } from 'yaml';

interface Action {
    kind: string;
    options?: Record<string, unknown>;
}
interface Guard {
    kind: string;
    options?: { command?: string };
}
interface Transition {
    from: string;
    to: string;
    terminalReason?: string;
    description?: string;
    guard?: Guard;
}
interface StateDef {
    id: string;
    description?: string;
    pause?: boolean;
    onEnter?: Action[];
}
interface WorkflowDef {
    name: string;
    version: string;
    iterationBound?: number;
    initialState?: string;
    terminalStates?: string[];
    failureStates?: string[];
    vars?: Record<string, string>;
    states: StateDef[];
    transitions: Transition[];
}

// The 'config' segment is split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8')) as WorkflowDef;

const SPUR_CLI = [process.execPath, join(import.meta.dir, '../../../../apps/cli/src/index.ts')];
const SPUR_BIN = SPUR_CLI.join(' ');

/** The literal YAML var template (`${vars.x}`) the definition carries — asserted, never interpolated. */
const VAR = (name: string): string => ['$', '{vars.', name, '}'].join('');

const stateOf = (id: string): StateDef | undefined => DEF.states.find((s) => s.id === id);
const actionsOf = (id: string): Action[] => stateOf(id)?.onEnter ?? [];
const kindsOf = (id: string): string[] => actionsOf(id).map((a) => a.kind);
const actionOf = (id: string, kind: string, needle?: string): Action | undefined =>
    actionsOf(id).find(
        (a) => a.kind === kind && (needle === undefined || JSON.stringify(a.options ?? {}).includes(needle)),
    );
const cmdOf = (id: string, needle: string): string => {
    const action = actionOf(id, 'shell', needle);
    if (action === undefined) throw new Error(`no shell in ${id} mentioning ${needle}`);
    return String(action.options?.command ?? '');
};
const guardOf = (from: string, to: string, index = 0): string => {
    const edges = DEF.transitions.filter((t) => t.from === from && t.to === to);
    return edges[index]?.guard?.options?.command ?? '';
};

/** Run a shell in `dir` with the workflow vars exported as the engine exports them. */
function runSh(
    script: string,
    cwd: string,
    vars: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
    const run = Bun.spawnSync(['sh', '-c', script], {
        cwd,
        env: { ...getEnvVars(), ...vars },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { code: run.exitCode ?? -1, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** First passing edge in declaration order — the engine's routing decision. */
function firstPassingEdge(from: string, cwd: string, vars: Record<string, string>): string {
    for (const edge of DEF.transitions.filter((t) => t.from === from)) {
        if (edge.guard?.kind === 'always') return edge.to;
        if (edge.guard?.kind !== 'shell') continue;
        if (runSh(edge.guard.options?.command ?? '', cwd, vars).code === 0) return edge.to;
    }
    throw new Error(`no passing edge out of ${from} — the run would hang`);
}

/** Run the source CLI in `dir`; throws on a non-zero exit. */
function spurIn(dir: string, args: string[]): string {
    const run = Bun.spawnSync([...SPUR_CLI, ...args, '--no-logo'], {
        cwd: dir,
        env: { ...getEnvVars() },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (run.exitCode !== 0) throw new Error(`spur ${args.join(' ')} failed: ${run.stderr.toString()}`);
    return run.stdout.toString();
}

/** A staged project: a real git repo with one tracked file and a created task. */
function stage(): { dir: string; wbs: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'tp-evidence-'));
    const git = (args: string[]): void => {
        const run = Bun.spawnSync(['git', ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
        if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
    };
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'test']);
    // The gate's receipt is keyed by the tracked tree, and the real project gitignores `.spur/`
    // (run artifacts must not move the tree hash) — mirror that here.
    writeFileSync(join(dir, '.gitignore'), '.spur/\n');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.ts'), 'export const start = 1;\n');
    git(['add', '.']);
    git(['commit', '-qm', 'base']);
    const created = JSON.parse(spurIn(dir, ['task', 'create', '--skip-ready', 'Evidence fixture', '--json'])) as {
        wbs: string;
    };
    return { dir, wbs: created.wbs, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Replace one task section body through the CLI (the reviewer's write path). */
function setSection(dir: string, wbs: string, section: string, body: string): void {
    const path = join(dir, `${section}-body.md`);
    writeFileSync(path, body);
    spurIn(dir, ['task', 'update', wbs, '--section', section, '--from-file', path]);
}

const REVIEW_HEAD = '| Priority | Finding | Location | Disposition |\n| --- | --- | --- | --- |\n';

/** Write the reviewer's answer and return its path (the pipeline's answerFile). */
function writeReviewAnswer(dir: string, runId: string, body: string): string {
    mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
    const path = join(dir, '.spur/run', `${runId}-review-answer.txt`);
    writeFileSync(path, body);
    return path;
}

/**
 * Execute a typed `command.gate` exactly as the engine does: run the argv, then write the typed
 * token (PASS|FAIL|BLOCKED from the exit code) to the result file (1234 §3.3).
 */
function runTypedGate(
    dir: string,
    resultFile: string,
    args: string[],
    vars: Record<string, string> = {},
): 'PASS' | 'FAIL' | 'BLOCKED' {
    const run = Bun.spawnSync([...SPUR_CLI, ...args, '--no-logo'], {
        cwd: dir,
        env: { ...getEnvVars(), ...vars },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const code = run.exitCode ?? -1;
    const token = code === 0 ? 'PASS' : code === 1 ? 'FAIL' : 'BLOCKED';
    mkdirSync(join(dir, '.spur/run'), { recursive: true });
    writeFileSync(join(dir, resultFile), `${token}\n`);
    return token;
}

describe('task-pipeline evidence chain — the proof chain is retired (D65 1239 R3)', () => {
    test('the graph is the six working states plus the two terminals', () => {
        expect(DEF.states.map((s) => s.id)).toEqual([
            'precheck',
            'implement',
            'escalate',
            'gate',
            'remediate',
            'review',
            'done',
            'failed',
        ]);
        expect(DEF.terminalStates).toEqual(['done', 'failed']);
        expect(DEF.failureStates).toEqual(['failed']);
        expect(DEF.initialState).toBe('precheck');
        expect(DEF.version).toBe('9');
    });

    test('no working state keeps the retired id it replaced', () => {
        for (const retired of [
            'test',
            'test-recheck',
            'test-fix',
            'triage',
            'test-fail-triage',
            'review-fail-triage',
            'approve',
            'verify',
            'record',
            'cancelled',
        ]) {
            expect(stateOf(retired), `${retired} must be gone`).toBeUndefined();
        }
    });

    test('no proof-chain action, option or variable survives anywhere in the definition', () => {
        for (const state of DEF.states) {
            for (const action of state.onEnter ?? []) {
                expect(action.kind, state.id).not.toBe('proof.fingerprint');
                expect(action.kind, state.id).not.toBe('run.artifact');
                const serialized = JSON.stringify(action.options ?? {});
                for (const retired of ['proofDigest', 'proofDigestNow', 'verifiedOutcome', 'taskSpecPathNow']) {
                    expect(serialized.includes(retired), `${state.id}: ${retired}`).toBe(false);
                }
            }
        }
        for (const retired of ['proofDigest', 'proofDigestNow', 'featureSpecPath', '__definitionDigest']) {
            expect(DEF.vars?.[retired], `${retired} var`).toBeUndefined();
        }
        // The one surviving declaration is the task spec path the decide evidence names.
        expect(DEF.vars?.taskSpecPath).toBe('');
    });

    test('no transition and no guard carries the proof vocabulary or a receipt precondition', () => {
        for (const edge of DEF.transitions) {
            const serialized = JSON.stringify(edge);
            for (const retired of ['proof', 'proofDigest', 'verifiedOutcome']) {
                expect(serialized.toLowerCase().includes(retired.toLowerCase()), `${edge.from}→${edge.to}`).toBe(false);
            }
        }
    });

    test('no state pauses: the only pause in a run is the host executor transform (1232)', () => {
        expect(DEF.states.filter((s) => s.pause === true).map((s) => s.id)).toEqual([]);
    });
});

describe('task-pipeline evidence chain — the gate state owns the quality gate (D65 R2)', () => {
    test('one typed command.gate over `spur task gate`, mode by visit, soft outcome', () => {
        const gates = DEF.states.flatMap((s) => (s.onEnter ?? []).map((a) => ({ state: s.id, action: a })));
        const qualityGate = gates.filter(({ action }) => {
            const args = action.options?.args;
            return Array.isArray(args) && args[0] === 'task' && args[1] === 'gate';
        });
        expect(qualityGate.map((g) => g.state)).toEqual(['gate']);
        const options = qualityGate[0]?.action.options as Record<string, unknown> | undefined;
        expect(options?.id).toBe('quality-gate');
        expect(options?.executable).toBe(VAR('spurBin'));
        expect(options?.args).toEqual(['task', 'gate', VAR('wbs'), VAR('gateMode'), '--no-logo']);
        expect(options?.resultFile).toBe(`.spur/run/${VAR('__runId')}-gate.status`);
        expect(options?.softFail).toBe(true);
        // Nothing else in the graph shells out to the gate.
        for (const state of DEF.states) {
            for (const action of state.onEnter ?? []) {
                if (state.id === 'gate') continue;
                expect(JSON.stringify(action.options ?? {}).includes('task gate'), state.id).toBe(false);
            }
        }
    });

    test('behavioral: the visit counter selects run, then recheck, then honours the deferred policy', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tp-gate-mode-'));
        try {
            const vars = { wbs: '1239', __runId: 'run-mode', deferQualityGate: 'false' };
            const bump = cmdOf('gate', 'gate-visit.txt');
            const select = cmdOf('gate', '-gate-mode.txt');
            const modeNow = (): string => readFileSync(join(dir, '.spur/run', '1239-gate-mode.txt'), 'utf8').trim();
            expect(runSh(bump, dir, vars).code).toBe(0);
            expect(runSh(select, dir, vars).code).toBe(0);
            expect(modeNow()).toBe('run');
            for (const expected of ['recheck', 'recheck']) {
                expect(runSh(bump, dir, vars).code).toBe(0);
                expect(runSh(select, dir, vars).code).toBe(0);
                expect(modeNow()).toBe(expected);
            }
            // The opt-in batch policy outranks the visit: the light tier writes the DEFERRED token.
            expect(runSh(bump, dir, { ...vars, deferQualityGate: 'true' }).code).toBe(0);
            expect(runSh(select, dir, { ...vars, deferQualityGate: 'true' }).code).toBe(0);
            expect(modeNow()).toBe('deferred');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a green visit requires BOTH the typed PASS and the gate own full-tier PASS token', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tp-gate-pass-'));
        try {
            const vars = { wbs: '1239', __runId: 'run-pass', deferQualityGate: 'false' };
            const guard = guardOf('gate', 'review', 0);
            const write = (typed: string, token: string): void => {
                mkdirSync(join(dir, '.spur/run'), { recursive: true });
                writeFileSync(join(dir, '.spur/run', 'run-pass-gate.status'), typed);
                writeFileSync(join(dir, '.spur/run', '1239-test-gate.status'), token);
            };
            write('PASS\n', 'PASS\n');
            expect(runSh(guard, dir, vars).code).toBe(0);
            // A red gate, a blocked visit, and a stale PASS without the typed PASS all refuse review.
            write('PASS\n', 'FAIL\n');
            expect(runSh(guard, dir, vars).code).not.toBe(0);
            write('FAIL\n', 'PASS\n');
            expect(runSh(guard, dir, vars).code).not.toBe(0);
            write('BLOCKED\n', 'PASS\n');
            expect(runSh(guard, dir, vars).code).not.toBe(0);
            // 1111 R2: DEFERRED rides only under the opt-in policy, on its own edge.
            const deferredGuard = guardOf('gate', 'review', 1);
            write('PASS\n', 'DEFERRED\n');
            expect(runSh(deferredGuard, dir, vars).code).not.toBe(0);
            expect(runSh(deferredGuard, dir, { ...vars, deferQualityGate: 'true' }).code).toBe(0);
            expect(runSh(guard, dir, { ...vars, deferQualityGate: 'true' }).code).not.toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a BLOCKED visit routes to failed before any failure-class edge can claim it', () => {
        const edges = DEF.transitions.filter((t) => t.from === 'gate').map((t) => t.to);
        // PASS (×2) first, then the blocked edge, then stop/cap/fix/defense.
        expect(edges).toEqual(['review', 'review', 'failed', 'failed', 'failed', 'remediate', 'failed']);
        const dir = mkdtempSync(join(tmpdir(), 'tp-gate-blocked-'));
        try {
            mkdirSync(join(dir, '.spur/run'), { recursive: true });
            writeFileSync(join(dir, '.spur/run', 'run-b-gate.status'), 'BLOCKED\n');
            const vars = { wbs: '1239', __runId: 'run-b', qualityGateMaxFixAttempts: '2' };
            expect(firstPassingEdge('gate', dir, vars)).toBe('failed');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('behavioral: a failed gate routes to remediate, which bumps the counter and re-gates in recheck', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tp-gate-loop-'));
        try {
            mkdirSync(join(dir, '.spur/run'), { recursive: true });
            const vars = {
                wbs: '1239',
                __runId: 'run-loop',
                qualityGateMaxFixAttempts: '2',
                deferQualityGate: 'false',
                mutationPolicy: 'code',
                spurBin: SPUR_BIN,
            };
            // Visit 1: run, red.
            runSh(cmdOf('gate', 'gate-visit.txt'), dir, vars);
            runSh(cmdOf('gate', '-gate-mode.txt'), dir, vars);
            expect(readFileSync(join(dir, '.spur/run', '1239-gate-mode.txt'), 'utf8').trim()).toBe('run');
            writeFileSync(join(dir, '.spur/run', 'run-loop-gate.status'), 'FAIL\n');
            writeFileSync(join(dir, '.spur/run', '1239-test-gate.status'), 'FAIL\n');
            writeFileSync(join(dir, '.spur/run', '1239-test-fix-attempt'), '0\n');
            writeFileSync(join(dir, '.spur/run', '1239-failure-class.decision'), '{"value":"fix"}\n');
            expect(firstPassingEdge('gate', dir, vars)).toBe('remediate');
            // The remediation hop counts its attempt (its own onEnter shell, spur-free actions).
            runSh(cmdOf('remediate', 'test-fix-attempt'), dir, vars);
            expect(readFileSync(join(dir, '.spur/run', '1239-test-fix-attempt'), 'utf8').trim()).toBe('1');
            // Re-entry re-gates: the visit counter now selects the recheck mode.
            runSh(cmdOf('gate', 'gate-visit.txt'), dir, vars);
            runSh(cmdOf('gate', '-gate-mode.txt'), dir, vars);
            expect(readFileSync(join(dir, '.spur/run', '1239-gate-mode.txt'), 'utf8').trim()).toBe('recheck');
            // And a still-red gate cannot reach review.
            writeFileSync(join(dir, '.spur/run', 'run-loop-gate.status'), 'FAIL\n');
            expect(firstPassingEdge('gate', dir, vars)).toBe('remediate');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('R11 behavioral: a PASS receipt keyed by the unchanged tree is reused, and a code edit invalidates it', () => {
        const staged = stage();
        try {
            const vars = { qualityGateCmd: 'true', gateProbeCmd: '' };
            const gateRun = (): { token: string; stdout: string } => {
                const run = Bun.spawnSync(
                    [...SPUR_CLI, 'task', 'gate', staged.wbs, 'run', '--cmd', 'true', '--probe-cmd', '', '--no-logo'],
                    {
                        cwd: staged.dir,
                        env: {
                            ...getEnvVars(),
                            qualityGateCmd: vars.qualityGateCmd,
                            gateProbeCmd: vars.gateProbeCmd,
                            SPUR_GATE_LOCK_DIR: join(staged.dir, '.lock'),
                        },
                        stdout: 'pipe',
                        stderr: 'pipe',
                    },
                );
                return { token: run.exitCode === 0 ? 'PASS' : 'FAIL', stdout: run.stdout.toString() };
            };
            // First visit: the gate runs and binds a receipt to the tree it captured.
            expect(gateRun().token).toBe('PASS');
            const receipt = JSON.parse(
                readFileSync(join(staged.dir, '.spur/run', `${staged.wbs}-check-receipt.json`), 'utf8'),
            ) as { status: string; inputDigest?: string; tier?: string; wbs?: string };
            expect(receipt.status).toBe('PASS');
            expect(receipt.tier).toBe('full');
            expect(receipt.wbs).toBe(staged.wbs);
            expect(receipt.inputDigest?.length ?? 0).toBeGreaterThan(0);

            // Second visit on the same tree: the receipt is reused, the check does not run.
            const reused = gateRun();
            expect(reused.token).toBe('PASS');
            expect(reused.stdout).toContain('check.reused');
            expect(readFileSync(join(staged.dir, '.spur/run', `${staged.wbs}-test-gate.log`), 'utf8')).toContain(
                'check.reused',
            );

            // A tracked code edit moves the tree, so the receipt is no longer this tree's evidence.
            writeFileSync(join(staged.dir, 'src/index.ts'), 'export const start = 2;\n');
            const rerun = gateRun();
            expect(rerun.token).toBe('PASS');
            expect(rerun.stdout).not.toContain('check.reused');
        } finally {
            staged.cleanup();
        }
    }, 30000);
});

describe('task-pipeline evidence chain — review certifies (D65 R2)', () => {
    test('the certification order is pinned: review → verdict → status → failure class → approval', () => {
        expect(kindsOf('review')).toEqual(['agent.run', 'command.gate', 'shell', 'decide', 'hitl.confirm', 'shell']);
        const options = actionOf('review', 'agent.run')?.options as Record<string, unknown> | undefined;
        expect(String(options?.input)).toContain(`/sp:dev-review --tasks ${VAR('wbs')} --auto`);
        // 0943 R1/R2: the resolved lane sets the review depth (fast  functional-only).
        expect(String(options?.input)).toContain(`--focus ${VAR('reviewFocus')}`);
        expect(options?.freshSession).toBe(true);
        expect(options?.role).toBe('reviewer');
        expect(options?.compareExecutorWith).toBe('implement');
        const verdict = actionOf('review', 'command.gate')?.options as Record<string, unknown> | undefined;
        expect(verdict?.args).toEqual([
            'task',
            'verdict',
            VAR('wbs'),
            '--from-answer',
            `.spur/run/${VAR('__runId')}-review-answer.txt`,
        ]);
        expect(verdict?.softFail).toBe(true);
    });

    test('behavioral: MET rows certify PASS; an UNMET requirement cannot certify, so done is unreachable', () => {
        const staged = stage();
        try {
            setSection(staged.dir, staged.wbs, 'Requirements', '- [ ] R1. Do the thing.\n- [ ] R2. Do both.\n');
            setSection(
                staged.dir,
                staged.wbs,
                'Review',
                `${REVIEW_HEAD}| P4 (advisory) | Note | src/index.ts:1 | ACCEPTED |\n`,
            );
            const vars = { wbs: staged.wbs, __runId: 'run-cert', spurBin: SPUR_BIN, profile: 'auto' };
            const fold = cmdOf('review', '-review.status');
            const statusNow = (): string =>
                readFileSync(join(staged.dir, '.spur/run', `${staged.wbs}-review.status`), 'utf8').trim();

            // A review that finds R2 UNMET derives FAIL, folds FAIL, and never reaches the close.
            writeReviewAnswer(
                staged.dir,
                'run-cert',
                'Verdict: PASS\n\n| Req | Status | Evidence |\n| --- | --- | --- |\n' +
                    '| R1 | MET | `src/index.ts:1` does the thing |\n' +
                    '| R2 | UNMET | nothing implements the second half |\n',
            );
            const unmet = runTypedGate(
                staged.dir,
                '.spur/run/run-cert-review-verdict.status',
                ['task', 'verdict', staged.wbs, '--from-answer', `.spur/run/run-cert-review-answer.txt`],
                vars,
            );
            expect(unmet).toBe('FAIL');
            expect(
                JSON.parse(readFileSync(join(staged.dir, '.spur/run', `${staged.wbs}-verdict.json`), 'utf8')).verdict,
            ).toBe('FAIL');
            expect(runSh(fold, staged.dir, vars).code).toBe(0);
            expect(statusNow()).toBe('FAIL');
            writeFileSync(join(staged.dir, '.spur/run', `${staged.wbs}-approval.status`), 'APPROVED\n');
            expect(firstPassingEdge('review', staged.dir, vars)).not.toBe('done');

            // The same reviewer, every requirement MET, certifies and the close is reachable.
            writeReviewAnswer(
                staged.dir,
                'run-cert',
                'Verdict: PASS\n\n| Req | Status | Evidence |\n| --- | --- | --- |\n' +
                    '| R1 | MET | `src/index.ts:1` does the thing |\n' +
                    '| R2 | MET | `src/index.ts:2` does both |\n',
            );
            expect(
                runTypedGate(
                    staged.dir,
                    '.spur/run/run-cert-review-verdict.status',
                    ['task', 'verdict', staged.wbs, '--from-answer', `.spur/run/run-cert-review-answer.txt`],
                    vars,
                ),
            ).toBe('PASS');
            expect(runSh(fold, staged.dir, vars).code).toBe(0);
            expect(statusNow()).toBe('PASS');
            expect(firstPassingEdge('review', staged.dir, vars)).toBe('done');

            // 1122: the same fold refuses a PASS whose review still carries an open P1-P3 finding.
            setSection(
                staged.dir,
                staged.wbs,
                'Review',
                `${REVIEW_HEAD}| P2 (major) | Missing validation | src/index.ts:8 | OPEN |\n`,
            );
            expect(runSh(fold, staged.dir, vars).code).toBe(0);
            expect(statusNow()).toBe('FAIL');
        } finally {
            staged.cleanup();
        }
    }, 60000);

    test('behavioral: the close re-asserts the certified verdict after the residual fold', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tp-close-verdict-'));
        try {
            mkdirSync(join(dir, '.spur/run'), { recursive: true });
            const reassert = cmdOf('done', 'jq -e');
            const write = (verdict: string): void =>
                writeFileSync(join(dir, '.spur/run', '1239-verdict.json'), `${JSON.stringify({ verdict })}\n`);
            write('PASS');
            expect(runSh(reassert, dir, { wbs: '1239' }).code).toBe(0);
            // A residual downgrade rewrites the artifact PARTIAL/FAIL — the close blocks.
            for (const downgraded of ['PARTIAL', 'FAIL']) {
                write(downgraded);
                expect(runSh(reassert, dir, { wbs: '1239' }).code, downgraded).not.toBe(0);
            }
            // A missing artifact is not a certification either.
            rmSync(join(dir, '.spur/run', '1239-verdict.json'));
            expect(runSh(reassert, dir, { wbs: '1239' }).code).not.toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the close owns the former record stage in declaration order (D65 R3)', () => {
        // record → feature sync → residual scan+fold → re-record → verdict re-assert → settle →
        // update done → checkpoint.
        expect(kindsOf('done')).toEqual([
            'command.gate',
            'shell',
            'shell',
            'shell',
            'shell',
            'shell',
            'command.gate',
            'shell',
        ]);
        const args = (kind: string): string => JSON.stringify(actionOf('done', kind)?.options ?? {});
        const gates = actionsOf('done').filter((a) => a.kind === 'command.gate');
        expect(JSON.stringify(gates[0]?.options)).toContain('"record"');
        expect(JSON.stringify(gates[0]?.options)).toContain('--solution-from-diff');
        expect(JSON.stringify(gates[0]?.options)).toContain('"testing"');
        expect(JSON.stringify(gates[1]?.options)).toContain('"done"');
        expect(args('command.gate')).toContain('--no-lifecycle');
        // The record gate keeps the classified transient retry; the done transition does too.
        for (const gate of gates) {
            const retry = gate.options?.retry as Record<string, unknown> | undefined;
            expect(retry?.maxAttempts).toBe(2);
            for (const cls of ['sqlite-busy', 'ENOENT', 'EBUSY', 'ENOTEMPTY']) expect(retry?.on).toContain(cls);
            expect(gate.options?.softFail).toBe(false);
        }
        // The checkpoint names the gate receipt's tree, not a retired proof digest.
        const checkpoint = cmdOf('done', 'checkpoint.md');
        expect(checkpoint).toContain('check-receipt.json');
        expect(checkpoint).not.toContain('proofDigest');
    });
});

describe('task-pipeline evidence chain — the approval is a decision point (1236, D65 R5)', () => {
    test('the review tail declares an evidence binding, never `mode: never` or a pause', () => {
        const confirm = actionOf('review', 'hitl.confirm')?.options as Record<string, unknown> | undefined;
        expect(confirm?.decision).toEqual({ mode: 'evidence', statusVar: 'approvalStatus', evidenceNodes: ['review'] });
        expect(DEF.vars?.approvalStatus).toBe('');
        expect(DEF.vars?.__hitlAnswer).toBe('');
        for (const state of DEF.states) {
            expect(state.pause, state.id).not.toBe(true);
        }
    });

    test('behavioral: `--auto` proceeds unless the maker denied; interactively only an explicit yes approves', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tp-approval-'));
        try {
            const fold = cmdOf('review', '-approval.status');
            const approvalNow = (): string =>
                readFileSync(join(dir, '.spur/run', '1239-approval.status'), 'utf8').trim();
            const cases: Array<[string, string, string]> = [
                ['auto', '', 'APPROVED'], // deferred maker answer is not a denial
                ['auto', 'yes', 'APPROVED'],
                ['auto', 'no', 'DENIED'], // the maker can deny
                ['auto', 'cancel', 'APPROVED'], // the confirm vocabulary has no cancel; only `no` denies
                ['standard', 'yes', 'APPROVED'],
                ['standard', '', 'DENIED'],
                ['standard', 'no', 'DENIED'],
                ['standard', 'cancel', 'DENIED'],
                ['', 'yes', 'APPROVED'],
                ['', '', 'DENIED'],
            ];
            for (const [profile, answer, expected] of cases) {
                const vars = { wbs: '1239', profile, __hitlAnswer: answer };
                expect(runSh(fold, dir, vars).code, `${profile}/${answer}`).toBe(0);
                expect(approvalNow(), `${profile}/${answer}`).toBe(expected);
            }
            // The done edge reads both the certification and the approval token.
            mkdirSync(join(dir, '.spur/run'), { recursive: true });
            writeFileSync(join(dir, '.spur/run', '1239-review.status'), 'PASS\n');
            writeFileSync(join(dir, '.spur/run', '1239-approval.status'), 'APPROVED\n');
            expect(runSh(guardOf('review', 'done'), dir, { wbs: '1239', profile: 'standard' }).code).toBe(0);
            writeFileSync(join(dir, '.spur/run', '1239-approval.status'), 'DENIED\n');
            expect(runSh(guardOf('review', 'done'), dir, { wbs: '1239', profile: 'standard' }).code).not.toBe(0);
            // The denial routes to failed(cancelled) — a recorded denial, not a check failure.
            const denied = DEF.transitions.find((t) => t.from === 'review' && t.to === 'failed');
            expect(denied?.terminalReason).toBe('cancelled');
            expect(runSh(guardOf('review', 'failed', 0), dir, { wbs: '1239', profile: 'auto' }).code).toBe(0);
            writeFileSync(join(dir, '.spur/run', '1239-approval.status'), 'APPROVED\n');
            expect(runSh(guardOf('review', 'failed', 0), dir, { wbs: '1239', profile: 'auto' }).code).not.toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('task-pipeline evidence chain — escalation still resumes implement (0933)', () => {
    test('the escalation hop asks through the responder and resumes on a non-empty answer', () => {
        expect(kindsOf('escalate')).toEqual(['shell', 'file.read.into-var', 'hitl.input']);
        const dir = mkdtempSync(join(tmpdir(), 'tp-escalate-'));
        try {
            mkdirSync(join(dir, '.spur/run'), { recursive: true });
            writeFileSync(join(dir, '.spur/run', '1239-question.md'), 'Which store should the cache use?\n');
            const vars = { wbs: '1239' };
            expect(firstPassingEdge('escalate', dir, { ...vars, __hitlInput: 'redis' })).toBe('implement');
            expect(firstPassingEdge('escalate', dir, { ...vars, __hitlInput: '' })).toBe('failed');
            // implement's onEnter records the Q/A pair and consumes the question file, so the
            // answered attempt can never re-trigger the hop.
            expect(runSh(cmdOf('implement', 'escalation.md'), dir, { ...vars, __hitlInput: 'redis' }).code).toBe(0);
            const transcript = readFileSync(join(dir, '.spur/run', '1239-escalation.md'), 'utf8');
            expect(transcript).toContain('## Q0');
            expect(transcript).toContain('Which store should the cache use?');
            expect(transcript).toContain('## A0');
            expect(transcript).toContain('redis');
            expect(() => readFileSync(join(dir, '.spur/run', '1239-question.md'), 'utf8')).toThrow();
            expect(firstPassingEdge('implement', dir, { ...vars, __hitlInput: 'redis' })).toBe('gate');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('task-pipeline evidence chain — kept invariants (0710/0751/0804)', () => {
    test('a priority tier is resolved at gate entry and feeds the review distinctness policy', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tp-priority-'));
        try {
            const spec = join(dir, 'spec.md');
            writeFileSync(spec, '---\nwbs: t9001\npriority: p1\n---\nbody\n');
            mkdirSync(join(dir, '.spur/run'), { recursive: true });
            const emit = join(dir, 'emit.sh');
            writeFileSync(emit, `#!/bin/sh\nprintf '{"filePath":"%s"}' "${spec}"\n`);
            Bun.spawnSync(['chmod', '+x', emit]);
            const rendered = cmdOf('gate', '-taskpath.txt').replaceAll('$spurBin', emit).replaceAll('$wbs', 't9001');
            expect(runSh(rendered, dir).code).toBe(0);
            expect(readFileSync(join(dir, '.spur/run', 't9001-priority.txt'), 'utf8').trim()).toBe('P1');
            const review = actionOf('review', 'agent.run')?.options as Record<string, unknown> | undefined;
            expect(review?.priority).toBe(VAR('taskPriority'));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the task-path lookup stays fail-closed in the gate state', () => {
        const command = cmdOf('gate', '-taskpath.txt');
        expect(command).toContain('task path $wbs --json');
        expect(command).not.toContain('--json 2>/dev/null');
        expect(command).not.toContain('|| true');
        expect(command).not.toContain('; exit 0');
        expect(command).toContain('-z "$task_path"');
        expect(command).toContain('did not resolve');
    });

    test('behavioral: an unresolved task path fails the rendered command', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tp-taskpath-'));
        try {
            mkdirSync(join(dir, '.spur/run'), { recursive: true });
            const emit = join(dir, 'emit.sh');
            writeFileSync(emit, "#!/bin/sh\nprintf '{}'\n");
            Bun.spawnSync(['chmod', '+x', emit]);
            const rendered = cmdOf('gate', '-taskpath.txt').replaceAll('$spurBin', emit).replaceAll('$wbs', 't9001');
            expect(runSh(rendered, dir).code).not.toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('behavioral: the route-reason artifact is run-attributed and unsafe ids are refused (0804 R8)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tp-route-'));
        try {
            const route = cmdOf('precheck', 'REASON_FILE=');
            expect(runSh(route, dir, { __runId: 'run_alpha', wbs: '1239', mode: 'fast' }).code).toBe(0);
            expect(readFileSync(join(dir, '.spur/run', 'run_alpha-route-reason.txt'), 'utf8').trim()).toBe(
                'fast:evidence complete+consistent',
            );
            for (const unsafe of ['$spurBin', '../evil', 'a/b', 'vars.wbs']) {
                const res = runSh(route, dir, { __runId: unsafe, wbs: '1239', mode: 'fast' });
                expect(res.code).not.toBe(0);
                expect(res.stderr).toContain('refusing unsafe run id');
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the lifecycle transitions keep their classified transient retry and verb shapes', () => {
        const gates = DEF.states.flatMap((s) => (s.onEnter ?? []).map((a) => ({ state: s.id, action: a })));
        const lifecycle = gates.filter(({ action }) => {
            const args = action.options?.args;
            return action.kind === 'command.gate' && Array.isArray(args) && args[0] === 'task' && args[1] === 'update';
        });
        expect(lifecycle.map((g) => g.state)).toEqual(['implement', 'done']);
        expect(JSON.stringify(lifecycle[0]?.action.options)).toContain('"wip"');
        expect(JSON.stringify(lifecycle[1]?.action.options)).toContain('"done"');
        for (const { action } of lifecycle) expect(action.options?.softFail).toBe(false);
    });
});
