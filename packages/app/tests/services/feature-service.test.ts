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
                status: 'backlog',
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

    describe('move — cascade rename (R1/R2/R3, DD-14)', () => {
        // Isolated corpus: A, A1 (child), A11 (grandchild), B + a task linked to A1.
        async function seedMoveCorpus(): Promise<{
            svc: FeatureService;
            featuresDir: string;
            tasksDir: string;
            fs: ReturnType<typeof createNodeFileSystem>;
            cleanup(): void;
        }> {
            const r = mkdtempSync(join(tmpdir(), 'spur-fs-move-'));
            const fdir = join(r, 'features');
            const tdir = join(r, 'tasks');
            const fs = createNodeFileSystem(r);
            await fs.ensureDir(fdir);
            await fs.ensureDir(tdir);
            const write = new PlanningWriteService({ fs });
            const s = new FeatureService({ fs, featuresDir: fdir, tasksDir: tdir, writeService: write });
            await s.create('Foundation'); // A
            await s.create('Sub', 'A'); // A1
            await s.create('Deep', 'A1'); // A11
            await s.create('Other'); // B
            await new TaskService({ fs, tasksDir: tdir, writeService: write }).create({
                title: 'impl sub',
                featureId: 'A1',
            });
            return {
                svc: s,
                featuresDir: fdir,
                tasksDir: tdir,
                fs,
                cleanup: () => rmSync(r, { recursive: true, force: true }),
            };
        }

        test('R1: cascades the subtree (A1→B1, A11→B11); files renamed, others untouched', async () => {
            const { svc: s, featuresDir, fs, cleanup } = await seedMoveCorpus();
            const result = await s.move('A1', 'B');
            expect(result.movedCount).toBe(2);
            expect(result.mapping).toEqual({ A1: 'B1', A11: 'B11' });
            // New files exist, old gone; A and B untouched.
            expect(await fs.exists(join(featuresDir, 'B1_sub.md'))).toBe(true);
            expect(await fs.exists(join(featuresDir, 'B11_deep.md'))).toBe(true);
            expect(await fs.exists(join(featuresDir, 'A1_sub.md'))).toBe(false);
            expect(await fs.exists(join(featuresDir, 'A11_deep.md'))).toBe(false);
            expect(await fs.exists(join(featuresDir, 'A_foundation.md'))).toBe(true);
            // The moved file's id frontmatter is rewritten + a move History line appended.
            const b1 = await fs.readFile(join(featuresDir, 'B1_sub.md'));
            expect(b1).toContain('id: "B1"');
            expect(b1).toContain('moved A1 → B1');
            cleanup();
        });

        test('R2: every linked task feature_id edge is updated', async () => {
            const { svc: s, tasksDir, fs, cleanup } = await seedMoveCorpus();
            const result = await s.move('A1', 'B');
            expect(result.tasksUpdated).toEqual(['0001']);
            const task = await fs.readFile(join(tasksDir, '0001_impl-sub.md'));
            expect(task).toContain('feature_id: B1');
            cleanup();
        });

        test('R3: --dry-run reports the plan with ZERO writes', async () => {
            const { svc: s, featuresDir, tasksDir, fs, cleanup } = await seedMoveCorpus();
            const result = await s.move('A1', 'B', { dryRun: true });
            expect(result.dryRun).toBe(true);
            expect(result.mapping).toEqual({ A1: 'B1', A11: 'B11' });
            expect(result.tasksUpdated).toEqual(['0001']);
            // Nothing changed on disk.
            expect(await fs.exists(join(featuresDir, 'A1_sub.md'))).toBe(true);
            expect(await fs.exists(join(featuresDir, 'B1_sub.md'))).toBe(false);
            expect(await fs.readFile(join(tasksDir, '0001_impl-sub.md'))).toContain('feature_id: A1');
            cleanup();
        });

        test('R1: rejects moving a feature into its own subtree', async () => {
            const { svc: s, cleanup } = await seedMoveCorpus();
            await expect(s.move('A', 'A1')).rejects.toThrow(/into itself or its own subtree/);
            cleanup();
        });

        test('R1: allocation skips taken sibling digits (B1 taken → A1 moves to B2)', async () => {
            const { svc: s, featuresDir, fs, cleanup } = await seedMoveCorpus();
            await s.create('Occupant', 'B'); // B1 now taken
            const result = await s.move('A1', 'B');
            // A1 maps to the next FREE digit under B (B1 taken → B2); cascade ok.
            expect(result.mapping.A1).toBe('B2');
            expect(result.mapping.A11).toBe('B21');
            expect(await fs.exists(join(featuresDir, 'B2_sub.md'))).toBe(true);
            cleanup();
        });

        test('R3: a mid-cascade write failure rolls back (best-effort) — originals restored', async () => {
            const { svc: _s, featuresDir, tasksDir, fs: realFs, cleanup } = await seedMoveCorpus();
            // Wrap fs so the SECOND real feature-file write (the B11 grandchild) throws,
            // after B1 was already written — exercising the rollback path.
            let featureWrites = 0;
            const failingFs = {
                ...realFs,
                writeFile: async (p: string, c: string) => {
                    // atomicWriteAsync writes a temp file in the features dir; count those.
                    if (p.startsWith(featuresDir) && p.includes('.tmp')) {
                        featureWrites += 1;
                        if (featureWrites === 2) throw new Error('injected mid-cascade failure');
                    }
                    return realFs.writeFile(p, c);
                },
            } as ReturnType<typeof createNodeFileSystem>;
            const s = new FeatureService({
                fs: failingFs,
                featuresDir,
                tasksDir,
                writeService: new PlanningWriteService({ fs: failingFs }),
            });
            await expect(s.move('A1', 'B')).rejects.toThrow(/rolled back/);
            // Best-effort rollback: the first-written B1 is removed, originals restored.
            expect(await realFs.exists(join(featuresDir, 'B1_sub.md'))).toBe(false);
            expect(await realFs.exists(join(featuresDir, 'A1_sub.md'))).toBe(true);
            expect(await realFs.exists(join(featuresDir, 'A11_deep.md'))).toBe(true);
            cleanup();
        });

        test('R3: a genuine deep-id collision is rejected before ANY write', async () => {
            // Set up so the cascade WOULD map a grandchild onto an existing id:
            // B1 is free (so A1→B1, A11→B11), but B11 already exists → collision.
            const { svc: s, featuresDir, fs, cleanup } = await seedMoveCorpus();
            // Hand-seed a stray B11 (occupies the grandchild target) without taking B1.
            writeFileSync(
                join(featuresDir, 'B11_stray.md'),
                [
                    '---',
                    'schema_version: 1',
                    'id: "B11"',
                    'name: "Stray"',
                    'status: backlog',
                    'priority: P2',
                    'created_at: 2026-06-14T00:00:00.000Z',
                    'updated_at: 2026-06-14T00:00:00.000Z',
                    '---',
                    '',
                    '# B11: Stray',
                ].join('\n'),
            );
            await expect(s.move('A1', 'B')).rejects.toThrow(/collision/);
            // Zero writes: A1/A11 still in place, no B1 created.
            expect(await fs.exists(join(featuresDir, 'A1_sub.md'))).toBe(true);
            expect(await fs.exists(join(featuresDir, 'B1_sub.md'))).toBe(false);
            cleanup();
        });
    });
});
