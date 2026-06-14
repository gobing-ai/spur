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

    describe('update', () => {
        test('sets a scalar frontmatter field via the write path', async () => {
            const created = await svc.create('Updatable Feature');
            const result = await svc.update(created.ref.id, 'priority', 'P0');
            expect(result.ref.id).toBe(created.ref.id);
            const shown = await svc.show(created.ref.id);
            expect(shown?.frontmatter.priority).toBe('P0');
        });

        test('update throws for an unknown feature ID', async () => {
            await expect(svc.update('ZZZZZ', 'priority', 'P0')).rejects.toThrow(/not found/);
        });
    });

    describe('create allocation is race-safe (R1, DD-14)', () => {
        test('sequential child creates allocate distinct digits (A1, A2, A3)', async () => {
            const fs = createNodeFileSystem(root);
            const dir = join(root, 'seq-features');
            await fs.ensureDir(dir);
            const seqSvc = new FeatureService({
                fs,
                featuresDir: dir,
                tasksDir,
                writeService: new PlanningWriteService({ fs }),
            });
            const parent = await seqSvc.create('Seq Parent'); // → 'A'
            const c1 = await seqSvc.create('Child 1', parent.ref.id);
            const c2 = await seqSvc.create('Child 2', parent.ref.id);
            const c3 = await seqSvc.create('Child 3', parent.ref.id);
            expect([c1.ref.id, c2.ref.id, c3.ref.id]).toEqual([
                `${parent.ref.id}1`,
                `${parent.ref.id}2`,
                `${parent.ref.id}3`,
            ]);
        });

        test('depth-3 allocation: A1 → A11, A12 (length = depth, parent = drop last char)', async () => {
            const fs = createNodeFileSystem(root);
            const dir = join(root, 'deep-features');
            await fs.ensureDir(dir);
            const deepSvc = new FeatureService({
                fs,
                featuresDir: dir,
                tasksDir,
                writeService: new PlanningWriteService({ fs }),
            });
            const a = await deepSvc.create('Group'); // → 'A'
            const a1 = await deepSvc.create('Child', a.ref.id); // → 'A1'
            const a11 = await deepSvc.create('Grandchild 1', a1.ref.id); // → 'A11'
            const a12 = await deepSvc.create('Grandchild 2', a1.ref.id); // → 'A12'
            expect(a1.ref.id).toBe(`${a.ref.id}1`);
            expect(a11.ref.id).toBe(`${a1.ref.id}1`);
            expect(a12.ref.id).toBe(`${a1.ref.id}2`);
            expect(deepSvc.depthOf(a11.ref.id)).toBe(3);
            expect(deepSvc.parentOf(a11.ref.id)).toBe(a1.ref.id);
        });

        test('concurrent creates never produce duplicate IDs — the loser fails loudly, not silently', async () => {
            // The create-lock makes allocation+write one critical section. Under
            // concurrency the lock holder wins; contenders throw a lock error
            // (fail-loud) rather than allocating the same ID and clobbering.
            const fs = createNodeFileSystem(root);
            const dir = join(root, 'race-features');
            await fs.ensureDir(dir);
            const raceSvc = new FeatureService({
                fs,
                featuresDir: dir,
                tasksDir,
                writeService: new PlanningWriteService({ fs }),
            });
            const parent = await raceSvc.create('Race Parent'); // → 'A'
            const settled = await Promise.allSettled([
                raceSvc.create('Child 1', parent.ref.id),
                raceSvc.create('Child 2', parent.ref.id),
                raceSvc.create('Child 3', parent.ref.id),
            ]);
            const succeeded = settled
                .filter(
                    (s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof raceSvc.create>>> =>
                        s.status === 'fulfilled',
                )
                .map((s) => s.value.ref.id);
            // Invariant: every successful create has a distinct ID (no clobbering).
            expect(new Set(succeeded).size).toBe(succeeded.length);
            for (const id of succeeded) {
                expect(id).toMatch(new RegExp(`^${parent.ref.id}[1-9]$`));
            }
            // And the corpus on disk has no duplicate child IDs either.
            const onDisk = (await raceSvc.list()).map((f) => f.id).filter((id) => id.length === 2);
            expect(new Set(onDisk).size).toBe(onDisk.length);
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
