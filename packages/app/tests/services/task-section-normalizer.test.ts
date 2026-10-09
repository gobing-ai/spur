// Task 1132 R1/R2/R3 — fail-first tests for write-time normalization, the parent-status
// link guard, and the `feature check --fix` feature-reopen repair.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { FeatureCheckService } from '../../src/services/feature-check';
import { FeatureService } from '../../src/services/feature-service';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import type { SectionMatrix } from '../../src/services/task-check';
import { normalizeTaskSection } from '../../src/services/task-section-normalizer';
import { featuresDirFor, TaskService } from '../../src/services/task-service';

const MATRIX: SectionMatrix = {
    variants: {
        standard: {
            backlog: {
                required: ['Background'],
                optional: ['Requirements', 'Acceptance Criteria', 'Design', 'Plan', 'Solution', 'Testing', 'Review'],
            },
            todo: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
            wip: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
            testing: { required: ['Solution', 'Testing'] },
            done: { required: ['Solution', 'Testing', 'Review'], gate: true },
        },
    },
};

const featureFile = (id: string, name: string, status: string): string =>
    [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `name: ${name}`,
        `status: ${status}`,
        'created_at: 2026-10-01T00:00:00Z',
        'updated_at: 2026-10-01T00:00:00Z',
        '---',
        `# ${id} ${name}`,
        '## Goal',
        'goal',
        '## Scope',
        'scope',
        '## Acceptance Criteria',
        'ac',
        '## Tasks',
        'tasks',
    ].join('\n');

// ─── R1: pure normalization ────────────────────────────────────────────

describe('normalizeTaskSection', () => {
    test('Requirements: heading-with-bold, colon, and dash variants normalize to `- [ ] R<n>. …`', () => {
        const { body, normalized } = normalizeTaskSection(
            'Requirements',
            [
                '- **R1 Lock.** The core invariant holds',
                'R2: Optional flag keeps strict mode',
                '- R3 - Structured report',
                '- [ ] R4. Already normalized',
            ].join('\n'),
        );
        expect(body).toBe(
            [
                '- [ ] R1. Lock. The core invariant holds',
                '- [ ] R2. Optional flag keeps strict mode',
                '- [ ] R3. Structured report',
                '- [ ] R4. Already normalized',
            ].join('\n'),
        );
        expect(normalized).toEqual([{ section: 'Requirements', kind: 'requirement', count: 3 }]);
    });

    test('Acceptance Criteria: bare AC bullets gain checkbox and em-dash', () => {
        const { body, normalized } = normalizeTaskSection(
            'Acceptance Criteria',
            '- AC1 Normalized output\n- [ ] AC2 — Already fine',
        );
        expect(body).toBe('- [ ] AC1 — Normalized output\n- [ ] AC2 — Already fine');
        expect(normalized).toEqual([{ section: 'Acceptance Criteria', kind: 'acceptance', count: 1 }]);
    });

    test('Gherkin-only AC: body untouched, task-local altitude + numbering flags returned', () => {
        const gherkin = 'Scenario: AC1 — probe rejected (req: R1)\n  Then the error is structured';
        const { body, normalized, frontmatter } = normalizeTaskSection('Acceptance Criteria', gherkin);
        expect(body).toBe(gherkin);
        expect(frontmatter).toEqual({ ac_altitude: 'task-local', ac_numbering: 'task-local' });
        expect(normalized).toEqual([{ section: 'Acceptance Criteria', kind: 'ac-altitude', count: 1 }]);
    });

    test('Other sections pass through untouched', () => {
        const r = normalizeTaskSection('Design', 'R1: not a requirement here');
        expect(r.body).toBe('R1: not a requirement here');
        expect(r.normalized).toEqual([]);
        expect(r.frontmatter).toBeUndefined();
    });

    // ─── 1132 review findings (P2/P3): losslessness and box preservation ───

    test('P3: bare bold forms never gain a stray asterisk, and wording keeps its characters', () => {
        expect(normalizeTaskSection('Requirements', '**R1**').body).toBe('- [ ] R1.');
        expect(normalizeTaskSection('Requirements', '**R1.**').body).toBe('- [ ] R1.');
        expect(normalizeTaskSection('Requirements', '**R1** Lock.').body).toBe('- [ ] R1. Lock.');
        // A leading separator character belongs to the wording, not to the marker.
        expect(normalizeTaskSection('Requirements', '- R2: -1 degree handling').body).toBe(
            '- [ ] R2. -1 degree handling',
        );
        // Not an R-item separator: left byte-identical (the checker never flags it).
        expect(normalizeTaskSection('Requirements', 'R4--').body).toBe('R4--');
    });

    test('P3: the checker predicate is the detection fallback (no write/check bounce)', () => {
        for (const loose of ['- R1', 'R1', '- R1**']) {
            const r = normalizeTaskSection('Requirements', loose);
            expect(r.normalized).toEqual([{ section: 'Requirements', kind: 'requirement', count: 1 }]);
            expect(r.body).toMatch(/^- \[ \] R\d+\./);
        }
    });

    test('P2: an existing checkbox is never flipped (AC and Requirements)', () => {
        expect(normalizeTaskSection('Acceptance Criteria', '- [x] AC1 — done\n- AC2 bare').body).toBe(
            '- [x] AC1 — done\n- [ ] AC2 — bare',
        );
        expect(normalizeTaskSection('Requirements', '- [x] R1. done\n- R2. second').body).toBe(
            '- [x] R1. done\n- [ ] R2. second',
        );
    });
});

// ─── R2/R3: guard + reopen over a temp corpus ──────────────────────────

describe('parent-status link guard', () => {
    let root = '';
    let fs: ReturnType<typeof createNodeFileSystem>;
    let taskSvc: TaskService;

    const featurePath = (): string => {
        const featuresDir = join(root, 'features');
        const name = readdirSync(featuresDir)[0];
        if (name === undefined) throw new Error('fixture feature file missing');
        return readFileSync(join(featuresDir, name), 'utf8');
    };

    const setup = (statuses: Record<string, string>): void => {
        root = mkdtempSync(join(tmpdir(), 'spur-1132-guard-'));
        const featuresDir = join(root, 'features');
        const tasksDir = join(root, 'tasks');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        fs = createNodeFileSystem(root);
        for (const [id, status] of Object.entries(statuses)) {
            writeFileSync(join(featuresDir, `${id}_feature.md`), featureFile(id, `Feature ${id}`, status));
        }
        const writeService = new PlanningWriteService({ fs });
        taskSvc = new TaskService({ fs, tasksDir, writeService, sectionMatrix: MATRIX });
    };

    test('AC2: done parent is rejected with active siblings named and no task written', async () => {
        setup({ A: 'done', A1: 'active', A2: 'active', A3: 'active' });
        const tasksDir = join(root, 'tasks');
        const before = readdirSync(tasksDir).length;
        let err: Error | undefined;
        try {
            await taskSvc.create({ title: 'probe', featureId: 'A', dedupeWithinSec: null });
        } catch (e) {
            err = e as Error;
        }
        expect(err).toBeDefined();
        expect(err?.message).toContain('done');
        expect(err?.message).toContain('A1');
        expect(err?.message).toContain('A3');
        expect(readdirSync(tasksDir).length).toBe(before);
    });

    test('AC3: verifying parent is reopened to active through FeatureService.transition', async () => {
        setup({ A: 'verifying' });
        const result = await taskSvc.create({ title: 'probe', featureId: 'A', dedupeWithinSec: null });
        expect(result.featureReopened).toEqual({ id: 'A', from: 'verifying', to: 'active' });
        expect(featurePath()).toContain('status: active');
    });

    test('AC2: --no-reopen keeps today behavior — verifying parent accepted without reopen', async () => {
        setup({ A: 'verifying' });
        const result = await taskSvc.create({ title: 'probe', featureId: 'A', noReopen: true, dedupeWithinSec: null });
        expect(result.featureReopened).toBeUndefined();
        expect(featurePath()).toContain('status: verifying');
    });

    // ─── 1132 review P1/P4: the guard must work in THIS repo's layout ───

    test('P1: a phase tasks folder (docs/tasks5) resolves its sibling features dir — the guard is not inert', async () => {
        // The pre-fix derivation `tasksDir.replace(/\/tasks$/, '/features')` only matched a
        // folder literally named `tasks`: for the real `docs/tasks5` it returned the tasks dir
        // itself, `list()` found 0 features, and the guard silently returned `undefined`.
        root = mkdtempSync(join(tmpdir(), 'spur-1132-phase-'));
        const tasksDir = join(root, 'docs', 'tasks5');
        const featuresDir = join(root, 'docs', 'features');
        mkdirSync(tasksDir, { recursive: true });
        mkdirSync(featuresDir, { recursive: true });
        expect(featuresDirFor(tasksDir)).toBe(featuresDir);
        writeFileSync(join(featuresDir, 'F1_shipped.md'), featureFile('F1', 'Shipped', 'done'));
        writeFileSync(join(featuresDir, 'F1A_open.md'), featureFile('F1A', 'Open', 'active'));
        fs = createNodeFileSystem(root);
        const writeService = new PlanningWriteService({ fs });
        taskSvc = new TaskService({ fs, tasksDir, writeService, sectionMatrix: MATRIX });

        await expect(taskSvc.create({ title: 'probe', featureId: 'F1', dedupeWithinSec: null })).rejects.toThrow(
            /is done/,
        );
        expect(readdirSync(tasksDir)).toHaveLength(0);
    });

    test('P4: batch-create runs the same parent-status guard', async () => {
        root = mkdtempSync(join(tmpdir(), 'spur-1132-batch-'));
        const featuresDir = join(root, 'features');
        const tasksDir = join(root, 'tasks');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        writeFileSync(join(featuresDir, 'A_done.md'), featureFile('A', 'Done', 'done'));
        fs = createNodeFileSystem(root);
        const writeService = new PlanningWriteService({ fs });
        taskSvc = new TaskService({ fs, tasksDir, writeService, sectionMatrix: MATRIX });
        const batchFile = join(root, 'batch.json');
        writeFileSync(batchFile, JSON.stringify([{ name: 'probe', feature_id: 'A' }]));

        await expect(taskSvc.batchCreate(batchFile)).rejects.toThrow(/is done/);
        expect(readdirSync(tasksDir)).toHaveLength(0);
    });

    test('P4: a create that fails candidate validation does not leave the parent reopened', async () => {
        setup({ A: 'verifying' });
        // The guard runs after validation, so an invalid candidate must not reopen the parent.
        await expect(taskSvc.create({ title: '', featureId: 'A', dedupeWithinSec: null })).rejects.toThrow();
        expect(featurePath()).toContain('status: verifying');
    });

    test('review 3 P4: a terminal parent in the batch leaves an earlier verifying parent untouched', async () => {
        // The two-phase guard exists for this: a reject-only pass over every distinct parent
        // runs BEFORE any reopen, so a terminal parent discovered on a later item cannot abort a
        // batch whose earlier parent was already reopened.
        setup({ A: 'verifying', B: 'done' });
        const batchFile = join(root, 'batch-mixed.json');
        writeFileSync(
            batchFile,
            JSON.stringify([
                { name: 'first', feature_id: 'A' },
                { name: 'second', feature_id: 'B' },
            ]),
        );
        await expect(taskSvc.batchCreate(batchFile)).rejects.toThrow(/is done/);
        expect(readFileSync(join(root, 'features', 'A_feature.md'), 'utf8')).toContain('status: verifying');
        expect(readdirSync(join(root, 'tasks'))).toHaveLength(0);
    });

    test('review 3 P2: the reopen goes through the injected FEATURE lifecycle port', async () => {
        // The pass-3 defect: guardParentFeature borrowed the TASK-profile write service for the
        // feature transition, whose FSM declares no `verifying` state, so the CLI reopen failed
        // with `FSMError: … undeclared state "verifying"`. The port carries the feature profile;
        // this asserts the guard actually calls it (and reports the port's own statuses).
        root = mkdtempSync(join(tmpdir(), 'spur-1132-port-'));
        const featuresDir = join(root, 'features');
        const tasksDir = join(root, 'tasks');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        writeFileSync(join(featuresDir, 'A_verifying.md'), featureFile('A', 'Verifying', 'verifying'));
        fs = createNodeFileSystem(root);
        const calls: Array<[string, string]> = [];
        const ported = new TaskService({
            fs,
            tasksDir,
            featuresDir,
            writeService: new PlanningWriteService({ fs }),
            sectionMatrix: MATRIX,
            featureTransition: async (id, to) => {
                calls.push([id, to]);
                return { fromStatus: 'verifying', toStatus: 'active' };
            },
        });
        const result = await ported.create({ title: 'probe', featureId: 'A', dedupeWithinSec: null });
        expect(calls).toEqual([['A', 'active']]);
        expect(result.featureReopened).toEqual({ id: 'A', from: 'verifying', to: 'active' });
        // The port owns the feature write, so the guard must not also mutate the file itself.
        expect(readFileSync(join(featuresDir, 'A_verifying.md'), 'utf8')).toContain('status: verifying');
    });

    test('review 2 P4: a duplicate-title refusal does not leave the parent reopened', async () => {
        setup({ A: 'verifying' });
        await taskSvc.create({ title: 'probe', featureId: 'A', dedupeWithinSec: 300 });
        // The guard sits after the dedupe refusal, so the second create must not reopen again.
        writeFileSync(join(root, 'features', 'A_feature.md'), featureFile('A', 'Feature A', 'verifying'));
        await expect(taskSvc.create({ title: 'probe', featureId: 'A', dedupeWithinSec: 300 })).rejects.toThrow();
        expect(featurePath()).toContain('status: verifying');
    });

    test('review 2 P3: batch-create APPLIES the implied task-local frontmatter it reports', async () => {
        setup({ A: 'active' });
        const batchFile = join(root, 'batch-ac.json');
        writeFileSync(
            batchFile,
            JSON.stringify([
                {
                    name: 'gherkin acs',
                    feature_id: 'A',
                    acceptance_criteria: 'Scenario: AC1 — probe (req: R1)\n  Then the guard fires',
                },
            ]),
        );
        const result = await taskSvc.batchCreate(batchFile);
        const wbs = result.children[0]?.ref.id;
        expect(wbs).toBeDefined();
        const raw = readFileSync(result.children[0]?.ref.filePath ?? '', 'utf8');
        expect(result.children[0]?.normalized).toEqual([
            { section: 'Acceptance Criteria', kind: 'ac-altitude', count: 1 },
        ]);
        // Reporting a change that was never written would re-arm the DD-09 subset rule.
        expect(raw).toContain('ac_altitude: task-local');
        expect(raw).toContain('ac_numbering: task-local');
    });
});

describe('feature check --fix feature-reopen', () => {
    test('AC4: verifying feature with a linked live todo task is reopened and reported as a repair', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-1132-fix-'));
        try {
            const featuresDir = join(root, 'features');
            const tasksDir = join(root, 'tasks');
            mkdirSync(featuresDir, { recursive: true });
            mkdirSync(tasksDir, { recursive: true });
            const featFile = join(featuresDir, 'A_probe.md');
            writeFileSync(featFile, featureFile('A', 'Probe', 'verifying'));
            writeFileSync(
                join(tasksDir, '0900_probe.md'),
                [
                    '---',
                    'schema_version: 1',
                    'wbs: "0900"',
                    'name: probe',
                    'status: todo',
                    'feature_id: A',
                    'variant: standard',
                    '---',
                    '# 0900. probe',
                    '## Background',
                    'b',
                    '## Acceptance Criteria',
                    'ac',
                    '## Design',
                    'd',
                    '## Plan',
                    'p',
                ].join('\n'),
            );
            const fs = createNodeFileSystem(root);
            const writeService = new PlanningWriteService({ fs });
            const featureSvc = new FeatureService({ fs, featuresDir, tasksDir, writeService });
            const svc = new FeatureCheckService(fs);
            const result = await svc.check(featFile, 'A', {
                featuresDir,
                tasksDirs: [tasksDir],
                fix: true,
                transitionPort: (id, to) => featureSvc.transition(id, to),
            });
            const reopen = result.repairs?.find((r) => r.kind === 'feature-reopen');
            expect(reopen).toBeDefined();
            const fm = readFileSync(featFile, 'utf8');
            expect(fm).toContain('status: active');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('AC4: verifying feature with no live tasks is a no-op', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-1132-fix2-'));
        try {
            const featuresDir = join(root, 'features');
            mkdirSync(featuresDir, { recursive: true });
            const featFile = join(featuresDir, 'A_probe.md');
            writeFileSync(featFile, featureFile('A', 'Probe', 'verifying'));
            const fs = createNodeFileSystem(root);
            const svc = new FeatureCheckService(fs);
            const result = await svc.check(featFile, 'A', {
                featuresDir,
                fix: true,
                transitionPort: () => {
                    throw new Error('must not be called');
                },
            });
            expect(result.repairs?.some((r) => r.kind === 'feature-reopen')).toBeFalsy();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
