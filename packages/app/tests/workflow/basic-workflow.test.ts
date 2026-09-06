import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * 0771 R1: basic's check state executes `qualityGateCmd` via `sh -c "$cmd"` so a
 * trusted compound command (`a && b`, `a || b`) preserves its real exit status.
 * The previous `( $cmd )` word-split the string, turning `&&` into argument
 * data — a failing left half could never fail the probe. Status stays a soft
 * probe (file + always exit 0) so guarded transitions route fix/done/failed.
 */

interface Action {
    kind: string;
    options?: { command?: string };
}
interface WorkflowDef {
    version?: string;
    states: { id: string; onEnter?: Action[] }[];
    transitions: { from: string; to: string; guard?: { kind: string; options?: { command?: string } } }[];
}

const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'basic.yaml'), 'utf8')) as WorkflowDef;

function checkCommand(): string {
    const state = DEF.states.find((s) => s.id === 'check');
    if (!state) throw new Error('check state missing');
    const shell = state.onEnter?.find((a) => a.kind === 'shell');
    if (!shell?.options?.command) throw new Error('check shell command missing');
    return shell.options.command;
}

function runSh(command: string, dir: string, env: Record<string, string>): Promise<number> {
    const proc = Bun.spawn(['/bin/sh', '-c', command], {
        cwd: dir,
        env: { ...env, PATH: process.env.PATH ?? '' },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return proc.exited;
}

const BASE_ENV: Record<string, string> = { qualityGateMaxFixAttempts: '2' };

function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'basic-wf-'));
    mkdirSync(join(dir, '.spur/run'), { recursive: true });
    return dir;
}

describe('basic workflow check/branch behavior (0771)', () => {
    test('definition carries the behavior-neutral version tag', () => {
        expect(DEF.version).toBe('1');
    });

    test('failing compound command records FAIL and never runs the right half', async () => {
        const dir = tempProject();
        try {
            const env = { ...BASE_ENV, qualityGateCmd: 'false && echo should-not-run', __runId: 'r1' };
            const rc = await runSh(checkCommand(), dir, env);
            expect(rc).toBe(0); // soft probe always exits 0
            expect(readFileSync(join(dir, '.spur/run/r1-basic-gate.status'), 'utf8').trim()).toBe('FAIL');
            expect(readFileSync(join(dir, '.spur/run/r1-basic-gate.status'), 'utf8')).not.toContain('should-not-run');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('valid compound command records PASS', async () => {
        const dir = tempProject();
        try {
            const env = {
                ...BASE_ENV,
                qualityGateCmd: 'mkdir -p out && echo hi > out/a.txt && test -s out/a.txt',
                __runId: 'r2',
            };
            const rc = await runSh(checkCommand(), dir, env);
            expect(rc).toBe(0);
            expect(readFileSync(join(dir, '.spur/run/r2-basic-gate.status'), 'utf8').trim()).toBe('PASS');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('declared-order routing: PASS→done, FAIL under cap→fix, FAIL at cap→failed, corrupt→fix/failed', async () => {
        const dir = tempProject();
        const env = { ...BASE_ENV, __runId: 'g' };
        const route = async (): Promise<string> => {
            for (const t of DEF.transitions.filter((x) => x.from === 'check')) {
                if (!t.guard || t.guard.kind === 'always') return t.to;
                if (
                    t.guard.kind === 'shell' &&
                    t.guard.options?.command &&
                    (await runSh(t.guard.options.command, dir, env)) === 0
                ) {
                    return t.to;
                }
            }
            throw new Error('no edge passed');
        };
        const status = (v: string | null): void => {
            if (v === null) rmSync(join(dir, '.spur/run/g-basic-gate.status'), { force: true });
            else {
                writeFileSync(join(dir, '.spur/run/g-basic-gate.status'), `${v}\n`);
            }
        };
        const attempt = (n: number): void => {
            writeFileSync(join(dir, '.spur/run/g-basic-fix-attempt'), `${n}\n`);
        };
        try {
            status('PASS');
            attempt(0);
            expect(await route()).toBe('done');
            status('FAIL');
            attempt(1);
            expect(await route()).toBe('fix');
            attempt(2);
            expect(await route()).toBe('failed');
            status('CORRUPT');
            attempt(1);
            expect(await route()).toBe('fix');
            attempt(2);
            expect(await route()).toBe('failed');
            status(null);
            attempt(2);
            expect(await route()).toBe('failed');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
