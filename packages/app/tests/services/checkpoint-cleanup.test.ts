import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, RunDao } from '@gobing-ai/spur-domain';
import { WorkflowAppService } from '../../src/services/workflow-service';

const DAY = 24 * 60 * 60 * 1000;

function checkpointDoc(overrides: Record<string, string> = {}, artifacts: string[] = []): string {
    const base: Record<string, string> = {
        schema_version: '1',
        session_id: '2026-01-01-0703',
        workflow: 'task-pipeline',
        run_id: 'run_expired_1',
        task_wbs: '0703',
        phase: 'done',
        status: 'done',
        updated_at: new Date(Date.now() - 40 * DAY).toISOString(),
        generated_at: new Date(Date.now() - 40 * DAY).toISOString(),
        next_action: 'merge to main',
    };
    const scalars = { ...base, ...overrides };
    const lines = Object.entries(scalars)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}: ${v}`);
    const artifactBlock = artifacts.length === 0 ? '' : `artifacts:\n${artifacts.map((a) => `  - ${a}`).join('\n')}\n`;
    return `---\n${lines.join('\n')}\n${artifactBlock}---\n`;
}

async function seedCheckpoint(dir: string, name: string, body: string): Promise<string> {
    const sessionsDir = join(dir, '.spur', 'memory', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    const path = join(sessionsDir, name);
    await writeFile(path, body);
    return path;
}

function service(dir: string, db?: Awaited<ReturnType<typeof createMigratedDb>>): WorkflowAppService {
    let own: ReturnType<typeof createMigratedDb> | undefined;
    return new WorkflowAppService({
        cwd: dir,
        getDb: async () => {
            if (db) return db;
            own ??= createMigratedDb({ url: ':memory:' });
            return own;
        },
    } as unknown as ConstructorParameters<typeof WorkflowAppService>[0]);
}

describe('cleanCheckpoints (0711 R5–R8)', () => {
    test('reclaims expired terminal checkpoints, keeps fresh ones (R6)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cp-'));
        const old = await seedCheckpoint(dir, '0703-checkpoint.md', checkpointDoc());
        await seedCheckpoint(dir, '0705-checkpoint.md', checkpointDoc({ updated_at: new Date().toISOString() }));

        const result = await service(dir).cleanCheckpoints(30, false);

        expect(result.failures).toEqual([]);
        expect(result.reclaimed.map((r) => r.name)).toEqual(['0703-checkpoint.md']);
        await expect(readFile(old, 'utf8')).rejects.toThrow(); // unlinked
        await rm(dir, { recursive: true, force: true });
    });

    test('boundary age is kept: age must be strictly past the retention cutoff', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cp-'));
        // 30 days minus one tick in frontmatter time -> inside the window.
        const edge = new Date(Date.now() - 30 * DAY + 60_000).toISOString();
        await seedCheckpoint(dir, '0703-checkpoint.md', checkpointDoc({ updated_at: edge }));

        const result = await service(dir).cleanCheckpoints(30, false);

        expect(result.reclaimed).toEqual([]);
        expect(result.skipped.map((s) => s.reason)).toEqual(['not expired: within retention window']);
        await rm(dir, { recursive: true, force: true });
    });

    test('falls back to file mtime when updated_at is absent', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cp-'));
        const path = await seedCheckpoint(dir, '0703-checkpoint.md', checkpointDoc({ updated_at: '' }));
        const old = Date.now() - 40 * DAY;
        await utimes(path, new Date(old), new Date(old));

        const result = await service(dir).cleanCheckpoints(30, false);

        expect(result.reclaimed.map((r) => r.name)).toEqual(['0703-checkpoint.md']);
        await rm(dir, { recursive: true, force: true });
    });

    test('checkpoints referencing an active run are kept (R6)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cp-'));
        // The run and the service must share ONE db — the active-run guard reads the workspace db.
        const shared = await createMigratedDb({ url: ':memory:' });
        const run = await new RunDao(shared).open({ status: 'running' });
        await seedCheckpoint(dir, '0703-checkpoint.md', checkpointDoc({ run_id: run.id }));

        const result = await service(dir, shared).cleanCheckpoints(30, false);

        expect(result.reclaimed).toEqual([]);
        expect(result.skipped.map((s) => s.reason)).toEqual([`active-run reference: ${run.id}`]);
        await rm(dir, { recursive: true, force: true });
    });

    test('empty run_id skips the active-reference check and is reclaimed on age', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cp-'));
        await seedCheckpoint(dir, '0703-checkpoint.md', checkpointDoc({ run_id: '' }));

        const result = await service(dir).cleanCheckpoints(30, false);

        expect(result.reclaimed.map((r) => r.name)).toEqual(['0703-checkpoint.md']);
        await rm(dir, { recursive: true, force: true });
    });

    test('malformed and non-terminal checkpoints are kept and reported, never deleted (R6)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cp-'));
        await seedCheckpoint(dir, 'garbage-checkpoint.md', 'not frontmatter at all\n');
        await seedCheckpoint(
            dir,
            'wip-checkpoint.md',
            checkpointDoc({ status: 'running', updated_at: new Date(Date.now() - 40 * DAY).toISOString() }),
        );

        const result = await service(dir).cleanCheckpoints(30, false);

        expect(result.reclaimed).toEqual([]);
        expect(result.skipped.map((s) => s.name).sort()).toEqual(['garbage-checkpoint.md', 'wip-checkpoint.md']);
        await rm(dir, { recursive: true, force: true });
    });

    test('entries resolving outside the sessions dir are kept (R5 path confinement)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cp-'));
        const outside = await mkdtemp(join(tmpdir(), 'spur-cp-out-'));
        const outsidePath = join(outside, '0703-checkpoint.md');
        await writeFile(outsidePath, checkpointDoc());
        const sessionsDir = join(dir, '.spur', 'memory', 'sessions');
        await mkdir(sessionsDir, { recursive: true });
        await symlink(outsidePath, join(sessionsDir, 'escape-checkpoint.md'));

        const result = await service(dir).cleanCheckpoints(30, false);

        expect(result.reclaimed).toEqual([]);
        expect(result.skipped).toEqual([
            { name: 'escape-checkpoint.md', reason: 'path-confinement: resolved outside .spur/memory/sessions' },
        ]);
        expect(await readFile(outsidePath, 'utf8')).toContain('schema_version');
        await rm(dir, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    });

    test('dry-run lists candidates without deleting (R7)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cp-'));
        const path = await seedCheckpoint(dir, '0703-checkpoint.md', checkpointDoc());

        const result = await service(dir).cleanCheckpoints(30, true);

        expect(result.dryRun).toBe(true);
        expect(result.reclaimed.map((r) => r.name)).toEqual(['0703-checkpoint.md']);
        expect(await readFile(path, 'utf8')).toContain('schema_version'); // still present
        await rm(dir, { recursive: true, force: true });
    });

    test('re-running an exhausted cleanup is a no-op (R8 idempotence)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cp-'));
        await seedCheckpoint(dir, '0703-checkpoint.md', checkpointDoc());
        const svc = service(dir);
        const first = await svc.cleanCheckpoints(30, false);
        expect(first.reclaimed).toHaveLength(1);

        const second = await svc.cleanCheckpoints(30, false);

        expect(second).toEqual({ retentionDays: 30, dryRun: false, reclaimed: [], skipped: [], failures: [] });
        await rm(dir, { recursive: true, force: true });
    });
});
