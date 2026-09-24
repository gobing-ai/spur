import { describe, expect, test } from 'bun:test';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/ts-utils';
import { parse } from 'yaml';

interface PipelineAction {
    kind: string;
    options?: { command?: string; file?: string; var?: string; escalationFile?: string; prompt?: string };
}

interface PipelineState {
    id: string;
    onEnter?: PipelineAction[];
}

interface PipelineTransition {
    from: string;
    to: string;
    guard?: PipelineAction;
}

interface PipelineDefinition {
    states: PipelineState[];
    transitions?: PipelineTransition[];
    vars?: Record<string, string>;
}

const ROOT = join(import.meta.dir, '..', '..', '..');
const PIPELINE = parse(
    readFileSync(join(ROOT, 'config', 'workflows', 'task-pipeline.yaml'), 'utf8'),
) as PipelineDefinition;

function commandFor(stateId: string, shellIndex = 0): string {
    const commands =
        PIPELINE.states
            .find((state) => state.id === stateId)
            ?.onEnter?.filter((action) => action.kind === 'shell')
            .map((action) => action.options?.command ?? '') ?? [];
    const command = commands[shellIndex];
    if (command === undefined) throw new Error(`missing shell command ${shellIndex} for ${stateId}`);
    return command;
}

function executable(dir: string, name: string, body: string): string {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
}

function initGitRepo(dir: string): void {
    for (const args of [
        ['git', 'init', '-q'],
        ['git', 'config', 'user.email', 'test@spur.local'],
        ['git', 'config', 'user.name', 'spur test'],
    ]) {
        Bun.spawnSync(args, { cwd: dir });
    }
    // Seed a tracked file under the corpus path so untracked corpus files are
    // listed individually — git collapses a fully-untracked directory into one
    // `?? docs/tasks4/` row, which would not name the file.
    mkdirSync(join(dir, 'docs', 'tasks4'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'tasks4', '.gitkeep'), '');
    Bun.spawnSync(['git', 'add', '.'], { cwd: dir });
    Bun.spawnSync(['git', 'commit', '-qm', 'init'], { cwd: dir });
}

function runShell(command: string, cwd: string, env: Record<string, string>): { exitCode: number; output: string } {
    const result = Bun.spawnSync(['sh', '-c', command], {
        cwd,
        env: { ...getEnvVars(), ...env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return {
        exitCode: result.exitCode,
        output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
}

describe('0503 task-pipeline resilience', () => {
    test('0777 mutation policy stops classification-only remediation before dispatch or source edits', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-mutation-policy-'));
        try {
            writeFileSync(join(dir, 'source.ts'), 'unchanged');
            const spurBin = executable(
                dir,
                'spur',
                'printf \'%s\\n\' \'{"content":"mutationPolicy: none\\n","frontmatter":{}}\'',
            );
            const action = commandFor('test-fix');
            const result = runShell(action, dir, { spurBin, wbs: '0773', mutationPolicy: 'code' });
            expect(result.exitCode).not.toBe(0);
            expect(result.output).toContain('mutation policy');
            expect(readFileSync(join(dir, 'source.ts'), 'utf8')).toBe('unchanged');
            expect(PIPELINE.states.find((state) => state.id === 'test-fix')?.onEnter?.[0]?.kind).toBe('shell');
            const allowed = executable(
                dir,
                'code-task',
                'printf \'%s\\n\' \'{"content":"ordinary task","frontmatter":{}}\'',
            );
            expect(runShell(action, dir, { spurBin: allowed, wbs: '0777', mutationPolicy: 'code' }).exitCode).toBe(0);
            expect(runShell(action, dir, { spurBin: allowed, wbs: '0777', mutationPolicy: 'none' }).exitCode).not.toBe(
                0,
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('precheck remains deterministic, doctor-free, and count-only (0723)', () => {
        const precheck = PIPELINE.states.find((state) => state.id === 'precheck');
        const commands = precheck?.onEnter?.map((action) => action.options?.command ?? '') ?? [];

        // 0723's doctor-free clause is superseded in a bounded way by 0894 R1: exactly ONE
        // soft role-resolution probe is allowed at precheck (roles coder+reviewer, resultFile
        // run-scoped, never aborting the run). Any other doctor.probe, and any `agent doctor`
        // shell invocation, stays forbidden — per-stage detection remains doctor-free.
        const probes = (precheck?.onEnter ?? []).filter((action) => action.kind === 'doctor.probe');
        expect(probes).toHaveLength(1);
        const probe = probes[0]?.options as { roles?: Record<string, string>; resultFile?: string } | undefined;
        expect(Object.keys(probe?.roles ?? {}).sort()).toEqual(['coder', 'reviewer']);
        expect(probe?.resultFile).toContain('.spur/run/');
        expect(commands.join('\n')).not.toContain('agent doctor');
        const size = commandFor('precheck', 2);
        expect(size).toContain('task-size-precheck.ts');
        expect(size).not.toContain('--executor');
        // Fail closed: the missing-checker fallback writes FAIL, never PASS.
        expect(size).toContain('"FAIL"');
        expect(size).not.toContain('skipped');
        // Feature reactivation surfaces failure instead of swallowing it (no `|| true`).
        expect(commandFor('precheck', 1)).not.toContain('|| true');
    });

    test('precheck size gate fails closed when the checker script is absent (0723 R2)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0723-nosize-'));
        try {
            // Absent means unresolvable on BOTH branches: no repo-relative copy AND
            // no staged copy. The stub mimics `superskill script path` on an
            // unstaged script (stderr + exit 2), so the gate must write FAIL.
            const bin = join(dir, 'bin');
            mkdirSync(bin, { recursive: true });
            executable(bin, 'superskill', 'echo "Script not found" >&2; exit 2');
            const command = commandFor('precheck', 2);
            const result = runShell(command, dir, {
                wbs: '0723',
                spurBin: 'spur',
                PATH: `${bin}:${getEnvVar('PATH') ?? ''}`,
            });
            expect(result.exitCode).toBe(0);
            expect(readFileSync(join(dir, '.spur/run/0723-precheck-size.status'), 'utf8')).toBe('FAIL\n');
            expect(result.output).toContain('failed closed');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('precheck size gate runs the checker exactly once and carries PASS through (0723 R2)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0723-size-'));
        try {
            mkdirSync(join(dir, 'plugins', 'sp', 'scripts'), { recursive: true });
            const counter = join(dir, 'size-counter');
            writeFileSync(
                join(dir, 'plugins', 'sp', 'scripts', 'task-size-precheck.ts'),
                `#!/usr/bin/env bun
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
appendFileSync(process.argv[2] === "0723" ? "${counter}" : "/dev/null", "x\\n");
mkdirSync(".spur/run", { recursive: true });
writeFileSync(".spur/run/" + process.argv[2] + "-precheck-size.status", "PASS\\n");
`,
            );
            const result = runShell(commandFor('precheck', 2), dir, { wbs: '0723', spurBin: 'spur' });
            expect(result.exitCode).toBe(0);
            expect(readFileSync(counter, 'utf8').split('\n').filter(Boolean).length).toBe(1);
            expect(readFileSync(join(dir, '.spur/run/0723-precheck-size.status'), 'utf8')).toBe('PASS\n');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('auto feature reactivation: single-shot on success, blocking on real failure (0723 R3)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0723-featsync-'));
        try {
            const calls = join(dir, 'sync-calls');
            const spur = executable(
                dir,
                'spur-fake',
                `case "$1:$2" in
  task:show) printf '%s\n' '{"feature_id":"F9"}' ;;
  feature:sync) echo x >> "${calls}"; exit "\${SYNC_RC:-0}" ;;
  feature:update) echo y >> "${calls}"; exit "\${UPDATE_RC:-0}" ;;
esac`,
            );
            const command = commandFor('precheck', 1);

            // Green path: one sync call, exit 0.
            const ok = runShell(command, dir, { profile: 'auto', wbs: '0723', spurBin: spur });
            expect(ok.exitCode).toBe(0);
            expect(readFileSync(calls, 'utf8').split('\n').filter(Boolean)).toEqual(['x']);

            // Sync fails, update rescue succeeds: still exit 0 (one sync + one update).
            const rescued = runShell(command, dir, {
                profile: 'auto',
                wbs: '0723',
                spurBin: spur,
                SYNC_RC: '1',
            });
            expect(rescued.exitCode).toBe(0);
            expect(readFileSync(calls, 'utf8').split('\n').filter(Boolean)).toEqual(['x', 'x', 'y']);

            // Both fail: the reactivation failure surfaces and blocks implementation.
            const blocked = runShell(command, dir, {
                profile: 'auto',
                wbs: '0723',
                spurBin: spur,
                SYNC_RC: '1',
                UPDATE_RC: '1',
            });
            expect(blocked.exitCode).not.toBe(0);
            expect(blocked.output).toContain('feature reactivation');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // 0823 (c): the implement/record/done transitions are `command.gate` actions — the
    // classified transient retry (once, 2s delay, ENOENT/EBUSY/ENOTEMPTY + lock forms) lives
    // in the gate; retry behavior is covered by plugins/sp/tests/command-gate.test.ts.
    test('lifecycle transitions are command.gate actions with the classified transient retry (0823 c)', () => {
        const gateOf = (stateId: string): Record<string, unknown> => {
            const action = PIPELINE.states
                .find((state) => state.id === stateId)
                ?.onEnter?.find((a) => a.kind === 'command.gate');
            expect(action).toBeDefined();
            return (action?.options ?? {}) as Record<string, unknown>;
        };
        for (const stateId of ['implement', 'record', 'done']) {
            const options = gateOf(stateId);
            expect(options.executable).toBe(`\${vars.spurBin}`); // escaped template: literal YAML text, not interpolation
            expect(options.softFail).toBe(false);
            const retry = options.retry as Record<string, unknown>;
            expect(retry.maxAttempts).toBe(2);
            expect(retry.delayMs).toBe(2000);
            for (const cls of ['sqlite-busy', 'ENOENT', 'EBUSY', 'ENOTEMPTY']) {
                expect(retry.on).toContain(cls);
            }
            expect(String(options.resultFile)).toContain(`.spur/run/\${vars.__runId}-`);
            expect(String(options.resultFile).endsWith('.status')).toBe(true);
        }
        const argsOf = (stateId: string): string => JSON.stringify(gateOf(stateId).args);
        expect(argsOf('implement')).toContain('--no-lifecycle');
        expect(argsOf('record')).toContain('--solution-from-diff');
        expect(argsOf('record')).toContain('testing');
        expect(argsOf('done')).toContain('--no-lifecycle');
    });

    // 0823 (d): the gate shells are thin resolvers — quality-gate.ts owns the retry loop,
    // findings cap, bounded summary and status artifact (behavioral coverage lives in
    // plugins/sp/tests/quality-gate.test.ts). Here: resolution order and fail-closed shape.
    test('gate shells resolve quality-gate.ts, fall back to superskill, and fail closed (0823 d)', () => {
        for (const [stateId, shellIndex, mode] of [
            ['test', 2, 'run'],
            ['test-recheck', 0, 'recheck'],
        ] as const) {
            const command = commandFor(stateId, shellIndex);
            expect(command).toContain(`quality-gate.ts ${mode}`);
            expect(command).toContain('superskill script path sp quality-gate.mjs');
            expect(command).toContain(`node "$Q" ${mode}`);
            // Fail closed: an unresolvable gate writes FAIL (never PASS) and stays soft.
            expect(command).toContain('failed closed');
            expect(command).toContain(`printf 'FAIL\\n' > ".spur/run/$wbs-test-gate.status"`);
            expect(command.trim().endsWith('exit 0')).toBe(true);
            // The retired loop is gone: no inline classifier or gate command remains.
            expect(command).not.toContain('qualityGateCmd');
            expect(command).not.toContain('grep -Eq');
        }
    });
    test('precheck dirty-tree action names task-corpus dirt without the non-corpus warning', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0511-corpus-dirty-'));
        initGitRepo(dir);
        writeFileSync(join(dir, 'docs', 'tasks4', 'uncommitted.md'), 'corpus edit');
        const command = commandFor('precheck', 0);
        const result = runShell(command, dir, {});

        expect(result.exitCode).toBe(0);
        expect(result.output).toContain('precheck: NOTE - task corpus has uncommitted changes');
        expect(result.output).toContain('?? docs/tasks4/uncommitted.md');
        expect(result.output).not.toContain('precheck: WARNING');
    });

    test('precheck dirty-tree action stays quiet on a clean task corpus', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0511-corpus-clean-'));
        initGitRepo(dir);
        const command = commandFor('precheck', 0);
        const result = runShell(command, dir, {});

        expect(result.exitCode).toBe(0);
        expect(result.output).not.toContain('precheck: NOTE');
        expect(result.output).not.toContain('precheck: WARNING');
    });

    // 0772 R1 (behavior moved into quality-gate.ts, 0823 d): the bounded-summary contract —
    // green gates print a one-line status, red gates print at most the last 40 lines, and the
    // durable log keeps everything — is asserted in plugins/sp/tests/quality-gate.test.ts.

    // F96 residual sweep (0950): scan/fold wired into verify between task verdict and the
    // jq proof bind; settle/report at the terminal states; base capture is resume-safe.
    function shellCommands(stateId: string): string[] {
        return (
            PIPELINE.states
                .find((state) => state.id === stateId)
                ?.onEnter?.filter((action) => action.kind === 'shell')
                .map((action) => action.options?.command ?? '') ?? []
        );
    }

    test('precheck captures base.sha only when absent (F96 R1 resume-safe)', () => {
        const cmd = shellCommands('precheck').find((c) => c.includes('-base.sha'));
        expect(cmd).toBeDefined();
        expect(cmd).toContain('rev-parse HEAD');
        expect(cmd).toMatch(/\[ -f "?\.spur\/run\/\$wbs-base\.sha"? \] \|\|/);
    });

    test('verify orders scan+fold between task verdict and the jq proof bind (F96 R2)', () => {
        const cmds = shellCommands('verify');
        const verdictIdx = cmds.findIndex((c) => c.includes('task verdict'));
        const residualIdx = cmds.findIndex((c) => c.includes('residual-scan') && c.includes('fold'));
        const bindIdx = cmds.findIndex((c) => c.includes('+ {proof:'));
        expect(verdictIdx).toBeGreaterThanOrEqual(0);
        expect(residualIdx).toBeGreaterThan(verdictIdx);
        expect(bindIdx).toBeGreaterThan(residualIdx);
        // Hard action: no exit-0 blanket — a scanner crash must fail verify closed.
        expect(cmds[residualIdx].trim().endsWith('exit 0')).toBe(false);
        // Repo-first, then superskill twin, failing closed (quality-gate pattern).
        expect(cmds[residualIdx]).toContain('superskill script path sp residual-scan.mjs');
    });

    test('test-fix appends the residual artifact to the gate log (F96 R3)', () => {
        const cmd = shellCommands('test-fix').find((c) => c.includes('-residuals.json'));
        expect(cmd).toBeDefined();
        expect(cmd).toContain('-test-gate.log');
    });

    test('done settles residuals as a soft action after the transition (F96 R4)', () => {
        const cmds = shellCommands('done');
        const settleIdx = cmds.findIndex((c) => c.includes('residual-scan') && c.includes('settle'));
        expect(settleIdx).toBe(0);
        expect(cmds[settleIdx].trim().endsWith('exit 0')).toBe(true);
    });

    test('failed renders the residual report as a soft action (F96 R5)', () => {
        const cmds = shellCommands('failed');
        expect(cmds.length).toBeGreaterThan(0);
        const report = cmds.find((c) => c.includes('residual-scan') && c.includes('report'));
        expect(report).toBeDefined();
        expect(report?.trim().endsWith('exit 0')).toBe(true);
    // 0931 R5: parallel batches launch each pipeline with deferFeatureSync "true" so a task
    // branch never touches feature files; the record-step sync shell must skip cleanly. The
    // default "false" keeps sequential/inline behavior unchanged — the sync is owned by
    // record-feature-sync.ts (ADR-115 moved the old inline chain out of the shell).
    test('deferFeatureSync "true" skips the record-step feature sync and notes the deferral (0931 R5)', () => {
        expect(PIPELINE.vars?.deferFeatureSync).toBe('false');

        const sync = commandFor('record', 0);
        expect(sync.startsWith('S=plugins/sp/scripts/record-feature-sync.ts;')).toBe(true);
        expect(sync).toContain('record-feature-sync.mjs');
        expect(sync).toContain('[ "$deferFeatureSync" = "true" ]');
        expect(sync).toContain('feature sync deferred to batch integration');
        expect(sync).toContain('bun "$S" --spur-bin "$spurBin"');

        // Behavioral: with deferFeatureSync=true the (canary) spurBin is never invoked.
        const dir = mkdtempSync(join(tmpdir(), 'spur-0931-defer-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            const spurBin = executable(dir, 'spur-bin-canary', 'echo "CANARY INVOKED" >&2; exit 42');
            const result = runShell(sync, dir, {
                deferFeatureSync: 'true',
                wbs: '0931',
                spurBin,
            });

            expect(result.exitCode).toBe(0);
            expect(result.output).not.toContain('CANARY INVOKED');
            const report = readFileSync(join(dir, '.spur', 'run', '0931-report.txt'), 'utf8');
            expect(report).toContain('feature sync deferred to batch integration');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('deferFeatureSync default delegates the sync to record-feature-sync (0931 R5 default)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0931-default-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            // Stage the owner script exactly as the pipeline finds it in-repo, so the shell
            // actually delegates. The script imports ../lib/env (getEnvVar) — stage it too
            // (self-contained node builtins). Canary: `task show` yields a feature_id -> the
            // owner runs the bare-spur last resort (no bounded wrapper / staged module here).
            mkdirSync(join(dir, 'plugins', 'sp', 'scripts'), { recursive: true });
            mkdirSync(join(dir, 'plugins', 'sp', 'lib'), { recursive: true });
            copyFileSync(
                join(import.meta.dir, '..', 'scripts', 'record-feature-sync.ts'),
                join(dir, 'plugins', 'sp', 'scripts', 'record-feature-sync.ts'),
            );
            copyFileSync(join(import.meta.dir, '..', 'lib', 'env.ts'), join(dir, 'plugins', 'sp', 'lib', 'env.ts'));
            const spurBin = executable(
                dir,
                'spur-bin-empty',
                'if [ "$1" = "task" ]; then echo \'{"feature_id":"F1"}\'; else echo "SYNC $*"; fi',
            );
            const result = runShell(commandFor('record', 0), dir, { wbs: '0931', spurBin });

            expect(result.exitCode).toBe(0);
            expect(result.output).not.toContain('deferred');
            expect(result.output).toContain('SYNC feature sync F1');
            const reportPath = join(dir, '.spur', 'run', '0931-report.txt');
            if (existsSync(reportPath)) {
                expect(readFileSync(reportPath, 'utf8')).not.toContain('Orphan task 0931');
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// 0933 — operator-question escalation (implement → escalate → implement)
// ---------------------------------------------------------------------------

describe('0933 operator-question escalation', () => {
    const guardFor = (from: string, to: string): PipelineTransition['guard'] =>
        PIPELINE.transitions?.find((t) => t.from === from && t.to === to)?.guard;
    // Workflow template syntax, not a JS template literal — built by concatenation so the source
    // doesn't contain a `${` that Biome's noTemplateCurlyInString would (correctly) flag
    // (mirrors packages/app/tests/workflow/builtins.test.ts).
    const tpl = (name: string): string => ['$' + '{vars.', name, '}'].join('');

    test('escalate state: bounded counter, question surfacing, and hitl.input pause', () => {
        const escalate = PIPELINE.states.find((s) => s.id === 'escalate');
        expect(escalate).toBeDefined();
        const kinds = escalate?.onEnter?.map((a) => a.kind) ?? [];
        // Counter first, then the question read, then the pause.
        expect(kinds).toEqual(['shell', 'file.read.into-var', 'hitl.input']);
        const counter = commandFor('escalate', 0);
        expect(counter).toContain('.spur/run/$wbs-escalation-count');
        const read = escalate?.onEnter?.find((a) => a.kind === 'file.read.into-var');
        expect(read?.options?.file).toBe(`.spur/run/${tpl('wbs')}-question.md`);
        expect(read?.options?.var).toBe('escalationQuestion');
        const pause = escalate?.onEnter?.find((a) => a.kind === 'hitl.input');
        expect(pause?.options?.prompt).toBe(tpl('escalationQuestion'));
    });

    test('escalation edges are declared before the implement→test always edge (bound first, then question)', () => {
        const transitions = PIPELINE.transitions ?? [];
        const idx = (from: string, to: string): number => {
            const i = transitions.findIndex((t) => t.from === from && t.to === to);
            if (i < 0) throw new Error(`missing transition ${from}→${to}`);
            return i;
        };
        const bound = idx('implement', 'failed');
        const ask = idx('implement', 'escalate');
        const body = idx('implement', 'test');
        expect(bound).toBeLessThan(ask);
        expect(ask).toBeLessThan(body);
        // Bound guard requires the escalation count AND a fresh question file; the report
        // note lives in the failed state's onEnter (guards stay thin, ADR-115).
        const boundCmd = guardFor('implement', 'failed')?.options?.command ?? '';
        expect(boundCmd).toContain('-ge "$maxEscalations"');
        expect(boundCmd).toContain('-s .spur/run/$wbs-question.md');
        expect(boundCmd).not.toContain('$wbs-report.md');
        expect(guardFor('implement', 'escalate')?.options?.command).toContain('test -s .spur/run/$wbs-question.md');
        // The Q/A transcript append + question consumption live in implement's onEnter
        // first action, not in the escalate→implement guard.
        const implement = PIPELINE.states.find((s) => s.id === 'implement');
        const append = implement?.onEnter?.[0];
        expect(append?.kind).toBe('shell');
        const appendCmd = append?.options?.command ?? '';
        expect(appendCmd).toContain('.spur/run/$wbs-escalation.md');
        expect(appendCmd).toContain('rm -f .spur/run/$wbs-question.md');
        // The bound note is a conditional shell in the failed state's onEnter.
        expect(commandFor('failed', 0) ?? '').toContain('Escalation bound reached');
    });

    test('escalate routing: answered → implement; empty → failed (guards stay thin predicates)', () => {
        const resume = guardFor('escalate', 'implement')?.options?.command ?? '';
        expect(resume).toContain('test -n "$__hitlInput"');
        // Appending/consuming is implement onEnter's job, not the guard's.
        expect(resume).not.toContain('.spur/run/$wbs-escalation.md');
        expect(guardFor('escalate', 'failed')?.options?.command).toContain('test -z "$__hitlInput"');
    });

    test('implement agent.run declares the escalation contract and names the transcript in its input', () => {
        const implement = PIPELINE.states.find((s) => s.id === 'implement');
        const agentRun = implement?.onEnter?.find((a) => a.kind === 'agent.run');
        // The agent.run option names the QUESTION file (the pause signal, deleted
        // pre-dispatch for freshness); the transcript reaches the agent via --escalation-file.
        expect(agentRun?.options?.escalationFile).toBe(`.spur/run/${tpl('wbs')}-question.md`);
        const input = String((agentRun?.options as Record<string, unknown> | undefined)?.input ?? '');
        expect(input).toContain(`--escalation-file .spur/run/${tpl('wbs')}-escalation.md`);
        expect(PIPELINE.vars?.maxEscalations).toBe('2');
    });

    test('bound guard routes at bound + fresh question; the failed onEnter writes the report note', () => {
        const dir = mkdtempSync(join(tmpdir(), 'pipeline-esc-bound-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            const cmd = guardFor('implement', 'failed')?.options?.command ?? '';
            // Under bound with a fresh question → not a bound failure.
            writeFileSync(join(dir, '.spur/run/0933-escalation-count'), '1');
            writeFileSync(join(dir, '.spur/run/0933-question.md'), 'Q3: again?');
            expect(runShell(cmd, dir, { wbs: '0933', maxEscalations: '2' }).exitCode).toBe(1);
            // At bound but NO fresh question (completed implement) → not a bound failure.
            writeFileSync(join(dir, '.spur/run/0933-escalation-count'), '2');
            rmSync(join(dir, '.spur/run/0933-question.md'));
            expect(runShell(cmd, dir, { wbs: '0933', maxEscalations: '2' }).exitCode).toBe(1);
            // At bound WITH a fresh question → routes to failed (guard is a pure predicate).
            writeFileSync(join(dir, '.spur/run/0933-question.md'), 'Q3: again?');
            expect(runShell(cmd, dir, { wbs: '0933', maxEscalations: '2' }).exitCode).toBe(0);
            // The failed state's onEnter writes the report note (no-op on ordinary failures).
            // R2: the note lands in the task report (report.txt) and carries the question.
            const note = commandFor('failed', 0);
            expect(runShell(note, dir, { wbs: '0933', maxEscalations: '2' }).exitCode).toBe(0);
            const report = readFileSync(join(dir, '.spur/run/0933-report.txt'), 'utf8');
            expect(report).toContain('Escalation bound reached');
            expect(report).toContain('Q3: again?');
            // Ordinary failure (no pending question) → note stays a no-op.
            const plain = mkdtempSync(join(tmpdir(), 'pipeline-esc-plain-'));
            try {
                mkdirSync(join(plain, '.spur', 'run'), { recursive: true });
                runShell(note, plain, { wbs: '0933', maxEscalations: '2' });
                expect(existsSync(join(plain, '.spur/run/0933-report.txt'))).toBe(false);
            } finally {
                rmSync(plain, { recursive: true, force: true });
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('implement onEnter records the Q/A transcript and consumes the question on a resume entry', () => {
        const dir = mkdtempSync(join(tmpdir(), 'pipeline-esc-resume-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            // First entry (no pending question, empty answer) → no-op, no transcript.
            const cmd = commandFor('implement', 0);
            expect(runShell(cmd, dir, { wbs: '0933', __hitlInput: '' }).exitCode).toBe(0);
            expect(existsSync(join(dir, '.spur/run/0933-escalation.md'))).toBe(false);
            // Resume entry → guard already passed (non-empty answer + fresh question);
            // onEnter appends Q1/A1 and consumes the question file.
            writeFileSync(join(dir, '.spur/run/0933-question.md'), 'which auth scheme?');
            writeFileSync(join(dir, '.spur/run/0933-escalation-count'), '1');
            expect(guardFor('escalate', 'implement')?.options?.command).toContain('test -n "$__hitlInput"');
            expect(runShell(cmd, dir, { wbs: '0933', __hitlInput: 'oauth2 device flow' }).exitCode).toBe(0);
            const transcript = readFileSync(join(dir, '.spur/run/0933-escalation.md'), 'utf8');
            expect(transcript).toContain('## Q1');
            expect(transcript).toContain('which auth scheme?');
            expect(transcript).toContain('## A1');
            expect(transcript).toContain('oauth2 device flow');
            expect(existsSync(join(dir, '.spur/run/0933-question.md'))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
