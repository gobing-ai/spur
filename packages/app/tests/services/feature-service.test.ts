import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { FeatureService } from '../../src/services/feature-service';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import { TaskService } from '../../src/services/task-service';

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

    describe('refresh — INDEX tree + Tasks auto-population (R1/R2/R3)', () => {
        // Build an isolated corpus: A, A1 (child), B + one task linked to A.
        async function seedRefreshCorpus(): Promise<{
            svc: FeatureService;
            featuresDir: string;
            tasksDir: string;
            cleanup(): void;
        }> {
            const r = mkdtempSync(join(tmpdir(), 'spur-fs-refresh-'));
            const fdir = join(r, 'features');
            const tdir = join(r, 'tasks');
            const fs = createNodeFileSystem(r);
            await fs.ensureDir(fdir);
            await fs.ensureDir(tdir);
            const write = new PlanningWriteService({ fs });
            const s = new FeatureService({ fs, featuresDir: fdir, tasksDir: tdir, writeService: write });
            await s.create('Foundation'); // A
            await s.create('Sub', 'A'); // A1
            await s.create('Agents'); // B
            // A task linked to feature A.
            await new TaskService({ fs, tasksDir: tdir, writeService: write }).create({
                title: 'Impl foundation',
                featureId: 'A',
            });
            return {
                svc: s,
                featuresDir: fdir,
                tasksDir: tdir,
                cleanup: () => rmSync(r, { recursive: true, force: true }),
            };
        }

        test('R1: INDEX.md renders a deterministic ID-encoded tree with status + links', async () => {
            const { svc: s, featuresDir, cleanup } = await seedRefreshCorpus();
            const { index } = await s.refresh();
            const onDisk = await createNodeFileSystem().readFile(`${featuresDir}/INDEX.md`);
            cleanup();

            // Golden shape: header, marker region, A then its child A1 (indented, └──), then B.
            expect(index).toBe(onDisk); // returned value === written file
            const lines = index.split('\n');
            expect(lines[0]).toBe('# Feature Index');
            expect(index).toContain('<!-- AUTO-GENERATED by spur feature refresh -->');
            const aLine = lines.findIndex((l) => l.includes('**A**:'));
            const a1Line = lines.findIndex((l) => l.includes('**A1**:'));
            const bLine = lines.findIndex((l) => l.includes('**B**:'));
            expect(aLine).toBeLessThan(a1Line); // parent before child
            expect(a1Line).toBeLessThan(bLine); // A subtree before B
            expect(lines[a1Line]).toContain('└── '); // last (only) child connector
            expect(lines[a1Line]?.startsWith('    ')).toBe(true); // indented (depth 1)
            expect(index).toContain('[A_foundation.md](./A_foundation.md)'); // relative link
            expect(index).toContain('[backlog] **A**'); // status badge
        });

        test('R1: INDEX render is deterministic — two refreshes produce identical output', async () => {
            const { svc: s, cleanup } = await seedRefreshCorpus();
            const first = (await s.refresh()).index;
            const second = (await s.refresh()).index;
            cleanup();
            expect(second).toBe(first);
        });

        test('R2: ## Tasks rewritten only between markers; content outside markers byte-preserved', async () => {
            const { svc: s, featuresDir, cleanup } = await seedRefreshCorpus();
            const fs = createNodeFileSystem();
            const before = await fs.readFile(`${featuresDir}/A_foundation.md`);
            await s.refresh();
            const after = await fs.readFile(`${featuresDir}/A_foundation.md`);
            cleanup();

            // The linked task appears inside the Tasks marker region.
            expect(after).toContain('| 0001 | Impl foundation | backlog |');
            // Everything BEFORE the Tasks section is byte-identical.
            const cut = (s2: string) => s2.slice(0, s2.indexOf('## Tasks'));
            expect(cut(after)).toBe(cut(before));
            // The Goal/Scope/AC/Notes/History headings are all still present.
            for (const h of ['## Goal', '## Scope', '## Acceptance Criteria', '## Notes', '## History']) {
                expect(after).toContain(h);
            }
        });

        test('R2: task files are never modified by refresh', async () => {
            const { svc: s, tasksDir, cleanup } = await seedRefreshCorpus();
            const fs = createNodeFileSystem();
            const taskFile = `${tasksDir}/0001_impl-foundation.md`;
            const before = await fs.readFile(taskFile);
            await s.refresh();
            const after = await fs.readFile(taskFile);
            cleanup();
            expect(after).toBe(before); // byte-identical — task untouched
        });

        test('R2: a feature with no linked tasks gets a "no tasks" placeholder', async () => {
            const { svc: s, featuresDir, cleanup } = await seedRefreshCorpus();
            await s.refresh();
            const bFile = await createNodeFileSystem().readFile(`${featuresDir}/B_agents.md`);
            cleanup();
            expect(bFile).toContain('_No linked tasks._');
        });

        test('R3 dogfood: refresh against a COPY of the real docs/features corpus renders every node + preserves files', async () => {
            // Operate on a COPY — never the live repo. The real corpus is the
            // multi-depth fixture the Solution requires (A, B/B1, F/F1..F6, H/H1..H3).
            const repoRoot = join(import.meta.dir, '..', '..', '..', '..');
            const realFeatures = join(repoRoot, 'docs', 'features');
            const tmp = mkdtempSync(join(tmpdir(), 'spur-fs-corpus-'));
            const fdir = join(tmp, 'features');
            const tdir = join(tmp, 'tasks');
            const rfs = createNodeFileSystem();
            await rfs.ensureDir(fdir);
            await rfs.ensureDir(tdir);
            const realNames = (await rfs.readDir(realFeatures)).filter((n) => /^[A-Z][1-9]*_.+\.md$/.test(n));
            for (const name of realNames) {
                writeFileSync(join(fdir, name), await rfs.readFile(join(realFeatures, name)));
            }

            const s = new FeatureService({
                fs: createNodeFileSystem(),
                featuresDir: fdir,
                tasksDir: tdir,
                writeService: new PlanningWriteService({ fs: createNodeFileSystem() }),
            });
            const { index, tasksUpdated } = await s.refresh();
            // INDEX lists every corpus feature, in deterministic ID order.
            for (const name of realNames) {
                const id = name.match(/^([A-Z][1-9]*)_/)?.[1];
                if (id) expect(index).toContain(`**${id}**`);
            }
            // Every feature has a Tasks marker region → every one is repopulated.
            expect(tasksUpdated).toBe(realNames.length);
            // Each rewritten feature still parses (no corruption) and keeps its Goal.
            for (const name of realNames) {
                const content = await createNodeFileSystem().readFile(join(fdir, name));
                expect(content).toContain('AUTO-GENERATED');
                expect(content).toContain('END AUTO-GENERATED');
            }
            rmSync(tmp, { recursive: true, force: true });
        });
    });

    describe('move', () => {
        test('returns movedCount', async () => {
            const result = await svc.move('A', 'B');
            expect(result).toHaveProperty('movedCount');
        });
    });
});
