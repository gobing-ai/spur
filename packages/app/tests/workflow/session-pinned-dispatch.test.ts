/**
 * Session-pinned dispatch (B7 / task 0894): run-scoped executor pins, per-role
 * session slots, and the stage session policy. Each describe block names the
 * requirement it pins — the design contract lives in
 * docs/design/session-pinned-dispatch.md.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionRunContext, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
import { createDefaultWorkflowEngineHost } from '@gobing-ai/ts-dual-workflow-engine';
import { EventBus } from '@gobing-ai/ts-infra';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type {
    AgentResolveResult,
    AgentRunInvocation,
    AgentRunTracedResult,
    AgentService,
} from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowAppService } from '../../src/services/workflow-service';
import { AgentRunActionRunner, parseExecutorPin } from '../../src/workflow/actions/agent-run';
import { DoctorProbeActionRunner } from '../../src/workflow/actions/doctor-probe';
import { registerSpurBuiltins } from '../../src/workflow/builtins';
import type { WorkflowObservabilityEventMap } from '../../src/workflow/observability';

function makeCtx(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
    return { runId: 'run-b7', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {}, ...overrides };
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

/** AgentService stub: counts `resolve` calls (the doctor-walk proxy) and captures dispatch flags. */
function svcSpy(
    onFlags: (flags: Record<string, string | boolean>) => void,
    result: Partial<AgentRunTracedResult> = {},
): { svc: AgentService; resolveCalls: () => number } {
    let resolveCount = 0;
    const svc = {
        resolve: async () => {
            resolveCount++;
            return { ok: true, agent: 'claude' } as const;
        },
        runTraced: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
            onFlags(flags);
            return { exitCode: 0, stdout: '', invocation: invocation(), ...result };
        },
    } as unknown as AgentService;
    return { svc, resolveCalls: () => resolveCount };
}

/** The B8 runner record shape pins carry (0894 R1 reads whichever fields exist). */
const RESUME_CAPABLE: Record<string, boolean> = {
    supportsResumeById: true,
    supportsSessionDir: true,
    supportsPersistentStdin: true,
    supportsStructuredOutput: true,
};

const CODER_PIN = { name: 'pi-coder', agent: 'pi', model: 'm-pin', capabilities: RESUME_CAPABLE };

function pinnedCtx(extraVars: Record<string, string> = {}): ActionRunContext {
    return makeCtx({
        vars: { '__executor.coder': JSON.stringify(CODER_PIN), ...extraVars },
    });
}

function affinityRunner(svc: AgentService): AgentRunActionRunner {
    return new AgentRunActionRunner(svc, undefined, undefined, { sessionAffinity: true });
}

describe('0894 R1: run-scoped executor pin — dispatch performs no per-stage resolve', () => {
    test('pinned dispatch sends the pin executor with pinResolved and no resolve call', async () => {
        let captured: Record<string, string | boolean> = {};
        const { svc, resolveCalls } = svcSpy((f) => {
            captured = f;
        });
        const runner = affinityRunner(svc);
        const result = await runner.execute({ role: 'coder', input: 'do the work' }, pinnedCtx());

        expect(result.ok).toBe(true);
        expect(resolveCalls()).toBe(0);
        expect(captured.agent).toBe('pi-coder');
        expect(captured.pinResolved).toBe('true');
        // Pin model applies only when the step declares none of its own.
        expect(captured.model).toBe('m-pin');
        const data = result.data as Record<string, unknown>;
        expect(data.agent).toBe('pi-coder');
        expect(data.model).toBe('m-pin');
    });

    test('the requiresCapabilities gate reads the pin instead of calling resolve (R1: fails on any doctor call)', async () => {
        let captured: Record<string, string | boolean> = {};
        const { svc, resolveCalls } = svcSpy((f) => {
            captured = f;
        });
        const runner = affinityRunner(svc);
        const result = await runner.execute(
            { role: 'coder', input: 'do the work', requiresCapabilities: { resumeById: 'enforced' } },
            pinnedCtx(),
        );

        expect(result.ok).toBe(true);
        expect(resolveCalls()).toBe(0);
        expect(captured.agent).toBe('pi-coder');
    });

    test('the executor-distinctness gate reads the pin instead of calling resolve', async () => {
        let captured: Record<string, string | boolean> = {};
        const { svc, resolveCalls } = svcSpy((f) => {
            captured = f;
        });
        const runner = affinityRunner(svc);
        const result = await runner.execute(
            {
                role: 'reviewer',
                input: 'review it',
                priority: 0,
                compareExecutorWith: 'implement',
            },
            makeCtx({
                vars: {
                    '__executor.reviewer': JSON.stringify({
                        name: 'pi-reviewer',
                        agent: 'pi',
                        capabilities: RESUME_CAPABLE,
                    }),
                    __agentRouting_implement: JSON.stringify({ agent: 'claude' }),
                },
            }),
        );

        expect(result.ok).toBe(true);
        expect(resolveCalls()).toBe(0);
        expect(captured.agent).toBe('pi-reviewer');
    });

    test('an unpinned stage resolves the way it always did (control)', async () => {
        let captured: Record<string, string | boolean> = {};
        const { svc, resolveCalls } = svcSpy((f) => {
            captured = f;
        });
        const runner = affinityRunner(svc);
        const result = await runner.execute(
            { role: 'coder', input: 'do the work', requiresCapabilities: { resumeById: 'enforced' } },
            makeCtx(),
        );

        expect(result.ok).toBe(true);
        expect(resolveCalls()).toBe(1);
        expect(captured.pinResolved).toBeUndefined();
    });

    test('a corrupt pin degrades to unpinned dispatch instead of failing the run', async () => {
        const { svc, resolveCalls } = svcSpy(() => {});
        const runner = affinityRunner(svc);
        const result = await runner.execute(
            { role: 'coder', input: 'do the work' },
            makeCtx({ vars: { '__executor.coder': '{not-json' } }),
        );

        expect(result.ok).toBe(true);
        expect(resolveCalls()).toBe(0);
    });
});

describe('0894 R2: per-role session slots', () => {
    test('a coder stage writes its session dir to the role slot, not the legacy global', async () => {
        let captured: Record<string, string | boolean> = {};
        const { svc } = svcSpy((f) => {
            captured = f;
        });
        const runner = affinityRunner(svc);
        const result = await runner.execute({ role: 'coder', input: 'step one' }, pinnedCtx());

        expect(result.ok).toBe(true);
        const setVars = result.setVars as Record<string, unknown>;
        expect(setVars['__session.coder.dir']).toBeDefined();
        expect(setVars.__agentSessionDir).toBeUndefined();
        // ADR-047: the explicit agent pin never emits a global continue — the
        // resolved invocation agent differs from the dispatch selector here.
        expect(captured.continue).toBeUndefined();
    });

    test('the next coder stage resumes the role slot (sessionId + dir) and records reused', async () => {
        let captured: Record<string, string | boolean> = {};
        const { svc } = svcSpy((f) => {
            captured = f;
        });
        const runner = affinityRunner(svc);
        const ctx = pinnedCtx({
            __agentSession: 'open',
            __agentSessionAgent: 'pi-coder',
            '__session.coder.dir': '/tmp/.spur/run/run-b7/agent-sessions/pi-coder',
            '__session.coder.id': 'sess-9',
        });
        const result = await runner.execute({ role: 'coder', input: 'step two' }, ctx);

        expect(result.ok).toBe(true);
        // Affinity resumes via sessionDir/sessionId — bare `continue` stays unset.
        expect(captured.sessionDir).toBe('/tmp/.spur/run/run-b7/agent-sessions/pi-coder');
        expect(captured.sessionId).toBe('sess-9');
        expect(result.data).toMatchObject({ session: 'reused', sessionSource: 'default' });
    });
});

describe('0894 R3: session option, role defaults, closed vocabulary', () => {
    test("session: 'wat' fails the step at the action boundary", async () => {
        const { svc } = svcSpy(() => {});
        const runner = affinityRunner(svc);
        const result = await runner.execute({ role: 'coder', input: 'x', session: 'wat' }, pinnedCtx());

        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toContain("'reuse' or 'fresh'");
    });

    test('workflow validate rejects an agent.run step with an out-of-vocabulary session', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-wf-session-'));
        try {
            const path = join(dir, 'session.yaml');
            const lines = [
                'name: badsession',
                'kind: state-machine',
                'initialState: start',
                'states:',
                '  - id: start',
                '    onEnter:',
                '      - kind: agent.run',
                '        options:',
                '          input: hello',
                '          agent: claude',
                '          role: coder',
                '          session: stale',
                '  - id: done',
                'transitions:',
                '  - from: start',
                '    to: done',
                'terminalStates: [done]',
            ];
            await writeFile(path, lines.join('\n'));
            // Minimal app-service context — validate() needs the cwd + workflow
            // resolution deps, not the full CLI wiring (pattern from
            // tests/services/workflow-service.test.ts makeCtx). The bad-session
            // failure is returned by the post-schema walk, so no DB is hit.
            const svc = new WorkflowAppService({
                cwd: dir,
                getDb: async () => {
                    throw new Error('not needed for validate');
                },
                agentService: () => ({}) as unknown as AgentService,
                ruleService: () => ({}) as unknown as never,
            } as never);
            const result = await svc.validate(path);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.join('\n')).toContain('invalid session');
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('0894 R4: declared vs defaulted session policy', () => {
    test("a reviewer stage defaults to fresh (no continue) and records sessionSource 'default'", async () => {
        let captured: Record<string, string | boolean> = {};
        const { svc } = svcSpy((f) => {
            captured = f;
        });
        const runner = affinityRunner(svc);
        const ctx = pinnedCtx({
            __agentSession: 'open',
            __agentSessionAgent: 'pi-reviewer',
            '__session.reviewer.dir': '/tmp/.spur/run/run-b7/agent-sessions/pi-reviewer',
            '__session.reviewer.id': 'sess-r',
        });
        const result = await runner.execute({ role: 'reviewer', input: 'review it' }, ctx);

        expect(result.ok).toBe(true);
        expect(captured.continue).toBeUndefined();
        expect(captured.sessionId).toBeUndefined();
        expect(result.data).toMatchObject({ session: 'fresh', sessionSource: 'default' });
    });

    test("a reviewer stage declaring session: reuse resumes the slot and records 'declared'", async () => {
        let captured: Record<string, string | boolean> = {};
        const { svc } = svcSpy((f) => {
            captured = f;
        });
        const runner = affinityRunner(svc);
        const ctx = pinnedCtx({
            __agentSession: 'open',
            __agentSessionAgent: 'pi-reviewer',
            '__session.reviewer.dir': '/tmp/.spur/run/run-b7/agent-sessions/pi-reviewer',
            '__session.reviewer.id': 'sess-r',
        });
        const result = await runner.execute({ role: 'reviewer', input: 'review it', session: 'reuse' }, ctx);

        expect(result.ok).toBe(true);
        expect(captured.sessionId).toBe('sess-r');
        expect(result.data).toMatchObject({ session: 'reused', sessionSource: 'declared' });
    });
});

describe('0894 R5: resume-incapable executor — one no-resume notice per run', () => {
    const NO_RESUME = { ...RESUME_CAPABLE, supportsResumeById: false };

    test('the first stage emits workflow.executor-no-resume and latches the run var', async () => {
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const events: Array<Record<string, unknown>> = [];
        bus.on('workflow.executor-no-resume', (event) => events.push(event as unknown as Record<string, unknown>));
        let captured: Record<string, string | boolean> = {};
        const svc = {
            resolve: async () => ({ ok: true, agent: 'claude' }) as const,
            runTraced: async (_input: string | undefined, flags: Record<string, string | boolean>) => {
                captured = flags;
                return { exitCode: 0, stdout: '', invocation: invocation() };
            },
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc, bus, undefined, { sessionAffinity: true });
        const result = await runner.execute(
            { role: 'coder', input: 'step one', continue: true },
            makeCtx({
                vars: {
                    '__executor.coder': JSON.stringify({ name: 'pi-coder', agent: 'pi', capabilities: NO_RESUME }),
                },
            }),
        );

        expect(result.ok).toBe(true);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: 'agent.run', executor: 'pi-coder' });
        // No resume flag of any kind reaches the dispatch.
        expect(captured.continue).toBeUndefined();
        expect(captured.sessionId).toBeUndefined();
        expect(result.data).toMatchObject({ session: 'fresh' });
        expect((result.setVars as Record<string, unknown>).__executorNoResumeWarned).toBe('true');
    });

    test('a later stage of the same run stays silent (notice is once per run, not per stage)', async () => {
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const events: Array<unknown> = [];
        bus.on('workflow.executor-no-resume', (event) => events.push(event));
        const svc = {
            resolve: async () => ({ ok: true, agent: 'claude' }) as const,
            runTraced: async () => ({ exitCode: 0, stdout: '', invocation: invocation() }),
        } as unknown as AgentService;
        const runner = new AgentRunActionRunner(svc, bus, undefined, { sessionAffinity: true });
        const result = await runner.execute(
            { role: 'coder', input: 'step two', continue: true },
            makeCtx({
                vars: {
                    '__executor.coder': JSON.stringify({ name: 'pi-coder', agent: 'pi', capabilities: NO_RESUME }),
                    __executorNoResumeWarned: 'true',
                },
            }),
        );

        expect(result.ok).toBe(true);
        expect(events).toHaveLength(0);
    });
});

describe('0894 R1: doctor.probe roles map — precheck pin resolution', () => {
    function probeSvc(responses: Record<string, AgentResolveResult>): {
        svc: AgentService;
        calls: Array<Record<string, string | boolean>>;
    } {
        const calls: Array<Record<string, string | boolean>> = [];
        const svc = {
            resolve: async (flags: Record<string, string | boolean>) => {
                calls.push(flags);
                return responses[(flags.agent as string) ?? ''];
            },
        } as unknown as AgentService;
        return { svc, calls };
    }

    test('resolves each declared role once and writes __executor.<role> pins', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-probe-'));
        try {
            const { svc, calls } = probeSvc({
                'pi-coder': {
                    ok: true,
                    agent: 'pi',
                    executor: 'pi-coder',
                    model: 'm-pin',
                    tier: 'capable-2',
                    source: 'role',
                },
                '': { ok: true, agent: 'claude', executor: 'claude', tier: 'capable-1', source: 'role' },
            });
            const runner = new DoctorProbeActionRunner(
                new NodeProcessExecutor(),
                createNodeFileSystem(),
                undefined,
                svc,
            );
            const resultFile = join(dir, '.spur', 'run', 'precheck.status');
            const result = await runner.execute(
                { resultFile, roles: { coder: 'pi-coder', reviewer: 'auto' } },
                makeCtx({ workdir: dir }),
            );

            expect(result.ok).toBe(true);
            expect(result.data).toMatchObject({ status: 'PASS' });
            // Explicit selector pins; 'auto' routes by role — both through resolve.
            expect(calls).toEqual([{ role: 'coder', agent: 'pi-coder' }, { role: 'reviewer' }]);
            const setVars = result.setVars as Record<string, string>;
            expect(parseExecutorPin(setVars['__executor.coder'])).toMatchObject({
                name: 'pi-coder',
                agent: 'pi',
                model: 'm-pin',
                tier: 'capable-2',
            });
            expect(parseExecutorPin(setVars['__executor.reviewer'])).toMatchObject({ name: 'claude', agent: 'claude' });
            expect(readFileSync(resultFile, 'utf8')).toBe('PASS\n');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a failed role resolution marks the status file FAIL and keeps the good pins (soft probe)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-probe-'));
        try {
            const { svc } = probeSvc({
                'pi-coder': { ok: true, agent: 'pi', executor: 'pi-coder', source: 'role' },
                ghost: { ok: false, exitCode: 3, message: 'no such executor' },
            });
            const runner = new DoctorProbeActionRunner(
                new NodeProcessExecutor(),
                createNodeFileSystem(),
                undefined,
                svc,
            );
            const resultFile = join(dir, '.spur', 'run', 'precheck.status');
            const result = await runner.execute(
                { resultFile, roles: { coder: 'pi-coder', reviewer: 'ghost' } },
                makeCtx({ workdir: dir }),
            );

            expect(result.ok).toBe(true);
            expect(result.data).toMatchObject({ status: 'FAIL' });
            const setVars = result.setVars as Record<string, string>;
            expect(parseExecutorPin(setVars['__executor.coder'])?.name).toBe('pi-coder');
            expect(setVars['__executor.reviewer']).toBeUndefined();
            expect(readFileSync(resultFile, 'utf8')).toBe('FAIL\n');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// Wiring (0894 R1, review P0): production registration must thread the agent
// service into doctor.probe — without it role-map resolution degrades to a
// FAIL status for every role and no run-scoped pin is ever written.
// ---------------------------------------------------------------------------
describe('0894 R1 wiring: registerSpurBuiltins threads agentService into doctor.probe', () => {
    test('roles-mode probe through the registered host resolves pins in-process', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-wiring-'));
        try {
            const calls: Array<Record<string, string | boolean>> = [];
            const agentService = {
                resolve: async (flags: Record<string, string | boolean>) => {
                    calls.push(flags);
                    return { ok: true, agent: 'pi', executor: 'pi-coder', tier: 'capable-1', source: 'role' };
                },
            } as unknown as AgentService;
            const host = createDefaultWorkflowEngineHost();
            registerSpurBuiltins(host, {
                agentService,
                ruleService: {} as RuleService,
                hitlResponder: {} as HitlResponder,
            });
            const result = await host.runAction(
                'doctor.probe',
                { roles: { coder: 'auto' }, resultFile: '.spur/run/precheck.status', spurBin: 'spur' },
                makeCtx({ workdir: dir }),
            );
            expect(result.ok).toBe(true);
            expect((result.data as { status: string }).status).toBe('PASS');
            const pin = result.setVars?.['__executor.coder'];
            expect(pin).toBeDefined();
            expect(JSON.parse(pin as string)).toMatchObject({ name: 'pi-coder', agent: 'pi' });
            // One resolution per declared role — the precheck pin walk is the
            // single resolve point for the run (dispatch must not re-resolve).
            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({ role: 'coder' });
            expect(readFileSync(join(dir, '.spur', 'run', 'precheck.status'), 'utf8')).toContain('PASS');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
