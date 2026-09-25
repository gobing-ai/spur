import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentFleet } from '@gobing-ai/spur-config';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentCoordinationService, SendResult } from '../../src/services/agent-coordination-service';
import type { AgentRunInvocation, AgentRunTracedResult, AgentService } from '../../src/services/agent-service';
import type { FleetService, ResolvedFleetMember } from '../../src/services/fleet-service';
import { AgentRunActionRunner } from '../../src/workflow/actions/agent-run';
import type { FleetDispatchDeps } from '../../src/workflow/fleet-dispatch';

function makeCtx(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
    return { runId: 'test-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {}, ...overrides };
}

function invocation(overrides: Partial<AgentRunInvocation> = {}): AgentRunInvocation {
    return {
        agent: 'claude',
        source: 'default',
        command: 'claude',
        argv: ['-p', 'hello'],
        cwd: '/tmp',
        mode: 'text',
        outputMode: 'buffered',
        continue: false,
        stdinInteractive: false,
        ...overrides,
    };
}

function svcWithRunTraced(result: Partial<AgentRunTracedResult>): AgentService {
    return { runTraced: async () => ({ exitCode: 0, stdout: '', ...result }) } as unknown as AgentService;
}

/** AgentService whose runTraced records that the traditional subprocess path ran. */
function subprocessSpy(): { svc: AgentService; calls: () => number } {
    let n = 0;
    return {
        svc: {
            runTraced: async () => {
                n += 1;
                return { exitCode: 0, stdout: '', invocation: invocation() };
            },
        } as unknown as AgentService,
        calls: () => n,
    };
}

function member(overrides: Partial<ResolvedFleetMember> = {}): ResolvedFleetMember {
    return {
        instanceId: 'proj-coder',
        role: 'coder',
        executor: 'claude',
        enabled: true,
        writeCapable: true,
        capabilityState: 'enforced',
        ...overrides,
    };
}

/**
 * Fleet deps over fakes, driving the REAL dispatchToFleet — the prompt artifact
 * lands in the temp workdir, the wait never blocks, and the send is a value.
 */
function fleetDeps(
    workdir: string,
    opts: { fileAppears?: boolean; members?: ResolvedFleetMember[]; declaration?: AgentFleet | null } = {},
): FleetDispatchDeps {
    let tick = 0;
    const waitForCalls: number[] = [];
    return {
        fleet: {
            load: async () =>
                opts.declaration !== undefined
                    ? opts.declaration
                    : ({ enabled: true, strategy: 'rest', members: [] } as unknown as AgentFleet),
            resolve: async () => ({
                projectPath: workdir,
                enabled: true,
                members: opts.members ?? [member()],
                missing: [],
            }),
        } as unknown as FleetService,
        coordination: {
            sendMessage: async (): Promise<SendResult> => ({
                msgId: 'msg-fleet-1',
                toId: 'proj-coder',
                status: 'queued',
                injected: false,
            }),
        } as unknown as AgentCoordinationService,
        waitForFile: async () => {
            waitForCalls.push(1);
            return opts.fileAppears !== false;
        },
        now: () => (tick += 5),
    };
}

function newRunner(svc: AgentService, deps?: FleetDispatchDeps): AgentRunActionRunner {
    return deps === undefined
        ? new AgentRunActionRunner(svc)
        : new AgentRunActionRunner(svc, undefined, undefined, {}, deps);
}

describe('agent.run fleet executor surface (0942/ADR-126)', () => {
    test('R4: a fleet success row carries the shared subprocess evidence keys plus fleet-only identity ids', async () => {
        const workdir = mkdtempSync(join(tmpdir(), 'agent-run-fleet-'));
        try {
            // Subprocess baseline row (default path, untouched by this task). The
            // fake executor writes the declared artifact so the subprocess contract
            // check passes and the row carries the same expectFile evidence.
            const baselineSvc = {
                runTraced: async () => {
                    mkdirSync(join(workdir, 'out'), { recursive: true });
                    writeFileSync(join(workdir, 'out', 'verdict.md'), 'verdict: pass');
                    return { exitCode: 0, stdout: '', invocation: invocation() };
                },
            } as unknown as AgentService;
            const baseline = await newRunner(baselineSvc).execute(
                { role: 'coder', input: 'hello', expectFile: 'out/verdict.md' },
                makeCtx({ workdir }),
            );
            expect(baseline.ok).toBe(true);
            const baseData = baseline.data as Record<string, unknown>;
            expect(baseData.exitCode).toBe(0);

            const fleet = await newRunner(svcWithRunTraced({ invocation: invocation() }), fleetDeps(workdir)).execute(
                { role: 'coder', input: 'hello', expectFile: 'out/verdict.md' },
                makeCtx({ workdir, vars: { executor: 'fleet' } }),
            );
            expect(fleet.ok).toBe(true);
            const data = fleet.data as Record<string, unknown>;
            // Shared evidence keys — who ran and usage availability are recorded by
            // BOTH surfaces for the same declared contract. The subprocess row
            // proves expectFile through its post-exit contract check (ok:true with
            // the artifact present), while the fleet row names it as a column; the
            // fleet row additionally records its duration and terminal reason (R4).
            for (const key of ['agent', 'usage']) {
                expect(baseData[key]).toBeDefined();
                expect(data[key]).toBeDefined();
            }
            expect(data.expectFile).toBe('out/verdict.md');
            expect(data.durationMs).toBeDefined();
            expect(data.reason).toBe('done');
            // Fleet-only identity columns (R4): the control-plane ids the design
            // adds. exitCode/invocation stay subprocess-transport-only: a member
            // dispatch has no child process, so those keys are absent.
            expect(data.surface).toBe('fleet');
            expect(data.memberId).toBe('proj-coder');
            expect(data.messageId).toBe('msg-fleet-1');
            expect(baseData.surface).toBeUndefined();
            expect(baseData.memberId).toBeUndefined();
            expect(baseData.messageId).toBeUndefined();
            expect(data.exitCode).toBeUndefined();
        } finally {
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    test('the fleet surface never spawns the traditional subprocess on success', async () => {
        const workdir = mkdtempSync(join(tmpdir(), 'agent-run-fleet-'));
        try {
            const { svc, calls } = subprocessSpy();
            const result = await newRunner(svc, fleetDeps(workdir)).execute(
                { role: 'coder', input: 'hello' },
                makeCtx({ workdir, vars: { executor: 'fleet' } }),
            );
            expect(result.ok).toBe(true);
            expect(calls()).toBe(0);
        } finally {
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    test('R3: an unavailable fleet without a declared fallback fails explicitly with failed-agent', async () => {
        const workdir = mkdtempSync(join(tmpdir(), 'agent-run-fleet-'));
        try {
            const { svc, calls } = subprocessSpy();
            const result = await newRunner(svc, fleetDeps(workdir, { declaration: null })).execute(
                { role: 'coder', input: 'hello' },
                makeCtx({ workdir, vars: { executor: 'fleet' } }),
            );
            expect(result.ok).toBe(false);
            expect(result.error).toContain('failed-agent');
            const data = result.data as Record<string, unknown>;
            expect(data.reason).toBe('failed-agent');
            expect(data.surface).toBe('fleet');
            // No silent downgrade: the subprocess path never ran.
            expect(calls()).toBe(0);
        } finally {
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    test('R3: executorFallback traditional reruns the stage on the traditional subprocess, naming why', async () => {
        const workdir = mkdtempSync(join(tmpdir(), 'agent-run-fleet-'));
        try {
            const { svc, calls } = subprocessSpy();
            const result = await newRunner(svc, fleetDeps(workdir, { declaration: null })).execute(
                { role: 'coder', input: 'hello' },
                makeCtx({ workdir, vars: { executor: 'fleet', executorFallback: 'traditional' } }),
            );
            expect(result.ok).toBe(true);
            expect(calls()).toBe(1);
            const data = result.data as Record<string, unknown>;
            expect(typeof data.fallbackReason).toBe('string');
            expect(data.surface).toBeUndefined();
        } finally {
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    test('R3: a fleet-fallback contract violation carries both the terminal outcome and the fallback reason', async () => {
        const workdir = mkdtempSync(join(tmpdir(), 'agent-run-fleet-'));
        try {
            // Fleet unavailable + declared fallback → the traditional subprocess
            // reruns and then violates its declared expectFile post-condition
            // (exit 0, file never written). The early contract-violation return
            // must still carry the fallbackReason stamp (P3#1) so the trace row
            // names BOTH the violated contract and why the subprocess ran.
            const { svc } = subprocessSpy();
            const result = await newRunner(svc, fleetDeps(workdir, { declaration: null })).execute(
                { role: 'coder', input: 'hello', expectFile: 'out/verdict.md' },
                makeCtx({ workdir, vars: { executor: 'fleet', executorFallback: 'traditional' } }),
            );
            expect(result.ok).toBe(false);
            const data = result.data as Record<string, unknown>;
            expect(data.outcome).toBe('contract-violation');
            expect(data.contract).toBe('expectFile');
            expect(data.observed).toBe('missing');
            expect(typeof data.fallbackReason).toBe('string');
        } finally {
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    test('default path is unchanged: without the run var the fleet deps are never consulted', async () => {
        const workdir = mkdtempSync(join(tmpdir(), 'agent-run-fleet-'));
        try {
            const { svc, calls } = subprocessSpy();
            const result = await newRunner(svc, fleetDeps(workdir)).execute(
                { role: 'coder', input: 'hello' },
                makeCtx({ workdir }),
            );
            expect(result.ok).toBe(true);
            expect(calls()).toBe(1);
            expect((result.data as Record<string, unknown>).surface).toBeUndefined();
        } finally {
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    test('subprocess-only options fail loud on the fleet surface instead of dropping guarantees', async () => {
        const workdir = mkdtempSync(join(tmpdir(), 'agent-run-fleet-'));
        try {
            const waits: number[] = [];
            const deps = fleetDeps(workdir);
            const original = deps.waitForFile;
            deps.waitForFile = async (path, timeoutMs) => {
                waits.push(1);
                return original(path, timeoutMs);
            };
            const { svc, calls } = subprocessSpy();
            const result = await newRunner(svc, deps).execute(
                { role: 'coder', input: 'hello', requireDiff: true },
                makeCtx({ workdir, vars: { executor: 'fleet' } }),
            );
            expect(result.ok).toBe(false);
            expect(result.error).toContain('subprocess-surface only');
            expect(waits.length).toBe(0);
            expect(calls()).toBe(0);
        } finally {
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    test('a member that accepted work but never wrote expectFile times out — no double execution', async () => {
        const workdir = mkdtempSync(join(tmpdir(), 'agent-run-fleet-'));
        try {
            const { svc, calls } = subprocessSpy();
            const result = await newRunner(svc, fleetDeps(workdir, { fileAppears: false })).execute(
                { role: 'coder', input: 'hello', expectFile: 'out/verdict.md' },
                makeCtx({ workdir, vars: { executor: 'fleet' } }),
            );
            expect(result.ok).toBe(false);
            const data = result.data as Record<string, unknown>;
            expect(data.reason).toBe('failed-timeout');
            expect(result.error).toContain('expectFile');
            expect(calls()).toBe(0);
        } finally {
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    test('delete-before-invoke: a stale expectFile from a prior run cannot satisfy the wait', async () => {
        const workdir = mkdtempSync(join(tmpdir(), 'agent-run-fleet-'));
        try {
            mkdirSync(join(workdir, 'out'), { recursive: true });
            writeFileSync(join(workdir, 'out', 'verdict.md'), 'stale');
            const result = await newRunner(svcWithRunTraced({}), fleetDeps(workdir, { fileAppears: false })).execute(
                { role: 'coder', input: 'hello', expectFile: 'out/verdict.md' },
                makeCtx({ workdir, vars: { executor: 'fleet' } }),
            );
            // The stale file was deleted before dispatch, so the (fake) wait that
            // never sees a fresh artifact reports a timeout instead of a fake pass.
            expect(result.ok).toBe(false);
            expect(existsSync(join(workdir, 'out', 'verdict.md'))).toBe(false);
        } finally {
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    test('a host that wired no fleet deps fails the selected surface explicitly', async () => {
        const { svc, calls } = subprocessSpy();
        const result = await newRunner(svc).execute(
            { role: 'coder', input: 'hello' },
            makeCtx({ vars: { executor: 'fleet' } }),
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no fleet dispatch');
        expect(calls()).toBe(0);
    });

    test('mapFleetExecutorVar seam: vars.executor reaches the action context through the run var only', async () => {
        // Guard the frozen var name against accidental renames (executor: 'fleet').
        const result = await newRunner(svcWithRunTraced({}), fleetDeps('/tmp', { declaration: null })).execute(
            { role: 'coder', input: 'hello' },
            makeCtx({ vars: { executor: 'Fleet' } }),
        );
        // Wrong-case value is NOT the fleet selector — it falls through to the
        // subprocess path (declaration null is irrelevant there).
        expect(result.ok).toBe(true);
    });
});
