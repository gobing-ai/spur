import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    createCapturedOutput,
    createMigratedDb,
    createTempProject,
    makeFeatureFile,
    makeTaskFile,
    makeTempDir,
    nullOutput,
} from './helpers';

describe('app test helpers', () => {
    describe('createMigratedDb', () => {
        test('returns an independent in-memory adapter with migrations applied', async () => {
            const db = await createMigratedDb();
            try {
                expect(db).toBeDefined();
                const row = await db.queryFirst<{ name: string }>(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces' LIMIT 1",
                );
                expect(row?.name).toBe('workspaces');
            } finally {
                db.close();
            }
        });
    });

    describe('createTempProject (re-exported from domain)', () => {
        test('creates the planning layout', async () => {
            const project = await createTempProject();
            try {
                expect(existsSync(join(project.root, '.spur', 'config.yaml'))).toBe(true);
                expect(existsSync(project.tasksDir)).toBe(true);
                expect(existsSync(project.featuresDir)).toBe(true);
            } finally {
                await Bun.spawn(['rm', '-rf', project.root]).exited;
            }
        });
    });

    describe('makeTaskFile / makeFeatureFile (re-exported from domain)', () => {
        test('produce parseable markdown strings', () => {
            expect(typeof makeTaskFile()).toBe('string');
            expect(typeof makeFeatureFile()).toBe('string');
            expect(makeTaskFile()).toContain('Fixture task');
            expect(makeFeatureFile()).toContain('Fixture feature');
        });
    });

    describe('makeTempDir', () => {
        test('creates a temp directory that exists on disk', async () => {
            const dir = await makeTempDir();
            try {
                expect(existsSync(dir)).toBe(true);
            } finally {
                await Bun.spawn(['rm', '-rf', dir]).exited;
            }
        });
    });

    describe('nullOutput', () => {
        test('provides write and error methods that do not throw', () => {
            const sink = nullOutput();
            expect(() => sink.write('x')).not.toThrow();
            expect(() => sink.error('y')).not.toThrow();
        });
    });

    describe('createCapturedOutput', () => {
        test('records writes and errors for assertions', () => {
            const sink = createCapturedOutput();
            sink.write('msg1');
            sink.write('msg2');
            sink.error('err1');
            expect(sink.messages).toEqual(['msg1', 'msg2']);
            expect(sink.errors).toEqual(['err1']);
        });
    });
});
