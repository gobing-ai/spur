import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { FeatureService } from '../../src/services/feature-service';
import { PlanningWriteService } from '../../src/services/planning-write-service';

let featuresDir: string;
let tasksDir: string;
let root: string;
let svc: FeatureService;

beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'spur-feature-svc-'));
    featuresDir = join(root, 'features');
    tasksDir = join(root, 'tasks');
    const fs = createNodeFileSystem(root);
    await fs.ensureDir(featuresDir);
    await fs.ensureDir(tasksDir);
    const writeService = new PlanningWriteService({ fs });
    svc = new FeatureService({ fs, featuresDir, tasksDir, writeService });
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('FeatureService', () => {
    describe('ID helpers', () => {
        test('parentOf returns null for top-level IDs', () => {
            expect(svc.parentOf('A')).toBeNull();
        });

        test('parentOf returns parent for child IDs', () => {
            expect(svc.parentOf('A1')).toBe('A');
            expect(svc.parentOf('B23')).toBe('B2');
        });

        test('depthOf returns correct depth', () => {
            expect(svc.depthOf('A')).toBe(1);
            expect(svc.depthOf('A1')).toBe(2);
            expect(svc.depthOf('A12')).toBe(3);
        });

        test('isValidId validates DD-14 pattern', () => {
            expect(svc.isValidId('A')).toBe(true);
            expect(svc.isValidId('A1')).toBe(true);
            expect(svc.isValidId('B9')).toBe(true);
            expect(svc.isValidId('1')).toBe(false);
            expect(svc.isValidId('a')).toBe(false);
            expect(svc.isValidId('A0')).toBe(false);
            expect(svc.isValidId('')).toBe(false);
        });
    });

    describe('create', () => {
        test('creates a top-level feature file', async () => {
            const result = await svc.create('Test Feature');
            expect(result.eventName).toBe('feature.created');
            expect(result.ref.id).toMatch(/^[A-Z]$/);
        });

        test('creates a child feature under a parent', async () => {
            const parentResult = await svc.create('Parent Feature');
            const childResult = await svc.create('Child Feature', parentResult.ref.id);
            expect(childResult.ref.id).toMatch(new RegExp(`^${parentResult.ref.id}[1-9]$`));
        });
    });

    describe('list', () => {
        test('returns features from the features directory', async () => {
            const result = await svc.list();
            expect(result.length).toBeGreaterThanOrEqual(2);
            const ids = result.map((f) => f.id);
            expect(ids.length).toBeGreaterThan(0);
        });
    });

    describe('show', () => {
        test('returns a feature by ID', async () => {
            const list = await svc.list();
            const first = list[0];
            if (!first) return;
            const shown = await svc.show(first.id);
            expect(shown).not.toBeNull();
            if (shown) {
                expect(shown.id).toBe(first.id);
                expect(shown.content).toBeTruthy();
            }
        });

        test('returns null for unknown ID', async () => {
            const shown = await svc.show('ZZZZZ');
            expect(shown).toBeNull();
        });
    });

    describe('refresh', () => {
        test('returns index and tasksUpdated', async () => {
            const result = await svc.refresh();
            expect(result).toHaveProperty('index');
            expect(result).toHaveProperty('tasksUpdated');
        });
    });

    describe('move', () => {
        test('returns movedCount', async () => {
            const result = await svc.move('A', 'B');
            expect(result).toHaveProperty('movedCount');
        });
    });
});
