import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { runStoragePaths } from '../../src/services/run-storage';
import { WorkflowCleanOps } from '../../src/services/workflow-clean-ops';
import type { WorkflowAppServiceContext } from '../../src/services/workflow-service';

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
