import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type ProcessExecutor, type ProcessResult } from '@gobing-ai/ts-runtime';
import { DoctorProbeActionRunner } from '../../../src/workflow/actions/doctor-probe';

function stubExecutor(handler: (opts: { command: string; args: string[] }) => Partial<ProcessResult>): {
    executor: ProcessExecutor;
    calls: Array<{ command: string; args: string[] }>;
} {
    const calls: Array<{ command: string; args: string[] }> = [];
    const executor = {
        run: async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
            calls.push({ command: opts.command, args: opts.args });
            const partial = handler(opts);
            return {
                command: opts.command,
                args: opts.args,
                exitCode: 0,
                stdout: '',
                stderr: '',
                durationMs: 0,
                ...partial,
            };
        },
    };
    // Structural test double for the ProcessExecutor port — the concrete NodeProcessExecutor
    // cannot be injected with canned output, so a minimal run() stub stands in.
    return { executor: executor as unknown as ProcessExecutor, calls };
}

const okAuth = (agent: string) =>
    JSON.stringify({
        agents: [{ name: agent, authenticated: 'authenticated', modelStatus: { status: 'ok', detail: '' } }],
    });

describe('DoctorProbeActionRunner', () => {
    test('writes PASS to resultFile when the executor is authenticated (soft probe returns ok)', async () => {
        const workdir = join(tmpdir(), `doctor-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        const { executor } = stubExecutor(() => ({ stdout: okAuth('omp') }));
        const runner = new DoctorProbeActionRunner(executor, fs);
        const res = await runner.execute(
            { resultFile: '.spur/run/precheck-doctor.status', spurBin: 'spur', agent: 'omp' },
            { runId: 'r1', stateOrNodeId: 'precheck', workdir, vars: {}, env: {} },
        );
        expect(res.ok).toBe(true);
        expect((res.data as { status: string }).status).toBe('PASS');
        expect((await fs.readFile(join(workdir, '.spur/run/precheck-doctor.status'))).trim()).toBe('PASS');
    });

    test('writes FAIL when a non-relay executor is unauthenticated with an explicit auth failure', async () => {
        const workdir = join(tmpdir(), `doctor-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        const { executor } = stubExecutor(() => ({
            stdout: JSON.stringify({
                agents: [
                    {
                        name: 'claude',
                        authenticated: 'unauthenticated',
                        modelStatus: { status: 'error', detail: 'invalid API key' },
                    },
                ],
            }),
        }));
        const runner = new DoctorProbeActionRunner(executor, fs);
        const res = await runner.execute(
            { resultFile: '.spur/run/precheck-doctor.status', spurBin: 'spur', agent: 'claude' },
            { runId: 'r1', stateOrNodeId: 'precheck', workdir, vars: {}, env: {} },
        );
        expect(res.ok).toBe(true);
        expect((res.data as { status: string }).status).toBe('FAIL');
        const output = (res.data as { output: string[] }).output.join('\n');
        expect(output).toContain('precheck: claude auth=unauthenticated probe=auth-fail');
        expect(output).toContain('precheck: FAIL - executor claude is unauthenticated');
        expect((await fs.readFile(join(workdir, '.spur/run/precheck-doctor.status'))).trim()).toBe('FAIL');
    });

    test('omp env-key miss stays soft (PASS) because the CLI cannot see relay-owned credentials', async () => {
        const workdir = join(tmpdir(), `doctor-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        const { executor } = stubExecutor(() => ({
            stdout: JSON.stringify({
                agents: [
                    {
                        name: 'omp',
                        authenticated: 'unauthenticated',
                        modelStatus: { status: 'error', detail: 'API key not found for provider volc' },
                    },
                ],
            }),
        }));
        const runner = new DoctorProbeActionRunner(executor, fs);
        const res = await runner.execute(
            { resultFile: '.spur/run/precheck-doctor.status', spurBin: 'spur', agent: 'omp' },
            { runId: 'r1', stateOrNodeId: 'precheck', workdir, vars: {}, env: {} },
        );
        expect(res.ok).toBe(true);
        expect((res.data as { status: string }).status).toBe('PASS');
        const output = (res.data as { output: string[] }).output.join('\n');
        expect(output).toContain('probe=env-miss');
        expect(output).toContain('SOFT - executor omp auth probe cannot see agent-owned credentials');
        expect((await fs.readFile(join(workdir, '.spur/run/precheck-doctor.status'))).trim()).toBe('PASS');
    });

    test('probes both executors with a divergence line when implementAgent differs', async () => {
        const workdir = join(tmpdir(), `doctor-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        const { executor, calls } = stubExecutor(() => ({ stdout: okAuth('x') }));
        const runner = new DoctorProbeActionRunner(executor, fs);
        const res = await runner.execute(
            {
                resultFile: '.spur/run/precheck-doctor.status',
                spurBin: 'spur',
                agent: 'claude',
                implementAgent: 'omp',
            },
            { runId: 'r1', stateOrNodeId: 'precheck', workdir, vars: {}, env: {} },
        );
        expect(res.ok).toBe(true);
        expect(calls.length).toBe(2);
        expect(calls[0]?.args).toContain('claude');
        expect(calls[1]?.args).toContain('omp');
        const output = (res.data as { output: string[] }).output.join('\n');
        expect(output).toContain('(executors diverge)');
    });

    test('probes a single executor when implementAgent equals agent', async () => {
        const workdir = join(tmpdir(), `doctor-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        const { executor, calls } = stubExecutor(() => ({ stdout: okAuth('omp') }));
        const runner = new DoctorProbeActionRunner(executor, fs);
        const res = await runner.execute(
            {
                resultFile: '.spur/run/precheck-doctor.status',
                spurBin: 'spur',
                agent: 'omp',
                implementAgent: 'omp',
            },
            { runId: 'r1', stateOrNodeId: 'precheck', workdir, vars: {}, env: {} },
        );
        expect(res.ok).toBe(true);
        expect(calls.length).toBe(1);
        expect((res.data as { output: string[] }).output.join('\n')).not.toContain('(executors diverge)');
    });

    test('writes FAIL when the doctor process exits non-zero', async () => {
        const workdir = join(tmpdir(), `doctor-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        const { executor } = stubExecutor(() => ({ exitCode: 2, stderr: 'spur: agent doctor failed' }));
        const runner = new DoctorProbeActionRunner(executor, fs);
        const res = await runner.execute(
            { resultFile: '.spur/run/precheck-doctor.status', spurBin: 'spur', agent: 'claude' },
            { runId: 'r1', stateOrNodeId: 'precheck', workdir, vars: {}, env: {} },
        );
        expect(res.ok).toBe(true);
        expect((res.data as { status: string }).status).toBe('FAIL');
        expect((res.data as { output: string[] }).output.join('\n')).toContain(
            'FAIL - doctor exited non-zero for claude',
        );
    });

    test('rejects resultFile outside .spur/run/', async () => {
        const runner = new DoctorProbeActionRunner();
        const res = await runner.execute(
            { resultFile: 'outside.status', spurBin: 'spur', agent: 'omp' },
            { runId: 'r1', stateOrNodeId: 'precheck', workdir: process.cwd(), vars: {}, env: {} },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('must resolve beneath .spur/run/');
    });

    test('rejects sibling directories that merely prefix .spur/run/ (boundary compare)', async () => {
        const runner = new DoctorProbeActionRunner();
        const workdir = join(tmpdir(), `doctor-${crypto.randomUUID()}`);
        for (const bad of ['.spur/run-evil/precheck.status', '.spur/run2/precheck.status']) {
            const res = await runner.execute(
                { resultFile: bad, spurBin: 'spur', agent: 'omp' },
                { runId: 'r1', stateOrNodeId: 'precheck', workdir, vars: {}, env: {} },
            );
            expect(res.ok).toBe(false);
            expect(res.error).toContain('must resolve beneath .spur/run/');
        }
    });

    test('splits a multi-token spurBin launch string into argv without a shell', async () => {
        const workdir = join(tmpdir(), `doctor-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        const { executor, calls } = stubExecutor(() => ({ stdout: okAuth('omp') }));
        const runner = new DoctorProbeActionRunner(executor, fs);
        const res = await runner.execute(
            {
                resultFile: '.spur/run/precheck-doctor.status',
                spurBin: '/usr/bin/bun /repo/apps/cli/src/index.ts',
                agent: 'omp',
            },
            { runId: 'r1', stateOrNodeId: 'precheck', workdir, vars: {}, env: {} },
        );
        expect(res.ok).toBe(true);
        expect(calls[0]?.command).toBe('/usr/bin/bun');
        expect(calls[0]?.args).toEqual(['/repo/apps/cli/src/index.ts', 'agent', 'doctor', 'omp', '--json']);
    });

    test('rejects a spurBin carrying shell metacharacters', async () => {
        const runner = new DoctorProbeActionRunner();
        const res = await runner.execute(
            { resultFile: '.spur/run/x.status', spurBin: 'spur && rm -rf /', agent: 'omp' },
            { runId: 'r1', stateOrNodeId: 'precheck', workdir: process.cwd(), vars: {}, env: {} },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('shell metacharacters');
    });

    test('unparseable doctor output degrades to unknown auth without failing the run', async () => {
        const workdir = join(tmpdir(), `doctor-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        const { executor } = stubExecutor(() => ({ stdout: 'not json' }));
        const runner = new DoctorProbeActionRunner(executor, fs);
        const res = await runner.execute(
            { resultFile: '.spur/run/precheck-doctor.status', spurBin: 'spur', agent: 'claude' },
            { runId: 'r1', stateOrNodeId: 'precheck', workdir, vars: {}, env: {} },
        );
        expect(res.ok).toBe(true);
        expect((res.data as { status: string }).status).toBe('PASS');
        expect((res.data as { output: string[] }).output.join('\n')).toContain('auth=unknown probe=unknown');
    });
});
