/**
 * 0943: task-pipeline triage lanes — routing contract for the new `triage` and
 * `test-fail-triage` states.
 *
 * The engine takes the first passing edge in declaration order, so routing is proven by
 * EXECUTING the live definition's own onEnter shell commands and transition guards against
 * staged file/variable state (same harness discipline as idea-pipeline-routing 0945): no
 * engine run, no model call — the `decide` actions are simulated by pre-writing the decision
 * rows the real decide runner would produce (including a degraded default row for R4).
 *
 * Covered (spec R1–R5 + Q&A):
 * - triage lane production: low → fast; standard/high → review (empty mode), caller-set mode
 *   is never overridden (R2b), sensitive paths or >400 changed lines pin safety with the
 *   decide result ignored (R2c), a degraded decide default degrades to the standard lane (R4),
 *   and a fail-closed diffstat (missing run base) degrades to safety — never to fast.
 * - R5: every triage run appends `<runId> <wbs> <reason>` to .spur/memory/task-pipeline-routes.log
 *   with the reason naming the lane origin (caller-set / triage low / deterministic-high / standard).
 * - failure-class routing: stop → failed(failed-check) BEFORE the cap (never mislabeled),
 *   the qualityGateMaxFixAttempts cap bounds BOTH lanes (a retryable classification counts its
 *   attempt on entry), retryable → test-recheck, fix → test-fix, missing/corrupt decision →
 *   failed(failed-check) defense (fail closed, never silently repair).
 * - Frozen names: decide ids `task-triage`/`failure-class`, the four gate-PASS edges are gone,
 *   and the triage fork guards are exhaustive (`= fast` / `!= fast`) so triage never hangs.
 */

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { parse as parseYaml } from 'yaml';

const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DIFFSTAT_SCRIPT = join(import.meta.dir, '../../../../plugins/sp/scripts', 'task-diffstat.ts');
const WBS = '0943';
const RUN_ID = 'run-triage';
const MAX_ATTEMPTS = '2';

interface ActionDef {
    kind: string;
    options?: {
        command?: string;
        id?: string;
        method?: string;
        question?: string;
        choices?: string[];
        default?: string;
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

/** Runs the state's real onEnter shell commands (in YAML order) inside the staged dir. */
function runOnEnterShells(stateId: string, cwd: string, vars: Record<string, string>): void {
    for (const [i, command] of shellCommands(stateId).entries()) {
        const run = spawnSync('/bin/sh', ['-c', command], { cwd, env: { ...getEnvVars(), ...vars }, encoding: 'utf8' });
        if (run.status !== 0) throw new Error(`${stateId} onEnter shell #${i} exited ${run.status}: ${run.stderr}`);
    }
}

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
 * Stage one scenario: a real git repo whose diff is shaped by `files` (tracked rewrites keyed
 * by path → new content) plus `untracked` paths, the precheck-anchored run base, and optional
 * pre-existing run artifacts (decision rows, gate status, attempt counter, caller mode).
 * The decide simulation writes exactly the row the decide runner would (resultFile contract).
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
    const cwd = mkdtempSync(join(tmpdir(), 'task-triage-'));
    const git = (args: string[]): void => {
        const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
        if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
    };
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'test']);
    mkdirSync(join(cwd, 'apps/cli/src'), { recursive: true });
    writeFileSync(join(cwd, 'apps/cli/src/index.ts'), 'export const start = 1;\n');
    git(['add', '.']);
    git(['commit', '-qm', 'base']);
    if (options.anchorBase !== false) {
        const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim();
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run', `${WBS}-base.sha`), `${sha}\n`);
    }
    // The onEnter diffstat shell resolves plugins/sp/scripts/task-diffstat.ts relative to cwd —
    // run the REAL script there (repo-local first branch of the resolution chain), which imports
    // ../lib/env, so the plugin lib tree is copied alongside it.
    mkdirSync(join(cwd, 'plugins/sp/scripts'), { recursive: true });
    mkdirSync(join(cwd, 'plugins/sp/lib'), { recursive: true });
    copyFileSync(DIFFSTAT_SCRIPT, join(cwd, 'plugins/sp/scripts/task-diffstat.ts'));
    copyFileSync(join(import.meta.dir, '../../../../plugins/sp/lib', 'env.ts'), join(cwd, 'plugins/sp/lib/env.ts'));
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
    if (options.gateStatus !== undefined) writeFileSync(join(runDir, `${WBS}-test-gate.status`), options.gateStatus);
    if (options.attempts !== undefined) writeFileSync(join(runDir, `${WBS}-test-fix-attempt`), options.attempts);
    return {
        cwd,
        vars: { wbs: WBS, __runId: RUN_ID, mode: options.callerMode ?? '', qualityGateMaxFixAttempts: MAX_ATTEMPTS },
    };
}

/**
 * Vars at triage-edge evaluation time: the fork guards read the `mode` VAR, which the trailing
 * file.read.into-var action set from the projected mode file — not the caller's env value.
 */
function edgeVars(staged: Staged): Record<string, string> {
    return { ...staged.vars, mode: readMode(staged) };
}

function readMode(staged: Staged): string {
    return readFileSync(join(staged.cwd, '.spur/run', `${WBS}-mode.txt`), 'utf8').trim();
}
function lastRouteLine(staged: Staged): string {
    const log = readFileSync(join(staged.cwd, '.spur/memory/task-pipeline-routes.log'), 'utf8').trim();
    const lines = log.split('\n');
    return lines[lines.length - 1] ?? '';
}
function readAttempts(staged: Staged): string {
    return readFileSync(join(staged.cwd, '.spur/run', `${WBS}-test-fix-attempt`), 'utf8').trim();
}

describe('task-pipeline 0943 — triage state routing (R1/R2)', () => {
    test('frozen contract: task-triage decide row + lane projection + exhaustive triage fork', () => {
        const triage = decideAction('triage', 'task-triage');
        expect(triage.options?.method).toBe('choice');
        expect(triage.options?.choices).toEqual(['low', 'standard', 'high']);
        expect(triage.options?.default).toBe('standard');
        expect(triage.options?.resultFile).toBe(`.spur/run/\${vars.wbs}-triage.decision`);
        expect(triage.options?.evidence).toContain(`.spur/run/\${vars.wbs}-diffstat.json`);
        // (d) the resolved lane lands in the mode var for the fork guards.
        const read = onEnter('triage').find((a) => a.kind === 'file.read.into-var');
        expect(read?.options?.var).toBe('mode');
        expect(read?.options?.path).toBe(`.spur/run/\${vars.wbs}-mode.txt`);
        // The four gate-PASS edges are gone; the triage fork guards are exhaustive.
        expect(DEF.transitions.find((t) => t.from === 'test' && t.to === 'verify')).toBeUndefined();
        expect(DEF.transitions.find((t) => t.from === 'test' && t.to === 'review')).toBeUndefined();
        expect(DEF.transitions.find((t) => t.from === 'test-recheck' && t.to === 'verify')).toBeUndefined();
        expect(DEF.transitions.find((t) => t.from === 'test-recheck' && t.to === 'review')).toBeUndefined();
        const fork = edgesFrom('triage').map((t) => t.to);
        expect(fork).toEqual(['verify', 'review']);
    });

    test('R1: task-triage low on a small clean diff routes the fast lane (triage → verify)', () => {
        const staged = stage({
            files: { 'apps/cli/src/index.ts': 'export const start = 2;\n' },
            triageDecision: { value: 'low' },
        });
        runOnEnterShells('triage', staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('fast');
        expect(firstPassingEdge('triage', staged.cwd, edgeVars(staged)).to).toBe('verify');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} fast:triage low lane`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('R1: task-triage standard stays on the review lane', () => {
        const staged = stage({
            files: { 'apps/cli/src/index.ts': 'export const start = 2;\n' },
            triageDecision: { value: 'standard' },
        });
        runOnEnterShells('triage', staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('');
        expect(firstPassingEdge('triage', staged.cwd, edgeVars(staged)).to).toBe('review');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} safety:triage standard lane`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('R2b: a caller-set mode is projected verbatim — the decide result is never consulted', () => {
        const staged = stage({
            files: { 'apps/cli/src/index.ts': 'export const start = 2;\n' },
            triageDecision: { value: 'standard' },
            callerMode: 'fast',
        });
        runOnEnterShells('triage', staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('fast');
        expect(firstPassingEdge('triage', staged.cwd, edgeVars(staged)).to).toBe('verify');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} fast:caller-set`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('R2c: a sensitive path pins safety even when the decide result says low', () => {
        const staged = stage({
            files: { 'apps/cli/src/index.ts': 'export const start = 2;\n' },
            untracked: ['drizzle/0050_triage-lanes.sql'],
            triageDecision: { value: 'low' },
        });
        runOnEnterShells('triage', staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('safety');
        expect(firstPassingEdge('triage', staged.cwd, edgeVars(staged)).to).toBe('review');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} safety:triage deterministic-high`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('R2c: >400 changed lines pin safety without a model answer', () => {
        const big = Array.from({ length: 450 }, (_, i) => `export const v${i} = ${i};\n`).join('');
        const staged = stage({ files: { 'apps/cli/src/index.ts': big }, triageDecision: { value: 'low' } });
        runOnEnterShells('triage', staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('safety');
        expect(lastRouteLine(staged)).toBe(`${RUN_ID} ${WBS} safety:triage deterministic-high`);
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('R4: a degraded decide default (decision-maker off) degrades to the standard lane', () => {
        const staged = stage({
            files: { 'apps/cli/src/index.ts': 'export const start = 2;\n' },
            triageDecision: { value: 'standard', degraded: true, reason: 'decision-maker disabled' },
        });
        runOnEnterShells('triage', staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('');
        expect(firstPassingEdge('triage', staged.cwd, edgeVars(staged)).to).toBe('review');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('fail-safe: a missing run base (fail-closed diffstat) degrades to safety, never fast', () => {
        const staged = stage({ anchorBase: false, triageDecision: { value: 'low' } });
        runOnEnterShells('triage', staged.cwd, staged.vars);
        expect(readMode(staged)).toBe('safety');
        expect(firstPassingEdge('triage', staged.cwd, edgeVars(staged)).to).toBe('review');
        rmSync(staged.cwd, { recursive: true, force: true });
    });
});

describe('task-pipeline 0943 — failure-class routing (R3)', () => {
    test('frozen contract: failure-class decide row + declaration order (stop, cap, retryable, fix, defense)', () => {
        const decide = decideAction('test-fail-triage', 'failure-class');
        expect(decide.options?.choices).toEqual(['retryable', 'fix', 'stop']);
        expect(decide.options?.default).toBe('fix');
        expect(decide.options?.resultFile).toBe(`.spur/run/\${vars.wbs}-failure-class.decision`);
        expect(decide.options?.evidence).toEqual([`.spur/run/\${vars.wbs}-test-gate.findings`]);
        expect(edgesFrom('test-fail-triage').map((t) => [t.to, t.terminalReason ?? '-'])).toEqual([
            ['failed', 'failed-check'],
            ['failed', 'retry-exhausted'],
            ['test-recheck', '-'],
            ['test-fix', '-'],
            ['failed', 'failed-check'],
        ]);
    });

    test('retryable counts its attempt on entry and routes test-fail-triage → test-recheck', () => {
        const staged = stage({ gateStatus: 'FAIL\n', attempts: '0\n', failureDecision: { value: 'retryable' } });
        runOnEnterShells('test-fail-triage', staged.cwd, staged.vars);
        expect(readAttempts(staged)).toBe('1');
        expect(firstPassingEdge('test-fail-triage', staged.cwd, staged.vars).to).toBe('test-recheck');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('fix routes test-fail-triage → test-fix without touching the attempt counter', () => {
        const staged = stage({ gateStatus: 'FAIL\n', attempts: '1\n', failureDecision: { value: 'fix' } });
        runOnEnterShells('test-fail-triage', staged.cwd, staged.vars);
        expect(readAttempts(staged)).toBe('1');
        expect(firstPassingEdge('test-fail-triage', staged.cwd, staged.vars).to).toBe('test-fix');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('stop routes failed(failed-check) FIRST — even past the cap it is never mislabeled retry-exhausted', () => {
        const staged = stage({ gateStatus: 'FAIL\n', attempts: '3\n', failureDecision: { value: 'stop' } });
        runOnEnterShells('test-fail-triage', staged.cwd, staged.vars);
        const edge = firstPassingEdge('test-fail-triage', staged.cwd, staged.vars);
        expect(edge.to).toBe('failed');
        expect(edge.terminalReason).toBe('failed-check');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('the cap bounds the retryable lane: retryable at max attempts routes failed(retry-exhausted)', () => {
        const staged = stage({
            gateStatus: 'FAIL\n',
            attempts: `${MAX_ATTEMPTS}\n`,
            failureDecision: { value: 'retryable' },
        });
        runOnEnterShells('test-fail-triage', staged.cwd, staged.vars);
        const edge = firstPassingEdge('test-fail-triage', staged.cwd, staged.vars);
        expect(edge.to).toBe('failed');
        expect(edge.terminalReason).toBe('retry-exhausted');
        rmSync(staged.cwd, { recursive: true, force: true });
    });

    test('fail closed: a missing or corrupt failure-class decision routes failed(failed-check)', () => {
        for (const failureDecision of [undefined, null]) {
            const staged = stage({
                gateStatus: 'FAIL\n',
                attempts: '0\n',
                failureDecision,
            });
            if (failureDecision === null)
                writeFileSync(join(staged.cwd, '.spur/run', `${WBS}-failure-class.decision`), 'not-json\n');
            runOnEnterShells('test-fail-triage', staged.cwd, staged.vars);
            const edge = firstPassingEdge('test-fail-triage', staged.cwd, staged.vars);
            expect(edge.to).toBe('failed');
            expect(edge.terminalReason).toBe('failed-check');
            rmSync(staged.cwd, { recursive: true, force: true });
        }
    });
});
