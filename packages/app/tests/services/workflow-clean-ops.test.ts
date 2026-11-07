import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, RunDao } from '@gobing-ai/spur-domain';
import { runStoragePaths } from '../../src/services/run-storage';
import { reapIfWorkerLost, WorkflowCleanOps } from '../../src/services/workflow-clean-ops';
import { WorkflowAppService, type WorkflowAppServiceContext } from '../../src/services/workflow-service';

// WorkflowCleanOps holds `workflow clean` and the reclamation passes (the one workflow module
// that reads the filesystem directly — see the runtime-boundaries exemption). Driven against a
// temp project with an in-memory run DB.

let dir: string;
const OLD = new Date('2020-01-01T00:00:00.000Z');

function makeCtx(getDb?: WorkflowAppServiceContext['getDb']): WorkflowAppServiceContext {
    let db: ReturnType<typeof createMigratedDb> | undefined;
    return {
        cwd: dir,
        getDb:
            getDb ??
            (async () => {
                db ??= createMigratedDb({ url: ':memory:' });
                return db;
            }),
    } as WorkflowAppServiceContext;
}

function aged(path: string, content = 'x'): string {
    writeFileSync(path, content);
    utimesSync(path, OLD, OLD);
    return path;
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spur-wf-clean-ops-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('WorkflowCleanOps.clean', () => {
    test('an empty run table cleans nothing and echoes the window', async () => {
        expect(await new WorkflowCleanOps(makeCtx()).clean(45, true)).toEqual({
            olderThanMinutes: 45,
            dryRun: true,
            cleaned: [],
        });
    });
});

describe('WorkflowCleanOps.cleanRunLogs', () => {
    test('reclaims expired .log files (dry run keeps them) and ignores fresh ones', async () => {
        const runDir = join(dir, '.spur', 'run');
        mkdirSync(runDir, { recursive: true });
        const old = aged(join(runDir, 'run-old.log'));
        writeFileSync(join(runDir, 'run-new.log'), 'fresh');
        aged(join(runDir, 'notes.txt'));
        const ops = new WorkflowCleanOps(makeCtx());

        const dry = await ops.cleanRunLogs(30, true);
        expect(dry.reclaimed.map((r) => r.runId)).toEqual(['run-old']);
        expect(existsSync(old)).toBe(true);

        const real = await ops.cleanRunLogs(30, false);
        expect(real.reclaimed.map((r) => r.runId)).toEqual(['run-old']);
        expect(real.failures).toEqual([]);
        expect(existsSync(old)).toBe(false);
        expect(existsSync(join(runDir, 'run-new.log'))).toBe(true);
    });

    test('an unreadable run DB is reported as a failure, never a reclaim', async () => {
        const ops = new WorkflowCleanOps(
            makeCtx(async () => {
                throw new Error('db locked');
            }),
        );
        const result = await ops.cleanRunLogs(30, false);
        expect(result.reclaimed).toEqual([]);
        expect(result.failures[0]?.error).toContain('db locked');
    });
});

describe('WorkflowCleanOps.cleanScratch', () => {
    test('reclaims expired scratch entries but never guests/ or logs', async () => {
        const scratch = runStoragePaths(dir).scratchDir;
        mkdirSync(join(scratch, 'guests'), { recursive: true });
        aged(join(scratch, 'guests', 'g.txt'));
        aged(join(scratch, 'a.log'));
        const stale = aged(join(scratch, 'stale-artifact.md'));
        writeFileSync(join(scratch, 'fresh-artifact.md'), 'fresh');

        const result = await new WorkflowCleanOps(makeCtx()).cleanScratch(30, false);
        expect(result.reclaimed.map((r) => r.name)).toEqual(['stale-artifact.md']);
        expect(existsSync(stale)).toBe(false);
        expect(existsSync(join(scratch, 'guests', 'g.txt'))).toBe(true);
    });

    test('an absent scratch root is a clean no-op', async () => {
        expect((await new WorkflowCleanOps(makeCtx()).cleanScratch()).reclaimed).toEqual([]);
    });
});

describe('WorkflowCleanOps.cleanCheckpoints', () => {
    test('no sessions dir → nothing; malformed checkpoints are skipped with a reason', async () => {
        const ops = new WorkflowCleanOps(makeCtx());
        expect((await ops.cleanCheckpoints()).skipped).toEqual([]);
        const sessions = join(dir, '.spur', 'memory', 'sessions');
        mkdirSync(sessions, { recursive: true });
        aged(join(sessions, 'junk.md'), 'not a checkpoint');
        const result = await ops.cleanCheckpoints(30, false);
        expect(result.reclaimed).toEqual([]);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]?.name).toBe('junk.md');
        expect(existsSync(join(sessions, 'junk.md'))).toBe(true);
    });
});

describe('WorkflowCleanOps.migrateRunStorage', () => {
    test('a project with no legacy run storage migrates nothing', async () => {
        const result = await new WorkflowCleanOps(makeCtx()).migrateRunStorage({ dryRun: true });
        expect(result).toBeDefined();
        expect(existsSync(join(dir, '.spur', 'run'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 1317 — a run whose recorded worker is gone is reaped on read.
// ---------------------------------------------------------------------------

/** A pid that belongs to a process which has already exited. */
async function deadWorkerPid(): Promise<number> {
    const proc = Bun.spawn([process.execPath, '-e', ''], { stdout: 'ignore', stderr: 'ignore' });
    const pid = proc.pid;
    await proc.exited;
    return pid;
}

function stateFile(runId: string): string {
    return join(runStoragePaths(dir).recordsDir, `${runId}.state.json`);
}

describe('reapIfWorkerLost (1317 R1/R2/R5)', () => {
    test('reaps a running row whose worker is dead, projects the record, and is idempotent', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const dao = new RunDao(db);
        const pid = await deadWorkerPid();
        const run = await dao.open({ status: 'running' });
        await dao.setPid(run.id, pid);
        mkdirSync(runStoragePaths(dir).recordsDir, { recursive: true });
        writeFileSync(
            stateFile(run.id),
            JSON.stringify({
                schemaVersion: 1,
                runId: run.id,
                status: 'running',
                startedAt: '2026-01-01T00:00:00.000Z',
            }),
        );

        expect(await reapIfWorkerLost(db, dir, run.id)).toBe(true);

        const row = await dao.traceRowById(run.id);
        expect(row?.status).toBe('interrupted');
        expect(JSON.parse(row?.metadata_json ?? '{}').staleReason).toStartWith(`worker-lost: pid ${pid} not alive`);
        // R4: the run record learns the terminal status — a worker that died can never write it.
        const projected = JSON.parse(readFileSync(stateFile(run.id), 'utf8'));
        expect(projected.status).toBe('interrupted');
        expect(projected.startedAt).toBe('2026-01-01T00:00:00.000Z');

        // R2: a second read reaps nothing and leaves the settled row alone.
        expect(await reapIfWorkerLost(db, dir, run.id)).toBe(false);
        expect((await dao.traceRowById(run.id))?.status).toBe('interrupted');
    });

    test('leaves a live worker, a pid-less run and an already-terminal row untouched', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const dao = new RunDao(db);
        const deadPid = await deadWorkerPid();
        const live = await dao.open({ status: 'running' });
        await dao.setPid(live.id, process.pid);
        const pidless = await dao.open({ status: 'running' });
        const terminal = await dao.open({ status: 'done' });
        await dao.setPid(terminal.id, deadPid);
        const before = await Promise.all([live.id, pidless.id, terminal.id].map((id) => dao.traceRowById(id)));

        for (const id of [live.id, pidless.id, terminal.id]) expect(await reapIfWorkerLost(db, dir, id)).toBe(false);

        const after = await Promise.all([live.id, pidless.id, terminal.id].map((id) => dao.traceRowById(id)));
        expect(after).toEqual(before);
    });

    test('reaps a pending row to failed and creates no run record where none existed', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const dao = new RunDao(db);
        const pid = await deadWorkerPid();
        const run = await dao.open({ status: 'pending' });
        await dao.setPid(run.id, pid);

        expect(await reapIfWorkerLost(db, dir, run.id)).toBe(true);

        const row = await dao.traceRowById(run.id);
        expect(row?.status).toBe('failed');
        expect(JSON.parse(row?.metadata_json ?? '{}').staleReason).toBe(`worker-lost: pid ${pid} not alive`);
        expect(existsSync(stateFile(run.id))).toBe(false);
    });

    test('an unknown run id reaps nothing', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        expect(await reapIfWorkerLost(db, dir, 'run_missing')).toBe(false);
    });
});

describe('WorkflowAppService.trace worker-lost reap (1317 R1/R3)', () => {
    test('the single-run read path reaps before projecting, and the reason reaches the trace', async () => {
        const ctx = makeCtx();
        const dao = new RunDao(await ctx.getDb());
        const pid = await deadWorkerPid();
        const run = await dao.open({ status: 'running' });
        await dao.setPid(run.id, pid);

        const timeline = await new WorkflowAppService(ctx).trace(run.id);

        expect(timeline.run.status).toBe('interrupted');
        expect(timeline.run.failureReason).toBe(`worker-lost: pid ${pid} not alive`);
    });
});
