/**
 * Task 0967 — the G66 member session as an application service (G67 R1/R2).
 * `docs/design/session-pinned-dispatch.md` §6: one fleet member's session
 * across the agent loop's lifetime — the warmest mode its agent supports
 * (persistent stdin, resume-by-id, one-shot), the resume id, the live process,
 * and the failed-drain budget.
 *
 * These tests drive the service directly: no `CliContext`, no spawned agent CLI.
 * The persistent process is stubbed through `MemberSessionDeps.processFactory`
 * and the runner capability lookup through `MemberSessionDeps.sessionCapability`
 * (the only way to reach the `member-persistent-stdin-unwired` degrade with a
 * runner whose three persistent-capable shims all wire the stdin argv).
 */
import { describe, expect, test } from 'bun:test';
import {
    createMigratedDb,
    type DbAdapter,
    RunSessionDao,
    readMemberSessions,
    recordMemberSession,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import type { AgentProcessOptions, AgentSpec } from '@gobing-ai/ts-ai-runner';
import type { SessionCapabilityRecord } from '../../src/services/capability-attestation';
import {
    MAX_CONSECUTIVE_FAILED_DRAINS,
    type MemberAgentProcess,
    MemberSession,
    selectsPersistentStdinDispatch,
} from '../../src/services/member-session';

/** In-memory fake of the runner's `TeamAgentProcess` (G66 R2) — records every interaction. */
class FakeMemberProcess implements MemberAgentProcess {
    readonly sends: string[] = [];
    started = 0;
    stopped = 0;
    status: 'running' | 'stopped' | 'errored' = 'running';
    constructor(readonly options: AgentProcessOptions) {}
    async start(): Promise<void> {
        this.started++;
    }
    async stop(): Promise<void> {
        this.stopped++;
        this.status = 'stopped';
        if (this.failStop) throw new Error('stop failed');
    }
    async send(message: string): Promise<{ ok: boolean }> {
        this.sends.push(message);
        return { ok: true };
    }
    getStatus(): 'running' | 'stopped' | 'errored' {
        return this.status;
    }
    getExitCode(): number | null {
        return this.status === 'errored' ? 1 : null;
    }
    /** Simulate the agent CLI exiting between drains (the G66 R4 restart path). */
    crash(): void {
        this.status = 'errored';
    }
    /** A process whose `stop()` rejects — a reset must still clear the session (G66 R4). */
    failStop = false;
    /** Arm {@link failStop}. */
    rejectStop(): void {
        this.failStop = true;
    }
}

interface Harness {
    session: MemberSession;
    db: DbAdapter;
    warnings: string[];
    events: SystemEventDao;
    runSessions: RunSessionDao;
    processes: FakeMemberProcess[];
}

interface HarnessOptions {
    /** `agent.executors` projection the service reads the binary from. */
    executors?: Array<{ name: string; agent?: string }>;
    /** Runner capability override — the degrade path's only reachable seam. */
    sessionCapability?: (canonical: string) => SessionCapabilityRecord;
    /** Process environment projected onto the persistent spawn (`undefined` entries drop). */
    env?: Record<string, string | undefined>;
    /** When set, the adapter the service sees — the ledger-down path. */
    getDb?: (real: DbAdapter) => Promise<DbAdapter>;
}

async function harness(options: HarnessOptions = {}): Promise<Harness> {
    const db = await createMigratedDb({ url: ':memory:' });
    const warnings: string[] = [];
    const processes: FakeMemberProcess[] = [];
    const session = new MemberSession(
        {
            executors: options.executors ?? [],
            env: options.env ?? {},
            getDb: async () => (options.getDb === undefined ? db : await options.getDb(db)),
            warn: (message) => warnings.push(message),
            processFactory: (processOptions) => {
                const process = new FakeMemberProcess(processOptions);
                processes.push(process);
                return process;
            },
            ...(options.sessionCapability !== undefined ? { sessionCapability: options.sessionCapability } : {}),
        },
        'member',
    );
    return { session, db, warnings, events: new SystemEventDao(db), runSessions: new RunSessionDao(db), processes };
}

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
    return {
        id: 'member',
        name: 'Member',
        type: 'claude',
        workspace: '/tmp/member-workspace',
        purpose: 'coding',
        tags: [],
        config: {},
        ...overrides,
    };
}

/**
 * A `DbAdapter` whose FIRST write rejects — the "ledger is down" path the member-session
 * mirror is documented to tolerate (observability only, never a drain blocker).
 */
function failFirstWrite(db: DbAdapter): DbAdapter {
    let failed = false;
    return new Proxy(db, {
        get(target, property) {
            const value = Reflect.get(target, property) as unknown;
            if (typeof value !== 'function') return value;
            if (property === 'run') {
                const run = value as (sql: string, ...params: unknown[]) => Promise<void>;
                return async (sql: string, ...params: unknown[]): Promise<void> => {
                    if (!failed) {
                        failed = true;
                        throw new Error('member-session ledger unavailable');
                    }
                    await run.call(target, sql, ...params);
                };
            }
            return (value as (...args: unknown[]) => unknown).bind(target);
        },
    });
}

/** The `fleet.member-session-reset` ledger payloads, in insertion order. */
async function resetRows(harnessed: Harness): Promise<Array<Record<string, unknown>>> {
    const rows = await harnessed.events.query({ names: ['fleet.member-session-reset'], limit: 100 });
    return rows.map((row) => JSON.parse(row.payload_json ?? '{}') as Record<string, unknown>);
}

async function insertRunSession(
    harnessed: Harness,
    runId: string,
    sessionId: string | null,
    exactness: 'exact' | 'unresolved' | 'estimated',
): Promise<void> {
    await harnessed.runSessions.insert({
        runId,
        source: 'pi',
        sessionId,
        exactness,
        mechanism: 'observed',
        resolvedAt: new Date().toISOString(),
    });
}

describe('MemberSession mode resolution (G66 R1, G67 R1)', () => {
    test('a persistent-capable agent resolves persistent with no degrade warning', async () => {
        const h = await harness();
        expect(h.session.resolveMode(spec({ type: 'claude' }))).toBe('persistent');
        expect(h.warnings).toEqual([]);
    });

    test('an executor entry names the binary the capability is looked up for', async () => {
        const h = await harness({ executors: [{ name: 'writer', agent: 'omp' }] });
        expect(h.session.resolveMode(spec({ type: 'writer', executor: 'writer' }))).toBe('persistent');
        expect(h.warnings).toEqual([]);
    });

    test('resume-by-id wins when the agent has no persistent stdin', async () => {
        const h = await harness();
        expect(h.session.resolveMode(spec({ type: 'codex' }))).toBe('resume');
        expect(h.warnings).toEqual([]);
    });

    test('an agent with neither capability falls back to one-shot', async () => {
        const h = await harness();
        expect(h.session.resolveMode(spec({ type: 'gemini' }))).toBe('one-shot');
        expect(h.warnings).toEqual([]);
    });

    test('an agent binary the runner does not know degrades silently to one-shot', async () => {
        const h = await harness();
        expect(h.session.resolveMode(spec({ type: 'not-a-real-agent', executor: 'not-a-real-agent' }))).toBe(
            'one-shot',
        );
        expect(h.warnings).toEqual([]);
    });

    test('a record vouching for persistent stdin over a one-shot argv warns once and degrades to resume-by-id', async () => {
        // gemini's shim dispatches no stdin-dispatch argv, so the capability
        // record and the installed shim disagree — exactly the P2 defect the
        // degrade defends against: the process would exit after its preamble.
        const h = await harness({
            sessionCapability: () => ({
                supportsResumeById: true,
                supportsSessionDir: false,
                supportsPersistentStdin: true,
                supportsStructuredOutput: true,
            }),
        });
        expect(h.session.resolveMode(spec({ type: 'gemini' }))).toBe('resume');
        expect(h.warnings).toHaveLength(1);
        expect(h.warnings[0]).toContain('member-persistent-stdin-unwired');
        expect(h.warnings[0]).toContain('degrades to resume-by-id');
    });

    test('the same degrade lands on one-shot when resume-by-id is unavailable', async () => {
        const h = await harness({
            sessionCapability: () => ({
                supportsResumeById: false,
                supportsSessionDir: false,
                supportsPersistentStdin: true,
                supportsStructuredOutput: false,
            }),
        });
        expect(h.session.resolveMode(spec({ type: 'gemini' }))).toBe('one-shot');
        expect(h.warnings[0]).toContain('degrades to one-shot');
    });
});

describe('MemberSession start (G66 R1/R3, 0897 ledger mirror)', () => {
    test('start resolves the mode once, mirrors it to the ledger, and warns once for one-shot', async () => {
        const h = await harness();
        await h.session.start(spec({ type: 'gemini' }));
        expect(h.session.mode).toBe('one-shot');
        expect(h.warnings).toHaveLength(1);
        expect(h.warnings[0]).toContain('member-no-session');
        expect((await readMemberSessions(h.db, ['member'])).get('member')).toEqual({ mode: 'one-shot' });
    });

    test('a persistent member records no lifetime warning', async () => {
        const h = await harness();
        await h.session.start(spec({ type: 'claude' }));
        expect(h.session.mode).toBe('persistent');
        expect(h.warnings).toEqual([]);
        expect((await readMemberSessions(h.db, ['member'])).get('member')).toEqual({ mode: 'persistent' });
    });

    test('a failing ledger mirror never blocks the session (observability only)', async () => {
        const h = await harness({ getDb: async (real) => failFirstWrite(real) });
        await h.session.start(spec({ type: 'claude' }));
        expect(h.session.mode).toBe('persistent');
        expect(h.warnings).toEqual([]);
        // The write was attempted and failed, so no mirror row exists — the
        // session state itself is unaffected.
        expect((await readMemberSessions(h.db, ['member'])).get('member')).toBeUndefined();
    });
});

describe('MemberSession process lifecycle (G66 R2/R4)', () => {
    test('a dead persistent process is reported as a restart reset before respawning', async () => {
        const h = await harness();
        await h.session.start(spec({ type: 'claude' }));

        const first = await h.session.ensureProcess(spec({ type: 'claude' }));
        expect(h.processes).toHaveLength(1);
        expect(h.processes[0]?.started).toBe(1);
        // A live process is reused, never respawned.
        expect(await h.session.ensureProcess(spec({ type: 'claude' }))).toBe(first);
        expect(h.processes).toHaveLength(1);

        h.processes[0]?.crash();
        const second = await h.session.ensureProcess(spec({ type: 'claude' }));
        expect(second).not.toBe(first);
        expect(h.processes).toHaveLength(2);
        expect(h.processes[1]?.started).toBe(1);
        expect(await resetRows(h)).toEqual([{ reason: 'restart', mode: 'persistent', exitCode: 1 }]);
        expect(h.session.process).toBe(second);
        expect(h.warnings).toEqual(['member session: reset for member (reason: restart)']);
    });

    test('the persistent spawn carries the member workspace and env', async () => {
        const h = await harness({ env: { MEMBER_TOKEN: 'abc', UNSET: undefined } });
        await h.session.start(spec({ type: 'claude' }));
        await h.session.ensureProcess(spec({ type: 'claude' }));
        expect(h.processes[0]?.options.cwd).toBe('/tmp/member-workspace');
        // An `undefined` environment entry is dropped, not stringified (G66 R2).
        expect(h.processes[0]?.options.env).toEqual({ MEMBER_TOKEN: 'abc' });
        // The stdin framer is part of the persistent protocol — without it the
        // long-lived process cannot accept later sends (G66 R2).
        expect(h.processes[0]?.options.stdinFramer).toBeFunction();
    });
});

describe('MemberSession failed-drain budget (G66 R4/R7)', () => {
    test('the poisoned session resets at exactly the bounded limit and the counter restarts', async () => {
        const h = await harness();
        await h.session.start(spec({ type: 'codex' }));
        expect(h.session.mode).toBe('resume');

        for (let i = 1; i < MAX_CONSECUTIVE_FAILED_DRAINS; i++) {
            await h.session.recordDrain(true, undefined);
            expect(await resetRows(h)).toEqual([]);
        }
        await h.session.recordDrain(true, undefined);
        expect(await resetRows(h)).toEqual([
            { reason: 'failed-drains', mode: 'resume', failedDrains: MAX_CONSECUTIVE_FAILED_DRAINS },
        ]);

        // The counter restarted with the fresh session: a full budget below the
        // limit again resets nothing.
        for (let i = 1; i < MAX_CONSECUTIVE_FAILED_DRAINS; i++) {
            await h.session.recordDrain(true, undefined);
        }
        expect(await resetRows(h)).toHaveLength(1);
    });

    test('a successful drain clears the consecutive-failure count', async () => {
        const h = await harness();
        await h.session.start(spec({ type: 'codex' }));
        for (let i = 1; i < MAX_CONSECUTIVE_FAILED_DRAINS; i++) await h.session.recordDrain(true, undefined);
        await h.session.recordDrain(false, undefined);
        for (let i = 1; i < MAX_CONSECUTIVE_FAILED_DRAINS; i++) {
            await h.session.recordDrain(true, undefined);
        }
        expect(await resetRows(h)).toEqual([]);
    });
});

describe('MemberSession resume-id capture (G66 R1)', () => {
    test('an exact run→session row is captured and mirrored; an inexact one is not', async () => {
        const h = await harness();
        await h.session.start(spec({ type: 'codex' }));
        await insertRunSession(h, 'run-exact', 'session-exact', 'exact');
        await insertRunSession(h, 'run-estimated', 'session-estimated', 'estimated');
        await insertRunSession(h, 'run-unresolved', null, 'unresolved');

        await h.session.recordDrain(false, 'run-exact');
        expect(h.session.id).toBe('session-exact');
        expect((await readMemberSessions(h.db, ['member'])).get('member')).toEqual({
            mode: 'resume',
            id: 'session-exact',
        });

        await h.session.recordDrain(false, 'run-estimated');
        await h.session.recordDrain(false, 'run-unresolved');
        expect(h.session.id).toBe('session-exact');
    });

    test('a run with no mapping row leaves the session id untouched', async () => {
        const h = await harness();
        await h.session.start(spec({ type: 'codex' }));
        await h.session.recordDrain(false, 'run-unknown');
        expect(h.session.id).toBeUndefined();
    });

    test('a one-shot member never captures a session id', async () => {
        const h = await harness();
        await h.session.start(spec({ type: 'gemini' }));
        await insertRunSession(h, 'run-exact', 'session-exact', 'exact');
        await h.session.recordDrain(false, 'run-exact');
        expect(h.session.id).toBeUndefined();
    });
});

describe('MemberSession operator reset (G66 R4)', () => {
    test('live state is named and reset; an untouched session is not', async () => {
        const h = await harness();
        expect(h.session.hasLiveState()).toBe(false);

        await h.session.start(spec({ type: 'gemini' }));
        expect(h.session.hasLiveState()).toBe(false);
        expect(await resetRows(h)).toEqual([]);

        await h.session.start(spec({ type: 'codex' }));
        h.session.id = 'session-live';
        expect(h.session.hasLiveState()).toBe(true);
        await h.session.reset('operator');
        expect(h.session.id).toBeUndefined();
        expect(await resetRows(h)).toEqual([{ reason: 'operator', mode: 'resume' }]);
        expect(h.warnings.at(-1)).toBe('member session: reset for member (reason: operator)');
    });

    test('reset stops a still-running persistent process and clears both live fields', async () => {
        const h = await harness();
        await h.session.start(spec({ type: 'claude' }));
        await h.session.ensureProcess(spec({ type: 'claude' }));
        await h.session.reset('operator');
        expect(h.processes[0]?.stopped).toBe(1);
        expect(h.session.process).toBeUndefined();
        expect(h.session.id).toBeUndefined();
        expect(h.session.hasLiveState()).toBe(false);
    });

    test('a stop that rejects still clears the session and records the reset', async () => {
        const h = await harness();
        await h.session.start(spec({ type: 'claude' }));
        await h.session.ensureProcess(spec({ type: 'claude' }));
        h.processes[0]?.rejectStop();
        await h.session.reset('operator');
        expect(h.processes[0]?.stopped).toBe(1);
        expect(h.session.process).toBeUndefined();
        expect(h.session.hasLiveState()).toBe(false);
        expect(await resetRows(h)).toEqual([{ reason: 'operator', mode: 'persistent' }]);
    });
});

describe('selectsPersistentStdinDispatch (Review P3 argv gate)', () => {
    test('only a stdin-dispatch argv selects persistent', () => {
        expect(selectsPersistentStdinDispatch(['omp', '--no-session', '--input-format', 'stream-json'])).toBe(true);
        expect(selectsPersistentStdinDispatch(['pi', '--mode', 'rpc'])).toBe(true);
        expect(selectsPersistentStdinDispatch(['claude', '-p', '<p>', '--output-format', 'text'])).toBe(false);
        expect(selectsPersistentStdinDispatch([])).toBe(false);
    });
});

describe('G71 R3 — resume seeding from the ledger', () => {
    /** Resume-only capability: no persistent stdin, so `resolveMode` lands on `resume`. */
    const resumeCapability = () => ({
        supportsResumeById: true,
        supportsSessionDir: false,
        supportsPersistentStdin: false,
        supportsStructuredOutput: false,
    });

    test('start seeds a resume member with the exact id its last drain recorded', async () => {
        const h = await harness({ sessionCapability: resumeCapability as never });
        await recordMemberSession(h.db, 'member', { mode: 'resume', id: 'sess-exact-1' });
        await h.session.start(spec({ type: 'gemini' }));
        expect(h.session.mode).toBe('resume');
        expect(h.session.id).toBe('sess-exact-1');
    });

    test('a deliberate reset clears the seed — the next start does not resume the old conversation', async () => {
        const h = await harness({ sessionCapability: resumeCapability as never });
        await recordMemberSession(h.db, 'member', { mode: 'resume', id: 'sess-old' });
        await h.session.start(spec({ type: 'gemini' }));
        expect(h.session.id).toBe('sess-old');
        await h.session.reset('operator');
        await h.session.start(spec({ type: 'gemini' }));
        expect(h.session.id).toBeUndefined();
    });

    test('an unreadable ledger starts the resume member without an id instead of failing the loop', async () => {
        const h = await harness({
            sessionCapability: resumeCapability as never,
            // The adapter resolves but its reads fail — the observability-down path (G71 R3).
            getDb: async (real) =>
                new Proxy(real, {
                    get: (target, key) =>
                        key === 'queryAll'
                            ? async () => {
                                  throw new Error('ledger unavailable');
                              }
                            : Reflect.get(target, key),
                }) as never,
        });
        await h.session.start(spec({ type: 'gemini' }));
        expect(h.session.mode).toBe('resume');
        expect(h.session.id).toBeUndefined();
    });

    test('a member with no recorded observation starts without an id', async () => {
        const h = await harness({ sessionCapability: resumeCapability as never });
        await h.session.start(spec({ type: 'gemini' }));
        expect(h.session.mode).toBe('resume');
        expect(h.session.id).toBeUndefined();
    });
});
