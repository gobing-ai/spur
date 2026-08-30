import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCliMigrations, type DbAdapter } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { EventBus } from '@gobing-ai/ts-infra';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    ESCALATION_PACKET_KIND,
    EscalationPacketSink,
    type EscalationTaskLocator,
} from '../../src/observability/escalation-packet-sink';
import type {
    WorkflowObservabilityBus,
    WorkflowObservabilityEventMap,
    WorkflowRunFinalizedEvent,
    WorkflowTripwireFiredEvent,
} from '../../src/workflow/observability';

function makeBus(): WorkflowObservabilityBus {
    return new EventBus<WorkflowObservabilityEventMap>();
}

function tripwireEvent(overrides: Partial<WorkflowTripwireFiredEvent> = {}): WorkflowTripwireFiredEvent {
    return {
        schemaVersion: 1,
        eventId: 'evt-1',
        runId: 'run-42',
        at: '2026-08-29T22:00:00.000Z',
        severity: 'warning',
        node: 'test',
        kind: 'agent.run',
        policy: { id: 'hard-budget', version: 1 },
        response: 'fail',
        observed: 'tokens used 120000',
        threshold: 'max-tokens 100000',
        actionId: 'run-42:test',
        task: '0709',
        evidenceRefs: ['.spur/run/run-42-budget.json'],
        nextDecision: 'An operator must raise the declared budget or trim the stage scope.',
        ...overrides,
    };
}

function finalizedEvent(status: 'failed' | 'done', runId = 'run-42'): WorkflowRunFinalizedEvent {
    return {
        schemaVersion: 1,
        eventId: 'evt-2',
        sequence: 2,
        runId,
        workflowName: 'task-pipeline',
        status,
        at: '2026-08-29T22:01:00.000Z',
    };
}

async function makeEnv(): Promise<{
    db: DbAdapter;
    bus: WorkflowObservabilityBus;
    cwd: string;
    sink: EscalationPacketSink;
}> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(db);
    insertRun(db, 'run-42');
    const cwd = mkdtempSync(join(tmpdir(), 'escalation-'));
    const bus = makeBus();
    const sink = new EscalationPacketSink({
        bus,
        cwd,
        fs: createNodeFileSystem(),
        db,
        now: () => '2026-08-29T22:02:00.000Z',
    });
    return { db, bus, cwd, sink };
}

function insertRun(db: DbAdapter, runId: string): void {
    // artifacts.run_id carries a foreign key into runs; a real run row exists
    // in production, so the fixture must insert one too.
    db.run(
        `INSERT INTO runs (id, workflow_name, mode, status, agent, started_at, completed_at, metadata_json)
         VALUES (?, 'task-pipeline', 'auto', 'failed', NULL, ?, ?, '{}')`,
        runId,
        '2026-08-29T10:00:00.000Z',
        '2026-08-29T11:00:00.000Z',
    );
}

async function rows(db: DbAdapter, runId: string): Promise<Array<{ path: string; kind: string }>> {
    return (await db.queryAll(`SELECT path, kind FROM artifacts WHERE run_id = ?`, runId)) as Array<{
        path: string;
        kind: string;
    }>;
}

describe('EscalationPacketSink', () => {
    test('trip wire projects one canonical packet + artifact row + bounded created event (R1/R2/R6)', async () => {
        const { bus, cwd, sink, db } = await makeEnv();
        const created: unknown[] = [];
        bus.on('workflow.escalation.created', (event) => created.push(event));
        bus.emit('workflow.tripwire.fired', tripwireEvent());
        await sink.flush();

        expect(created).toHaveLength(1);
        const event = created[0] as { runId: string; fingerprint: string; artifactPath: string; decision: string };
        expect(event.runId).toBe('run-42');
        expect(event.decision).toBe('raise_budget');

        const packet = JSON.parse(readFileSync(event.artifactPath, 'utf8'));
        expect(packet.schemaVersion).toBe(1);
        expect(packet.identity.wbs).toBe('0709');
        expect(packet.decision.kind).toBe('raise_budget');
        // References only — no logs, prompts, stdout/stderr, or task bodies (R2).
        expect(JSON.stringify(packet)).not.toContain('nextDecision prompt body');
        expect(JSON.stringify(packet)).toContain('.spur/run/run-42-budget.json');

        const artifactRows = await rows(db, 'run-42');
        expect(artifactRows).toHaveLength(1);
        expect(artifactRows[0]?.kind).toBe(ESCALATION_PACKET_KIND);
        expect(artifactRows[0]?.path).toBe(join(cwd, '.spur', 'run', 'run-42-escalation.json'));
        expect(await sink.readPacket('run-42')).toBeDefined();
        rmSync(cwd, { recursive: true, force: true });
    });

    // Review finding: a fail-response tripwire is followed shortly by a
    // `failed` finalize — both projections dispatch before either completes.
    // The synchronous reservation must still yield exactly one packet.
    test('back-to-back tripwire + failed finalize race yields exactly one packet (R5)', async () => {
        const { bus, sink, db } = await makeEnv();
        const created: unknown[] = [];
        bus.on('workflow.escalation.created', (event) => created.push(event));
        bus.emit('workflow.tripwire.fired', tripwireEvent());
        bus.emit('workflow.run.finalized', finalizedEvent('failed'));
        await sink.flush();

        expect(created).toHaveLength(1);
        expect(await rows(db, 'run-42')).toHaveLength(1);
        // The tripwire (first event) wins; the packet is the tripwire one.
        const packet = await sink.readPacket('run-42');
        expect(packet?.trigger).toBe('tripwire');
        expect(packet?.evidence.eventRefs).toContain('evt-1');
    });

    test('duplicate triggers and retries never produce a second packet or message (R5)', async () => {
        const { bus, sink, db } = await makeEnv();
        const created: unknown[] = [];
        bus.on('workflow.escalation.created', (event) => created.push(event));
        // Trip wire fires, then the run finalizes failed, then the same events
        // replay (retry semantics): still exactly one packet.
        bus.emit('workflow.tripwire.fired', tripwireEvent());
        await sink.flush();
        bus.emit('workflow.run.finalized', finalizedEvent('failed'));
        await sink.flush();
        bus.emit('workflow.tripwire.fired', tripwireEvent({ eventId: 'evt-replay' }));
        await sink.flush();

        expect(created).toHaveLength(1);
        expect(await rows(db, 'run-42')).toHaveLength(1);

        // A restarted process (fresh sink, same artifacts table) is also idempotent.
        const sink2 = new EscalationPacketSink({
            bus,
            cwd: (created[0] as { artifactPath: string }).artifactPath.replace(/[/\\].*/, ''),
            fs: createNodeFileSystem(),
            db,
            now: () => '2026-08-29T23:00:00.000Z',
        });
        bus.emit('workflow.tripwire.fired', tripwireEvent());
        await sink2.flush();
        expect(created).toHaveLength(1);
        expect(await rows(db, 'run-42')).toHaveLength(1);
    });

    test('terminal failure with a task link projects a packet carrying the wbs (R1)', async () => {
        const { db, bus, sink } = await makeEnv();
        db.run(
            `INSERT INTO runs (id, workflow_name, mode, status, agent, started_at, completed_at, metadata_json)
             VALUES ('run-7', 'task-pipeline', 'auto', 'failed', NULL, ?, ?, ?)`,
            '2026-08-29T10:00:00.000Z',
            '2026-08-29T11:00:00.000Z',
            JSON.stringify({ failure_reason: 'verify gate failed: proof digest mismatch' }),
        );
        db.run(
            `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at) VALUES ('link-7', '0705', 'run-7', 'pipeline', ?)`,
            '2026-08-29T11:00:00.000Z',
        );
        const created: unknown[] = [];
        bus.on('workflow.escalation.created', (event) => created.push(event));
        bus.emit('workflow.run.finalized', finalizedEvent('failed', 'run-7'));
        await sink.flush();

        expect(created).toHaveLength(1);
        const packet = await sink.readPacket('run-7');
        expect(packet?.trigger).toBe('terminal-failure');
        expect(packet?.identity.wbs).toBe('0705');
        expect(packet?.lastFailedGate.id).toBe('terminal-failure');
        expect(packet?.decision.reason).toContain('proof digest mismatch');
        // Successful finalization never projects.
        bus.emit('workflow.run.finalized', finalizedEvent('done', 'run-8'));
        await sink.flush();
        expect(created).toHaveLength(1);
    });

    test('projection failure emits a bounded secondary diagnostic and never throws (R7)', async () => {
        const { bus, cwd } = await makeEnv();
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        // Break the first DAO read the projector performs: dedupe queries
        // artifacts before writing, so this fails before any write happens.
        (db as unknown as { queryAll: () => never }).queryAll = () => {
            throw new Error('db exploded');
        };
        const sink = new EscalationPacketSink({
            bus,
            cwd,
            fs: createNodeFileSystem(),
            db,
            now: () => '2026-08-29T22:03:00.000Z',
        });
        const diagnostics: unknown[] = [];
        bus.on('workflow.escalation.projection_failed', (event) => diagnostics.push(event));
        expect(() => bus.emit('workflow.tripwire.fired', tripwireEvent())).not.toThrow();
        await sink.flush();
        expect(diagnostics).toHaveLength(1);
        expect((diagnostics[0] as { error: string }).error).toContain('db exploded');
        expect((diagnostics[0] as { error: string }).error.length).toBeLessThan(300);
    });

    test('locator enriches identity with task name and feature id (R1)', async () => {
        const { bus, cwd } = await makeEnv();
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        insertRun(db, 'run-42');
        // Separate cwd: the shared-bus makeEnv sink (no locator) must not win
        // the same-path write race with the enriched projector.
        const escDir = mkdtempSync(join(tmpdir(), 'escalation-enr-'));
        const taskFile = join(escDir, '0709_task.md');
        writeFileSync(taskFile, `---\nname: "Render escalation packets"\nfeature_id: A6\n---\n\nbody\n`);
        const enriched = new EscalationPacketSink({
            bus,
            cwd: escDir,
            fs: createNodeFileSystem(),
            db,
            locator: {
                findByWbs: async () => ({ filePath: taskFile }),
            } satisfies EscalationTaskLocator,
            now: () => '2026-08-29T22:04:00.000Z',
        });
        bus.emit('workflow.tripwire.fired', tripwireEvent());
        await enriched.flush();
        const packet = await enriched.readPacket('run-42');
        expect(packet?.identity).toEqual({ wbs: '0709', task: 'Render escalation packets', feature: 'A6' });
        rmSync(cwd, { recursive: true, force: true });
    });
});
