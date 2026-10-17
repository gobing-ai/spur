import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentFleet } from '@gobing-ai/spur-config';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { AgentRunInvocation, AgentRunTracedResult, AgentService } from '../../../src/services/agent-service';
import type { FleetDispatchRequest, FleetReceipt } from '../../../src/services/fleet-dispatcher';
import type { FleetService, ResolvedFleetMember } from '../../../src/services/fleet-service';
import { AgentRunActionRunner } from '../../../src/workflow/actions/agent-run';
import type { FleetDispatchDeps } from '../../../src/workflow/fleet-dispatch';
import { readReceipt, readWorkItem, receiptPath } from '../../../src/workflow/receipt';

function workdir(): string {
    return mkdtempSync(join(tmpdir(), 'spur-agent-run-receipt-'));
}

function makeCtx(workdirPath: string, vars: Record<string, string> = {}): ActionRunContext {
    return { runId: 'run-1', stateOrNodeId: 'implement', workdir: workdirPath, vars, env: {} };
}

function invocation(): AgentRunInvocation {
    return {
        agent: 'claude',
        source: 'default',
        command: 'claude',
        argv: ['-p', 'implement'],
        cwd: '/tmp',
        mode: 'text',
        outputMode: 'buffered',
        continue: false,
        stdinInteractive: false,
    };
}

function svcWithRunTraced(result: Partial<AgentRunTracedResult>): { svc: AgentService; calls: () => number } {
    let calls = 0;
    return {
        svc: {
            runTraced: async () => {
                calls += 1;
                return { exitCode: 0, stdout: '', invocation: invocation(), ...result } as AgentRunTracedResult;
            },
        } as unknown as AgentService,
        calls: () => calls,
    };
}

/** A dispatch that produces the declared artifact, the way a real executor would. */
function svcWritingArtifact(workdirPath: string, path: string): AgentService {
    return {
        runTraced: async () => {
            mkdirSync(join(workdirPath, path, '..'), { recursive: true });
            writeFileSync(join(workdirPath, path), 'implemented', 'utf8');
            return { exitCode: 0, stdout: '', invocation: invocation() };
        },
    } as unknown as AgentService;
}

function fleetDeps(
    workdirPath: string,
    receipt: FleetReceipt,
): FleetDispatchDeps & { dispatchCalls: FleetDispatchRequest[] } {
    const dispatchCalls: FleetDispatchRequest[] = [];
    return {
        fleet: {
            load: async () => ({ enabled: true, strategy: 'rest', members: [] }) as unknown as AgentFleet,
            resolve: async () => ({
                projectPath: workdirPath,
                enabled: true,
                members: [
                    {
                        instanceId: 'proj-coder',
                        role: 'coder',
                        executor: 'claude',
                        enabled: true,
                        writeCapable: true,
                    } as ResolvedFleetMember,
                ],
                missing: [],
            }),
        } as unknown as FleetService,
        dispatcher: {
            enqueue: async (request: FleetDispatchRequest) => {
                dispatchCalls.push(request);
                return { messageId: 'msg-1', replayed: false };
            },
            awaitReceipt: async () => receipt,
        },
        now: () => 1,
        dispatchCalls,
    };
}

describe('agent.run host executor (D65 1232)', () => {
    test('writes the work item and dispatches nothing', async () => {
        const dir = workdir();
        const { svc, calls } = svcWithRunTraced({});
        const runner = new AgentRunActionRunner(svc);

        const result = await runner.execute(
            {
                role: 'coder',
                input: 'Implement task 1232',
                skill: 'sp-code-implementation',
                expectFile: '.spur/run/out.txt',
                ownedSections: ['Solution'],
                inputs: [{ path: 'docs/tasks5/1232_task.md', kind: 'task' }],
            },
            makeCtx(dir, { executor: 'host' }),
        );

        expect(calls()).toBe(0);
        expect(result.ok).toBe(true);
        expect(result.data?.surface).toBe('host');
        expect(await readWorkItem(createNodeFileSystem(dir), dir, 'run-1')).toEqual({
            runId: 'run-1',
            state: 'implement',
            skill: 'sp-code-implementation',
            prompt: 'Implement task 1232',
            inputs: [{ path: 'docs/tasks5/1232_task.md', kind: 'task' }],
            expectFiles: ['.spur/run/out.txt'],
            ownedSections: ['Solution'],
        });
    });

    test('declare nothing: skill is null and the file/section claims are empty arrays', async () => {
        const dir = workdir();
        const runner = new AgentRunActionRunner(svcWithRunTraced({}).svc);

        await runner.execute({ role: 'coder', input: 'go' }, makeCtx(dir, { executor: 'host' }));

        expect(await readWorkItem(createNodeFileSystem(dir), dir, 'run-1')).toMatchObject({
            skill: null,
            expectFiles: [],
            ownedSections: [],
            inputs: [],
        });
    });

    test('removes a stale declared artifact before pausing, so a prior run cannot satisfy the receipt', async () => {
        const dir = workdir();
        mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
        writeFileSync(join(dir, '.spur', 'run', 'out.txt'), 'stale', 'utf8');
        const runner = new AgentRunActionRunner(svcWithRunTraced({}).svc);

        const result = await runner.execute(
            { role: 'coder', input: 'go', expectFile: '.spur/run/out.txt' },
            makeCtx(dir, { executor: 'host' }),
        );

        expect(result.ok).toBe(true);
        expect(createNodeFileSystem(dir).exists(join(dir, '.spur', 'run', 'out.txt'))).toBe(false);
    });

    test('refuses a host dispatch with no prompt', async () => {
        const dir = workdir();
        const runner = new AgentRunActionRunner(svcWithRunTraced({}).svc);

        const result = await runner.execute({ role: 'coder', input: '  ' }, makeCtx(dir, { executor: 'host' }));

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/requires an input prompt/);
        expect(await readWorkItem(createNodeFileSystem(dir), dir, 'run-1')).toBeNull();
    });
});

describe('agent.run durable receipts (D65 1232)', () => {
    test('subprocess: a clean dispatch leaves a done receipt for the stage', async () => {
        const dir = workdir();
        const runner = new AgentRunActionRunner(svcWritingArtifact(dir, '.spur/run/out.txt'));

        const result = await runner.execute(
            { role: 'coder', input: 'go', expectFile: '.spur/run/out.txt' },
            makeCtx(dir),
        );

        expect(result.ok).toBe(true);
        const receipt = await readReceipt(createNodeFileSystem(dir), dir, receiptPath(dir, 'run-1', 'implement'));
        expect(receipt).toMatchObject({
            runId: 'run-1',
            state: 'implement',
            executor: 'subprocess',
            outcome: 'done',
            files: ['.spur/run/out.txt'],
            reason: null,
        });
    });

    test('subprocess: a non-zero exit leaves a failed receipt', async () => {
        const dir = workdir();
        const runner = new AgentRunActionRunner(svcWithRunTraced({ exitCode: 2, stderr: 'boom' }).svc);

        const result = await runner.execute({ role: 'coder', input: 'go' }, makeCtx(dir));

        expect(result.ok).toBe(false);
        const receipt = await readReceipt(createNodeFileSystem(dir), dir, receiptPath(dir, 'run-1', 'implement'));
        expect(receipt?.outcome).toBe('failed');
        expect(receipt?.reason).toContain('exited with code 2');
    });

    // ADR-118 third outcome: a clean exit that missed its declared post-condition.
    test('subprocess: a missed declared post-condition leaves a contract-violation receipt naming the contract', async () => {
        const dir = workdir();
        const runner = new AgentRunActionRunner(svcWithRunTraced({}).svc);

        const result = await runner.execute(
            { role: 'coder', input: 'go', expectFile: '.spur/run/never-written.txt' },
            makeCtx(dir),
        );

        expect(result.ok).toBe(false);
        const receipt = await readReceipt(createNodeFileSystem(dir), dir, receiptPath(dir, 'run-1', 'implement'));
        expect(receipt).toMatchObject({ outcome: 'contract-violation', contract: 'expectFile' });
    });

    // ADR-126 A4: a wait/termination timeout is outcome-unknown — never failure.
    test('subprocess: a timed-out dispatch leaves an outcome-unknown receipt', async () => {
        const dir = workdir();
        const runner = new AgentRunActionRunner(svcWithRunTraced({ exitCode: 3, signal: 'SIGTERM' }).svc);

        await runner.execute({ role: 'coder', input: 'go', timeoutMs: 1000 }, makeCtx(dir));

        const receipt = await readReceipt(createNodeFileSystem(dir), dir, receiptPath(dir, 'run-1', 'implement'));
        expect(receipt?.outcome).toBe('outcome-unknown');
    });

    test('fleet: a completed dispatch writes the same receipt shape as the subprocess surface', async () => {
        const subprocessDir = workdir();
        const subprocessRunner = new AgentRunActionRunner(svcWithRunTraced({}).svc);
        await subprocessRunner.execute({ role: 'coder', input: 'go' }, makeCtx(subprocessDir));
        const subprocessReceipt = await readReceipt(
            createNodeFileSystem(subprocessDir),
            subprocessDir,
            receiptPath(subprocessDir, 'run-1', 'implement'),
        );

        const fleetDir = workdir();
        const deps = fleetDeps(fleetDir, { status: 'completed', messageId: 'msg-1', runId: 'run-1' });
        const fleetRunner = new AgentRunActionRunner(svcWithRunTraced({}).svc, undefined, undefined, {}, deps);
        const result = await fleetRunner.execute(
            { role: 'coder', input: 'go' },
            makeCtx(fleetDir, { executor: 'fleet' }),
        );
        expect(result.ok).toBe(true);
        const fleetReceipt = await readReceipt(
            createNodeFileSystem(fleetDir),
            fleetDir,
            receiptPath(fleetDir, 'run-1', 'implement'),
        );

        expect(fleetReceipt).toMatchObject({ executor: 'fleet', outcome: 'done', runId: 'run-1', state: 'implement' });
        expect(Object.keys(fleetReceipt ?? {}).sort()).toEqual(Object.keys(subprocessReceipt ?? {}).sort());
    });

    test('fleet: a definite not-started receipt is recorded as not-started', async () => {
        const dir = workdir();
        const deps = fleetDeps(dir, { status: 'not-started', messageId: 'msg-1', runId: 'run-1' });
        const runner = new AgentRunActionRunner(svcWithRunTraced({}).svc, undefined, undefined, {}, deps);

        await runner.execute({ role: 'coder', input: 'go' }, makeCtx(dir, { executor: 'fleet' }));

        const receipt = await readReceipt(createNodeFileSystem(dir), dir, receiptPath(dir, 'run-1', 'implement'));
        expect(receipt?.outcome).toBe('not-started');
    });

    test('fleet: a wait timeout is recorded as outcome-unknown, never failed', async () => {
        const dir = workdir();
        const deps = fleetDeps(dir, { status: 'outcome-unknown', messageId: 'msg-1', runId: 'run-1' });
        const runner = new AgentRunActionRunner(svcWithRunTraced({}).svc, undefined, undefined, {}, deps);

        const result = await runner.execute({ role: 'coder', input: 'go' }, makeCtx(dir, { executor: 'fleet' }));

        expect(result.ok).toBe(false);
        const receipt = await readReceipt(createNodeFileSystem(dir), dir, receiptPath(dir, 'run-1', 'implement'));
        expect(receipt?.outcome).toBe('outcome-unknown');
    });
});
