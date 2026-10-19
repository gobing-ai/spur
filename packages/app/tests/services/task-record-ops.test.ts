import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import type { TaskFeatureLink } from '../../src/services/task-feature-link';
import { TaskFiles } from '../../src/services/task-files';
import { TaskLocator } from '../../src/services/task-locator';
import { TaskRecordOps } from '../../src/services/task-record-ops';
import type { TaskService, TaskServiceContext } from '../../src/services/task-service';

// TaskRecordOps holds `spur task record`. task-record.test.ts covers the rendering end to end;
// these tests pin the collaborator's own decisions: the authored-Testing preservation, the
// verdict-file default rooted in the injected tree, the feature-link failure isolation and the
// transition branches that never reach a hop.

let root: string;
let tasksDir: string;
let ctx: TaskServiceContext;
let files: TaskFiles;
let writeService: PlanningWriteService;

function writeTask(wbs: string, status: string, body: string): string {
    const filePath = join(tasksDir, `${wbs}_task-${wbs}.md`);
    writeFileSync(
        filePath,
        `---\nschema_version: 1\nname: task ${wbs}\nstatus: ${status}\ncreated_at: 2026-10-01T00:00:00.000Z\nupdated_at: 2026-10-01T00:00:00.000Z\n---\n\n## ${wbs}. task\n${body}`,
    );
    return filePath;
}

function ops(featureLink?: Partial<TaskFeatureLink>): TaskRecordOps {
    const link = { resolveFeatureAcBody: mock(async () => null), ...featureLink } as unknown as TaskFeatureLink;
    return new TaskRecordOps({} as TaskService, ctx, writeService, link, files);
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spur-task-record-ops-'));
    tasksDir = join(root, 'docs', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    const fs = createNodeFileSystem(root);
    writeService = new PlanningWriteService({ fs });
    ctx = { fs, tasksDir, writeService };
    files = new TaskFiles(ctx, new TaskLocator(ctx));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('TaskRecordOps.record', () => {
    test('a bare basename anchor in the verdict evidence is qualified when record transcribes it', async () => {
        // Tracked file so the basename index has exactly one candidate for `widget.ts`.
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src', 'widget.ts'), 'export const w = 1;\n');
        const git = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
        git(['init', '-q']);
        git(['config', 'user.email', 'test@example.com']);
        git(['config', 'user.name', 'test']);
        git(['add', 'src/widget.ts']);
        git(['commit', '-qm', 'base']);

        const filePath = writeTask('0007', 'wip', '\n### Testing\n\n');
        const verdictFile = join(root, '0007-verdict.json');
        writeFileSync(
            verdictFile,
            JSON.stringify({
                wbs: '0007',
                verdict: 'PASS',
                requirements: [{ id: 'R1', status: 'MET', evidence: '`widget.ts:12` guards the thing' }],
                acceptanceCriteria: [],
                checks: [],
            }),
        );

        const result = await ops().record('0007', { verdictFile });

        expect(result.testingWritten).toBe(true);
        const written = readFileSync(filePath, 'utf8');
        // Qualified to the tracked repo-relative path, line spec byte-for-byte.
        expect(written).toContain('`src/widget.ts:12`');
        expect(written).not.toContain('`widget.ts:12`');
    });

    test('without a verdict artifact an authored Testing section is preserved and the state is reported', async () => {
        const filePath = writeTask('0001', 'wip', '\n### Testing\n\nHand-written evidence.\n');
        const result = await ops().record('0001');
        expect(result.verdictState).toBe('missing');
        expect(result.testingWritten).toBe(false);
        expect(readFileSync(filePath, 'utf8')).toContain('Hand-written evidence.');
    });

    test('a bare Testing section is written from the UNKNOWN stub; a throwing feature link adds no warning', async () => {
        const filePath = writeTask('0002', 'wip', '\n### Testing\n\n');
        const resolveFeatureAcBody = mock(async () => {
            throw new Error('feature tree unreadable');
        });
        const result = await ops({ resolveFeatureAcBody }).record('0002');
        expect(result.testingWritten).toBe(true);
        expect(result.scenarioWarnings).toBeUndefined();
        expect(resolveFeatureAcBody).toHaveBeenCalled();
        expect(readFileSync(filePath, 'utf8')).toContain('### Testing');
    });

    test('--transition to the current status is an idempotent no-op', async () => {
        writeTask('0003', 'wip', '\n### Testing\n\nkept\n');
        const result = await ops().record('0003', { transition: 'wip' });
        expect(result.transitionedTo).toBe('wip');
        expect(result.bookkeepingError).toBeUndefined();
    });

    test('--transition done without a PASS verdict is refused with the override hint', async () => {
        writeTask('0004', 'wip', '\n### Testing\n\nkept\n');
        await expect(ops().record('0004', { transition: 'done' })).rejects.toThrow('not PASS');
    });
});
