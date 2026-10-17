/**
 * 0943 lanes, re-keyed by D65 1239: the triage lane decision and the failure-class routing are
 * decision CALLS inside the one `gate` state, and the former routing states are gone.
 *
 * The engine takes the first passing edge in declaration order, so routing is proven by
 * EXECUTING the live definition's own onEnter shell commands and transition guards against
 * staged file/variable state (same harness discipline as 0945): no engine run, no model call —
 * the `decide` actions are simulated by pre-writing the decision rows the real decide runner
 * would produce (including a degraded default row).
 *
 * Covered:
 * - lane production (0943 R1/R2): low → fast (functional-only review depth); standard/high →
 *   review; a caller-set mode is never overridden (R2b); sensitive paths or >400 changed lines
 *   pin safety with the decide result ignored (R2c); a missing/corrupt diffstat row pins safety
 *   — never fast; and every lane appends `<runId> <wbs> <reason>` to the routes log (R5).
 * - failure-class routing (0943 R3): the typed gate outcome gates first (BLOCKED is never read
 *   as red), then stop → failed(failed-check) BEFORE the cap, the cap → failed(retry-exhausted),
 *   fix → remediate, and a missing/corrupt decision fails closed.
 * - gate visit mode (D65 R2): the first visit runs `run`, a visit after remediation `recheck`.
 */

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { parse as parseYaml } from 'yaml';

const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
// Script-absorption PR-3: the lane onEnter calls `$spurBin task diffstat` — run the REAL CLI from
// source so the shell exercises the shipped verb (no plugin script staging).
const SPUR_BIN = `${process.execPath} ${join(import.meta.dir, '../../../../apps/cli/src/index.ts')}`;
const WBS = '0943';
const RUN_ID = 'run-triage';
const MAX_ATTEMPTS = '2';

interface ActionDef {
    kind: string;
    options?: {
        command?: string;
        id?: string;
        decision?: string;
        params?: Record<string, string>;
        evidence?: string[];
        resultFile?: string;
        path?: string;
        var?: string;
    };
}
interface TransitionDef {
    from: string;
    to: string;
    terminalReason?: string;
    guard?: { kind?: string; options?: { command?: string } };
}
interface TaskPipelineDef {
    vars?: Record<string, string>;
    states: { id: string; onEnter?: ActionDef[] }[];
    transitions: TransitionDef[];
}

const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8')) as TaskPipelineDef;

function onEnter(stateId: string): ActionDef[] {
    return DEF.states.find((s) => s.id === stateId)?.onEnter ?? [];
}
function decideAction(stateId: string, id: string): ActionDef {
    const action = onEnter(stateId).find((a) => a.kind === 'decide' && a.options?.id === id);
    if (!action) throw new Error(`decide ${id} missing from ${stateId} onEnter`);
    return action;
}
function shellCommands(stateId: string): string[] {
    return onEnter(stateId)
        .filter((a) => a.kind === 'shell')
        .map((a) => a.options?.command ?? '');
}
function edgesFrom(from: string): TransitionDef[] {
    return DEF.transitions.filter((t) => t.from === from);
}

/**
 * Run the state's onEnter shells whose command mentions one of `needles`, in YAML order. The
 * gate's task-path resolver is excluded by every lane scenario: it reads the real task corpus,
 * which this harness does not stage (its fail-closed behavior is pinned in the evidence suite).
 */
function runShellsMatching(stateId: string, needles: string[], cwd: string, vars: Record<string, string>): void {
    const selected = shellCommands(stateId).filter((command) => needles.some((n) => command.includes(n)));
    for (const [i, command] of selected.entries()) {
        const run = spawnSync('/bin/sh', ['-c', command], { cwd, env: { ...getEnvVars(), ...vars }, encoding: 'utf8' });
        if (run.status !== 0) throw new Error(`${stateId} shell #${i} exited ${run.status}: ${run.stderr}`);
    }
}

const LANE_SHELLS = ['-diffstat.json', 'sensitive == true', 'task-pipeline-routes.log', '-review-focus.txt'];

/** First passing edge in declaration order — the engine's routing decision. */
function firstPassingEdge(from: string, cwd: string, vars: Record<string, string>): TransitionDef {
    for (const edge of edgesFrom(from)) {
        if (edge.guard?.kind === 'always') return edge;
        if (edge.guard?.kind !== 'shell') continue;
        const run = spawnSync('/bin/sh', ['-c', edge.guard.options?.command ?? ''], {
            cwd,
            env: { ...getEnvVars(), ...vars },
            encoding: 'utf8',
        });
        if (run.status === 0) return edge;
    }
    throw new Error(`no passing edge out of ${from} — the run would hang`);
}

interface Staged {
    cwd: string;
    vars: Record<string, string>;
}

/**
 * Stage one scenario: a real git repo whose diff is shaped by `files` plus `untracked` paths, the
 * precheck-anchored run base, and optional pre-existing run artifacts (decision rows, gate tokens,
 * attempt counter, caller mode). The decide simulation writes exactly the row the decide runner
 * would (resultFile contract).
 */
function stage(options: {
    files?: Record<string, string>;
    untracked?: string[];
    triageDecision?: object | null;
    failureDecision?: object | null;
    gateStatus?: string;
    attempts?: string;
    callerMode?: string;
    anchorBase?: boolean;
}): Staged {
    const cwd = mkdtempSync(join(tmpdir(), 'task-lane-'));
    const git = (args: string[]): void => {
        const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
        if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
    };
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'test']);
    writeFileSync(join(cwd, '.gitignore'), '.spur/\n');
    mkdirSync(join(cwd, 'apps/cli/src'), { recursive: true });
    writeFileSync(join(cwd, 'apps/cli/src/index.ts'), 'export const start = 1;\n');
    git(['add', '.']);
    git(['commit', '-qm', 'base']);
    if (options.anchorBase !== false) {
        const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim();
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run', `${WBS}-base.sha`), `${sha}\n`);
    }
    for (const [path, content] of Object.entries(options.files ?? {})) {
        mkdirSync(join(cwd, path, '..'), { recursive: true });
        writeFileSync(join(cwd, path), content);
    }
    for (const path of options.untracked ?? []) {
        mkdirSync(join(cwd, path, '..'), { recursive: true });
        writeFileSync(join(cwd, path), 'export const added = 1;\n');
    }
    const runDir = join(cwd, '.spur/run');
    mkdirSync(runDir, { recursive: true });
    if (options.triageDecision !== undefined && options.triageDecision !== null) {
        writeFileSync(join(runDir, `${WBS}-triage.decision`), `${JSON.stringify(options.triageDecision)}\n`);
    }
    if (options.failureDecision !== undefined && options.failureDecision !== null) {
        writeFileSync(join(runDir, `${WBS}-failure-class.decision`), `${JSON.stringify(options.failureDecision)}\n`);
    }
    if (options.gateStatus !== undefined) {
        // The gate writes both tokens: its own status file and the typed command.gate outcome.
        writeFileSync(join(runDir, `${WBS}-test-gate.status`), options.gateStatus);
        writeFileSync(join(runDir, `${RUN_ID}-gate.status`), options.gateStatus);
    }
    if (options.attempts !== undefined) writeFileSync(join(runDir, `${WBS}-test-fix-attempt`), options.attempts);
    return {
        cwd,
        vars: {
            wbs: WBS,
            __runId: RUN_ID,
            mode: options.callerMode ?? '',
            qualityGateMaxFixAttempts: MAX_ATTEMPTS,
            deferQualityGate: 'false',
            spurBin: SPUR_BIN,
        },
    };
}

function readMode(staged: Staged): string {
    return readFileSync(join(staged.cwd, '.spur/run', `${WBS}-mode.txt`), 'utf8').trim();
}
function readFocus(staged: Staged): string {
    return readFileSync(join(staged.cwd, '.spur/run', `${WBS}-review-focus.txt`), 'utf8').trim();
}
function lastRouteLine(staged: Staged): string {
    const log = readFileSync(join(staged.cwd, '.spur/memory/task-pipeline-routes.log'), 'utf8').trim();
    const lines = log.split('\n');
    return lines[lines.length - 1] ?? '';
}
function readAttempts(staged: Staged): string {
    return readFileSync(join(staged.cwd, '.spur/run', `${WBS}-test-fix-attempt`), 'utf8').trim();
}

describe('task-pipeline 1239 — the lane is a decision call in the gate state (0943 R1/R2)', () => {
    test('frozen contract: both catalog decides live in `gate`; no routing states remain', () => {
        for (const retired of ['triage', 'test-fail-triage', 'test-recheck']) {
            expect(
                DEF.states.find((s) => s.id === retired),
                retired,
            ).toBeUndefined();
        }
        const triage = decideAction('gate', 'task-triage');
        expect(triage.options?.decision).toBe('task-triage');
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(triage.options?.params).toEqual({ wbs: '${vars.wbs}' });
        expect(triage.options?.resultFile).toBe(`.spur/run/\${vars.wbs}-triage.decision`);
        expect(triage.options?.evidence).toContain(`.spur/run/\${vars.wbs}-diffstat.json`);
        const failure = decideAction('gate', 'failure-class');
        expect(failure.options?.decision).toBe('failure-class');
        expect(failure.options?.resultFile).toBe(`.spur/run/\${vars.wbs}-failure-class.decision`);
        expect(failure.options?.evidence).toEqual([`.spur/run/\${vars.wbs}-test-gate.findings`]);
        // The lane depth lands in the mode/focus vars the review template reads.
        expect(onEnter('gate').some((a) => a.kind === 'file.read.into-var' && a.options?.var === 'mode')).toBe(true);
        expect(onEnter('gate').some((a) => a.kind === 'file.read.into-var' && a.options?.var === 'reviewFocus')).toBe(
            true,
        );
    });

    test('R1: task-triage low on a small clean diff resolves the fast lane (functional review depth)', () => {
        const staged = stage({
            files: { 'apps/cli/src/index.ts': 'export const start = 2;\n' },
            triageDecision: { value: 'low' },
        });
        runShellsMatching('gate', LANE_SHELLS, staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('fast');
        expect(readFocus(staged)).toBe('functional');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} fast:triage low lane`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('R1: task-triage standard stays on the review lane with the full review depth', () => {
        const staged = stage({
            files: { 'apps/cli/src/index.ts': 'export const start = 2;\n' },
            triageDecision: { value: 'standard' },
        });
        runShellsMatching('gate', LANE_SHELLS, staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('');
        expect(readFocus(staged)).toBe('all');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} safety:triage standard lane`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('R2b: a caller-set mode is projected verbatim — the decide result is never consulted', () => {
        const staged = stage({
            files: { 'apps/cli/src/index.ts': 'export const start = 2;\n' },
            triageDecision: { value: 'standard' },
            callerMode: 'fast',
        });
        runShellsMatching('gate', LANE_SHELLS, staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('fast');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} fast:caller-set`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('R2c: a sensitive path pins safety even when the decide result says low', () => {
        const staged = stage({
            files: { 'apps/cli/src/index.ts': 'export const start = 2;\n' },
            untracked: ['drizzle/0050_lane.sql'],
            triageDecision: { value: 'low' },
        });
        runShellsMatching('gate', LANE_SHELLS, staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('safety');
        expect(readFocus(staged)).toBe('all');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} safety:triage deterministic-high`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('R2c: >400 changed lines pin safety without a model answer', () => {
        const big = Array.from({ length: 450 }, (_, i) => `export const v${i} = ${i};\n`).join('');
        const staged = stage({ files: { 'apps/cli/src/index.ts': big }, triageDecision: { value: 'low' } });
        runShellsMatching('gate', LANE_SHELLS, staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('safety');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} safety:triage deterministic-high`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('fail-safe: a missing run base (fail-closed diffstat) degrades to safety, never fast', () => {
        const staged = stage({ anchorBase: false, triageDecision: { value: 'low' } });
        runShellsMatching('gate', LANE_SHELLS, staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('safety');
        expect(readFocus(staged)).toBe('all');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('fail-safe: a producer that wrote no diffstat row pins safety, never fast', () => {
        const staged = stage({ triageDecision: { value: 'low' } });
        runShellsMatching('gate', LANE_SHELLS, staged.cwd, { ...staged.vars, spurBin: 'true' });
        expect(existsSync(join(staged.cwd, '.spur/run', `${WBS}-diffstat.json`))).toBe(false);
        expect(readMode(staged)).toBe('safety');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} safety:triage deterministic-high`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('fail-closed: a spur that cannot run `task diffstat` writes the sensitive row (safety)', () => {
        const staged = stage({ triageDecision: { value: 'low' } });
        runShellsMatching('gate', LANE_SHELLS, staged.cwd, { ...staged.vars, spurBin: 'false' });
        const row = JSON.parse(readFileSync(join(staged.cwd, '.spur/run', `${WBS}-diffstat.json`), 'utf8'));
        expect(row).toEqual({ files: 0, insertions: 0, deletions: 0, paths: [], sensitive: true });
        expect(readMode(staged)).toBe('safety');
        rmSync(staged.cwd, { recursive: true, force: true });
    });
});

describe('task-pipeline 1239 — failure-class routing inside the gate state (0943 R3)', () => {
    test('frozen contract: declaration order is green, blocked, stop, cap, fix, defense', () => {
        expect(edgesFrom('gate').map((t) => [t.to, t.terminalReason ?? '-'])).toEqual([
            ['review', '-'],
            ['review', '-'],
            ['failed', 'failed-check'],
            ['failed', 'failed-check'],
            ['failed', 'retry-exhausted'],
            ['remediate', '-'],
            ['failed', 'failed-check'],
        ]);
        const cap = edgesFrom('gate').find((t) => t.terminalReason === 'retry-exhausted');
        expect(String(cap?.guard?.options?.command)).toContain('$wbs-test-fix-attempt');
        expect(String(cap?.guard?.options?.command)).toContain('qualityGateMaxFixAttempts');
        expect(edgesFrom('gate').at(-1)?.guard?.kind).toBe('always');
    });

    test('a BLOCKED gate is never read as red — it terminates before any failure-class edge', () => {
        const staged = stage({ gateStatus: 'BLOCKED\n', attempts: '0\n', failureDecision: { value: 'fix' } });
        const edge = firstPassingEdge('gate', staged.cwd, staged.vars);
        expect(edge.to).toBe('failed');
        expect(edge.terminalReason).toBe('failed-check');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('0976 R2: a stale `retryable` row is out of vocabulary — fails closed, no lane, no attempt counted', () => {
        const staged = stage({ gateStatus: 'FAIL\n', attempts: '0\n', failureDecision: { value: 'retryable' } });
        expect(readAttempts(staged)).toBe('0');
        const edge = firstPassingEdge('gate', staged.cwd, staged.vars);
        expect(edge.to).toBe('failed');
        expect(edge.terminalReason).toBe('failed-check');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('fix routes gate → remediate without touching the attempt counter', () => {
        const staged = stage({ gateStatus: 'FAIL\n', attempts: '1\n', failureDecision: { value: 'fix' } });
        expect(readAttempts(staged)).toBe('1');
        expect(firstPassingEdge('gate', staged.cwd, staged.vars).to).toBe('remediate');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('stop routes failed(failed-check) FIRST — even past the cap it is never mislabeled retry-exhausted', () => {
        const staged = stage({ gateStatus: 'FAIL\n', attempts: '3\n', failureDecision: { value: 'stop' } });
        const edge = firstPassingEdge('gate', staged.cwd, staged.vars);
        expect(edge.to).toBe('failed');
        expect(edge.terminalReason).toBe('failed-check');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('the cap bounds the remediation lane: fix at max attempts routes failed(retry-exhausted)', () => {
        const staged = stage({
            gateStatus: 'FAIL\n',
            attempts: `${MAX_ATTEMPTS}\n`,
            failureDecision: { value: 'fix' },
        });
        const edge = firstPassingEdge('gate', staged.cwd, staged.vars);
        expect(edge.to).toBe('failed');
        expect(edge.terminalReason).toBe('retry-exhausted');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('fail closed: a missing or corrupt failure-class decision routes failed(failed-check)', () => {
        for (const failureDecision of [undefined, null]) {
            const staged = stage({ gateStatus: 'FAIL\n', attempts: '0\n', failureDecision });
            if (failureDecision === null) {
                writeFileSync(join(staged.cwd, '.spur/run', `${WBS}-failure-class.decision`), 'not-json\n');
            }
            const edge = firstPassingEdge('gate', staged.cwd, staged.vars);
            expect(edge.to).toBe('failed');
            expect(edge.terminalReason).toBe('failed-check');
            rmSync(staged.cwd, { recursive: true, force: true });
        }
    });
});
