import { describe, expect, spyOn, test, vi } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpurConfig, spurConfigSchema } from '@gobing-ai/spur-config';
import {
    CoordinationRunDao,
    type DbAdapter,
    ProjectClaimDao,
    ProjectStrategyDao,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import { InboxMessageDao } from '@gobing-ai/ts-db';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { parse as yamlParse } from 'yaml';
import {
    DEFAULT_STRATEGY,
    FLEET_AUTO_TAG,
    FleetDispatcher,
    type FleetDispatchRequest,
    type FleetReceipt,
    FleetService,
    gtdStrategy,
    normalizeProjectPath,
    ProjectRegistry,
    restStrategy,
    type StrategyContext,
    type StrategyResult,
    StrategyRuntime,
    type StrategyRuntimeContext,
} from '../../src/index';
import { createMigratedDb } from '../helpers';

/**
 * The two {@link AgentCoordinationService} methods the dispatcher uses, over the real
 * inbox DAO: keyed idempotent enqueue and one row read. Faithful to the app service's
 * signatures and behaviour, so the REAL FleetDispatcher drives the rig.
 */
function coordinationOver(db: DbAdapter) {
    return {
        sendMessage: async (
            fromId: string | null,
            toId: string,
            body: string,
            replyTo?: string,
            requestKey?: string,
        ) => {
            const dao = new InboxMessageDao(db);
            const keyed =
                requestKey !== undefined ? await dao.enqueueIdempotent(fromId, toId, body, requestKey, replyTo) : null;
            const msgId = keyed?.id ?? (await dao.enqueue(fromId, toId, body, replyTo));
            return {
                msgId,
                toId,
                status: 'queued' as const,
                injected: false,
                ...(keyed !== null ? { replayed: keyed.replayed, requestKey } : {}),
            };
        },
        getMessage: async (msgId: string) => {
            const row = await new InboxMessageDao(db).getById(msgId);
            if (row === undefined) return null;
            return { id: row.id, toId: row.toId, status: row.status, requestKey: row.requestKey ?? null };
        },
    };
}

// ---------------------------------------------------------------------------
// Harness (mirrors write-slot-service.test.ts conventions)
// ---------------------------------------------------------------------------

const EXECUTORS_YAML = `agent:
  executors:
    - name: writer
      agent: claude
      executionCapabilities:
        version: 1
        axes:
          fsWrite:
            state: available
            provenance: native-known
    - name: readonly
      agent: claude
      executionCapabilities:
        version: 1
        axes:
          fsWrite:
            state: unavailable
            provenance: native-known
`;

function parseConfig(yaml: string): SpurConfig {
    return spurConfigSchema.parse(yamlParse(yaml));
}

const FLEET = {
    members: [
        { id: 'orch', role: 'planner', purpose: 'orchestrator', executor: 'writer' },
        { id: 'coder', executor: 'writer' },
        { id: 'reader', executor: 'readonly' },
    ],
    orchestrator: 'orch',
};

/**
 * The project's merged config carrying the fleet section — the 0858 carrier.
 * A declared roster runs only when `enabled` is true, which is the state these
 * dispatch rigs assert (an absent or disabled fleet starts nothing).
 */
function fleetConfig(): SpurConfig {
    const base = parseConfig(EXECUTORS_YAML);
    return spurConfigSchema.parse({ ...base, agent: { ...base.agent, fleet: { enabled: true, ...FLEET } } });
}

/** A todo candidate with frontmatter knobs; `tags`/`priority` opt it in or out. */
function task(
    wbs: string,
    opts?: { status?: string; tags?: string[]; priority?: string },
): {
    wbs: string;
    name: string;
    status: string;
    filePath: string;
    frontmatter: Record<string, unknown>;
} {
    const frontmatter: Record<string, unknown> = {};
    if (opts?.tags !== undefined) frontmatter.tags = opts.tags;
    if (opts?.priority !== undefined) frontmatter.priority = opts.priority;
    return { wbs, name: `task ${wbs}`, status: opts?.status ?? 'todo', filePath: `/x/${wbs}_t.md`, frontmatter };
}

async function makeProject(): Promise<{ project: string; cleanup: () => Promise<void> }> {
    const base = await mkdtemp(join(tmpdir(), 'spur-strategy-'));
    await mkdir(join(base, 'proj', '.spur'), { recursive: true });
    const project = normalizeProjectPath(join(base, 'proj'));
    return {
        project,
        cleanup: async () => {
            await rm(base, { recursive: true, force: true });
        },
    };
}

interface Rig {
    project: string;
    db: DbAdapter;
    dao: ProjectStrategyDao;
    claims: ProjectClaimDao;
    runtime: StrategyRuntime;
    /** Every request the runtime enqueued through the real dispatcher. */
    enqueued: FleetDispatchRequest[];
    candidates: ReturnType<typeof task>[];
    blocked: Record<string, string | null>;
    cleanup: () => Promise<void>;
}

/**
 * Temp project + fleet declaration + migrated in-memory db + wired StrategyRuntime.
 *
 * `noFleet` builds the rig WITHOUT the `agent.fleet` section — the 0858 carrier's
 * "no declaration" state (the retired `.spur/fleet.json` file no longer models it).
 */
async function makeRig(opts?: { strategy?: string; noFleet?: boolean }): Promise<Rig> {
    const { project, cleanup } = await makeProject();
    const db = await createMigratedDb();
    if (opts?.strategy !== undefined) {
        await new ProjectStrategyDao(db).set(project, opts.strategy);
    }
    const candidates = [
        task('0840', { tags: [FLEET_AUTO_TAG], priority: 'P1' }),
        task('0841', { tags: [FLEET_AUTO_TAG, 'other'], priority: 'P0' }),
        task('0842'),
        task('0843', { tags: [FLEET_AUTO_TAG], priority: 'P0' }),
    ];
    const blocked: Record<string, string | null> = {};
    const fleet = new FleetService({
        spurConfig: opts?.noFleet === true ? parseConfig(EXECUTORS_YAML) : fleetConfig(),
        fs: createNodeFileSystem(project),
        registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
        openDb: async () => db,
    });
    // G71 R1: the REAL dispatcher over the rig's db, wrapped only to record requests.
    const enqueued: FleetDispatchRequest[] = [];
    const inner = new FleetDispatcher({ coordination: coordinationOver(db), runs: new CoordinationRunDao(db) });
    const dispatcher = {
        enqueue: async (req: FleetDispatchRequest) => {
            enqueued.push(req);
            return inner.enqueue(req);
        },
        receipt: (messageId: string, member: string): Promise<FleetReceipt | null> => inner.receipt(messageId, member),
    };
    const ctx: StrategyRuntimeContext = {
        openDb: async () => db,
        tasks: { list: async () => candidates },
        ready: async () => true,
        fleet,
        dependencyBlocked: async (_projectPath, wbs) => blocked[wbs] ?? null,
        dispatcher,
    };
    return {
        project,
        db,
        dao: new ProjectStrategyDao(db),
        claims: new ProjectClaimDao(db),
        runtime: new StrategyRuntime(ctx),
        enqueued,
        candidates,
        blocked,
        cleanup,
    };
}

// ---------------------------------------------------------------------------
// Pure strategy units — the frozen select() contracts over synthetic contexts
// ---------------------------------------------------------------------------

function pureCtx(overrides?: Partial<StrategyContext>): StrategyContext {
    return {
        projectPath: '/tmp/p',
        strategyVersion: 3,
        ownerEpoch: 2,
        candidates: [],
        idleInstances: [],
        dependencyBlocked: () => null,
        dispatchAttempts: new Map(),
        ...overrides,
    };
}

describe('restStrategy.select (0838 R2)', () => {
    test('zero decisions, one rest-after-drain hold PER candidate', () => {
        const result = restStrategy.select(
            pureCtx({ candidates: [task('0840', { tags: [FLEET_AUTO_TAG] }), task('0841')] }),
        );
        expect(result.decisions).toEqual([]);
        expect(result.holds).toEqual([
            { wbs: '0840', reason: 'rest-after-drain' },
            { wbs: '0841', reason: 'rest-after-drain' },
        ]);
    });
});

describe('gtdStrategy.select (0838 R3/R4)', () => {
    test('priority chooses the work before a scarce idle instance is consumed', () => {
        const result = gtdStrategy.select(
            pureCtx({
                candidates: [
                    task('0801', { tags: [FLEET_AUTO_TAG], priority: 'P3' }),
                    task('0802', { tags: [FLEET_AUTO_TAG], priority: 'P0' }),
                ],
                idleInstances: [
                    {
                        instanceId: 'writer',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                ],
            }),
        );
        expect(result.decisions.map((decision) => decision.taskId)).toEqual(['0802']);
        expect(result.holds).toEqual([{ wbs: '0801', reason: 'no-idle-instance' }]);
    });
    test('five-step precedence: every skip gets exactly one hold reason, first failure wins', () => {
        const result = gtdStrategy.select(
            pureCtx({
                candidates: [
                    task('0801'), // no tags → unauthorized
                    // G71 R1: a WIP task is a candidate now (it is resumed work), so this
                    // step is exercised through the runtime's readiness gate instead — the
                    // same input the real selectNext hands the strategy.
                    task('0802', { tags: [FLEET_AUTO_TAG] }), // not-ready (ready() false)
                    task('0803', { tags: [FLEET_AUTO_TAG] }), // unmet-dependency (below)
                    task('0804', { tags: [FLEET_AUTO_TAG] }), // dispatches
                    task('0805', { tags: [FLEET_AUTO_TAG] }), // no idle instance left
                    task('0806', { tags: [FLEET_AUTO_TAG] }), // executor-unavailable pops the broken member
                    task('0807', { tags: [FLEET_AUTO_TAG] }), // then no idle again
                ],
                idleInstances: [
                    {
                        instanceId: 'proj-coder',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                    {
                        instanceId: 'proj-broken',
                        executor: '',
                        enabled: true,
                        writeCapable: false,
                        capabilityState: 'unknown',
                    },
                ],
                dependencyBlocked: (wbs) => (wbs === '0803' ? '0802' : null),
                ready: (wbs) => wbs !== '0802',
            }),
        );
        expect(result.holds).toEqual([
            { wbs: '0801', reason: 'unauthorized' },
            { wbs: '0802', reason: 'not-ready' },
            { wbs: '0803', reason: 'unmet-dependency', detail: '0802' },
            { wbs: '0805', reason: 'executor-unavailable' }, // pops the broken member
            { wbs: '0806', reason: 'no-idle-instance' },
            { wbs: '0807', reason: 'no-idle-instance' },
        ]);
        expect(result.decisions).toHaveLength(1);
        expect(result.decisions[0]).toEqual({
            projectPath: '/tmp/p',
            instanceId: 'proj-coder',
            ownerEpoch: 2,
            strategyVersion: 3,
            requiresWrite: true,
            taskId: '0804',
        });
    });

    test('G71 R1: a wip fleet:auto candidate is dispatchable (interrupted work is still work)', () => {
        const result = gtdStrategy.select(
            pureCtx({
                candidates: [task('0801', { tags: [FLEET_AUTO_TAG], status: 'wip' })],
                idleInstances: [
                    {
                        instanceId: 'writer',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                ],
            }),
        );
        expect(result.decisions.map((decision) => decision.taskId)).toEqual(['0801']);
        expect(result.holds).toEqual([]);
    });

    test('survivors order by priority ascending then wbs; a missing priority sorts last (P9 sentinel)', () => {
        const result: StrategyResult = gtdStrategy.select(
            pureCtx({
                candidates: [
                    task('0805', { tags: [FLEET_AUTO_TAG] }), // no priority → last
                    task('0803', { tags: [FLEET_AUTO_TAG], priority: 'P1' }),
                    task('0802', { tags: [FLEET_AUTO_TAG], priority: 'P2' }),
                    task('0801', { tags: [FLEET_AUTO_TAG], priority: 'P0' }),
                    task('0804', { tags: [FLEET_AUTO_TAG], priority: 'P1' }),
                ],
                idleInstances: [
                    {
                        instanceId: 'i1',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                    {
                        instanceId: 'i2',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                    {
                        instanceId: 'i3',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                    {
                        instanceId: 'i4',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                    {
                        instanceId: 'i5',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                ],
            }),
        );
        expect(result.holds).toEqual([]);
        expect(result.decisions.map((d) => d.taskId)).toEqual(['0801', '0803', '0804', '0802', '0805']);
    });

    test('a proven read-only member dispatches with requiresWrite false — the 0837 claim gate decides the rest', () => {
        const result = gtdStrategy.select(
            pureCtx({
                candidates: [task('0801', { tags: [FLEET_AUTO_TAG] })],
                idleInstances: [
                    {
                        instanceId: 'proj-reader',
                        executor: 'readonly',
                        enabled: true,
                        writeCapable: false,
                        capabilityState: 'unavailable',
                    },
                ],
            }),
        );
        expect(result.decisions[0]?.requiresWrite).toBe(false);
    });

    test('G71 R1: an in-flight attempt holds its own task specifically and blocks every other write dispatch', () => {
        const result = gtdStrategy.select(
            pureCtx({
                candidates: [
                    task('0801', { tags: [FLEET_AUTO_TAG], priority: 'P0' }),
                    task('0802', { tags: [FLEET_AUTO_TAG], priority: 'P0' }),
                ],
                idleInstances: [
                    {
                        instanceId: 'writer',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                ],
                // 0801 has an attempt with no definite receipt; 0801's readiness stays
                // true (the runtime only folds completed/exhausted into `ready`).
                dispatchAttempts: new Map([['0801', { attempt: 2 }]]),
            }),
        );
        expect(result.decisions).toEqual([]);
        expect(result.holds).toContainEqual({
            wbs: '0801',
            reason: 'dispatch-in-flight',
            detail: 'attempt 2 has no terminal receipt yet',
        });
        expect(result.holds).toContainEqual({
            wbs: '0802',
            reason: 'dispatch-in-flight',
            detail: 'waiting on in-flight dispatch 0801 (attempt 2)',
        });
    });

    test('G71 R1: a definite receipt no longer holds the pipeline — the task dispatches again', () => {
        const result = gtdStrategy.select(
            pureCtx({
                candidates: [task('0801', { tags: [FLEET_AUTO_TAG], priority: 'P0' })],
                idleInstances: [
                    {
                        instanceId: 'writer',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                ],
                dispatchAttempts: new Map([['0801', { attempt: 1, receipt: 'failed' as const }]]),
            }),
        );
        expect(result.decisions.map((decision) => decision.taskId)).toEqual(['0801']);
        expect(result.holds).toEqual([]);
    });

    test('G71 R1: an unauthorized candidate keeps its own reason while another dispatch is in flight', () => {
        const result = gtdStrategy.select(
            pureCtx({
                candidates: [task('0801', { tags: [FLEET_AUTO_TAG] }), task('0802')],
                idleInstances: [
                    {
                        instanceId: 'writer',
                        executor: 'writer',
                        enabled: true,
                        writeCapable: true,
                        capabilityState: 'available',
                    },
                ],
                dispatchAttempts: new Map([['0801', { attempt: 1 }]]),
            }),
        );
        expect(result.holds).toContainEqual({ wbs: '0802', reason: 'unauthorized' });
        expect(result.holds).toContainEqual({
            wbs: '0801',
            reason: 'dispatch-in-flight',
            detail: 'attempt 1 has no terminal receipt yet',
        });
    });
});

// ---------------------------------------------------------------------------
// StrategyRuntime — persistence, resume, and wiring (R1, R6)
// ---------------------------------------------------------------------------

describe('StrategyRuntime persistence (0838 R1)', () => {
    test('no persisted row → rest default; getStrategy never writes (Board-open is read-only)', async () => {
        const rig = await makeRig();
        try {
            expect(await rig.runtime.getStrategy(rig.project)).toEqual({ name: 'rest', version: 1 });
            expect(await rig.dao.get(rig.project)).toBeNull(); // the read persisted nothing
        } finally {
            await rig.cleanup();
        }
    });

    test('setStrategy returns the new version and increments even when the name is unchanged', async () => {
        const rig = await makeRig();
        try {
            expect(await rig.runtime.setStrategy(rig.project, 'gtd')).toBe(1);
            expect(await rig.runtime.setStrategy(rig.project, 'gtd')).toBe(2); // same name, still bumps
            expect(await rig.runtime.setStrategy(rig.project, 'rest')).toBe(3);
            expect(await rig.runtime.getStrategy(rig.project)).toEqual({ name: 'rest', version: 3 });
        } finally {
            await rig.cleanup();
        }
    });

    test('selectNext under an unpersisted strategy applies the rest default (starts nothing)', async () => {
        const rig = await makeRig();
        try {
            const result = await rig.runtime.selectNext(rig.project);
            expect(result.decisions).toEqual([]);
            expect(result.holds.map((h) => h.wbs)).toEqual(['0840', '0841', '0842', '0843']);
            expect(result.holds.every((h) => h.reason === 'rest-after-drain')).toBe(true);
        } finally {
            await rig.cleanup();
        }
    });
});

describe('StrategyRuntime.selectNext wiring (0838 R3)', () => {
    test('gtd dispatches only the authorized/ready/satisfied subset, carrying the live claim epoch + strategy version', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.runtime.setStrategy(rig.project, 'gtd'); // version 2
            const orch = await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            expect(orch?.ownerEpoch).toBe(1);
            rig.blocked['0841'] = '0899'; // the injected L4 gate; its blocking wbs is the hold detail
            rig.blocked['0842'] = '0800'; // never consulted — unauthorized precedes the dependency gate

            const result = await rig.runtime.selectNext(rig.project);
            // 0843 (P0) and 0840 (P1) dispatch — priority first; 0841 holds
            // unmet-dependency with the blocking wbs; 0842 holds unauthorized.
            // Each decision pins strategyVersion 2 / the live claim's epoch 1.
            expect(result.decisions.map((d) => [d.taskId, d.strategyVersion, d.ownerEpoch])).toEqual([
                ['0843', 2, 1],
                ['0840', 2, 1],
            ]);
            expect(result.holds).toEqual([
                { wbs: '0841', reason: 'unmet-dependency', detail: '0899' },
                { wbs: '0842', reason: 'unauthorized' },
            ]);
            // Priority order also owns capacity allocation: P0 gets the first instance.
            expect(result.decisions.map((d) => d.instanceId)).toEqual(['proj-coder', 'proj-reader']);
            expect(result.decisions.map((d) => d.requiresWrite)).toEqual([true, false]);
        } finally {
            await rig.cleanup();
        }
    });

    test('no live orchestrator blocks selection rather than minting epoch-zero decisions', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'write', 'proj-orch', 30_000); // orch is running work
            const result = await rig.runtime.selectNext(rig.project);
            expect(result.decisions).toEqual([]);
            expect(result.holds.every((hold) => hold.detail?.includes('bound-offline'))).toBe(true);
        } finally {
            await rig.cleanup();
        }
    });

    test('rest leaves a held write slot and its holder untouched (drain, not cancel)', async () => {
        const rig = await makeRig();
        try {
            const held = await rig.claims.claim(rig.project, 'write', 'proj-coder', 30_000);
            expect(held).not.toBeNull();
            const result = await rig.runtime.selectNext(rig.project);
            expect(result.decisions).toEqual([]);
            const after = await rig.claims.get(rig.project, 'write');
            expect(after?.holderId).toBe('proj-coder');
            expect(after?.ownerEpoch).toBe(held?.ownerEpoch);
        } finally {
            await rig.cleanup();
        }
    });
});

describe('StrategyRuntime.reconcileStrategy (0859 R1)', () => {
    test('a declared strategy that differs from the row writes once, bumps the version and emits one event', async () => {
        const rig = await makeRig({ strategy: 'rest' });
        try {
            expect(await rig.runtime.reconcileStrategy(rig.project, 'gtd')).toBe(true);
            expect(await rig.runtime.getStrategy(rig.project)).toEqual({ name: 'gtd', version: 2 }); // rest v1 → gtd v2
            const rows = await new SystemEventDao(rig.db).query({ names: ['strategy.changed'], limit: 10 });
            expect(rows).toHaveLength(1);
            expect(JSON.parse(rows[0]?.payload_json ?? '{}')).toMatchObject({ strategy: 'gtd', version: 2 });
        } finally {
            await rig.cleanup();
        }
    });

    test('a second reconcile with the same strategy is silent: no version bump, no event', async () => {
        const rig = await makeRig({ strategy: 'rest' });
        try {
            await rig.runtime.reconcileStrategy(rig.project, 'gtd');
            expect(await rig.runtime.reconcileStrategy(rig.project, 'gtd')).toBe(false);
            expect(await rig.runtime.getStrategy(rig.project)).toEqual({ name: 'gtd', version: 2 });
            const rows = await new SystemEventDao(rig.db).query({ names: ['strategy.changed'], limit: 10 });
            expect(rows).toHaveLength(1); // still the first reconcile's single row
        } finally {
            await rig.cleanup();
        }
    });

    test('the default matches an absent row without writing one (0859 R3 — a project with no declaration is untouched)', async () => {
        const rig = await makeRig();
        try {
            expect(await rig.runtime.reconcileStrategy(rig.project, DEFAULT_STRATEGY)).toBe(false);
            expect(await rig.dao.get(rig.project)).toBeNull();
            const rows = await new SystemEventDao(rig.db).query({ names: ['strategy.changed'], limit: 10 });
            expect(rows).toHaveLength(0);
        } finally {
            await rig.cleanup();
        }
    });
});

describe('StrategyRuntime.resume (0838 R6)', () => {
    test('strict order: persists the rest default when absent, restores a persisted strategy without resetting it', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            const report = await rig.runtime.resume(rig.project);
            expect(report.strategy).toBe('gtd');
            expect(report.version).toBe(1);
            const row = await rig.dao.get(rig.project);
            expect(row).toMatchObject({ strategy: 'gtd', strategyVersion: 1 }); // NOT rewritten

            const fresh = await makeRig();
            try {
                const defaultReport = await fresh.runtime.resume(fresh.project);
                expect(defaultReport.strategy).toBe('rest');
                expect(defaultReport.version).toBe(1);
                expect(await fresh.dao.get(fresh.project)).toMatchObject({ strategy: 'rest', strategyVersion: 1 });
            } finally {
                await fresh.cleanup();
            }
        } finally {
            await rig.cleanup();
        }
    });

    test('orchestrator offline (bound-offline) → reconciled: false, no dispatch input produced', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            const report = await rig.runtime.resume(rig.project);
            expect(report.orchestrator.state).toBe('bound-offline');
            expect(report.reconciled).toBe(false);
            expect(report.unresolved).toEqual([]);
            expect(report.orchestrator.reason).toBe('no-live-claim');
        } finally {
            await rig.cleanup();
        }
    });

    test('orchestrator missing (no declaration) → reconciled: false, distinct state, never a throw', async () => {
        const { project, db, runtime, cleanup } = await makeRig({ noFleet: true });
        try {
            const report = await runtime.resume(project);
            expect(report.orchestrator.state).toBe('missing');
            expect(report.reconciled).toBe(false);
            expect(db !== undefined).toBe(true);
        } finally {
            await cleanup();
        }
    });

    test('bound-online reconciles deliveries before reporting ready (unresolved surfaced, reconciled: true)', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            // One ambiguous delivery: injected by the drain, never settled, no receipt.
            const inbox = new (await import('@gobing-ai/spur-domain')).InboxMessageDao(rig.db);
            const messageId = await inbox.enqueue('operator', 'proj-coder', 'do the work');
            await inbox.drainPending('proj-coder');
            expect(messageId).toBeTruthy();

            const report = await rig.runtime.resume(rig.project);
            expect(report.reconciled).toBe(true);
            expect(report.orchestrator.state).toBe('bound-online');
            expect(report.unresolved.map((u) => [u.messageId, u.reason])).toEqual([[messageId, 'outcome-unknown']]);
            const selected = await rig.runtime.selectNext(rig.project);
            expect(selected.decisions).toEqual([]);
            expect(selected.holds.every((hold) => hold.detail?.includes('unresolved-deliveries'))).toBe(true);
        } finally {
            await rig.cleanup();
        }
    });

    test('an unresolved delivery to an agent outside the fleet does not hold dispatch', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            // A stale terminal message to an unrelated ad-hoc agent, never settled.
            const inbox = new (await import('@gobing-ai/spur-domain')).InboxMessageDao(rig.db);
            await inbox.enqueue('terminal', 'demo-claude', 'hello');
            await inbox.drainPending('demo-claude');

            const report = await rig.runtime.resume(rig.project);
            expect(report.reconciled).toBe(true);
            expect(report.unresolved).toEqual([]);
            const selected = await rig.runtime.selectNext(rig.project);
            expect(selected.holds.some((hold) => hold.detail?.includes('unresolved-deliveries'))).toBe(false);
        } finally {
            await rig.cleanup();
        }
    });
});

describe('StrategyRuntime wake emits (0839 R1)', () => {
    test('setStrategy emits one strategy.changed row per call into the same db as the persisted row', async () => {
        const rig = await makeRig();
        try {
            await rig.runtime.setStrategy(rig.project, 'gtd');
            await rig.runtime.setStrategy(rig.project, 'gtd');
            const rows = await new SystemEventDao(rig.db).query({ names: ['strategy.changed'], limit: 10 });
            expect(rows).toHaveLength(2);
            const payloads = rows
                .map((r) => JSON.parse(r.payload_json ?? '{}') as Record<string, unknown>)
                .sort((a, b) => (a.version as number) - (b.version as number)); // same-ms rows tie-break unstably
            expect(payloads[1]).toMatchObject({ projectPath: rig.project, strategy: 'gtd', version: 2 });
            expect(payloads.every((p) => p.strategy === 'gtd')).toBe(true);
            expect(rows.every((r) => r.actor === 'strategy-runtime')).toBe(true);
        } finally {
            await rig.cleanup();
        }
    });

    test('read-only strategy access emits nothing (idle reads are not wake facts)', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.runtime.getStrategy(rig.project);
            await rig.runtime.selectNext(rig.project);
            const rows = await new SystemEventDao(rig.db).query({ names: ['strategy.changed'], limit: 10 });
            expect(rows).toHaveLength(0);
        } finally {
            await rig.cleanup();
        }
    });
});

describe('managed GTD dispatch and reconciliation (G62)', () => {
    test('R1: tick enqueues one keyed dispatch per idle writer, claims the write slot, and never runs member work in-process', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            const ticked = await rig.runtime.tick(rig.project, { ownerEpoch: 1, orchestratorId: 'proj-orch' });
            // Both P0 tasks go out: the write-capable coder takes the single write slot,
            // the proven read-only reader needs none (0837 R5).
            expect(ticked.dispatched.map((d) => d.taskId)).toEqual(['0841', '0843']);
            expect(rig.enqueued).toEqual([
                {
                    member: 'proj-coder',
                    fromId: 'proj-orch',
                    body: '/sp:dev-run 0841 --auto',
                    requestKey: 'fleet:task:0841:1',
                },
                {
                    member: 'proj-reader',
                    fromId: 'proj-orch',
                    body: '/sp:dev-run 0843 --auto',
                    requestKey: 'fleet:task:0843:1',
                },
            ]);
            expect((await rig.claims.get(rig.project, 'write'))?.holderId).toBe('proj-coder');
            rig.runtime.stop();
        } finally {
            await rig.cleanup();
        }
    });

    test('G71 R1: a wip task is dispatched with --continue', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            const target = rig.candidates.find((candidate) => candidate.wbs === '0841');
            if (target !== undefined) target.status = 'wip';
            const ticked = await rig.runtime.tick(rig.project, { ownerEpoch: 1, orchestratorId: 'proj-orch' });
            // 0841 is the first P0 candidate by wbs; 0843 follows on the second idle member.
            expect(ticked.dispatched.map((d) => d.taskId)).toContain('0841');
            expect(rig.enqueued[0]?.body).toBe('/sp:dev-run 0841 --auto --continue');
            rig.runtime.stop();
        } finally {
            await rig.cleanup();
        }
    });

    test('G71 R1: a todo task whose prior keyed attempt failed is retried with --continue', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            const runs = new CoordinationRunDao(rig.db);
            const inbox = new InboxMessageDao(rig.db);
            const { id } = await inbox.enqueueIdempotent('proj-orch', 'proj-coder', 'attempt 1', 'fleet:task:0841:1');
            await runs.insertStart({
                specId: 'proj-coder',
                agentKind: 'pi',
                processId: null,
                runId: 'prior-failed',
                generation: 1,
                startedAt: new Date().toISOString(),
                messageIds: [id],
                taskId: '0841',
            });
            await runs.updateExit('prior-failed', 'errored', new Date().toISOString(), '[]', {
                messageIds: [id],
                taskId: '0841',
                outcome: 'errored',
            });
            const ticked = await rig.runtime.tick(rig.project, { ownerEpoch: 1, orchestratorId: 'proj-orch' });
            expect(ticked.dispatched.map((d) => d.taskId)).toContain('0841');
            expect(rig.enqueued[0]?.requestKey).toBe('fleet:task:0841:2');
            expect(rig.enqueued[0]?.body).toBe('/sp:dev-run 0841 --auto --continue');
            rig.runtime.stop();
        } finally {
            await rig.cleanup();
        }
    });

    test('R1: a stale owner epoch fences the whole tick — nothing is claimed or enqueued', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            const ticked = await rig.runtime.tick(rig.project, { ownerEpoch: 99, orchestratorId: 'proj-orch' });
            expect(ticked.dispatched).toEqual([]);
            expect(rig.enqueued).toEqual([]);
            expect(await rig.claims.get(rig.project, 'write')).toBeNull();
        } finally {
            await rig.cleanup();
        }
    });

    test('R1: an in-flight keyed dispatch blocks every new dispatch until a definite receipt lands', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            await rig.runtime.tick(rig.project, { ownerEpoch: 1, orchestratorId: 'proj-orch' });
            const second = await rig.runtime.tick(rig.project, { ownerEpoch: 1, orchestratorId: 'proj-orch' });
            expect(second.dispatched).toEqual([]);
            expect(rig.enqueued).toHaveLength(2);
            // Each in-flight task names its OWN open attempt; nothing new goes out.
            expect(second.holds).toContainEqual({
                wbs: '0841',
                reason: 'dispatch-in-flight',
                detail: 'attempt 1 has no terminal receipt yet',
            });
            expect(second.holds).toContainEqual({
                wbs: '0843',
                reason: 'dispatch-in-flight',
                detail: 'attempt 1 has no terminal receipt yet',
            });
            rig.runtime.stop();
        } finally {
            await rig.cleanup();
        }
    });

    test('R2: an outcome-unknown wait is not re-dispatched — absence of a receipt is not a failure', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            const runs = new CoordinationRunDao(rig.db);
            const inbox = new InboxMessageDao(rig.db);
            const { id } = await inbox.enqueueIdempotent('proj-orch', 'proj-coder', 'attempt 1', 'fleet:task:0841:1');
            await runs.insertStart({
                specId: 'proj-coder',
                agentKind: 'pi',
                processId: null,
                runId: 'still-running',
                generation: 1,
                startedAt: new Date().toISOString(),
                messageIds: [id],
                taskId: '0841',
            });
            const selected = await rig.runtime.selectNext(rig.project);
            expect(selected.decisions.some((d) => d.taskId === '0841')).toBe(false);
            expect(selected.holds).toContainEqual({
                wbs: '0841',
                reason: 'dispatch-in-flight',
                detail: 'attempt 1 has no terminal receipt yet',
            });
        } finally {
            await rig.cleanup();
        }
    });

    test('R1: a failed receipt retries under the attempt cap; a completed attempt is not a candidate', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            const runs = new CoordinationRunDao(rig.db);
            const inbox = new InboxMessageDao(rig.db);
            const settle = async (wbs: string, n: number, status: 'exited' | 'errored') => {
                const { id } = await inbox.enqueueIdempotent(
                    'proj-orch',
                    'proj-coder',
                    `attempt ${n}`,
                    `fleet:task:${wbs}:${n}`,
                );
                await runs.insertStart({
                    specId: 'proj-coder',
                    agentKind: 'pi',
                    processId: null,
                    runId: `${wbs}-try-${n}`,
                    generation: n,
                    startedAt: new Date().toISOString(),
                    messageIds: [id],
                    taskId: wbs,
                });
                await runs.updateExit(`${wbs}-try-${n}`, status, new Date().toISOString(), '[]', {
                    messageIds: [id],
                    taskId: wbs,
                    outcome: status === 'exited' ? 'run-exit-only' : 'errored',
                });
            };
            await settle('0841', 1, 'errored');
            const retry = await rig.runtime.selectNext(rig.project);
            expect(retry.decisions.some((d) => d.taskId === '0841')).toBe(true);
            expect(retry.holds.some((h) => h.wbs === '0841' && h.reason === 'dispatch-in-flight')).toBe(false);

            await settle('0841', 2, 'errored');
            await settle('0841', 3, 'errored');
            const capped = await rig.runtime.selectNext(rig.project);
            expect(capped.decisions.some((d) => d.taskId === '0841')).toBe(false);
            expect(capped.holds).toContainEqual({ wbs: '0841', reason: 'not-ready' });

            await settle('0843', 1, 'exited');
            const completed = await rig.runtime.selectNext(rig.project);
            expect(completed.decisions.some((d) => d.taskId === '0843')).toBe(false);
            expect(completed.holds).toContainEqual({ wbs: '0843', reason: 'not-ready' });
        } finally {
            await rig.cleanup();
        }
    });

    test('running members consume instance capacity and a definite receipt frees the slot', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            const runs = new CoordinationRunDao(rig.db);
            await runs.insertStart({
                specId: 'proj-reader',
                agentKind: 'claude-code',
                processId: null,
                runId: 'reader-running',
                generation: 1,
                startedAt: new Date().toISOString(),
                taskId: '0843',
            });
            const result = await rig.runtime.selectNext(rig.project);
            expect(result.decisions.map((d) => d.instanceId)).toEqual(['proj-coder']);
            expect(result.decisions.map((d) => d.taskId)).toEqual(['0841']);
        } finally {
            await rig.cleanup();
        }
    });

    test('R1/R4: observe releases the write slot once the receipt settles, and retry is freshness only', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            await rig.runtime.tick(rig.project, { ownerEpoch: 1, orchestratorId: 'proj-orch' });
            // Still pending: the slot stays claimed so nothing else can start.
            expect(await rig.runtime.observe(rig.project, { ownerEpoch: 1 })).toEqual({ released: [] });
            expect((await rig.claims.get(rig.project, 'write'))?.holderId).toBe('proj-coder');

            // The member's run lands an errored receipt for the dispatched message.
            const inbox = new InboxMessageDao(rig.db);
            const [row] = await inbox.inbox('proj-coder');
            expect(row).toBeDefined();
            const runs = new CoordinationRunDao(rig.db);
            await runs.insertStart({
                specId: 'proj-coder',
                agentKind: 'pi',
                processId: null,
                runId: 'failed-once',
                generation: 1,
                startedAt: new Date().toISOString(),
                messageIds: [row?.id ?? ''],
                taskId: '0841',
            });
            await runs.updateExit('failed-once', 'errored', new Date().toISOString(), '[]', {
                messageIds: [row?.id ?? ''],
                taskId: '0841',
                outcome: 'errored',
            });

            expect(await rig.runtime.observe(rig.project, { ownerEpoch: 1 })).toEqual({ released: ['proj-coder'] });
            expect(await rig.claims.get(rig.project, 'write')).toBeNull();
            rig.runtime.stop();
        } finally {
            await rig.cleanup();
        }
    });

    test('R1: the standby heartbeat keeps the slot alive until the member claims it', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        vi.useFakeTimers();
        const clock = spyOn(Date, 'now');
        try {
            const start = Date.now();
            await rig.claims.claim(rig.project, 'orchestrator', 'proj-orch', 120_000);
            const ticked = await rig.runtime.tick(rig.project, { ownerEpoch: 1, orchestratorId: 'proj-orch' });
            expect(ticked.dispatched.map((d) => d.taskId)).toEqual(['0841', '0843']);
            const original = await rig.claims.get(rig.project, 'write');
            for (let i = 0; i < 4; i++) {
                clock.mockReturnValue(start + (i + 1) * 10_000);
                vi.advanceTimersByTime(10_000);
                // Drain the async DAO heartbeat work scheduled by the interval.
                for (let j = 0; j < 20; j++) await Promise.resolve();
            }
            const renewed = await rig.claims.get(rig.project, 'write');
            expect(renewed?.expiresAt).toBeGreaterThan(original?.expiresAt ?? 0);
            expect(renewed?.expiresAt).toBeGreaterThan(Date.now());
            expect(await rig.claims.claim(rig.project, 'write', 'competing-writer', 30_000)).toBeNull();
            rig.runtime.stop();
        } finally {
            clock.mockRestore();
            vi.useRealTimers();
            await rig.cleanup();
        }
    });
});
