import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { TaskCheckService } from '../../src/services/task-check';

const matrix = {
    variants: {
        standard: {
            backlog: { required: ['Background'], forbidden: ['Solution', 'Review', 'Testing'] },
            done: { required: ['Solution', 'Testing', 'Review'], gate: true },
        },
    },
};

function seedFile(content: string): { fs: ReturnType<typeof createNodeFileSystem>; path: string; cleanup(): void } {
    const dir = mkdtempSync(join(tmpdir(), 'spur-check-test-'));
    const filePath = join(dir, 'task.md');
    writeFileSync(filePath, content);
    return {
        fs: createNodeFileSystem(),
        path: filePath,
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
}

/**
 * Create a full task check environment with tasks/ and features/ dirs.
 * The task file goes in {root}/tasks/{wbs}_task.md and features go in {root}/features/.
 */
function seedEnv(opts: {
    wbs?: string;
    taskContent: string;
    features?: Record<string, string>; // featureId → content
    extraTasks?: Record<string, string>; // wbs → content (for parent/dep lookups)
}): { fs: ReturnType<typeof createNodeFileSystem>; path: string; cleanup(): void } {
    const root = mkdtempSync(join(tmpdir(), 'spur-check-l4-'));
    const tasksDir = join(root, 'tasks');
    const featuresDir = join(root, 'features');
    const { mkdirSync } = require('node:fs');
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(featuresDir, { recursive: true });

    const taskPath = join(tasksDir, `${opts.wbs ?? '0001'}_task.md`);
    writeFileSync(taskPath, opts.taskContent);

    if (opts.features) {
        for (const [fid, content] of Object.entries(opts.features)) {
            writeFileSync(join(featuresDir, `${fid}_feature.md`), content);
        }
    }
    if (opts.extraTasks) {
        for (const [wbs, content] of Object.entries(opts.extraTasks)) {
            writeFileSync(join(tasksDir, `${wbs}_extra.md`), content);
        }
    }

    return {
        fs: createNodeFileSystem(),
        path: taskPath,
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

/** Minimal valid task frontmatter for L4 tests. */
function taskFm(overrides: Record<string, unknown> = {}): string {
    const defaults: Record<string, unknown> = {
        schema_version: 1,
        name: 'Test task',
        status: 'backlog',
        created_at: '2026-06-13T00:00:00.000Z',
        updated_at: '2026-06-13T00:00:00.000Z',
    };
    const merged = { ...defaults, ...overrides };
    const lines = ['---'];
    for (const [k, v] of Object.entries(merged)) {
        if (v === undefined || v === null) continue;
        if (k === 'dependencies') {
            lines.push('dependencies:');
            for (const item of v as string[]) lines.push(`  - "${item}"`);
        } else if (typeof v === 'string') {
            lines.push(`${k}: "${v}"`);
        } else {
            lines.push(`${k}: ${JSON.stringify(v)}`);
        }
    }
    lines.push('---', '', '## 0001. Test task', '', '### Background', '', 'text');
    return lines.join('\n');
}

/** Minimal valid feature frontmatter. */
function featureFm(id: string, status: string): string {
    return [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `name: "Feature ${id}"`,
        `status: ${status}`,
        'priority: P1',
        'created_at: 2026-06-13T00:00:00.000Z',
        'updated_at: 2026-06-13T00:00:00.000Z',
        '---',
        '',
        `# ${id}: Feature ${id}`,
        '',
        '## Goal',
        '',
        'Text',
    ].join('\n');
}

describe('TaskCheckService', () => {
    test('L1: schema validation passes for valid frontmatter', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Valid"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Valid',
            '',
            '### Background',
            '',
            'Text',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        expect(result.pass).toBe(true);

        expect(result.findings.filter((f) => f.layer === 'L1' && f.severity === 'error')).toHaveLength(0);
    });

    test('L1: schema validation catches missing required field', async () => {
        const content = ['---', 'status: backlog', '---', '', '## 0001. No name'].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        expect(result.findings.some((f) => f.layer === 'L1' && f.severity === 'error')).toBe(true);
    });

    test('L2: detects missing required section', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Missing"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Missing',
            '',
            '### Solution',
            '',
            'code',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const l2Missing = result.findings.filter((f) => f.layer === 'L2' && f.message.includes('Missing required'));
        expect(l2Missing.length).toBeGreaterThan(0);
        expect(result.missingSections).toContain('Background');
    });

    test('L2: gate:true makes missing section an error', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Done task"',
            'status: done',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Done task',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        const gateErrors = result.findings.filter((f) => f.severity === 'error' && f.message.includes('gate: true'));
        expect(gateErrors.length).toBeGreaterThan(0);
        expect(result.pass).toBe(false);
    });

    test('--strict elevates warnings to errors', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Strict test"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Strict test',
            '',
            '### Solution',
            '',
            'code',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001', { strict: true });
        cleanup();

        const warnings = result.findings.filter((f) => f.severity === 'warning');
        expect(warnings).toHaveLength(0);
    });

    test('L3: Review must contain P1–P4 table', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Review test"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Review test',
            '',
            '### Review',
            '',
            'Just some free text, no table.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reviewErrors = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Review');
        expect(reviewErrors.length).toBeGreaterThan(0);
        expect(reviewErrors[0]?.severity).toBe('error');
    });

    test('resolveMatrixEntry falls back to standard variant', () => {
        const svc = new TaskCheckService(createNodeFileSystem(), matrix);
        const entry = svc.resolveMatrixEntry('nonexistent', 'backlog');
        expect(entry).toBeTruthy();
        expect(entry?.required).toContain('Background');
    });

    test('resolveMatrixEntry returns undefined for unknown status', () => {
        const svc = new TaskCheckService(createNodeFileSystem(), matrix);
        const entry = svc.resolveMatrixEntry('standard', 'unknown-status');
        expect(entry).toBeUndefined();
    });

    // ── L4: Traceability ──

    test('L4: valid feature_id with active feature produces no L4 errors', async () => {
        const content = taskFm({ feature_id: 'F1' });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const l4Errors = result.findings.filter((f) => f.layer === 'L4' && f.severity === 'error');
        expect(l4Errors).toHaveLength(0);
    });

    test('L4: feature_id pointing to done feature is an error', async () => {
        const content = taskFm({ feature_id: 'F1' });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'done') },
        });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const doneErrors = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'error' && f.message.includes('done'),
        );
        expect(doneErrors.length).toBeGreaterThan(0);
    });

    test('L4: feature_id pointing to cancelled feature is an error', async () => {
        const content = taskFm({ feature_id: 'F1' });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'cancelled') },
        });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const cancelledErrors = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'error' && f.message.includes('cancelled'),
        );
        expect(cancelledErrors.length).toBeGreaterThan(0);
    });

    test('L4: feature_id pointing to non-existent feature warns', async () => {
        const content = taskFm({ feature_id: 'F99' });
        const { fs, path, cleanup } = seedEnv({ taskContent: content });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const notFoundWarnings = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.message.includes('not found'),
        );
        expect(notFoundWarnings.length).toBeGreaterThan(0);
    });

    test('L4: missing feature_id warns (one direction)', async () => {
        const content = taskFm(); // no feature_id
        const { fs, path, cleanup } = seedEnv({ taskContent: content });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const missingWarnings = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.message.includes('Missing feature_id'),
        );
        expect(missingWarnings.length).toBeGreaterThan(0);
    });

    test('L4: legacy feature-id key is also checked', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Legacy task"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            'feature-id: F1',
            '---',
            '',
            '## 0001. Legacy task',
            '',
            '### Background',
            '',
            'text',
        ].join('\n');

        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        // Should recognize feature-id and find the active feature → no L4 errors
        const l4Errors = result.findings.filter((f) => f.layer === 'L4' && f.severity === 'error');
        expect(l4Errors).toHaveLength(0);
        // Should NOT warn about missing feature_id
        const missingWarnings = result.findings.filter(
            (f) => f.layer === 'L4' && f.message.includes('Missing feature_id'),
        );
        expect(missingWarnings).toHaveLength(0);
    });

    test('L4: empty feature_id ("") is treated as missing', async () => {
        const content = taskFm({ feature_id: '' });
        const { fs, path, cleanup } = seedEnv({ taskContent: content });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const missingWarnings = result.findings.filter(
            (f) => f.layer === 'L4' && f.message.includes('Missing feature_id'),
        );
        expect(missingWarnings.length).toBeGreaterThan(0);
    });

    test('L4: valid parent_wbs that exists produces no L4 finding', async () => {
        const content = taskFm({ feature_id: 'F1', parent_wbs: '0002' });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': taskFm({ feature_id: 'F1', name: 'Parent' }) },
        });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const parentWarnings = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('Parent'));
        expect(parentWarnings).toHaveLength(0);
    });

    test('L4: dangling parent_wbs warns', async () => {
        const content = taskFm({ feature_id: 'F1', parent_wbs: '9999' });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const parentWarnings = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('Parent task'));
        expect(parentWarnings.length).toBeGreaterThan(0);
    });

    test('L4: valid dependencies produce no L4 finding', async () => {
        const content = taskFm({ feature_id: 'F1', dependencies: ['0002', '0003'] });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
            extraTasks: {
                '0002': taskFm({ feature_id: 'F1', name: 'Dep 1' }),
                '0003': taskFm({ feature_id: 'F1', name: 'Dep 2' }),
            },
        });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const depWarnings = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('Dependency'));
        expect(depWarnings).toHaveLength(0);
    });

    test('L4: dangling dependency warns', async () => {
        const content = taskFm({ feature_id: 'F1', dependencies: ['9999: some desc'] });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const depWarnings = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('Dependency'));
        expect(depWarnings.length).toBeGreaterThan(0);
    });

    test('L4: --strict elevates feature_id done error (already error, stays error)', async () => {
        const content = taskFm({ feature_id: 'F1' });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'done') },
        });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001', { strict: true });
        cleanup();

        // Missing feature_id warning → error (but we have feature_id; done is already error)
        const warnings = result.findings.filter((f) => f.severity === 'warning');
        expect(warnings).toHaveLength(0);
    });
});
