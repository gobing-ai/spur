import { expect, spyOn, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { PlanningReadinessService } from '../../src/services/planning-readiness';
import type { RunStoreService, RunStoreWbsLink } from '../../src/services/run-store-service';
import { TaskCheckService } from '../../src/services/task-check';
import { TaskLocator } from '../../src/services/task-locator';
import { readinessFixture } from './planning-readiness.fixture';

// Failure cases frozen before implementation: missing/undone/deprecated dependencies,
// blocked/terminal status, missing required input, duplicate/unreadable corpus,
// missing checker policy, unavailable/orphan/truncated run links, and paused work.
function runs(links: Record<string, RunStoreWbsLink[]> = {}): Pick<RunStoreService, 'listByWbs'> {
    return {
        async listByWbs(wbs) {
            return { wbs, links: links[wbs] ?? [], count: links[wbs]?.length ?? 0 };
        },
    };
}

test('ready commands require complete inputs, done cross-folder dependencies and no paused work', async () => {
    const f = readinessFixture();
    try {
        f.task('0001', 'todo', ['0003']);
        f.task('0002', 'todo', ['0099']);
        f.task('0003', 'done', [], f.otherDir);
        f.task('0004', 'todo', ['0002']);
        f.task('0005', 'blocked');
        f.task('0006', 'deprecated');
        f.task('0007', 'todo', [], f.tasksDir, '');
        f.task('0008', 'todo', ['0006']);
        f.task('0009', 'todo');
        const links: RunStoreWbsLink[] = [
            {
                runId: 'paused',
                kind: 'task',
                linkedAt: '',
                run: {
                    id: 'paused',
                    status: 'paused',
                    workflowName: 'task-pipeline',
                    mode: 'state-machine',
                    agent: null,
                    startedAt: '',
                    completedAt: null,
                },
            },
        ];
        const service = new PlanningReadinessService({
            ...f,
            taskDirs: [f.tasksDir, f.otherDir],
            runStore: runs({ '0009': links }),
        });
        const result = await service.read({ folder: 'docs/tasks' });
        const row = (wbs: string) => result.tasks.find((task) => task.wbs === wbs);
        expect(row('0001')?.nextAction).toEqual({ kind: 'run-task', wbs: '0001', command: '/sp:dev-run 0001' });
        expect(row('0003')).toBeUndefined();
        expect(row('0002')?.reasons).toContainEqual({
            code: 'dependency-missing',
            message: 'Dependency 0099 is missing in configured task folders',
            relatedWbs: '0099',
        });
        expect(row('0004')?.state).toBe('blocked');
        expect(row('0005')?.state).toBe('blocked');
        expect(row('0006')?.state).toBe('not-startable');
        expect(row('0007')?.reasons.some((reason) => reason.message.includes('Background'))).toBe(true);
        expect(row('0008')?.reasons.some((reason) => reason.relatedWbs === '0006')).toBe(true);
        expect(row('0009')?.state).toBe('blocked');
        expect(result.pausedRuns).toEqual([{ runId: 'paused', wbs: '0009' }]);
        expect(result.tasks.filter((task) => task.nextAction).map((task) => task.wbs)).toEqual(['0001']);
        expect(await service.read({ folder: 'unregistered' })).toMatchObject({
            tasks: [],
            diagnostics: [expect.objectContaining({ message: expect.stringContaining('folder') })],
        });
        f.task('0003', 'todo', [], f.otherDir);
        expect((await service.read()).tasks.find((task) => task.wbs === '0001')?.nextAction).toBeNull();
    } finally {
        f.cleanup();
    }
});

test('ambiguous, unreadable or unchecked input never becomes ready', async () => {
    const f = readinessFixture();
    try {
        f.task('0001');
        const options = { ...f, taskDirs: [f.tasksDir, f.otherDir], runStore: runs() };
        expect(
            (await new PlanningReadinessService({ ...options, matrix: undefined }).read()).tasks[0]?.nextAction,
        ).toBeNull();
        f.task('0001', 'todo', [], f.otherDir);
        const duplicate = await new PlanningReadinessService(options).read();
        expect(duplicate.diagnostics[0]?.message).toContain('duplicate WBS');
        expect(duplicate.tasks.every((task) => task.nextAction === null)).toBe(true);
        f.fs.readFile = async () => {
            throw new Error('unreadable');
        };
        const unreadable = await new PlanningReadinessService(options).read();
        expect(unreadable.tasks).toEqual([]);
        expect(unreadable.diagnostics.length).toBeGreaterThan(0);
    } finally {
        f.cleanup();
    }
});

test('run-store failure, orphan link and bounded link page suppress recommendations', async () => {
    const f = readinessFixture();
    try {
        f.task('0001');
        const orphan = { runId: 'missing', kind: 'task', linkedAt: '', run: null };
        const unavailable: Pick<RunStoreService, 'listByWbs'> = {
            async listByWbs() {
                throw new Error('offline');
            },
        };
        for (const runStore of [
            unavailable,
            runs({ '0001': [orphan] }),
            runs({ '0001': Array.from({ length: 200 }, () => orphan) }),
        ]) {
            const result = await new PlanningReadinessService({ ...f, taskDirs: [f.tasksDir], runStore }).read();
            expect(result.tasks[0]?.nextAction).toBeNull();
            expect(result.tasks[0]?.reasons.length).toBeGreaterThan(0);
        }
    } finally {
        f.cleanup();
    }
});

test('readiness parses each selected file a bounded number of times (review P2, 2026-11-06)', async () => {
    // Before the operation-scoped child index, every readiness row ran the checker's O(tasks)
    // rollup scan: 600 tasks measured 360,600 parses (100 -> 10,100). The projection must stay
    // linear in the number of rows, so a per-file bound catches a regression long before the
    // wall-clock does.
    const f = readinessFixture();
    const parses = spyOn(MarkdownDocument, 'parse');
    try {
        const ROWS = 60;
        for (let i = 1; i <= ROWS; i++) f.task(String(i).padStart(4, '0'), 'todo');
        const reads: string[] = [];
        const inner = f.fs.readFile.bind(f.fs);
        const countingFs = Object.assign(Object.create(f.fs) as typeof f.fs, {
            readFile: async (path: string) => {
                reads.push(path);
                return inner(path);
            },
        });
        const service = new PlanningReadinessService({
            ...f,
            fs: countingFs,
            taskDirs: [f.tasksDir],
            runStore: runs(),
        });
        const result = await service.read();
        // Count parsing too: snapshotFileSystem caches bytes, so physical reads alone cannot
        // detect the old repeated parsing of those same bytes by the sibling scan.
        expect(result.tasks).toHaveLength(ROWS);
        expect(result.tasks.every((task) => task.state === 'ready')).toBe(true);
        expect(parses.mock.calls.length).toBeLessThanOrEqual(ROWS * 2);
        expect(reads.length).toBeLessThanOrEqual(ROWS * 4);
    } finally {
        parses.mockRestore();
        f.cleanup();
    }
});

test.each(['done', 'completed', 'todo'])(
    'indexed rollups preserve checker policy for %s children, aliases and self references',
    async (childStatus) => {
        const f = readinessFixture();
        try {
            f.task('0001');
            f.task('0002', childStatus, [], f.otherDir);
            f.task('0003');
            for (const [dir, wbs, key, parent] of [
                [f.otherDir, '0002', 'parent-wbs', '0001'],
                [f.tasksDir, '0003', 'parent_wbs', '0003'],
            ] as const) {
                const path = join(dir, `${wbs}_fixture.md`);
                writeFileSync(
                    path,
                    readFileSync(path, 'utf8').replace('schema_version: 1', `schema_version: 1\n${key}: "${parent}"`),
                );
            }
            const taskDirs = [f.tasksDir, f.otherDir];
            const severityOverrides = { 'L4.rollup-parent-open': 'error' as const };
            const result = await new PlanningReadinessService({
                ...f,
                taskDirs,
                severityOverrides,
                runStore: runs(),
            }).read({ folder: 'docs/tasks' });
            const checker = new TaskCheckService(f.fs, f.matrix, TaskLocator.forDirs(f.fs, taskDirs));
            for (const wbs of ['0001', '0003']) {
                const checked = await checker.check(join(f.tasksDir, `${wbs}_fixture.md`), wbs, {
                    asStatus: 'todo',
                    severityOverrides,
                });
                const expected = checked.findings
                    .filter((finding) => finding.code.startsWith('L4.rollup-') && finding.severity === 'error')
                    .map(({ code, message }) => ({ code, message }));
                expect(
                    result.tasks
                        .find((task) => task.wbs === wbs)
                        ?.reasons.filter((reason) => reason.code.startsWith('L4.rollup-')),
                ).toEqual(expected);
            }
        } finally {
            f.cleanup();
        }
    },
);
