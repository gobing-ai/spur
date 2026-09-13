import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    normalizeProjectPath,
    ProjectRegistry,
    setDetachedServeSpawnForTests,
    setPortProbeForTests,
} from '@gobing-ai/spur-app';
import { CoordinationRunDao, createMigratedDb, InboxMessageDao, ProjectStrategyDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { Hono } from 'hono';
import type { ServerContext } from '../../src/context';
import { healthModule } from '../../src/modules/health';

describe('healthModule', () => {
    let tempDir: string;
    let projectsFile: string;
    const origAllocate = ProjectRegistry.prototype.allocatePort;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-health-test-'));
        projectsFile = join(tempDir, 'projects.json');
        process.env.SPUR_PROJECTS_FILE = projectsFile;
    });

    afterEach(() => {
        setPortProbeForTests(undefined);
        ProjectRegistry.prototype.allocatePort = origAllocate;
        delete process.env.SPUR_PROJECTS_FILE;
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('name is health', () => {
        expect(healthModule.name).toBe('health');
    });

    test('mount registers /api/health and /api/health/ready', async () => {
        const app = new Hono();
        healthModule.mount(app, undefined);

        // Liveness
        const livenessRes = await app.request('/api/health');
        expect(livenessRes.status).toBe(200);
        const livenessBody = (await livenessRes.json()) as Record<string, unknown>;
        expect(livenessBody.status).toBe('ok');
        expect(typeof livenessBody.uptime_seconds).toBe('number');
        expect(typeof livenessBody.memory_rss_mb).toBe('number');

        // Readiness without ServerContext
        const readyRes = await app.request('/api/health/ready');
        expect(readyRes.status).toBe(503);
        const readyBody = (await readyRes.json()) as Record<string, unknown>;
        expect(readyBody.status).toBe('error');
        expect(readyBody.db).toBe('unavailable');
    });

    test('readiness with ServerContext calling checkDbHealth', async () => {
        const app = new Hono();
        const ctxOk = { checkDbHealth: async () => true } as unknown as ServerContext;
        healthModule.mount(app, ctxOk);

        const resOk = await app.request('/api/health/ready');
        expect(resOk.status).toBe(200);
        const bodyOk = (await resOk.json()) as Record<string, unknown>;
        expect(bodyOk.status).toBe('ok');

        const appFail = new Hono();
        const ctxFail = { checkDbHealth: async () => false } as unknown as ServerContext;
        healthModule.mount(appFail, ctxFail);

        const resFail = await appFail.request('/api/health/ready');
        expect(resFail.status).toBe(503);
    });

    test('/api/project returns the basename and normalized path of the served cwd', async () => {
        const app = new Hono();
        const ctx = { cwd: '/Users/robin/xprojects/spur-new' } as ServerContext;
        healthModule.mount(app, ctx);

        const res = await app.request('/api/project');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.name).toBe('spur-new');
        // 0840 R4: path is the canonical worktree (normalizeProjectPath of cwd).
        expect(body.path).toBe('/Users/robin/xprojects/spur-new');
    });

    test('/api/project returns null name without ServerContext', async () => {
        const app = new Hono();
        healthModule.mount(app, undefined);

        const res = await app.request('/api/project');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.name).toBeNull();
        expect(body.path).toBeNull();
    });

    test('/api/projects lists projects and marks current project', async () => {
        const registry = new ProjectRegistry(projectsFile);
        await registry.upsert({ name: 'Project A', path: tempDir, port: 0 });

        const app = new Hono();
        const ctx = { cwd: tempDir } as ServerContext;
        healthModule.mount(app, ctx);

        const res = await app.request('/api/projects');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { projects: Array<{ name: string; current: boolean; running: boolean }> };
        expect(body.projects.length).toBe(1);
        expect(body.projects[0]?.name).toBe('Project A');
        expect(body.projects[0]?.current).toBe(true);
        expect(body.projects[0]?.running).toBe(false);
    });

    test('/api/projects returns empty projects list without ServerContext', async () => {
        const app = new Hono();
        healthModule.mount(app, undefined);

        const res = await app.request('/api/projects');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { projects: unknown[] };
        expect(body.projects).toEqual([]);
    });

    test('/api/projects/start returns 501 without ServerContext (Worker env)', async () => {
        const app = new Hono();
        healthModule.mount(app, undefined);

        const res = await app.request('/api/projects/start', {
            method: 'POST',
            body: JSON.stringify({ name: 'Test' }),
            headers: { 'content-type': 'application/json' },
        });
        expect(res.status).toBe(501);
    });

    test('/api/projects/start handles validation and target lookup errors', async () => {
        const app = new Hono();
        const ctx = { cwd: tempDir } as ServerContext;
        healthModule.mount(app, ctx);

        // Missing body target
        const resMissing = await app.request('/api/projects/start', {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'content-type': 'application/json' },
        });
        expect(resMissing.status).toBe(400);

        // Non-existent project
        const resNotFound = await app.request('/api/projects/start', {
            method: 'POST',
            body: JSON.stringify({ name: 'NonExistentProject' }),
            headers: { 'content-type': 'application/json' },
        });
        expect(resNotFound.status).toBe(404);
    });

    test('/api/projects/start handles already running project', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const livePort = 3500;
        setPortProbeForTests(async (p) => (p === livePort ? 'in-use' : 'available'));

        await registry.upsert({ name: 'RunningApp', path: tempDir, port: livePort });

        const app = new Hono();
        const ctx = { cwd: tempDir } as ServerContext;
        healthModule.mount(app, ctx);

        const res = await app.request('/api/projects/start', {
            method: 'POST',
            body: JSON.stringify({ name: 'RunningApp' }),
            headers: { 'content-type': 'application/json' },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { running: boolean; port: number };
        expect(body.running).toBe(true);
        expect(body.port).toBe(livePort);
    });

    test('/api/projects/start starts stopped project and updates registry when port is live', async () => {
        const registry = new ProjectRegistry(projectsFile);
        await registry.upsert({ name: 'StoppedApp', path: tempDir, port: 0 });

        const targetPort = 3501;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
        const origAllocate = ProjectRegistry.prototype.allocatePort;
        ProjectRegistry.prototype.allocatePort = async () => targetPort;

        // Injectable serve fake — never reassign Bun.spawn (breaks ProcessExecutor).
        setDetachedServeSpawnForTests(() => ({ exitCode: null, unref: () => {} }));

        try {
            const app = new Hono();
            const ctx = { cwd: tempDir } as ServerContext;
            healthModule.mount(app, ctx);

            const res = await app.request('/api/projects/start', {
                method: 'POST',
                body: JSON.stringify({ name: 'StoppedApp' }),
                headers: { 'content-type': 'application/json' },
            });
            expect(res.status).toBe(200);
            const body = (await res.json()) as { running: boolean; url: string; port: number };
            expect(body.running).toBe(true);
            expect(body.port).toBe(targetPort);
        } finally {
            setDetachedServeSpawnForTests(undefined);
            ProjectRegistry.prototype.allocatePort = origAllocate;
        }
    });

    test('/api/projects/start auto-registers target path if existing directory on disk', async () => {
        const targetPort = 3502;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
        const origAllocate = ProjectRegistry.prototype.allocatePort;
        ProjectRegistry.prototype.allocatePort = async () => targetPort;

        setDetachedServeSpawnForTests(() => ({ exitCode: null, unref: () => {} }));

        try {
            const app = new Hono();
            const ctx = { cwd: tempDir } as ServerContext;
            healthModule.mount(app, ctx);

            const res = await app.request('/api/projects/start', {
                method: 'POST',
                body: JSON.stringify({ path: tempDir }),
                headers: { 'content-type': 'application/json' },
            });
            expect(res.status).toBe(200);
            const body = (await res.json()) as { running: boolean; url: string };
            expect(body.running).toBe(true);
        } finally {
            setDetachedServeSpawnForTests(undefined);
            ProjectRegistry.prototype.allocatePort = origAllocate;
        }
    });

    // ── 0840: /api/project path identity + /api/project/fleet snapshot ──

    test('/api/project path equals the normalized current entry /api/projects reports', async () => {
        const registry = new ProjectRegistry(projectsFile);
        await registry.upsert({ name: 'Current Project', path: tempDir, port: 0 });

        const app = new Hono();
        const ctx = { cwd: tempDir } as ServerContext;
        healthModule.mount(app, ctx);

        const res = await app.request('/api/project');
        const body = (await res.json()) as { path: string };
        const listRes = await app.request('/api/projects');
        const listBody = (await listRes.json()) as { projects: Array<{ path: string; current: boolean }> };
        const current = listBody.projects.find((p) => p.current);
        expect(current).toBeDefined();
        expect(body.path).toBe(normalizeProjectPath(tempDir));
        expect(normalizeProjectPath(current?.path ?? '')).toBe(body.path);
    });

    /** Full-fixture ctx: real fs + one shared migrated project db handle. */
    async function fullCtx(projectDbUrl: string): Promise<{ ctx: ServerContext; close: () => void }> {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(join(tempDir, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: projectDbUrl });
        return {
            ctx: {
                cwd: tempDir,
                fs: createNodeFileSystem(tempDir),
                getDb: () => Promise.resolve(db),
                taskService: () => ({ list: async () => ({ data: [] }) }),
                reloadAgentConfig: async () => null,
            } as unknown as ServerContext,
            close: () => db.close(),
        };
    }

    test('/api/project/fleet returns a full snapshot (members, binding, persisted strategy)', async () => {
        const { writeFileSync } = await import('node:fs');
        const { mkdirSync } = await import('node:fs');
        const { ctx, close } = await fullCtx(join(tempDir, '.spur', 'spur.db'));
        mkdirSync(join(tempDir, '.spur'), { recursive: true });
        writeFileSync(
            join(tempDir, '.spur', 'fleet.json'),
            JSON.stringify({
                version: 1,
                orchestrator: 'lead',
                members: [{ id: 'lead', executor: 'build', role: 'planner', purpose: 'orchestrator' }],
            }),
        );
        // Persist a non-default strategy so the endpoint provably reads
        // StrategyRuntime (not a hardcoded rest).
        await new ProjectStrategyDao(await createMigratedDb({ url: join(tempDir, '.spur', 'spur.db') })).set(
            normalizeProjectPath(tempDir),
            'gtd',
        );

        const app = new Hono();
        healthModule.mount(app, ctx);
        try {
            const res = await app.request('/api/project/fleet');
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                path: string;
                strategy: { name: string; version: number } | null;
                orchestrator: { state: string; reason?: string };
                members: Array<{ instanceId: string; enabled: boolean; executor: string }>;
                capacity: { total: number; enabled: number; writeCapable: number; missing: string[] };
            };
            expect(body.path).toBe(normalizeProjectPath(tempDir));
            expect(body.strategy).toEqual({ name: 'gtd', version: 1 });
            // No live project_claims row → bound but not responding (a named state).
            expect(body.orchestrator.state).toBe('bound-offline');
            expect(body.orchestrator.reason).toBe('no-live-claim');
            expect(body.members).toHaveLength(1);
            expect(body.members[0]?.enabled).toBe(true);
            expect(body.members[0]?.executor).toBe('build');
            expect(body.capacity).toEqual({ total: 1, enabled: 1, writeCapable: 0, missing: [] });
        } finally {
            close();
        }
    });

    test('/api/project/fleet keeps FleetService detail for an invalid fleet.json (200, no 500)', async () => {
        const { writeFileSync } = await import('node:fs');
        const { ctx, close } = await fullCtx(join(tempDir, '.spur', 'spur.db'));
        // Garbage declaration: FleetService.load() throws with purpose-built
        // detail (file + reason); the endpoint must surface that detail in
        // capacity.missing rather than a placeholder, and still return 200.
        writeFileSync(join(tempDir, '.spur', 'fleet.json'), '{ not json');

        const app = new Hono();
        healthModule.mount(app, ctx);
        try {
            const res = await app.request('/api/project/fleet');
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                members: unknown[];
                capacity: { total: number; missing: string[] };
            };
            expect(body.members).toEqual([]);
            expect(body.capacity.total).toBe(0);
            expect(body.capacity.missing).toHaveLength(1);
            expect(body.capacity.missing[0]).toContain('Invalid fleet declaration');
        } finally {
            close();
        }
    });

    test('/api/project/fleet names a zero-member fleet instead of an empty shell', async () => {
        // No .spur/fleet.json at all — every fact resolves to its named absence.
        const { ctx, close } = await fullCtx(join(tempDir, '.spur', 'spur.db'));

        const app = new Hono();
        healthModule.mount(app, ctx);
        try {
            const res = await app.request('/api/project/fleet');
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                strategy: { name: string; version: number } | null;
                orchestrator: { state: string; reason?: string };
                capacity: { total: number; enabled: number; writeCapable: number; missing: string[] };
            };
            expect(body.capacity.total).toBe(0);
            expect(body.capacity.missing).toEqual(['no-declaration']);
            expect(body.orchestrator.state).toBe('missing');
            expect(body.orchestrator.reason).toBe('no-orchestrator-declared');
            expect(body.strategy).toEqual({ name: 'rest', version: 1 });
        } finally {
            close();
        }
    });

    test('/api/project/fleet degrades to named states when services fail (never 500)', async () => {
        const { writeFileSync } = await import('node:fs');
        const { mkdirSync } = await import('node:fs');
        mkdirSync(join(tempDir, '.spur'), { recursive: true });
        writeFileSync(
            join(tempDir, '.spur', 'fleet.json'),
            JSON.stringify({
                version: 1,
                orchestrator: 'lead',
                members: [{ id: 'lead', executor: 'build', role: 'planner', purpose: 'orchestrator' }],
            }),
        );
        // The declaration resolves (fs-only) but every db-backed service is down.
        const ctx = {
            cwd: tempDir,
            fs: createNodeFileSystem(tempDir),
            getDb: () => Promise.reject(new Error('db down')),
            taskService: () => ({ list: async () => ({ data: [] }) }),
            reloadAgentConfig: async () => null,
        } as unknown as ServerContext;

        const app = new Hono();
        healthModule.mount(app, ctx);

        const res = await app.request('/api/project/fleet');
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            strategy: unknown;
            orchestrator: { state: string };
            capacity: { total: number; enabled: number; missing: string[] };
        };
        expect(body.strategy).toBeNull();
        expect(body.orchestrator.state).toBe('unresolvable');
        expect(body.capacity.total).toBe(1);
        expect(body.capacity.enabled).toBe(1);
    });

    // ── 0844: /api/project/requests ──

    test('/api/project/requests joins operator rows with delivery + run facts, scoped to the mailbox', async () => {
        const { writeFileSync } = await import('node:fs');
        const { mkdirSync } = await import('node:fs');
        const dbUrl = join(tempDir, '.spur', 'spur.db');
        const { ctx, close } = await fullCtx(dbUrl);
        mkdirSync(join(tempDir, '.spur'), { recursive: true });
        writeFileSync(
            join(tempDir, '.spur', 'fleet.json'),
            JSON.stringify({
                version: 1,
                orchestrator: 'lead',
                members: [{ id: 'lead', executor: 'build', role: 'planner', purpose: 'orchestrator' }],
            }),
        );

        const app = new Hono();
        healthModule.mount(app, ctx);
        try {
            // The orchestrator mailbox identity comes from the fleet projection.
            const fleetRes = await app.request('/api/project/fleet');
            const fleetBody = (await fleetRes.json()) as { orchestrator: { instanceId?: string } };
            const instanceId = fleetBody.orchestrator.instanceId;
            expect(instanceId).toBeTruthy();

            const db = await ctx.getDb();
            const inbox = new InboxMessageDao(db);
            const runs = new CoordinationRunDao(db);

            // A consumed request with a run receipt (drained → injected → run exited).
            const consumed = await inbox.enqueueIdempotent(
                'board-operator',
                instanceId as string,
                'consumed request',
                'rk-consumed',
            );
            await runs.insertStart({
                specId: instanceId as string,
                agentKind: 'planner',
                processId: null,
                runId: 'run-1',
                generation: 1,
                startedAt: new Date().toISOString(),
            });
            await runs.updateExit('run-1', 'exited', new Date().toISOString(), '[]', {
                messageIds: [consumed.id],
                taskId: '0844',
                outcome: 'run-exit-only',
            });
            await inbox.drainPending(instanceId as string);

            // A queued operator request with a durable key, and a foreign row that must be dropped.
            await inbox.enqueueIdempotent('board-operator', instanceId as string, 'queued request', 'rk-queued');
            await inbox.enqueueIdempotent('some-member', instanceId as string, 'not an operator request', 'rk-foreign');

            const res = await app.request('/api/project/requests');
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                requests: Array<{
                    messageId: string;
                    requestKey: string | null;
                    deliveryStatus: string;
                    injectAttempts: number;
                    injectError: string | null;
                    runId: string | null;
                    taskId: string | null;
                    outcome: string | null;
                    reason: string | null;
                    hold: string | null;
                }>;
            };
            // Foreign mailbox traffic is filtered; only operator rows remain.
            expect(body.requests).toHaveLength(2);

            const consumedRow = body.requests.find((r) => r.messageId === consumed.id);
            expect(consumedRow).toBeDefined();
            expect(consumedRow?.requestKey).toBe('rk-consumed');
            expect(consumedRow?.deliveryStatus).toBe('injected');
            expect(consumedRow?.runId).toBe('run-1');
            expect(consumedRow?.taskId).toBe('0844');
            expect(consumedRow?.outcome).toBe('run-exit-only');
            // 0834 classifies run-exit-only as an unresolved (queryable) hold —
            // surfaced verbatim; the client's precedence maps it to completed-exit-only.
            expect(consumedRow?.reason).toBe('run-exit-only');

            const queuedRow = body.requests.find((r) => r.requestKey === 'rk-queued');
            expect(queuedRow).toBeDefined();
            expect(queuedRow?.deliveryStatus).toBe('queued');
            expect(queuedRow?.runId).toBeNull();
            expect(queuedRow?.outcome).toBeNull();

            // limit caps the feed.
            const limited = await app.request('/api/project/requests?limit=1');
            const limitedBody = (await limited.json()) as { requests: unknown[] };
            expect(limitedBody.requests).toHaveLength(1);
        } finally {
            close();
        }
    });

    test('/api/project/requests degrades to {requests:[]} without a bound orchestrator (never 500)', async () => {
        // No .spur/fleet.json at all → no orchestrator instance to address.
        const { ctx, close } = await fullCtx(join(tempDir, '.spur', 'spur.db'));
        const app = new Hono();
        healthModule.mount(app, ctx);
        try {
            const res = await app.request('/api/project/requests');
            expect(res.status).toBe(200);
            const body = (await res.json()) as { requests: unknown[] };
            expect(body.requests).toEqual([]);
        } finally {
            close();
        }
    });
});
