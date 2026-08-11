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
    test('omp env-probe auth miss is soft while a non-omp unauthenticated executor fails with remediation', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0503-doctor-'));
        const doctor = executable(
            dir,
            'spur-doctor',
            `printf '%s\\n' '{"agents":[{"authenticated":"unauthenticated","modelStatus":{"detail":"API key not found for provider volc"}}]}'`,
        );
        const command = commandFor('precheck');

        const omp = runShell(command, dir, {
            wbs: '0503',
            agent: 'omp-dsv4-flash-volc',
            implementAgent: 'omp-dsv4-flash-volc',
            spurBin: doctor,
        });
        expect(omp.exitCode).toBe(0);
        expect(readFileSync(join(dir, '.spur/run/0503-precheck-doctor.status'), 'utf8').trim()).toBe('PASS');
        expect(omp.output).toContain('probe=env-miss');
        expect(omp.output).toContain('precheck: SOFT');

        const codex = runShell(command, dir, {
            wbs: '0504',
            agent: 'codex',
            implementAgent: 'codex',
            spurBin: doctor,
        });
        expect(codex.exitCode).toBe(0);
        expect(readFileSync(join(dir, '.spur/run/0504-precheck-doctor.status'), 'utf8').trim()).toBe('FAIL');
        expect(codex.output).toContain('fix agent.default or pass --vars');
        expect(codex.output).toContain('agent doctor codex --json');
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
        const command = commandFor('test').replace('sleep 10', 'sleep 0');
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
        const result = runShell(command, dir, {
            wbs: '0503',
            qualityGateCmd: gate,
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
        const command = commandFor('precheck', 1);
        const result = runShell(command, dir, {});

        expect(result.exitCode).toBe(0);
        expect(result.output).toContain('precheck: NOTE - task corpus has uncommitted changes');
        expect(result.output).toContain('?? docs/tasks4/uncommitted.md');
        expect(result.output).not.toContain('precheck: WARNING');
    });

    test('precheck dirty-tree action stays quiet on a clean task corpus', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0511-corpus-clean-'));
        initGitRepo(dir);
        const command = commandFor('precheck', 1);
        const result = runShell(command, dir, {});

        expect(result.exitCode).toBe(0);
        expect(result.output).not.toContain('precheck: NOTE');
        expect(result.output).not.toContain('precheck: WARNING');
    });
});
