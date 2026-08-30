import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    test('precheck remains deterministic and does not probe executor health (0723 bypass)', () => {
        const precheck = PIPELINE.states.find((state) => state.id === 'precheck');
        const commands = precheck?.onEnter?.map((action) => action.options?.command ?? '') ?? [];

        expect(precheck?.onEnter?.some((action) => action.kind === 'doctor.probe')).toBe(false);
        expect(commands.join('\n')).not.toContain('agent doctor');
        expect(commandFor('precheck', 2)).toContain('task-size-precheck.ts');
        expect(commandFor('precheck', 2)).not.toContain('--executor');
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
});
