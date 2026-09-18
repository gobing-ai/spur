import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/ts-utils';
import { parse } from 'yaml';

interface PipelineAction {
    kind: string;
    options?: { command?: string };
}

interface PipelineState {
    id: string;
    onEnter?: PipelineAction[];
}

interface PipelineDefinition {
    states: PipelineState[];
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
});
