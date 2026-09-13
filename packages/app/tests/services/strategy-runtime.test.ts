import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpurConfig, spurConfigSchema } from '@gobing-ai/spur-config';
import { type DbAdapter, ProjectClaimDao, ProjectStrategyDao, SystemEventDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { parse as yamlParse } from 'yaml';
import {
    FLEET_AUTO_TAG,
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
    version: 1,
    members: [
        { id: 'orch', role: 'planner', purpose: 'orchestrator', executor: 'writer' },
        { id: 'coder', executor: 'writer' },
        { id: 'reader', executor: 'readonly' },
    ],
    orchestrator: 'orch',
};

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
    candidates: ReturnType<typeof task>[];
    blocked: Record<string, string | null>;
    cleanup: () => Promise<void>;
}

/** Temp project + fleet declaration + migrated in-memory db + wired StrategyRuntime. */
async function makeRig(opts?: { strategy?: string }): Promise<Rig> {
    const { project, cleanup } = await makeProject();
    await writeFile(join(project, '.spur', 'fleet.json'), JSON.stringify(FLEET));
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
        spurConfig: parseConfig(EXECUTORS_YAML),
        fs: createNodeFileSystem(project),
        registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
        openDb: async () => db,
    });
    const ctx: StrategyRuntimeContext = {
        openDb: async () => db,
        tasks: { list: async () => candidates },
        fleet,
        dependencyBlocked: async (_projectPath, wbs) => blocked[wbs] ?? null,
    };
    return {
        project,
        db,
        dao: new ProjectStrategyDao(db),
        claims: new ProjectClaimDao(db),
        runtime: new StrategyRuntime(ctx),
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
    test('five-step precedence: every skip gets exactly one hold reason, first failure wins', () => {
        const result = gtdStrategy.select(
            pureCtx({
                candidates: [
                    task('0801'), // no tags → unauthorized
                    task('0802', { tags: [FLEET_AUTO_TAG], status: 'wip' }), // not-ready
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
            // The frozen five-step assigns idle instances in candidate iteration
            // order (0840 pops the first member), THEN survivors sort — so P0 0843
            // carries the second resolved member. Instances are fungible in v1.
            expect(result.decisions.map((d) => d.instanceId)).toEqual(['proj-coder', 'proj-orch']);
            expect(result.decisions.map((d) => d.requiresWrite)).toEqual([true, true]);
        } finally {
            await rig.cleanup();
        }
    });

    test('idle capacity excludes the live write-slot holder; no live orchestrator claim → epoch 0 (fences every claim)', async () => {
        const rig = await makeRig({ strategy: 'gtd' });
        try {
            await rig.claims.claim(rig.project, 'write', 'proj-orch', 30_000); // orch is running work
            const result = await rig.runtime.selectNext(rig.project);
            expect(result.decisions.map((d) => d.instanceId)).not.toContain('proj-orch');
            expect(result.decisions.every((d) => d.ownerEpoch === 0)).toBe(true);
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
        const { project, db, runtime, cleanup } = await (async () => {
            const rig = await makeRig();
            await rm(join(rig.project, '.spur', 'fleet.json'));
            return rig;
        })();
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
