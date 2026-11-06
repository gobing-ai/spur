import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningReadError } from '../../src/errors';
import { assertPlanningSnapshotComplete, readPlanningSnapshot } from '../../src/services/planning-snapshot';

function writeTask(dir: string, name: string, status: string, featureId = 'F1', dependencies: string[] = []): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, name),
        `---\nschema_version: 1\nname: ${name}\nstatus: ${status}\nfeature_id: ${featureId}\ndependencies: [${dependencies.map((d) => `"${d}"`).join(', ')}]\n---\n# ${name}\n`,
    );
}

function writeFeature(dir: string, name: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, name),
        '---\nschema_version: 1\nid: F1\nname: Linked\nstatus: active\npriority: P1\n---\n# F1: Linked\n',
    );
}

describe('readPlanningSnapshot', () => {
    test('parses every selected file once and retains duplicate IDs with actionable diagnostics', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-planning-snapshot-'));
        try {
            const a = join(root, 'tasks-a');
            const b = join(root, 'tasks-b');
            const features = join(root, 'features');
            writeTask(a, '0001_same.md', 'done', 'F1', ['0002']);
            writeTask(b, '0001_other.md', 'todo', 'F1', ['0003']);
            writeTask(b, '0002_second.md', 'done');
            writeFeature(features, 'F1_first.md');
            writeFeature(features, 'F1_second.md');
            const fs = createNodeFileSystem(root);
            const reads: string[] = [];
            const original = fs.readFile.bind(fs);
            fs.readFile = async (path) => {
                reads.push(path);
                return original(path);
            };
            const snapshot = await readPlanningSnapshot({ fs, taskDirs: [a, b], featuresDir: features });

            expect(reads).toHaveLength(5);
            expect(new Set(reads).size).toBe(reads.length);
            expect(snapshot.tasksByWbs.get('0001')).toHaveLength(2);
            expect(snapshot.dependenciesByWbs.get('0001')).toEqual(['0002', '0003']);
            expect(snapshot.diagnostics.map((d) => d.code).sort()).toEqual(['duplicate-feature-id', 'duplicate-wbs']);
            expect(snapshot.complete).toBe(false);
            expect(() => assertPlanningSnapshotComplete(snapshot)).toThrow(PlanningReadError);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a valid snapshot is complete and a later operation sees new bytes', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-planning-snapshot-fresh-'));
        try {
            const tasks = join(root, 'tasks');
            const features = join(root, 'features');
            writeTask(tasks, '0001_first.md', 'done', 'F1', ['0002']);
            writeFeature(features, 'F1_first.md');
            const fs = createNodeFileSystem(root);
            const first = await readPlanningSnapshot({ fs, taskDirs: [tasks], featuresDir: features });
            expect(first.complete).toBe(true);
            expect(() => assertPlanningSnapshotComplete(first)).not.toThrow();
            expect(first.tasksByFeature.get('F1')).toHaveLength(1);
            expect(first.dependenciesByWbs.get('0001')).toEqual(['0002']);
            expect(first.features[0]?.document.getSection('Goal')).toBeNull();

            writeTask(tasks, '0001_first.md', 'todo', 'F1', ['0002', '0003']);
            const second = await readPlanningSnapshot({ fs, taskDirs: [tasks], featuresDir: features });
            expect(second.tasks[0]?.status).toBe('todo');
            expect(second.tasks[0]?.raw).toContain('status: todo');
            expect(second.dependenciesByWbs.get('0001')).toEqual(['0002', '0003']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
