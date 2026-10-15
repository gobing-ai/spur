import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import { featuresDirFor, TaskFeatureLink } from '../../src/services/task-feature-link';
import type { TaskServiceContext } from '../../src/services/task-service';
import { ParentFeatureStatusError } from '../../src/services/task-service-errors';

// TaskFeatureLink is the parent-feature collaborator TaskService owns: the features-dir rule,
// the 1132 R2 parent-status guard and the feature AC lookup. Driven against a real temp corpus.

let root: string;
let tasksDir: string;
let featuresDir: string;
let ctx: TaskServiceContext;
let link: TaskFeatureLink;

function writeFeature(id: string, status: string, ac = ''): string {
    const path = join(featuresDir, `${id}_${id.toLowerCase()}-feature.md`);
    const acSection = ac === '' ? '' : `\n## Acceptance Criteria\n\n\`\`\`gherkin\n${ac}\n\`\`\`\n`;
    writeFileSync(path, `---\nid: ${id}\nname: "${id} feature"\nstatus: ${status}\n---\n\n# ${id}\n${acSection}`);
    return path;
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spur-task-feature-link-'));
    tasksDir = join(root, 'docs', 'tasks');
    featuresDir = join(root, 'docs', 'features');
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(featuresDir, { recursive: true });
    const fs = createNodeFileSystem(root);
    const writeService = new PlanningWriteService({ fs });
    ctx = { fs, tasksDir, writeService };
    link = new TaskFeatureLink(ctx, writeService);
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('featuresDirFor / deriveFeaturesDir', () => {
    test('a phase folder still maps to its parent features/ sibling', () => {
        expect(featuresDirFor('/repo/docs/tasks5')).toBe('/repo/docs/features');
        expect(link.deriveFeaturesDir()).toBe(featuresDir);
    });

    test('a configured featuresDir wins over the sibling rule', () => {
        const configured = new TaskFeatureLink({ ...ctx, featuresDir: '/elsewhere/features' }, ctx.writeService);
        expect(configured.deriveFeaturesDir()).toBe('/elsewhere/features');
    });
});

describe('TaskFeatureLink.guardParentFeature', () => {
    test('an unknown or active parent passes untouched', async () => {
        writeFeature('A1', 'active');
        expect(await link.guardParentFeature('A1')).toBeUndefined();
        expect(await link.guardParentFeature('Z9')).toBeUndefined();
        expect(await link.readParentFeatureStatus('A1')).toBe('active');
        expect(await link.readParentFeatureStatus('Z9')).toBeUndefined();
    });

    test('a done parent is rejected with active same-group siblings as suggestions', async () => {
        writeFeature('B1', 'done');
        writeFeature('B2', 'active');
        writeFeature('C1', 'active');
        const err = await link.guardParentFeature('B1').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ParentFeatureStatusError);
        expect(String((err as Error).message)).toContain('B2');
        expect(String((err as Error).message)).not.toContain('C1');
    });

    test('a verifying parent is reopened through the injected transition port, unless noReopen', async () => {
        writeFeature('D1', 'verifying');
        expect(await link.guardParentFeature('D1', true)).toBeUndefined();
        const calls: Array<[string, string]> = [];
        const ported = new TaskFeatureLink(
            {
                ...ctx,
                featureTransition: async (id, to) => {
                    calls.push([id, to]);
                    return { fromStatus: 'verifying', toStatus: 'active' } as never;
                },
            },
            ctx.writeService,
        );
        expect(await ported.guardParentFeature('D1')).toEqual({ id: 'D1', from: 'verifying', to: 'active' });
        expect(calls).toEqual([['D1', 'active']]);
    });

    test('without a features dir the guard and status read are inert', async () => {
        rmSync(featuresDir, { recursive: true, force: true });
        expect(await link.guardParentFeature('A1')).toBeUndefined();
        expect(await link.readParentFeatureStatus('A1')).toBeUndefined();
    });
});

describe('TaskFeatureLink.resolveFeatureAcBody', () => {
    test('returns the linked feature AC and the task AC, null without a feature_id', async () => {
        writeFeature('E1', 'active', '  Scenario: covered\n    Given x\n    Then y');
        const linked = join(tasksDir, '0001_linked.md');
        writeFileSync(
            linked,
            '---\nname: linked\nfeature_id: E1\n---\n\n## 0001. linked\n\n### Acceptance Criteria\n\n```gherkin\n  Scenario: covered\n```\n',
        );
        const resolved = await link.resolveFeatureAcBody(linked);
        expect(resolved?.featureId).toBe('E1');
        expect(resolved?.ac).toContain('Scenario: covered');
        expect(resolved?.taskAc).toContain('Scenario: covered');

        const unlinked = join(tasksDir, '0002_unlinked.md');
        writeFileSync(unlinked, '---\nname: unlinked\n---\n\n## Acceptance Criteria\n\nnone\n');
        expect(await link.resolveFeatureAcBody(unlinked)).toBeNull();
        expect(readFileSync(unlinked, 'utf8')).toContain('unlinked');
    });
});
