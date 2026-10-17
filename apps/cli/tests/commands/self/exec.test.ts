import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { main } from '../../../src';
import { registerExecCommand } from '../../../src/commands/self/exec';
import { createCliContext } from '../../../src/context';
import { type CliResult, runCli } from '../../helpers';

/**
 * `spur self exec` E2E (feature A92, task 1223) — every case spawns the real CLI as a
 * subprocess against a throwaway project root with its own `.spur/config.yaml`, so the
 * transport seam (exit codes, inherited stdio, stderr step echoes) is what is under test.
 *
 * Each probe also persists its captured stdout/stderr/exit code under
 * `ARTIFACT_DIR` as a repeatable artifact of the run.
 */

const ARTIFACT_DIR = join(tmpdir(), 'spur-exec-e2e-artifacts');

const CONFIG = `project: exec-fixture
builder:
  preset: none
  actions:
    exit-3: >-
      exit 3
    args-echo: >-
      printf '[%s]'
    env-write: >-
      printf '%s' "$SPUR_ACTION" > env.txt
    fail-mid:
      - ok-step
      - fail-step
      - after-step
    ok-step: >-
      exit 0
    fail-step: >-
      exit 7
    after-step: >-
      touch after-ran
`;

let fixture = '';

/** Run one probe through the real CLI and persist its captured result. */
async function probe(name: string, args: string[]): Promise<CliResult> {
    const result = await runCli(['--no-logo', 'self', 'exec', ...args], fixture);
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await writeFile(
        join(ARTIFACT_DIR, `${name}.json`),
        `${JSON.stringify({ command: `spur self exec ${args.join(' ')}`, ...result }, null, 2)}\n`,
    );
    return result;
}

beforeAll(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'spur-exec-e2e-'));
    await mkdir(join(fixture, '.spur'), { recursive: true });
    await writeFile(join(fixture, '.spur', 'config.yaml'), CONFIG);
});

afterAll(async () => {
    await rm(fixture, { recursive: true, force: true });
});

describe('spur self exec — list', () => {
    test('--list --json reports every reserved and declared action with its source (R5)', async () => {
        const result = await probe('list-json', ['--list', '--json']);
        expect(result.code).toBe(0);
        const rows = JSON.parse(result.stdout) as Array<{
            name: string;
            reserved: boolean;
            source: string;
            command?: string;
            steps?: string[];
        }>;
        const byName = new Map(rows.map((row) => [row.name, row]));
        expect(rows.length).toBe(25); // 18 reserved + 7 declared
        expect(byName.get('test')).toEqual({ name: 'test', reserved: true, source: 'unbound' });
        expect(byName.get('rules-pre')?.source).toBe('default');
        expect(byName.get('exit-3')).toEqual({
            name: 'exit-3',
            reserved: false,
            source: 'config',
            command: 'exit 3',
        });
        expect(byName.get('fail-mid')?.steps).toEqual(['ok-step', 'fail-step', 'after-step']);
    });

    test('--list prints a NAME/SOURCE/COMMAND table (R5)', async () => {
        const result = await probe('list-table', ['--list']);
        expect(result.code).toBe(0);
        const lines = result.stdout.trim().split('\n');
        expect(lines[0]).toMatch(/^NAME\s+SOURCE\s+COMMAND$/);
        expect(result.stdout).toContain('rules-pre');
        expect(result.stdout).toContain('unbound');
        expect(result.stdout).toContain('ok-step → fail-step → after-step');
    });
});

describe('spur self exec — run', () => {
    test('propagates the child exit code and sets SPUR_ACTION in the project root (R1)', async () => {
        const result = await probe('run-exit-3', ['exit-3']);
        expect(result.code).toBe(3);
        expect(result.stdout).toBe('');

        const envResult = await probe('run-env', ['env-write']);
        expect(envResult.code).toBe(0);
        expect(await readFile(join(fixture, 'env.txt'), 'utf8')).toBe('env-write');
    });

    test('--dry-run prints the resolved commands and runs nothing (R4)', async () => {
        const result = await probe('dry-run-composite', ['fail-mid', '--dry-run']);
        expect(result.code).toBe(0);
        expect(result.stdout.trim().split('\n')).toEqual(['exit 0', 'exit 7', 'touch after-ran']);
        expect(existsSync(join(fixture, 'after-ran'))).toBe(false);
    });

    test('--dry-run --json emits one { name, command } object per step and runs nothing (R4)', async () => {
        const result = await probe('dry-run-json', ['fail-mid', '--dry-run', '--json']);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual([
            { name: 'ok-step', command: 'exit 0' },
            { name: 'fail-step', command: 'exit 7' },
            { name: 'after-step', command: 'touch after-ran' },
        ]);
        expect(existsSync(join(fixture, 'after-ran'))).toBe(false);
    });

    test('-- <args> are shQuoted and appended to a string action (R2)', async () => {
        const result = await probe('args-passthrough', ['args-echo', '--', '--my-flag', 'a b']);
        expect(result.code).toBe(0);
        expect(result.stdout).toBe('[--my-flag][a b]');
    });

    test('a composite echoes each step on stderr and stops at the first failure (R3)', async () => {
        const result = await probe('composite-failure', ['fail-mid']);
        expect(result.code).toBe(7);
        expect(result.stderr).toContain('▶ ok-step');
        expect(result.stderr).toContain('▶ fail-step');
        expect(result.stderr).not.toContain('▶ after-step');
        expect(existsSync(join(fixture, 'after-ran'))).toBe(false);
    });

    test('--json prints the final { action, steps, exitCode } summary (R7)', async () => {
        const result = await probe('json-summary', ['exit-3', '--json']);
        expect(result.code).toBe(3);
        const summary = JSON.parse(result.stdout) as {
            action: string;
            steps: Array<{ name: string; exitCode: number; durationMs: number }>;
            exitCode: number;
        };
        expect(summary.action).toBe('exit-3');
        expect(summary.exitCode).toBe(3);
        expect(summary.steps).toHaveLength(1);
        expect(summary.steps[0]?.name).toBe('exit-3');
        expect(summary.steps[0]?.exitCode).toBe(3);
        expect(summary.steps[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });
});

describe('spur self exec — exit 2 usage and unbound cases', () => {
    test('an unbound action exits 2 with the builder.actions remediation (R6)', async () => {
        const result = await probe('unbound', ['check']);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('action "check" is not bound; add builder.actions.check to .spur/config.yaml');
    });

    test('a missing action without --list exits 2 with usage (R6)', async () => {
        const result = await probe('missing-action', []);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('usage: spur self exec <action>');
    });

    test('a composite with extra args exits 2 (R2)', async () => {
        const result = await probe('composite-args', ['fail-mid', '--', '--verbose']);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('composite action "fail-mid" does not accept arguments');
    });
});

// ---------------------------------------------------------------------------
// In-process branch coverage of the transport module.
//
// The E2E cases above spawn a real subprocess, which Bun's in-process coverage
// cannot see. These cases drive the same verb through the real dispatcher
// (`main`) against a second temp project root, so every branch of `exec.ts`
// (list text/json, dry-run, run, composite success/failure/nesting, args, and
// all three exit-2 refusals) is measured.
// ---------------------------------------------------------------------------

const INPROC_CONFIG = `project: exec-inproc
builder:
  preset: none
  actions:
    exit-3: >-
      exit 3
    env-write: >-
      printf '%s' "$SPUR_ACTION" > env.txt
    ok-step: >-
      exit 0
    fail-step: >-
      exit 7
    ok-mid:
      - ok-step
      - ok-step
    fail-mid:
      - ok-step
      - fail-step
      - ok-step
    nested-mid:
      - ok-mid
      - ok-step
    noop: >-
      :
`;

describe('spur self exec — in-process transport branches', () => {
    let root = '';
    let runCount = 0;

    beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), 'spur-exec-inproc-'));
        await mkdir(join(root, '.spur'), { recursive: true });
        await writeFile(join(root, '.spur', 'config.yaml'), INPROC_CONFIG);
    });

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
    });

    /** Dispatch one invocation through the real CLI in this process and capture its output. */
    async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
        runCount += 1;
        const messages: string[] = [];
        const errors: string[] = [];
        const code = await main(['--no-logo', 'self', 'exec', ...args], {
            cwd: root,
            output: { write: (message) => messages.push(message), error: (message) => errors.push(message) },
            dbUrl: ':memory:',
        });
        return { code, stdout: messages.join('\n'), stderr: errors.join('\n') };
    }

    test('--list renders the table for command, composite and unbound rows', async () => {
        const { code, stdout } = await run(['--list']);
        expect(code).toBe(0);
        expect(stdout.split('\n')[0]).toMatch(/^NAME\s+SOURCE\s+COMMAND$/);
        expect(stdout).toContain('(unbound)');
        expect(stdout).toContain('ok-step → ok-step');
        expect(stdout).toContain('exit 3');
    });

    test('--list --json emits the row shapes for all three resolution kinds', async () => {
        const { code, stdout } = await run(['--list', '--json']);
        expect(code).toBe(0);
        const rows = JSON.parse(stdout) as Array<{
            name: string;
            reserved: boolean;
            source: string;
            command?: string;
            steps?: string[];
        }>;
        expect(rows.find((row) => row.name === 'test')).toEqual({
            name: 'test',
            reserved: true,
            source: 'unbound',
        });
        expect(rows.find((row) => row.name === 'ok-mid')).toEqual({
            name: 'ok-mid',
            reserved: false,
            source: 'config',
            steps: ['ok-step', 'ok-step'],
        });
        expect(rows.find((row) => row.name === 'exit-3')?.command).toBe('exit 3');
    });

    test('a string action propagates its exit code and exports SPUR_ACTION', async () => {
        expect((await run(['exit-3'])).code).toBe(3);

        const env = await run(['env-write']);
        expect(env.code).toBe(0);
        expect(await readFile(join(root, 'env.txt'), 'utf8')).toBe('env-write');
    });

    test('-- args are appended to the resolved command', async () => {
        // The child's stdout is inherited by the test process, so the rendered append is
        // asserted in the E2E block above; here the append branch only needs to run.
        expect((await run(['noop', '--', '--my-flag', 'a b'])).code).toBe(0);
    });

    test('a composite runs every step in order and echoes each on stderr', async () => {
        const { code, stderr } = await run(['ok-mid']);
        expect(code).toBe(0);
        expect(stderr.trim().split('\n')).toEqual(['▶ ok-step', '▶ ok-step']);
    });

    test('a nested composite flattens through the resolver', async () => {
        const { code, stderr } = await run(['nested-mid']);
        expect(code).toBe(0);
        expect(stderr.trim().split('\n')).toEqual(['▶ ok-step', '▶ ok-step', '▶ ok-step']);
    });

    test('a composite stops at the first failing step', async () => {
        const { code, stderr } = await run(['fail-mid']);
        expect(code).toBe(7);
        expect(stderr.trim().split('\n')).toEqual(['▶ ok-step', '▶ fail-step']);
    });

    test('--dry-run prints the resolved commands without running them', async () => {
        const { code, stdout } = await run(['fail-mid', '--dry-run']);
        expect(code).toBe(0);
        expect(stdout.split('\n')).toEqual(['exit 0', 'exit 7', 'exit 0']);
    });

    test('--dry-run --json emits the resolved steps as JSON', async () => {
        const { code, stdout } = await run(['nested-mid', '--dry-run', '--json']);
        expect(code).toBe(0);
        expect(JSON.parse(stdout)).toEqual([
            { name: 'ok-step', command: 'exit 0' },
            { name: 'ok-step', command: 'exit 0' },
            { name: 'ok-step', command: 'exit 0' },
        ]);
    });

    test('--json prints the summary after the run', async () => {
        const { code, stdout } = await run(['exit-3', '--json']);
        expect(code).toBe(3);
        const summary = JSON.parse(stdout) as {
            action: string;
            steps: Array<{ name: string; exitCode: number; durationMs: number }>;
            exitCode: number;
        };
        expect(summary.action).toBe('exit-3');
        expect(summary.exitCode).toBe(3);
        expect(summary.steps[0]?.name).toBe('exit-3');
    });

    test('refusals exit 2: missing action, unbound action, composite with arguments', async () => {
        const missing = await run([]);
        expect(missing.code).toBe(2);
        expect(missing.stderr).toContain('usage: spur self exec <action>');

        const unbound = await run(['check']);
        expect(unbound.code).toBe(2);
        expect(unbound.stderr).toContain('action "check" is not bound; add builder.actions.check');

        const compositeArgs = await run(['fail-mid', '--', '--verbose']);
        expect(compositeArgs.code).toBe(2);
        expect(compositeArgs.stderr).toContain('composite action "fail-mid" does not accept arguments');
    });

    test('a composite step that resolves to nothing is refused (unvalidated config)', async () => {
        // Load-time validation rejects this shape, so the resolver's defensive branch is only
        // reachable with an injected config: a composite whose step names no binding.
        const errors: string[] = [];
        let exitCode = 0;
        const ctx = createCliContext({
            cwd: root,
            output: { write: () => {}, error: (message) => errors.push(message) },
            env: {},
            dbUrl: ':memory:',
            spurConfig: {
                builder: { preset: 'none', actions: { broken: ['ghost'] } },
            } as unknown as SpurConfig,
            setExitCode: (code) => {
                exitCode = code;
            },
        });
        const program = new Command().name('spur').exitOverride();
        program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
        registerExecCommand(program, ctx);
        await program.parseAsync(['exec', 'broken'], { from: 'user' });
        expect(exitCode).toBe(2);
        expect(errors.join('\n')).toContain('action "ghost" is not bound; add builder.actions.ghost');
    });

    test('every in-process case drove the dispatcher', () => {
        expect(runCount).toBeGreaterThanOrEqual(11);
    });
});
