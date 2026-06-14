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
});
