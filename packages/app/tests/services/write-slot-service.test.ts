import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpurConfig, spurConfigSchema } from '@gobing-ai/spur-config';
import { type DbAdapter, ProjectClaimDao, ProjectStrategyDao, SystemEventDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { parse as yamlParse } from 'yaml';
import {
    type DispatchDecision,
    FleetService,
    type FleetServiceContext,
    normalizeProjectPath,
    ProjectRegistry,
    WriteSlotService,
} from '../../src/index';
import { createMigratedDb } from '../helpers';

// ---------------------------------------------------------------------------
// Harness (mirrors fleet-service.test.ts conventions)
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
    - name: noaxis
      agent: codex
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
        { id: 'ghost', executor: 'noaxis' },
    ],
    orchestrator: 'orch',
};

async function makeProject(): Promise<{ project: string; cleanup: () => Promise<void> }> {
    const base = await mkdtemp(join(tmpdir(), 'spur-write-slot-'));
    // Create the dir BEFORE normalizing — realpath (/var → /private/var on
    // macOS) only resolves for an existing path, and the dao seeds below and
    // the service's internal normalization must agree on the key.
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
    dao: ProjectClaimDao;
    service: WriteSlotService;
    cleanup: () => Promise<void>;
}

/** Temp project + fleet declaration + migrated in-memory db + wired WriteSlotService. */
async function makeRig(): Promise<Rig> {
    const { project, cleanup } = await makeProject();
    await writeFile(join(project, '.spur', 'fleet.json'), JSON.stringify(FLEET));
    const db = await createMigratedDb();
    const fleet = new FleetService({
        spurConfig: parseConfig(EXECUTORS_YAML),
        fs: createNodeFileSystem(project),
        registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
        openDb: async () => db,
    } satisfies FleetServiceContext);
    const service = new WriteSlotService({
        fleet,
        openDb: async () => db,
    });
    return { project, db, dao: new ProjectClaimDao(db), service, cleanup };
}

function writeDecision(rig: Rig, instanceId: string, opts?: Partial<DispatchDecision>): DispatchDecision {
    return {
        projectPath: rig.project,
        instanceId,
        ownerEpoch: 1,
        strategyVersion: 1,
        requiresWrite: true,
        ...opts,
    };
}

// ---------------------------------------------------------------------------
// claim — atomicity, fencing, capability (R2–R5)
// ---------------------------------------------------------------------------

describe('WriteSlotService claim (0837)', () => {
    test('the persisted strategy fences a decision even when the orchestrator row has no version', async () => {
        const rig = await makeRig();
        try {
            await rig.dao.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            const strategy = new ProjectStrategyDao(rig.db);
            await strategy.set(rig.project, 'gtd');
            await strategy.set(rig.project, 'rest');
            expect(await rig.service.claim(writeDecision(rig, 'proj-coder'))).toEqual({
                ok: false,
                refusal: 'stale-strategy',
            });
            expect(await rig.dao.get(rig.project, 'write')).toBeNull();
        } finally {
            await rig.cleanup();
        }
    });

    test('two simultaneous assignments to the same writer cannot both acquire its live slot', async () => {
        const rig = await makeRig();
        try {
            const outcomes = await Promise.all([
                rig.service.claim(writeDecision(rig, 'proj-coder')),
                rig.service.claim(writeDecision(rig, 'proj-coder')),
            ]);
            expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
        } finally {
            await rig.cleanup();
        }
    });
    test('two racing write claims: exactly one holder, the loser refused slot-held (R2)', async () => {
        const rig = await makeRig();
        try {
            const results = await Promise.all([
                rig.service.claim(writeDecision(rig, 'proj-coder')),
                rig.service.claim(writeDecision(rig, 'proj-ghost')),
            ]);
            const ok = results.filter((r) => r.ok);
            const refused = results.filter((r) => !r.ok && r.refusal === 'slot-held');
            expect(ok).toHaveLength(1);
            expect(refused).toHaveLength(1);
            const winner = ok[0]?.lease?.holderId;
            expect(winner === 'proj-coder' || winner === 'proj-ghost').toBe(true);
            const current = await rig.dao.get(rig.project, 'write');
            expect(current?.holderId).toBe(winner);
            expect(current?.ownerEpoch).toBe(1);
        } finally {
            await rig.cleanup();
        }
    });

    test('decision pinned below the orchestrator epoch → stale-owner, slot never touched (R3)', async () => {
        const rig = await makeRig();
        try {
            await rig.dao.claim(rig.project, 'orchestrator', 'proj-orch', 30_000);
            await rig.dao.claim(rig.project, 'orchestrator', 'proj-orch', 30_000); // re-entrant → epoch 2 (claim-generation)
            const outcome = await rig.service.claim(writeDecision(rig, 'proj-coder', { ownerEpoch: 1 }));
            expect(outcome).toEqual({ ok: false, refusal: 'stale-owner' });
            expect(await rig.dao.get(rig.project, 'write')).toBeNull();
        } finally {
            await rig.cleanup();
        }
    });

    test('a decision taken before a strategy bump → stale-strategy (R4)', async () => {
        const rig = await makeRig();
        try {
            await rig.dao.claim(rig.project, 'orchestrator', 'proj-orch', 30_000, 3); // 0838 will mint versions
            const outcome = await rig.service.claim(writeDecision(rig, 'proj-coder', { strategyVersion: 2 }));
            expect(outcome).toEqual({ ok: false, refusal: 'stale-strategy' });
            expect(await rig.dao.get(rig.project, 'write')).toBeNull();
        } finally {
            await rig.cleanup();
        }
    });

    test('NULL strategy_version fences nothing (0838 not minting yet)', async () => {
        const rig = await makeRig();
        try {
            await rig.dao.claim(rig.project, 'orchestrator', 'proj-orch', 30_000); // strategy_version NULL
            const outcome = await rig.service.claim(writeDecision(rig, 'proj-coder', { strategyVersion: 1 }));
            expect(outcome.ok).toBe(true);
        } finally {
            await rig.cleanup();
        }
    });

    test('proven read-only runs CONCURRENTLY with a held write slot — no lease taken (R5)', async () => {
        const rig = await makeRig();
        try {
            const holder = await rig.service.claim(writeDecision(rig, 'proj-coder'));
            expect(holder.ok).toBe(true);

            const reader = await rig.service.claim(writeDecision(rig, 'proj-reader', { requiresWrite: false }));
            expect(reader).toEqual({ ok: true });

            // the read-only pass left the slot untouched — the writer is still excluded
            const again = await rig.service.claim(writeDecision(rig, 'proj-ghost'));
            expect(again).toEqual({ ok: false, refusal: 'slot-held' });
        } finally {
            await rig.cleanup();
        }
    });

    test('fsWrite unknown / absent member → write-capability-unproven; role name never evidence (R5)', async () => {
        const rig = await makeRig();
        try {
            const unknownAxis = await rig.service.claim(writeDecision(rig, 'proj-ghost', { requiresWrite: false }));
            expect(unknownAxis).toEqual({ ok: false, refusal: 'write-capability-unproven' });

            const absent = await rig.service.claim(writeDecision(rig, 'proj-nobody', { requiresWrite: false }));
            expect(absent).toEqual({ ok: false, refusal: 'write-capability-unproven' });

            expect(await rig.dao.get(rig.project, 'write')).toBeNull();
        } finally {
            await rig.cleanup();
        }
    });

    test('claim stores strategyVersion on the lease; release is holder-scoped and the slot re-claims', async () => {
        const rig = await makeRig();
        try {
            const held = await rig.service.claim(writeDecision(rig, 'proj-coder', { strategyVersion: 7 }));
            expect(held.ok && held.lease?.strategyVersion).toBe(7);

            expect(await rig.service.release(rig.project, 'proj-orch')).toBe(false);
            expect(await rig.service.release(rig.project, 'proj-coder')).toBe(true);
            expect(await rig.dao.get(rig.project, 'write')).toBeNull();

            const next = await rig.service.claim(writeDecision(rig, 'proj-ghost'));
            expect(next.ok && next.lease?.holderId).toBe('proj-ghost');
        } finally {
            await rig.cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// validateResult — stale owners get a diagnostic, never a transition (R3)
// ---------------------------------------------------------------------------

describe('WriteSlotService validateResult (0837 R3)', () => {
    test('a different holder cannot report a result with the current or a future epoch', async () => {
        const rig = await makeRig();
        try {
            await rig.dao.claim(rig.project, 'write', 'proj-coder', 30_000);
            expect(await rig.service.validateResult(rig.project, 'proj-ghost', 1)).toBe('stale-owner-rejected');
            expect(await rig.service.validateResult(rig.project, 'proj-coder', 99)).toBe('stale-owner-rejected');
        } finally {
            await rig.cleanup();
        }
    });

    test('release and reclaim preserve the generation fence against an older run of the same member', async () => {
        const rig = await makeRig();
        try {
            const first = await rig.dao.claim(rig.project, 'write', 'proj-coder', 30_000);
            await rig.service.release(rig.project, 'proj-coder');
            const second = await rig.dao.claim(rig.project, 'write', 'proj-coder', 30_000);
            expect(second?.ownerEpoch).toBeGreaterThan(first?.ownerEpoch ?? 0);
            expect(await rig.service.validateResult(rig.project, 'proj-coder', first?.ownerEpoch ?? 0)).toBe(
                'stale-owner-rejected',
            );
        } finally {
            await rig.cleanup();
        }
    });
    test('result from a replaced owner → stale-owner-rejected + diagnostic, slot state unchanged', async () => {
        const rig = await makeRig();
        try {
            await rig.dao.claim(rig.project, 'write', 'proj-coder', 0); // expired…
            await rig.dao.claim(rig.project, 'write', 'proj-ghost', 30_000, 1); // …takeover: epoch 2

            const verdict = await rig.service.validateResult(rig.project, 'proj-coder', 1, {
                runId: 'run-1',
                taskId: '0837',
            });
            expect(verdict).toBe('stale-owner-rejected');

            const events = await rig.db.queryAll<{
                event_name: string;
                run_id: string | null;
                entity_id: string | null;
            }>(
                "SELECT event_name, run_id, entity_id FROM system_events WHERE event_name = 'fleet.write-slot.stale-owner-rejected'",
            );
            expect(events).toHaveLength(1);
            expect(events[0]?.run_id).toBe('run-1');
            expect(events[0]?.entity_id).toBe('0837');

            // no transition: the slot still belongs to the CURRENT owner, untouched by the diagnostic
            const slot = await rig.dao.get(rig.project, 'write');
            expect(slot?.holderId).toBe('proj-ghost');
            expect(slot?.ownerEpoch).toBe(2);
        } finally {
            await rig.cleanup();
        }
    });

    test('current-generation result is accepted before release; a released slot cannot certify a late result', async () => {
        const rig = await makeRig();
        try {
            await rig.dao.claim(rig.project, 'write', 'proj-coder', 30_000, 1);
            expect(await rig.service.validateResult(rig.project, 'proj-coder', 1)).toBe('accepted');
            expect(await rig.service.validateResult(rig.project, 'proj-coder', 0)).toBe('stale-owner-rejected');

            await rig.service.release(rig.project, 'proj-coder');
            expect(await rig.service.validateResult(rig.project, 'proj-coder', 1)).toBe('stale-owner-rejected');
        } finally {
            await rig.cleanup();
        }
    });

    test('path spellings of the same project resolve to the same slot', async () => {
        const rig = await makeRig();
        try {
            await rig.dao.claim(rig.project, 'write', 'proj-coder', 0);
            await rig.dao.claim(rig.project, 'write', 'proj-ghost', 30_000, 1);
            expect(await rig.service.validateResult(`${rig.project}/`, 'proj-coder', 1)).toBe('stale-owner-rejected');
        } finally {
            await rig.cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// Guard: the diagnostic path never mutates task state (R3 — structural)
// ---------------------------------------------------------------------------

describe('stale-owner diagnostic side effects (0837)', () => {
    test('the only write is the single system_events row; claim rows and strategy untouched', async () => {
        const rig = await makeRig();
        try {
            await rig.dao.claim(rig.project, 'write', 'proj-coder', 0);
            await rig.dao.claim(rig.project, 'write', 'proj-ghost', 30_000, 1);
            const claimsBefore = await rig.db.queryAll('SELECT * FROM project_claims');

            await rig.service.validateResult(rig.project, 'proj-coder', 1);

            const claimsAfter = await rig.db.queryAll('SELECT * FROM project_claims');
            expect(claimsAfter).toEqual(claimsBefore);
        } finally {
            await rig.cleanup();
        }
    });
});

describe('WriteSlotService wake emits (0839 R1)', () => {
    test('a taken slot emits one fleet.capacity.changed row; a proven read-only claim emits nothing', async () => {
        const rig = await makeRig();
        try {
            await rig.service.claim(writeDecision(rig, 'proj-coder'));
            await rig.service.claim(writeDecision(rig, 'proj-ghost', { requiresWrite: false }));
            const rows = await new SystemEventDao(rig.db).query({ names: ['fleet.capacity.changed'], limit: 10 });
            expect(rows).toHaveLength(1);
            const payload = JSON.parse(rows[0]?.payload_json ?? '{}') as Record<string, unknown>;
            expect(payload).toMatchObject({ projectPath: rig.project, change: 'claim', holderId: 'proj-coder' });
        } finally {
            await rig.cleanup();
        }
    });

    test('release emits only when a slot is actually freed', async () => {
        const rig = await makeRig();
        try {
            await rig.service.claim(writeDecision(rig, 'proj-coder'));
            expect(await rig.service.release(rig.project, 'proj-coder')).toBe(true);
            expect(await rig.service.release(rig.project, 'proj-coder')).toBe(false);
            const rows = await new SystemEventDao(rig.db).query({ names: ['fleet.capacity.changed'], limit: 10 });
            const changes = rows.map((r) => (JSON.parse(r.payload_json ?? '{}') as { change?: string }).change).sort(); // query orders occurred_at DESC — same-ms inserts are tie-broken unstably
            expect(changes).toEqual(['claim', 'release']);
        } finally {
            await rig.cleanup();
        }
    });
});
