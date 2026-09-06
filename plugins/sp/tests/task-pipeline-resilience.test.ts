import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
        env: { ...process.env, ...env },
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

        expect(precheck?.onEnter?.some((action) => action.kind === 'doctor.probe')).toBe(false);
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
                PATH: `${bin}:${process.env.PATH ?? ''}`,
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

    test('a transient transition error retries once and preserves the broken path in output', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0503-transition-'));
        const counter = join(dir, 'counter');
        const spur = executable(
            dir,
            'spur-fake',
            `n=$(cat "$COUNTER" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$COUNTER"; if [ "$n" -eq 1 ]; then echo "ENOENT reading $BROKEN_PATH" >&2; exit 1; fi; echo transitioned`,
        );
        const command = commandFor('implement').replace('sleep 2', 'sleep 0');
        const result = runShell(command, dir, {
            wbs: '0503',
            spurBin: spur,
            COUNTER: counter,
            BROKEN_PATH: join(dir, 'node_modules/@gobing-ai/missing'),
        });

        expect(result.exitCode).toBe(0);
        expect(readFileSync(counter, 'utf8').trim()).toBe('2');
        expect(result.output).toContain('node_modules/@gobing-ai/missing');
        expect(result.output).toContain('transitioned');
    });

    test('a persistent transient dependency error retries once and emits the bun install hint', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0503-transition-fail-'));
        const counter = join(dir, 'counter');
        const spur = executable(
            dir,
            'spur-fake',
            `n=$(cat "$COUNTER" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$COUNTER"; echo "ENOENT reading $BROKEN_PATH" >&2; exit 1`,
        );
        const command = commandFor('record').replace('sleep 2', 'sleep 0');
        const result = runShell(command, dir, {
            wbs: '0503',
            spurBin: spur,
            COUNTER: counter,
            BROKEN_PATH: join(dir, 'node_modules/@gobing-ai/missing'),
        });

        expect(result.exitCode).toBe(1);
        expect(readFileSync(counter, 'utf8').trim()).toBe('2');
        expect(result.output).toContain('node_modules/@gobing-ai/missing');
        expect(result.output).toContain('run bun install and retry');
    });

    test('quality gate retries only lock failures and passes when the lock clears', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0503-gate-'));
        const counter = join(dir, 'counter');
        const gate = executable(
            dir,
            'gate-fake',
            `n=$(cat "$COUNTER" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$COUNTER"; if [ "$n" -eq 1 ]; then echo 'SQLiteError: database is locked' >&2; exit 1; fi; echo PASS`,
        );
        // 0703 R2: test.onEnter now resolves the task-spec path in a first shell before the
        // canonical proof.fingerprint capture, so the gate shell moved to shell index 1.
        const command = commandFor('test', 1).replace('sleep 10', 'sleep 0');
        const result = runShell(command, dir, {
            wbs: '0503',
            qualityGateCmd: gate,
            COUNTER: counter,
        });

        expect(result.exitCode).toBe(0);
        expect(readFileSync(counter, 'utf8').trim()).toBe('2');
        expect(readFileSync(join(dir, '.spur/run/0503-test-gate.status'), 'utf8').trim()).toBe('PASS');
        const log = readFileSync(join(dir, '.spur/run/0503-test-gate.log'), 'utf8');
        expect(log).toContain('SQLiteError: database is locked');
        expect(log).toContain('retrying (1/5)');
    });

    test('quality gate stops after five persistent lock failures and retains the lock error', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0503-gate-fail-'));
        const counter = join(dir, 'counter');
        const gate = executable(
            dir,
            'gate-fake',
            `n=$(cat "$COUNTER" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$COUNTER"; echo 'SQLiteError: database is locked' >&2; exit 1`,
        );
        const command = commandFor('test-recheck').replace('sleep 10', 'sleep 0');
        // Pin the probe off: the workflow engine exports gateProbeCmd into shell-action env,
        // which leaks into this process — the default probe would run `bun run lint` in the
        // scratch dir (no package.json), fail, and skip the full-gate loop this test asserts.
        const result = runShell(command, dir, {
            wbs: '0503',
            qualityGateCmd: gate,
            gateProbeCmd: '',
            COUNTER: counter,
        });

        expect(result.exitCode).toBe(0);
        expect(readFileSync(counter, 'utf8').trim()).toBe('5');
        expect(readFileSync(join(dir, '.spur/run/0503-test-gate.status'), 'utf8').trim()).toBe('FAIL');
        expect(readFileSync(join(dir, '.spur/run/0503-test-gate.log'), 'utf8')).toContain(
            'SQLiteError: database is locked',
        );
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

    // 0772 R1: gate output is a bounded summary — green gates print status/attempt/path/
    // bytes, red gates print at most the last 40 lines plus the log path; the durable full
    // log on disk is never truncated and the old full-log `cat` echo is gone.
    test('quality gate output is a bounded summary; full log stays on disk (0772 R1)', () => {
        for (const stateId of ['test', 'test-recheck']) {
            const shells =
                PIPELINE.states
                    .find((state) => state.id === stateId)
                    ?.onEnter?.filter((action) => action.kind === 'shell') ?? [];
            for (const { options } of shells) {
                const command = options?.command ?? '';
                if (command.includes('test-gate.status')) {
                    expect(command).not.toMatch(/cat "\$LOG_FILE" *&&/);
                    expect(command).toContain('tail -n 40 "$LOG_FILE"');
                }
            }
        }

        const dir = mkdtempSync(join(tmpdir(), 'spur-0772-summary-'));
        const noisyGate = executable(dir, 'gate-noisy', 'for i in $(seq 1 60); do echo "line-$i"; done; exit 1');
        const command = commandFor('test', 1).replace('sleep 10', 'sleep 0');
        const red = runShell(command, dir, { wbs: '0772', qualityGateCmd: noisyGate });

        expect(red.exitCode).toBe(0);
        expect(red.output).toContain(
            'quality gate FAIL — last 40 lines follow (full log: .spur/run/0772-test-gate.log)',
        );
        expect(red.output).toContain('line-60');
        expect(red.output).not.toContain('line-1\n');
        expect(readFileSync(join(dir, '.spur/run/0772-test-gate.status'), 'utf8').trim()).toBe('FAIL');
        const log = readFileSync(join(dir, '.spur/run/0772-test-gate.log'), 'utf8');
        expect(log).toContain('line-1');
        expect(log).toContain('line-60');

        const greenGate = executable(dir, 'gate-green', 'echo gate-ok; exit 0');
        const green = runShell(command, dir, { wbs: '0772', qualityGateCmd: greenGate });

        expect(green.exitCode).toBe(0);
        expect(green.output).toContain('quality gate PASS (attempts: 1; log: .spur/run/0772-test-gate.log; bytes:');
        expect(green.output).not.toContain('gate-ok\n');
        expect(readFileSync(join(dir, '.spur/run/0772-test-gate.status'), 'utf8').trim()).toBe('PASS');
    });
});
