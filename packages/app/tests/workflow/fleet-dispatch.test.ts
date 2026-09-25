import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentFleet } from '@gobing-ai/spur-config';
import type { AgentCoordinationService, SendResult } from '../../src/services/agent-coordination-service';
import type { FleetService, ResolvedFleet, ResolvedFleetMember } from '../../src/services/fleet-service';
import {
    dispatchToFleet,
    type FleetDispatchDeps,
    fleetUnavailableOutcome,
    waitForFileExists,
} from '../../src/workflow/fleet-dispatch';

/** Enabled coder/reviewer member fixture — desired state only, no liveness (R5). */
function member(overrides: Partial<ResolvedFleetMember> = {}): ResolvedFleetMember {
    return {
        instanceId: 'proj-m1',
        role: 'coder',
        executor: 'claude',
        enabled: true,
        writeCapable: true,
        capabilityState: 'enforced',
        ...overrides,
    };
}

/** Declaration fixture — dispatch reads only `enabled`/`strategy`; members come from `resolve`. */
function declaration(enabled = true, strategy: 'rest' | 'gtd' = 'rest'): AgentFleet {
    return { enabled, strategy, members: [] } as unknown as AgentFleet;
}

function fleetSvc(
    decl: AgentFleet | null,
    members: ResolvedFleetMember[],
    missing: string[] = [],
    projectPath = '/proj',
): FleetService {
    const resolved: ResolvedFleet = { projectPath, enabled: decl?.enabled === true, members, missing };
    return {
        load: async () => decl,
        resolve: async () => resolved,
    } as unknown as FleetService;
}

interface RecordedSend {
    fromId: string | null;
    toId: string;
    body: string;
    requestKey: string | undefined;
}

function coordination(opts: { throws?: Error } = {}) {
    const sends: RecordedSend[] = [];
    const svc = {
        sendMessage: async (
            fromId: string | null,
            toId: string,
            body: string,
            _replyTo?: string,
            requestKey?: string,
        ): Promise<SendResult> => {
            if (opts.throws !== undefined) throw opts.throws;
            sends.push({ fromId, toId, body, requestKey });
            return { msgId: `msg-${sends.length}`, toId, status: 'queued', injected: false };
        },
    };
    return { svc: svc as unknown as AgentCoordinationService, sends };
}

function deps(
    fleet: FleetService,
    coordination: AgentCoordinationService,
    opts: { fileAppears?: boolean; waitForFileCalls?: number[] } = {},
): FleetDispatchDeps {
    let tick = 0;
    return {
        fleet,
        coordination,
        waitForFile: async () => {
            opts.waitForFileCalls?.push(1);
            return opts.fileAppears !== false;
        },
        now: () => (tick += 10),
    };
}

/** Writable project dir for dispatches that reach the prompt-artifact write. */
const tempDirs: string[] = [];
function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('dispatchToFleet', () => {
    test('R1/R2: dispatches to the first enabled role-matching member and persists the prompt artifact', async () => {
        const project = mkdtempSync(join(tmpdir(), 'fleet-'));
        try {
            const { svc: coord, sends } = coordination();
            const result = await dispatchToFleet(
                {
                    role: 'coder',
                    prompt: 'implement task 0942',
                    projectPath: project,
                    expectFile: 'out/verdict.md',
                    runId: 'run-1',
                    state: 'impl',
                },
                deps(
                    fleetSvc(declaration(), [
                        member({ instanceId: 'p-coder', role: 'coder' }),
                        member({ role: 'reviewer', instanceId: 'p-rev' }),
                    ]),
                    coord,
                ),
            );
            expect(result.status).toBe('dispatched');
            if (result.status !== 'dispatched') return;
            expect(result.memberId).toBe('p-coder');
            expect(result.messageId).toBe('msg-1');
            expect(result.durationMs).toBeGreaterThan(0);
            // The durable artifact carries the step prompt itself (ADR-057).
            expect(readFileSync(result.promptPath, 'utf8')).toBe('implement task 0942');
            expect(sends.length).toBe(1);
            const body = sends[0]?.body ?? '';
            expect(body).toContain('run: run-1');
            expect(body).toContain('state: impl');
            expect(body).toContain('role: coder');
            expect(body).toContain(result.promptPath);
            expect(body).toContain('out/verdict.md');
            expect(sends[0]?.fromId).toBeNull();
            expect(sends[0]?.toId).toBe('p-coder');
            // Keyed send (0832): run+state pins the submission identity so a stage
            // retry replays the original submission instead of double-sending.
            expect(sends[0]?.requestKey).toBe('run-1/impl');
        } finally {
            rmSync(project, { recursive: true, force: true });
        }
    });

    test('R1: no enabled member for the role is an unavailable value naming the role, not an exception', async () => {
        const { svc: coord, sends } = coordination();
        const result = await dispatchToFleet(
            { role: 'reviewer', prompt: 'review', projectPath: '/proj', runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member({ role: 'coder' })], ['no-enabled-members']), coord),
        );
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining("role 'reviewer'") });
        expect(sends.length).toBe(0);
    });

    test('R1: a disabled fleet is unavailable before any send', async () => {
        const { svc: coord, sends } = coordination();
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: '/proj', runId: 'r', state: 's' },
            deps(fleetSvc(declaration(false), [member()]), coord),
        );
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('disabled') });
        expect(sends.length).toBe(0);
    });

    test('R1: no agent.fleet declaration is unavailable with the fix named', async () => {
        const { svc: coord, sends } = coordination();
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: '/proj', runId: 'r', state: 's' },
            deps(fleetSvc(null, [], ['no-declaration']), coord),
        );
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('agent.fleet') });
        expect(sends.length).toBe(0);
    });

    test('R2: expectFile never appearing within the timeout is a timeout carrying the identity pair', async () => {
        const project = mkdtempSync(join(tmpdir(), 'fleet-'));
        try {
            const { svc: coord, sends } = coordination();
            const result = await dispatchToFleet(
                {
                    role: 'coder',
                    prompt: 'x',
                    projectPath: project,
                    expectFile: 'out/v.md',
                    timeoutMs: 50,
                    runId: 'r',
                    state: 's',
                },
                deps(fleetSvc(declaration(), [member()]), coord, { fileAppears: false }),
            );
            expect(result.status).toBe('timeout');
            if (result.status !== 'timeout') return;
            expect(result.memberId).toBe('proj-m1');
            expect(result.messageId).toBe('msg-1');
            expect(result.expectFile).toBe(join(project, 'out/v.md'));
            expect(sends.length).toBe(1);
        } finally {
            rmSync(project, { recursive: true, force: true });
        }
    });

    test('R2: no declared expectFile completes at send without waiting', async () => {
        const calls: number[] = [];
        const { svc: coord } = coordination();
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member()]), coord, { waitForFileCalls: calls }),
        );
        expect(result.status).toBe('dispatched');
        expect(calls.length).toBe(0);
    });

    test('ADR-121: a reviewer dispatch rejects every member carrying a reusable session BEFORE send', async () => {
        const { svc: coord, sends } = coordination();
        const result = await dispatchToFleet(
            { role: 'reviewer', prompt: 'review', projectPath: '/proj', runId: 'r', state: 's' },
            deps(
                fleetSvc(declaration(), [
                    member({ instanceId: 'p-rev', role: 'reviewer', session: { mode: 'persistent' } }),
                    member({ instanceId: 'p-rev2', role: 'reviewer', session: { mode: 'resume' } }),
                ]),
                coord,
            ),
        );
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('ADR-121') });
        expect(sends.length).toBe(0);
    });

    test('ADR-121: a one-shot member counts as fresh for a reviewer dispatch', async () => {
        const { svc: coord, sends } = coordination();
        const result = await dispatchToFleet(
            { role: 'reviewer', prompt: 'review', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member({ role: 'reviewer', session: { mode: 'one-shot' } })]), coord),
        );
        expect(result.status).toBe('dispatched');
        expect(sends.length).toBe(1);
    });

    test('R1: gtd prefers the member without a session in flight; rest keeps declaration order', async () => {
        const fresh = member({ instanceId: 'p-idle' });
        const busy = member({ instanceId: 'p-busy', session: { mode: 'persistent' } });
        const { svc: coordA } = coordination();
        const gtd = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(true, 'gtd'), [busy, fresh]), coordA),
        );
        expect(gtd).toEqual({
            status: 'dispatched',
            memberId: 'p-idle',
            messageId: expect.any(String),
            durationMs: expect.any(Number),
            promptPath: expect.any(String),
        });
        const { svc: coordB } = coordination();
        const rest = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(true, 'rest'), [busy, fresh]), coordB),
        );
        expect(rest).toEqual({
            status: 'dispatched',
            memberId: 'p-busy',
            messageId: expect.any(String),
            durationMs: expect.any(Number),
            promptPath: expect.any(String),
        });
    });

    test('R3: a failing send reads as an unavailable value naming the member, never a throw', async () => {
        const { svc: coord } = coordination({ throws: new Error('inbox db locked') });
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member()]), coord),
        );
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('inbox db locked') });
    });
});

describe('waitForFileExists', () => {
    test('returns true once the artifact exists', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'fleet-wait-'));
        try {
            writeFileSync(join(dir, 'present.md'), 'verdict');
            expect(await waitForFileExists(join(dir, 'present.md'), 1000)).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('returns false when the deadline passes', async () => {
        const started = Date.now();
        expect(await waitForFileExists(join(tmpdir(), `absent-${crypto.randomUUID()}.md`), 80)).toBe(false);
        expect(Date.now() - started).toBeGreaterThanOrEqual(70);
    });
});

describe('fleetUnavailableOutcome', () => {
    test('falls back ONLY when executorFallback is declared traditional', () => {
        expect(fleetUnavailableOutcome('fleet is disabled', 'traditional')).toEqual({
            mode: 'fallback',
            fallbackReason: 'fleet is disabled',
        });
    });

    test('otherwise fails explicitly with the 0937 failed-agent reason', () => {
        const outcome = fleetUnavailableOutcome('fleet is disabled', undefined);
        expect(outcome.mode).toBe('fail');
        if (outcome.mode !== 'fail') return;
        expect(outcome.error).toContain('failed-agent');
        expect(outcome.error).toContain('fleet is disabled');
    });
});
