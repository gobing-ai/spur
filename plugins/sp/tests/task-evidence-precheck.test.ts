/**
 * task-evidence-precheck contract tests (0726 R2).
 *
 * Behavioral matrix runs the REAL script against a fake spur binary and fixture
 * SQLite databases. Wiring tests assert the task-pipeline precheck action and
 * both precheck guards, mirroring task-pipeline-resilience.test.ts idioms.
 */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(import.meta.dir, '..', '..', '..');
const SCRIPT = join(ROOT, 'plugins', 'sp', 'scripts', 'task-evidence-precheck.ts');

const DECL = 'evidence-channel: history_tool_call.args_raw[pi]';

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
    transitions: { from: string; to: string; guard?: { kind?: string; options?: { command?: string } } }[];
}

const PIPELINE = parse(
    readFileSync(join(ROOT, 'config', 'workflows', 'task-pipeline.yaml'), 'utf8'),
) as PipelineDefinition;

function shellCommands(stateId: string): string[] {
    return (
        PIPELINE.states
            .find((state) => state.id === stateId)
            ?.onEnter?.filter((action) => action.kind === 'shell')
            .map((action) => action.options?.command ?? '') ?? []
    );
}

function executable(dir: string, name: string, body: string): string {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
}

/** Sandbox with a fake spur emitting the given task content for `task show`. */
function makeSandbox(taskJson: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'spur-0726-evidence-'));
    executable(
        dir,
        'spur-fake',
        `case "$1:$2" in
  task:show) printf '%s\\n' '${taskJson.replace(/'/g, `'\\''`)}' ;;
  *) exit 1 ;;
esac`,
    );
    return dir;
}

function seedDb(dir: string, rows: { source: string; argsRaw: string | null }[]): void {
    mkdirSync(join(dir, '.spur'), { recursive: true });
    const db = new Database(join(dir, '.spur', 'spur.db'));
    db.exec('CREATE TABLE history_tool_call (source TEXT, args_raw TEXT)');
    for (const row of rows) {
        db.query('INSERT INTO history_tool_call (source, args_raw) VALUES (?, ?)').run(row.source, row.argsRaw);
    }
    db.close();
}

function runScript(
    dir: string,
    spurBinPath: string,
    wbs = '0726',
): { exitCode: number; output: string; status: string | null } {
    const result = Bun.spawnSync(['bun', SCRIPT, wbs, '--spur-bin', `sh ${spurBinPath}`], {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const statusPath = join(dir, '.spur', 'run', `${wbs}-precheck-evidence.status`);
    return {
        exitCode: result.exitCode,
        output: `${result.stdout.toString()}${result.stderr.toString()}`,
        status: (() => {
            try {
                return readFileSync(statusPath, 'utf8');
            } catch {
                return null;
            }
        })(),
    };
}

describe('0726 task-evidence-precheck script', () => {
    test('always exits 0 and writes a status file (soft action contract)', () => {
        const dir = makeSandbox('{"content":"no declarations here"}');
        try {
            const result = runScript(dir, join(dir, 'spur-fake'));
            expect(result.exitCode).toBe(0);
            expect(result.status).toBe('PASS\n');
            expect(result.output).toContain('no evidence-channel declaration');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('declaration-free task passes without opening SQLite (no .spur/spur.db present)', () => {
        const dir = makeSandbox('{"content":"plain task"}');
        try {
            // No .spur directory at all — a DB touch would fail the run.
            const result = runScript(dir, join(dir, 'spur-fake'));
            expect(result.exitCode).toBe(0);
            expect(result.status).toBe('PASS\n');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('exact declaration with live pi args_raw rows passes', () => {
        const dir = makeSandbox(`{"content":"AC: ${DECL}"}`);
        try {
            seedDb(dir, [
                { source: 'pi', argsRaw: '{"command":"ls -la"}' },
                { source: 'pi', argsRaw: null },
                { source: 'claude', argsRaw: '{"tool":"x"}' },
            ]);
            const result = runScript(dir, join(dir, 'spur-fake'));
            expect(result.exitCode).toBe(0);
            expect(result.status).toBe('PASS\n');
            expect(result.output).toContain('live pi history_tool_call row(s)');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('exact declaration with zero qualifying rows fails closed', () => {
        const dir = makeSandbox(`{"content":"AC: ${DECL}"}`);
        try {
            // pi rows exist but args_raw is NULL — the destructive-importer signature.
            seedDb(dir, [
                { source: 'pi', argsRaw: null },
                { source: 'claude', argsRaw: '{"tool":"x"}' },
            ]);
            const result = runScript(dir, join(dir, 'spur-fake'));
            expect(result.exitCode).toBe(0);
            expect(result.status).toBe('FAIL\n');
            expect(result.output).toContain('0 live pi rows');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('missing database and missing table fail closed', () => {
        const missingDb = makeSandbox(`{"content":"${DECL}"}`);
        try {
            const result = runScript(missingDb, join(missingDb, 'spur-fake'));
            expect(result.exitCode).toBe(0);
            expect(result.status).toBe('FAIL\n');
            expect(result.output).toContain('database not found');
        } finally {
            rmSync(missingDb, { recursive: true, force: true });
        }

        const noTable = makeSandbox(`{"content":"${DECL}"}`);
        try {
            mkdirSync(join(noTable, '.spur'), { recursive: true });
            const db = new Database(join(noTable, '.spur', 'spur.db'));
            db.exec('CREATE TABLE other (x TEXT)');
            db.close();
            const result = runScript(noTable, join(noTable, 'spur-fake'));
            expect(result.exitCode).toBe(0);
            expect(result.status).toBe('FAIL\n');
            expect(result.output).toContain('evidence query failed');
        } finally {
            rmSync(noTable, { recursive: true, force: true });
        }
    });

    test('unknown evidence-channel declaration fails closed', () => {
        const dir = makeSandbox('{"content":"evidence-channel: some_other.tool[pi]"}');
        try {
            seedDb(dir, [{ source: 'pi', argsRaw: '{"command":"ls"}' }]);
            const result = runScript(dir, join(dir, 'spur-fake'));
            expect(result.exitCode).toBe(0);
            expect(result.status).toBe('FAIL\n');
            expect(result.output).toContain('unknown evidence-channel declaration');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('spur fetch failure fails closed with exit 0', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0726-evidence-'));
        try {
            const result = runScript(dir, '/bin/false');
            expect(result.exitCode).toBe(0);
            expect(result.status).toBe('FAIL\n');
            expect(result.output).toContain('could not fetch task');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('0726 pipeline wiring', () => {
    test('precheck runs the evidence checker with the same fail-closed fallback as size', () => {
        const commands = shellCommands('precheck');
        const evidence = commands.find((c) => c.includes('task-evidence-precheck.ts'));
        expect(evidence).toBeDefined();
        expect(evidence).toContain('precheck-evidence.status');
        expect(evidence).toContain('"FAIL"');
        expect(evidence).not.toContain('skipped');
    });

    test('precheck→implement guard requires BOTH size and evidence PASS', () => {
        const guard = PIPELINE.transitions.find((t) => t.from === 'precheck' && t.to === 'implement');
        const command = guard?.guard?.options?.command ?? '';
        expect(command).toContain('precheck-size.status');
        expect(command).toContain('precheck-evidence.status');
        expect(command).toContain('$spurBin task check $wbs');
    });

    test('precheck→failed remains the fail-closed catch-all', () => {
        const guard = PIPELINE.transitions.find((t) => t.from === 'precheck' && t.to === 'failed');
        expect(guard?.guard?.kind).toBe('always');
    });

    test('YAML precheck command drives the real script end-to-end (declared + live rows → PASS)', () => {
        const dir = makeSandbox(`{"content":"AC: ${DECL}"}`);
        try {
            seedDb(dir, [{ source: 'pi', argsRaw: '{"command":"git status"}' }]);
            // The pipeline invokes the checker at its repo-relative path, so the
            // sandbox needs the script at that path (same convention as the 0723
            // resilience harness seeding plugins/sp/scripts into the sandbox).
            mkdirSync(join(dir, 'plugins', 'sp', 'scripts'), { recursive: true });
            symlinkSync(SCRIPT, join(dir, 'plugins', 'sp', 'scripts', 'task-evidence-precheck.ts'));
            const command = shellCommands('precheck').find((c) => c.includes('task-evidence-precheck.ts'));
            const result = Bun.spawnSync(['sh', '-c', command ?? ''], {
                cwd: dir,
                env: { ...process.env, wbs: '0726', spurBin: join(dir, 'spur-fake') },
                stdout: 'pipe',
                stderr: 'pipe',
            });
            expect(result.exitCode).toBe(0);
            expect(readFileSync(join(dir, '.spur/run/0726-precheck-evidence.status'), 'utf8')).toBe('PASS\n');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('missing checker script fails closed through the YAML command (exit 0, status FAIL)', () => {
        const dir = makeSandbox(`{"content":"AC: ${DECL}"}`);
        try {
            const command = shellCommands('precheck').find((c) => c.includes('task-evidence-precheck.ts'));
            const result = Bun.spawnSync(['sh', '-c', command ?? ''], {
                cwd: dir,
                env: { ...process.env, wbs: '0726', spurBin: join(dir, 'spur-fake') },
                stdout: 'pipe',
                stderr: 'pipe',
            });
            expect(result.exitCode).toBe(0);
            expect(`${result.stdout.toString()}${result.stderr.toString()}`).toContain('failed closed');
            expect(readFileSync(join(dir, '.spur/run/0726-precheck-evidence.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
