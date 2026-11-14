import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { FINDING_CODES } from '../../src/services/finding-codes';
import { TaskCheckService } from '../../src/services/task-check';
import { TaskLocator } from '../../src/services/task-locator';

const matrix = {
    variants: {
        standard: {
            backlog: { required: ['Background'], forbidden: ['Solution', 'Review', 'Testing'] },
            todo: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
            wip: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
            testing: { required: ['Solution', 'Testing'], optional: ['Design', 'Review'] },
            done: { required: ['Solution', 'Testing', 'Review'], gate: true },
        },
        issue: {
            wip: { required: ['Background', 'Design'] },
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

/**
 * Seed one repository-relative evidence file under a seeded task's repo root.
 *
 * Live records must RESOLVE every in-repo anchor (0994 follow-up: `L4.anchor-unresolved`
 * is an error), so a fixture that cites a real-looking path has to materialize it —
 * otherwise the fixture is asserting on a gate finding it never intended to model.
 * Only task paths built by `seedEnv` work here: its repo root is one level above the
 * `tasks/` dir, whereas `seedFile` resolves its root to the system temp dir.
 */
function seedRepoFile(taskPath: string, rel: string, content: string): void {
    const abs = join(taskPath, '..', '..', rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
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

    test('L3: empty-cell Review scaffold is tolerated where Review is optional', async () => {
        // Pre-fix-round window: a review task carries the scaffold at a status where
        // Review is optional. The rule must NOT force a populated table yet — only
        // once Review becomes required (the prior test) does the scaffold error.
        const reviewMatrix = {
            variants: {
                review: {
                    todo: { required: ['Background'], optional: ['Review'] },
                    done: { required: ['Background', 'Review'], gate: true },
                },
            },
        };
        const content = [
            '---',
            'schema_version: 1',
            'name: "Scaffold at todo"',
            'status: todo',
            'template: review',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Scaffold at todo',
            '',
            '### Background',
            '',
            'Context.',
            '',
            '### Review',
            '',
            'Post-implementation reflection — to be filled after the first fix round.',
            '',
            '| Severity | File | Finding | Recommendation |',
            '| -------- | ---- | ------- | -------------- |',
            '| P1       |      |         |                |',
            '| P2       |      |         |                |',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, reviewMatrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reviewErrors = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Review');
        expect(reviewErrors.length).toBe(0);
    });
    test('L3: dash-filled Review scaffold is tolerated where Review is optional (0297)', async () => {
        // The dash-filled table is the same "not yet authored" state as the empty-cell
        // scaffold — at an optional-Review status it must be tolerated, not errored,
        // exactly like the empty-cell variant in the test above.
        const reviewMatrix = {
            variants: {
                review: {
                    todo: { required: ['Background'], optional: ['Review'] },
                    done: { required: ['Background', 'Review'], gate: true },
                },
            },
        };
        const content = [
            '---',
            'schema_version: 1',
            'name: "Dash scaffold at todo"',
            'status: todo',
            'template: review',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Dash scaffold at todo',
            '',
            '### Background',
            '',
            'Context.',
            '',
            '### Review',
            '',
            '| Severity | Finding | Location | Action |',
            '|----------|---------|----------|--------|',
            '| P1 | — | — | — |',
            '| P2 | — | — | — |',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, reviewMatrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reviewErrors = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Review');
        expect(reviewErrors.length).toBe(0);
    });
    test('L3: a P-row with real content beside dash cells still counts as populated (0297)', async () => {
        // Dash cells are empty, but one substantive cell in any P-row keeps the table
        // populated — mixed rows like `| P2 | real finding | — | follow-up |` must not
        // regress to an error.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Mixed dash row"',
            'status: done',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Mixed dash row',
            '',
            '### Solution',
            '',
            'Fixed `src/foo.ts:10-15`.',
            '',
            '### Testing',
            '',
            'Coverage: 95%.',
            '',
            '### Review',
            '',
            '| Severity | Finding | Location | Action |',
            '|----------|---------|----------|--------|',
            '| P1 | — | — | — |',
            '| P2 | scaffold detector misses dash cells | `task-check.ts:127` | tighten placeholder rule |',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reviewErrors = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Review');
        expect(reviewErrors.length).toBe(0);
    });
    test('L3: prose-only ### Review (no table) at optional status is tolerated (P1 regression)', async () => {
        // WHY: a fresh review-template fix-task may have its ### Review authored as
        // prose context (no table at all) when all findings are stale — this is a
        // legitimate pre-fix-round state. The L3 rule must not fire at a status where
        // Review is only *optional* (backlog/todo). This was the P1 bug in 0156:
        // isReviewScaffold required at least one empty-cell P-row, which rejected
        // prose-only Review bodies and forced an L3 error even when Review was optional.
        const reviewMatrix = {
            variants: {
                review: {
                    todo: { required: ['Background'], optional: ['Review'] },
                    done: { required: ['Background', 'Review'], gate: true },
                },
            },
        };
        const content = [
            '---',
            'schema_version: 1',
            'name: "Prose-only review"',
            'status: todo',
            'template: review',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Prose-only review',
            '',
            '### Background',
            '',
            'Context.',
            '',
            '### Review',
            '',
            'Post-implementation reflection — filled after the first fix round.',
            'All findings from the dogfood run were stale; no table needed yet.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, reviewMatrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reviewErrors = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Review');
        expect(reviewErrors.length).toBe(0); // prose-only at optional status must be tolerated
    });
    test('L3: Review with a populated P-table passes', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Populated review"',
            'status: done',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Populated review',
            '',
            '### Solution',
            '',
            'Fixed `src/foo.ts:10-15`.',
            '',
            '### Testing',
            '',
            'Coverage: 95%.',
            '',
            '### Review',
            '',
            '| Severity | File | Finding | Recommendation |',
            '| -------- | ---- | ------- | -------------- |',
            '| P2       | `src/foo.ts:10` | missing guard | add a null check |',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reviewErrors = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Review');
        expect(reviewErrors.length).toBe(0);
    });
    test('L3: Review at backlog (forbidden) does not trigger P1-P4 check', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Review scaffold"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Review scaffold',
            '',
            '### Background',
            '',
            'Task context.',
            '',
            '### Review',
            '',
            'Post-implementation reflection — scaffolding, no P1-P4 table yet.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reviewErrors = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Review');
        expect(reviewErrors.length).toBe(0); // L3 should not fire — Review is forbidden at backlog
    });

    test('L3: Requirements with proper R-numbering produces no warning', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Req ok"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Req ok',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Requirements',
            '',
            'R1. The system shall do X.',
            'R2. The system shall do Y.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reqWarnings = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Requirements' && f.code !== 'L3.requirements-checkbox',
        );
        expect(reqWarnings).toHaveLength(0);
    });

    test('L3: bulletized R-numbered Requirements produce no warning', async () => {
        // WHY: the producer bulletizes R-items ("- R1. …"); the R-numbering check
        // must accept the list-bullet prefix, else a correctly-formatted file warns.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Bullet reqs"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Bullet reqs',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Requirements',
            '',
            '- R1. The system shall do X.',
            '- R2. The system shall do Y.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        const reqWarnings = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Requirements' && f.code !== 'L3.requirements-checkbox',
        );
        expect(reqWarnings).toHaveLength(0);
    });

    test('L3: checkbox-prefixed R-numbered Requirements produce no warning', async () => {
        // WHY: todo tasks track requirements as GitHub task-list checkboxes
        // ("- [ ] R1. …"); the R-numbering check must accept the checkbox between
        // the bullet and the R-number, else a correctly-formatted todo task warns.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Checkbox reqs"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Checkbox reqs',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Requirements',
            '',
            '- [ ] R1. The system shall do X.',
            '- [x] R2. The system shall do Y.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        const reqWarnings = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Requirements' && f.code !== 'L3.requirements-checkbox',
        );
        expect(reqWarnings).toHaveLength(0);
    });

    test('L3: bold-emphasised R-numbered Requirements produce no warning', async () => {
        // WHY: "- [ ] **R1.** …" is a natural way to write R-items and was previously
        // rejected on a cosmetic technicality — the regex allowed a bullet and a checkbox
        // but not emphasis, so a correctly-structured section warned.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Bold reqs"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Bold reqs',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Requirements',
            '',
            '- [ ] **R1.** The system shall do X.',
            '- [x] **R2.** The system shall do Y.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const reqWarnings = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Requirements' && f.code !== 'L3.requirements-checkbox',
        );
        expect(reqWarnings).toHaveLength(0);
    });

    test('L3: multi-line R-numbered Requirements produce no warning', async () => {
        // WHY: R-items with multi-line bodies (continuation lines, detail paragraphs)
        // must not false-positive. The heuristic counts requirement blocks, not lines,
        // so one R-item that spans 10 lines of body text doesn't dilute the ratio.
        // This is the 0174 dogfood bug — a 6-item Requirements section with R6 spanning
        // ~8 continuation lines warned "~50% or fewer" under the old per-line count.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Multi-line reqs"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Multi-line reqs',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Requirements',
            '',
            'R1. Add --dry-run flag pass-through to dev-wrap.',
            '',
            'R2. Run a live end-to-end dogfood of sp:dev-idea and sp:dev-wrapall.',
            '',
            'R3. Reconcile planning-pipeline design-approval HITL taxonomy.',
            '',
            'R4. (optional) Add structured dependencies support to the task-batch schema.',
            '',
            'R5. Advance feature I to done; parent task 0167 to done.',
            '',
            'R6. Fix the agent.run side-effect + cyclic-edge convergence defects.',
            '    Root cause: RC1 (exit-0=success without side-effect verification) +',
            '    RC2 (uncapped feature-check↔ac-generate loop). Three-layer solution:',
            '    S1 loop cap, S2 side-effect verification via capture+shell,',
            '    S3 A/B nesting diagnostic. This requirement supersedes the',
            '    misdiagnosis in task 0173 Review and the 0167 close-out summary.',
            '    Those were a propagation of unverified claims without trace evidence.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        const reqWarnings = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Requirements' && f.code !== 'L3.requirements-checkbox',
        );
        expect(reqWarnings).toHaveLength(0);
    });

    test('L3: a guidance-placeholder Solution does NOT trigger the file:line error', async () => {
        // WHY: a not-yet-implemented task (Solution = guidance comment only) must
        // pass — forcing a file:line citation before implementation is the original
        // dogfood bug that failed every freshly-created task.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Placeholder sol"',
            'status: wip',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Placeholder sol',
            '',
            '### Solution',
            '',
            '<!-- Change map — HOW/WHERE. A file:line table … -->',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        const solErrors = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Solution');
        expect(solErrors).toHaveLength(0);
    });

    test('L3: Solution table with backtick-wrapped file + adjacent line column passes (P3 regression)', async () => {
        // WHY: hasAdjacentFileLineColumns initially failed to strip backticks before
        // checking file extensions — `\`src/foo.ts\`` didn't match the extension regex.
        // This test locks the fix: backtick-wrapped paths in table columns are recognized.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Table file:line"',
            'status: done',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Table file:line',
            '',
            '### Solution',
            '',
            '| File | Lines | What / Why |',
            '| ---- | ----- | ---------- |',
            '| `src/foo.ts` | 42 | added validation |',
            '',
            '### Testing',
            '',
            'Coverage: 95%.',
            '',
            '### Review',
            '',
            '| Severity | File | Finding | Recommendation |',
            '| -------- | ---- | ------- | -------------- |',
            '| P2 | `src/foo.ts:42` | fixed | — |',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        const solErrors = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Solution' && f.severity === 'error',
        );
        expect(solErrors.length).toBe(0);
    });

    test('L3: Solution table with bare file + adjacent line range passes', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Table file:line range"',
            'status: done',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Table file:line range',
            '',
            '### Solution',
            '',
            '| File | Lines | What / Why |',
            '| ---- | ----- | ---------- |',
            '| src/foo.ts | 10-25 | refactored parser |',
            '',
            '### Testing',
            '',
            'Coverage: 95%.',
            '',
            '### Review',
            '',
            '| Severity | File | Finding | Recommendation |',
            '| -------- | ---- | ------- | -------------- |',
            '| P2 | src/foo.ts:10-25 | fixed | — |',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        const solErrors = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Solution' && f.severity === 'error',
        );
        expect(solErrors.length).toBe(0);
    });

    test('L3: Plan as ordered checklist produces no warning', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Plan list"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Plan list',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Plan',
            '',
            '1. Do X',
            '2. Do Y',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const planWarnings = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Plan');
        expect(planWarnings).toHaveLength(0);
    });

    test('L3: Plan with bold-phase header followed by checkbox items produces no warning (0129-shape)', async () => {
        // WHY: the L3 Plan check must scan ALL lines for a list-item marker, not just the first.
        // A Plan that opens with a **Phase A — …:** bold header and contains '- [ ]' checkbox items
        // is a valid ordered form — the first-line-only test falsely flagged it as free-form prose.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Plan bold-phase"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Plan bold-phase',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Plan',
            '',
            '**Phase A — Setup:**',
            '- [ ] A1. Install dependencies',
            '- [ ] A2. Configure environment',
            '',
            '**Phase B — Implementation:**',
            '- [ ] B1. Write the fix',
            '- [ ] B2. Add regression test',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const planWarnings = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Plan');
        expect(planWarnings).toHaveLength(0);
    });

    test('resolveMatrixEntry falls back to the standard variant', () => {
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

    test('L4: feature_id pointing to non-existent feature blocks', async () => {
        const content = taskFm({ feature_id: 'F99' });
        const { fs, path, cleanup } = seedEnv({ taskContent: content });
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const notFoundErrors = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'error' && f.message.includes('not found'),
        );
        expect(notFoundErrors.length).toBeGreaterThan(0);
        expect(result.pass).toBe(false);
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
        // Verify the message includes the actionable corrective hint (0148 P2).
        expect(missingWarnings.some((f) => f.message.includes('spur task update'))).toBe(true);
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
                '0002': taskFm({ feature_id: 'F1', name: 'Dep 1', status: 'done' }),
                '0003': taskFm({ feature_id: 'F1', name: 'Dep 2', status: 'done' }),
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

    test('readiness: direct dependency must be done before the task is ready', async () => {
        const content = taskFm({ feature_id: 'F1', dependencies: ['0002'] });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
            extraTasks: {
                '0002': taskFm({ feature_id: 'F1', name: 'Dep 1', status: 'wip' }),
            },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const readiness = result.findings.filter(
            (f) => f.layer === 'L4' && f.message.includes('Prerequisite 0002 is wip'),
        );
        expect(readiness).toHaveLength(1);
    });

    test('readiness: transitive dependency status is surfaced', async () => {
        const content = taskFm({ feature_id: 'F1', dependencies: ['0002'] });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
            extraTasks: {
                '0002': taskFm({ feature_id: 'F1', name: 'Dep 1', status: 'done', dependencies: ['0003'] }),
                '0003': taskFm({ feature_id: 'F1', name: 'Dep 2', status: 'todo' }),
            },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const readiness = result.findings.filter(
            (f) => f.layer === 'L4' && f.message.includes('Transitive prerequisite 0003 is todo'),
        );
        expect(readiness).toHaveLength(1);
    });

    test('readiness: a cycle reached through a prose-inferred edge is not reported (R3)', async () => {
        // 0001 prose-refs 0002; 0002 declares [0001]. The closing edge is frontmatter,
        // but the opening edge is prose-inferred — the loop is a parser artifact.
        const content = [
            taskFm({ feature_id: 'F1' }),
            '',
            '### Requirements',
            '',
            'This task depends on 0002 before implementation.',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
            extraTasks: {
                '0002': taskFm({ feature_id: 'F1', name: 'Dep', status: 'done', dependencies: ['0001'] }),
            },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const cycle = result.findings.filter((f) => f.layer === 'L4' && f.code === FINDING_CODES.L4_PREREQUISITE_CYCLE);
        expect(cycle).toHaveLength(0);
    });

    test('readiness: a cycle whose only mutual references are prose is not reported (R3)', async () => {
        // Neither task declares the other; the only references are prose. Such a loop
        // is never claimed from prose alone.
        const content = [taskFm({ feature_id: 'F1' }), '', '### Requirements', '', 'This task depends on 0002.'].join(
            '\n',
        );
        const dep2 = [
            taskFm({ feature_id: 'F1', name: 'Dep', status: 'done' }),
            '',
            '### Requirements',
            '',
            'This task depends on 0001.',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': dep2 },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const cycle = result.findings.filter((f) => f.layer === 'L4' && f.code === FINDING_CODES.L4_PREREQUISITE_CYCLE);
        expect(cycle).toHaveLength(0);
    });

    test('readiness: a cycle resting on frontmatter dependency edges is still reported (R3)', async () => {
        const content = taskFm({ feature_id: 'F1', dependencies: ['0002'] });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
            extraTasks: {
                '0002': taskFm({ feature_id: 'F1', name: 'Dep', status: 'done', dependencies: ['0001'] }),
            },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const cycle = result.findings.filter((f) => f.layer === 'L4' && f.code === FINDING_CODES.L4_PREREQUISITE_CYCLE);
        expect(cycle).toHaveLength(1);
    });

    test('readiness: hyphenated tokens like "parity-gated" do NOT raise gate language (0622 R9)', async () => {
        const content = [
            taskFm({ feature_id: 'F1' }),
            '',
            '### Design',
            '',
            'The parity-gated references stay authoritative; see the spine for details.',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const gate = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('gate language'));
        expect(gate).toHaveLength(0);
    });

    test('readiness: blocked status reports not-ready state', async () => {
        const content = taskFm({ feature_id: 'F1', status: 'blocked' });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const blocked = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('is blocked'));
        expect(blocked).toHaveLength(1);
    });

    test('readiness: dependency cycle is reported instead of recursing forever', async () => {
        const content = taskFm({ feature_id: 'F1', dependencies: ['0002'] });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
            extraTasks: {
                '0002': taskFm({ feature_id: 'F1', name: 'Dep 1', status: 'done', dependencies: ['0001'] }),
            },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const cycle = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('cycle detected'));
        expect(cycle).toHaveLength(1);
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

    // ── L4: AC coverage (R1, DD-09) ──────────────────────────────────────

    /** A task with `## ... Acceptance Criteria` Gherkin and a feature_id. */
    function taskWithAc(featureId: string, scenarios: string[]): string {
        const ac = [
            '```gherkin',
            'Feature: T',
            '',
            ...scenarios.flatMap((s) => [`  Scenario: ${s}`, '    Given x']),
            '```',
        ];
        return [
            '---',
            'schema_version: 1',
            'name: "AC task"',
            'status: backlog',
            `feature_id: ${featureId}`,
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. AC task',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Acceptance Criteria',
            '',
            ...ac,
        ].join('\n');
    }

    /** A feature file with Gherkin AC scenarios. */
    function featureWithAc(id: string, scenarios: string[]): string {
        const ac = [
            '```gherkin',
            `Feature: ${id}`,
            '',
            ...scenarios.flatMap((s) => [`  Scenario: ${s}`, '    Given x']),
            '```',
        ];
        return [
            '---',
            'schema_version: 1',
            `id: ${id}`,
            `name: "Feature ${id}"`,
            'status: active',
            'priority: P1',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            `# ${id}: Feature ${id}`,
            '',
            '## Acceptance Criteria',
            '',
            ...ac,
        ].join('\n');
    }

    test('R1: task scenario covered by the feature AC produces no coverage warning', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAc('F1', ['shared scenario']),
            features: { F1: featureWithAc('F1', ['shared scenario', 'another']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        expect(result.findings.filter((f) => f.message.includes('subset rule'))).toHaveLength(0);
    });

    test('R1: coverage match is title-normalized (R-id prefix + case ignored)', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAc('F1', ['R1: Logs In']),
            features: { F1: featureWithAc('F1', ['logs in']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        // "R1: Logs In" normalizes to "logs in" → matches → no warning.
        expect(result.findings.filter((f) => f.message.includes('subset rule'))).toHaveLength(0);
    });

    /** A task whose AC is a checklist (Tier-2), not Gherkin. */
    function taskWithChecklist(featureId: string, items: string[]): string {
        return [
            '---',
            'schema_version: 1',
            'name: "Checklist task"',
            'status: backlog',
            `feature_id: ${featureId}`,
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Checklist task',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Acceptance Criteria',
            '',
            ...items.map((i) => `- [ ] ${i}`),
        ].join('\n');
    }

    test('R1: checklist-tier task AC covers feature scenarios by item text (DD-09)', async () => {
        const { fs, path, cleanup } = seedEnv({
            // Checklist item "logs in" matches the feature scenario "Logs In" (normalized).
            taskContent: taskWithChecklist('F1', ['R1: Logs In']),
            features: { F1: featureWithAc('F1', ['logs in']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        expect(result.findings.filter((f) => f.message.includes('subset rule'))).toHaveLength(0);
    });

    /** A feature with Gherkin AC AND a wayfinder-map tag (task 0476). */
    function featureWithAcAndTag(id: string, scenarios: string[], tag: string): string {
        const ac = [
            '```gherkin',
            `Feature: ${id}`,
            '',
            ...scenarios.flatMap((s) => [`  Scenario: ${s}`, '    Given x']),
            '```',
        ];
        return [
            '---',
            'schema_version: 1',
            `id: ${id}`,
            `name: "Feature ${id}"`,
            'status: active',
            'priority: P1',
            `tags: ["${tag}"]`,
            'created_at: 2026-06-13T00:00:00Z',
            'updated_at: 2026-06-13T00:00:00Z',
            '---',
            '',
            `# ${id}: Feature ${id}`,
            '',
            '## Acceptance Criteria',
            '',
            ...ac,
        ].join('\n');
    }

    test('R2: wayfinder-map parent feature skips DD-09 subset rule entirely', async () => {
        // Same setup as the baseline DD-09 test, but the parent feature is tagged
        // as a wayfinder map. The rogue scenario should NOT produce a coverage
        // warning because the subset rule is category-wrong for maps.
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAc('F1', ['rogue scenario']),
            features: { F1: featureWithAcAndTag('F1', ['the real scenario'], 'wayfinder-map') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        expect(result.findings.filter((f) => f.message.includes('subset rule'))).toHaveLength(0);
    });

    // ── AC altitude: ac_altitude: task-local skips DD-09 (0584 R3/R4) ──

    /** Task with a declared AC altitude and a scenario that drifts from its feature. */
    function taskWithAltitude(altitude: 'graduating' | 'task-local' | undefined, scenario = 'rogue scenario'): string {
        const fm = taskFm({ feature_id: 'F1', status: 'backlog', name: 'Altitude task', ac_altitude: altitude });
        return [
            fm,
            '',
            '### Acceptance Criteria',
            '',
            '```gherkin',
            'Feature: T',
            `  Scenario: ${scenario}`,
            '    Given x',
            '```',
        ].join('\n');
    }

    test('R3: ac_altitude: task-local skips the DD-09 subset rule entirely', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAltitude('task-local'),
            features: { F1: featureWithAc('F1', ['the real scenario']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        expect(result.findings.filter((f) => f.message.includes('subset rule'))).toHaveLength(0);
    });

    test('R4: altitude is field-only — a task-local task written in Gherkin does not warn', async () => {
        // Same drifted Gherkin scenario as the graduating case below; only the
        // declared field differs. Notation must not decide the rule (R4).
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAltitude('task-local', 'R99: local regression bullet case'),
            features: { F1: featureWithAc('F1', ['the real scenario']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        expect(result.findings.filter((f) => f.message.includes('subset rule'))).toHaveLength(0);
    });

    // ── 1061 canaries: AC forms keep their exact finding codes/severities ──
    // The task templates and ac-style-guide.md teach these AC forms; these checks
    // pin what the checker emits per form so guidance edits cannot drift semantics
    // (1061 R3: assert codes/severities, never whole-check pass/fail). Runtime
    // equivalents: .spur/run/1061-ac-proof/ (fixture corpus + 1053–1056 baselines).
    describe('1061 canaries: AC forms and their finding codes/severities', () => {
        /** Canary task with the given altitude/numbering declaration, Requirements, and raw AC lines. */
        const canaryTask = (opts: {
            altitude?: 'graduating' | 'task-local';
            numbering?: boolean;
            status?: string;
            requirements: readonly string[];
            ac: readonly string[];
        }): string =>
            [
                '---',
                'schema_version: 1',
                'name: "AC canary"',
                `status: ${opts.status ?? 'backlog'}`,
                'created_at: 2026-10-02T00:00:00.000Z',
                'updated_at: 2026-10-02T00:00:00.000Z',
                'feature_id: "F1"',
                ...(opts.altitude === 'task-local' ? ['ac_altitude: task-local'] : []),
                ...(opts.numbering ? ['ac_numbering: task-local'] : []),
                '---',
                '',
                '## 0001. AC canary',
                '',
                '### Background',
                '',
                'text',
                '',
                '### Requirements',
                '',
                ...opts.requirements,
                '',
                '### Acceptance Criteria',
                '',
                ...opts.ac,
            ].join('\n');

        const check = async (content: string) => {
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                features: { F1: featureWithAc('F1', ['the real scenario']) },
            });
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();
            return result.findings;
        };

        test('complete task-local binding stays silent on coverage and subset', async () => {
            const findings = await check(
                canaryTask({
                    altitude: 'task-local',
                    numbering: true,
                    requirements: ['- [ ] R1. Bind this one.', '- [ ] R2. Bind this too.'],
                    ac: [
                        '```gherkin',
                        'Scenario: AC1 — First outcome is bound (req: R1)',
                        '  Given x',
                        '```',
                        '',
                        '```gherkin',
                        'Scenario: AC2 — Second outcome is bound (req: R2)',
                        '  Given x',
                        '```',
                    ],
                }),
            );
            expect(findings.filter((f) => f.code === FINDING_CODES.L3_AC_REQUIREMENT_COVERAGE)).toHaveLength(0);
            expect(findings.filter((f) => f.code === FINDING_CODES.L4_UNCOVERED_TASK_SCENARIO)).toHaveLength(0);
        });

        test('checkbox rows never bind — without Scenario: lines the loop stays silent', async () => {
            // Enforcement limit (1061 Design): the binding loop reads Scenario: titles only and
            // needs scenarioCount > 0, so a checkbox-only AC is silent on L3 coverage — checkboxes
            // neither bind requirements nor trigger the no-binding warning. Guidance documents
            // this limit instead of inventing coverage.
            const findings = await check(
                canaryTask({
                    altitude: 'task-local',
                    numbering: true,
                    requirements: ['- [ ] R1. Bind this one.'],
                    ac: ['- [ ] AC1 — A checkbox outcome nobody bound'],
                }),
            );
            expect(findings.filter((f) => f.code === FINDING_CODES.L3_AC_REQUIREMENT_COVERAGE)).toHaveLength(0);
            expect(findings.filter((f) => f.code === FINDING_CODES.L4_UNCOVERED_TASK_SCENARIO)).toHaveLength(0);
        });

        test('legacy raw bullets parse as nothing — silent on coverage and subset', async () => {
            const findings = await check(
                canaryTask({
                    altitude: 'graduating',
                    numbering: true,
                    requirements: ['- [ ] R1. A requirement no scenario binds.'],
                    ac: ['- AC1 — A raw bullet record with no checkbox and no Scenario heading'],
                }),
            );
            expect(findings.filter((f) => f.code === FINDING_CODES.L3_AC_REQUIREMENT_COVERAGE)).toHaveLength(0);
            expect(findings.filter((f) => f.code === FINDING_CODES.L4_UNCOVERED_TASK_SCENARIO)).toHaveLength(0);
        });
    });

    // ── L4 roll-up (0121): parent↔child status drift + roster presence ──

    /** A parent task body with a Plan; `withRoster` controls whether the Plan table names a child WBS. */
    function parentBody(opts: { wbs: string; status: string; withRoster: boolean; rosterWbs?: string }): string {
        const plan = opts.withRoster
            ? ['| Sub-task | Status |', '| -------- | ------ |', `| ${opts.rosterWbs ?? '0002'} | open |`]
            : ['- Implementation step'];
        return [
            taskFm({ feature_id: 'F1', status: opts.status, name: 'Parent task' }),
            '',
            '### Plan',
            '',
            ...plan,
        ].join('\n');
    }

    /** A child task pointing at `parentWbs`, with the given status. */
    function childBody(parentWbs: string, status: string): string {
        return taskFm({ feature_id: 'F1', parent_wbs: parentWbs, status, name: 'Child task' });
    }

    test('roll-up: parent done while a child is open blocks (drift down)', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: parentBody({ wbs: '0001', status: 'done', withRoster: true }),
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': childBody('0001', 'wip') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const drift = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'error' && f.message.includes('still open'),
        );
        expect(drift.length).toBeGreaterThan(0);
        expect(drift[0]?.message).toContain('0002');
        expect(result.pass).toBe(false);
    });

    test('roll-up: all children done while parent open warns (drift up)', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: parentBody({ wbs: '0001', status: 'wip', withRoster: true }),
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': childBody('0001', 'done'), '0003': childBody('0001', 'cancelled') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const drift = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.message.includes('parent is still'),
        );
        expect(drift.length).toBeGreaterThan(0);
    });

    // ADR-137 / 1189: a deprecated task is retained-but-frozen, not live work, so the two
    // "is this still live?" predicates must not treat it as open.
    test('ADR-137: deprecated task under a done feature does NOT emit L4_FEATURE_TERMINAL', async () => {
        // Before the fix, `taskTerminal` was done|cancelled only, so `spur task check` FAILED on a
        // legitimately frozen record with a re-parent instruction that cannot be followed.
        const content = taskFm({ status: 'deprecated', feature_id: 'F1' });
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'done') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const terminalErrors = result.findings.filter(
            (f) => f.code === FINDING_CODES.L4_FEATURE_TERMINAL && f.severity === 'error',
        );
        expect(terminalErrors).toEqual([]);
    });

    test('ADR-137: a deprecated child counts as resolved work under a settled parent', async () => {
        // The kid-side predicate is the sibling case: a frozen kid must not read as
        // "sub-task(s) still open" and invite a close/re-parent of work that is frozen on purpose.
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: parentBody({ wbs: '0001', status: 'done', withRoster: true }),
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': childBody('0001', 'deprecated') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const openKidWarnings = result.findings.filter((f) => f.message.includes('still open'));
        expect(openKidWarnings).toEqual([]);
    });

    test('roll-up: parent done with all children closed produces no drift warning', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: parentBody({ wbs: '0001', status: 'done', withRoster: true }),
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': childBody('0001', 'done') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const drift = result.findings.filter(
            (f) => f.layer === 'L4' && (f.message.includes('still open') || f.message.includes('parent is still')),
        );
        expect(drift).toHaveLength(0);
    });

    test('roll-up: a task with zero children is inert (R3 — no roll-up findings)', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: parentBody({ wbs: '0001', status: 'done', withRoster: false }),
            features: { F1: featureFm('F1', 'active') },
            // no extraTasks — nothing points at 0001
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const rollup = result.findings.filter(
            (f) =>
                f.layer === 'L4' &&
                (f.message.includes('still open') ||
                    f.message.includes('parent is still') ||
                    f.message.includes('roster')),
        );
        expect(rollup).toHaveLength(0);
    });

    test('0713 R1: the same roster with the dependency declared is silent', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: [
                taskFm({ feature_id: 'F1', status: 'wip', name: 'Parent task', dependencies: ['0002'] }),
                '',
                '### Plan',
                '',
                '| Sub-task | Status |',
                '| -------- | ------ |',
                '| 0002 | open |',
            ].join('\n'),
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': childBody('0001', 'wip') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        expect(result.findings.filter((f) => f.code === 'L4.rollup-roster-not-declared-dependency')).toHaveLength(0);
    });

    test('0713 R1: a closed child needs no dependency edge — it cannot be mis-ordered', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: parentBody({ wbs: '0001', status: 'wip', withRoster: true }),
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': childBody('0001', 'done') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        expect(result.findings.filter((f) => f.code === 'L4.rollup-roster-not-declared-dependency')).toHaveLength(0);
    });

    test('roll-up: parent whose Plan table names the child WBS suppresses the roster warning', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: parentBody({ wbs: '0001', status: 'wip', withRoster: true, rosterWbs: '0002' }),
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': childBody('0001', 'wip') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        // Keyed to the code, not the word "roster": 0713 R1 added a second Plan-roster
        // finding whose message also contains it, and this test is about the missing-roster
        // warning specifically.
        const roster = result.findings.filter((f) => f.code === 'L4.rollup-missing-roster');
        expect(roster).toHaveLength(0);
    });

    test('roll-up: --strict elevates drift warnings to errors (fails the gate)', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: parentBody({ wbs: '0001', status: 'done', withRoster: true }),
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': childBody('0001', 'wip') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001', { strict: true });
        cleanup();
        const drift = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('still open'));
        expect(drift.length).toBeGreaterThan(0);
        expect(drift.every((f) => f.severity === 'error')).toBe(true);
        expect(result.pass).toBe(false);
    });

    // ── L3: terminal-status open checkboxes (0182 R7-optional) ──

    test('terminal-status boxes: a done task with all boxes checked does not trigger the warning', async () => {
        const content = [
            taskFm({ status: 'done', name: 'Closed task' }),
            '',
            '### Plan',
            '',
            '- [x] Step one',
            '- [x] Step two',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const boxes = result.findings.filter((f) => f.layer === 'L3' && f.message.includes('unchecked checklist box'));
        expect(boxes).toHaveLength(0);
    });

    test('terminal-status boxes: a todo/wip roster-bearing umbrella parent with open Plan boxes does NOT trigger the warning', async () => {
        // The 0176 roster pattern: an umbrella/tracking parent's Plan legitimately
        // carries open checklist items until every child sub-task lands. Gating the
        // rule strictly on terminal status (done/cancelled) must not fire here.
        const content = [
            taskFm({ status: 'wip', name: 'Umbrella parent' }),
            '',
            '### Plan',
            '',
            '| Sub-task | Status |',
            '| -------- | ------ |',
            '| 0002 | open |',
            '',
            '- [ ] Wave A',
            '- [ ] Wave B',
            '- [ ] Wave C',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const boxes = result.findings.filter((f) => f.layer === 'L3' && f.message.includes('unchecked checklist box'));
        expect(boxes).toHaveLength(0);
    });

    test('terminal-status boxes: a todo umbrella parent with open Plan boxes does NOT trigger the warning', async () => {
        const content = [
            taskFm({ status: 'todo', name: 'Umbrella parent' }),
            '',
            '### Plan',
            '',
            '- [ ] Wave A',
            '- [ ] Wave B',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const boxes = result.findings.filter((f) => f.layer === 'L3' && f.message.includes('unchecked checklist box'));
        expect(boxes).toHaveLength(0);
    });
    // ── R4 (task 0294): Design placeholder warning ───────────────────────────

    test('R4: populated Design at wip does NOT warn', async () => {
        // WHY: once the operator writes a real approach (prose, bullets, an
        // interface sketch), the warning must clear — the check is shape-based,
        // not a subjective quality gate.
        const content = [
            taskFm({ status: 'wip', name: 'Filled design' }),
            '',
            '### Design',
            '',
            'Use an in-memory cache with a 5-minute TTL. Eviction LRU, cap 1k entries.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const designWarnings = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.section === 'Design',
        );
        expect(designWarnings).toHaveLength(0);
    });

    test('R4: placeholder Design on a non-standard template does NOT warn', async () => {
        // WHY: R4 intentionally targets the standard task profile. Other
        // templates have their own section semantics even when their matrix
        // happens to require a Design heading.
        const content = [
            taskFm({ status: 'wip', name: 'Issue empty design', template: 'issue' }),
            '',
            '### Design',
            '',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const designWarnings = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.section === 'Design',
        );
        expect(designWarnings).toHaveLength(0);
    });

    test('R4: missing Design section does NOT emit the placeholder warning (L2 handles missing)', async () => {
        // WHY: L2 already flags a missing required section as an error. The R4
        // placeholder check must only fire when the heading EXISTS but the body
        // is empty — emitting both would double-report and confuse the operator.
        const content = [taskFm({ status: 'wip', name: 'No design heading' }), '', '### Background', '', 'text'].join(
            '\n',
        );
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const designWarnings = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.section === 'Design',
        );
        expect(designWarnings).toHaveLength(0);
    });

    // --- Multi-folder corpus (L4 edges across configured task folders) ---

    describe('L4 edges across multiple task folders', () => {
        /**
         * Seed a corpus split over two task folders: the checked task in `tasks/`,
         * its parent and dependency in `tasks2/`. This is the shape a `spur.yaml`
         * with several `tasks.folders` entries produces.
         */
        function seedTwoFolderEnv(): {
            fs: ReturnType<typeof createNodeFileSystem>;
            path: string;
            tasksDir: string;
            otherDir: string;
            cleanup(): void;
        } {
            const { mkdirSync } = require('node:fs');
            const root = mkdtempSync(join(tmpdir(), 'spur-check-folders-'));
            const tasksDir = join(root, 'tasks');
            const otherDir = join(root, 'tasks2');
            mkdirSync(tasksDir, { recursive: true });
            mkdirSync(otherDir, { recursive: true });
            mkdirSync(join(root, 'features'), { recursive: true });

            const taskPath = join(tasksDir, '0100_task.md');
            writeFileSync(
                taskPath,
                taskFm({ status: 'backlog', parent_wbs: '0050', dependencies: ['0050'], name: 'Child' }),
            );
            // Parent + dependency live in the OTHER folder.
            writeFileSync(join(otherDir, '0050_parent.md'), taskFm({ status: 'done', name: 'Parent' }));

            return {
                fs: createNodeFileSystem(),
                path: taskPath,
                tasksDir,
                otherDir,
                cleanup: () => rmSync(root, { recursive: true, force: true }),
            };
        }

        const edgeFindings = (result: { findings: { code: string }[] }) =>
            result.findings.filter(
                (f) => f.code === FINDING_CODES.L4_PARENT_NOT_FOUND || f.code === FINDING_CODES.L4_DEPENDENCY_NOT_FOUND,
            );

        test('resolves a parent and dependency living in a sibling folder', async () => {
            // WHY: the L4 edge checks used to search only dirname(taskFile), so a
            // cross-folder dependency was reported missing even though `spur task
            // show` resolved it. The locator makes the check see the whole corpus.
            const { fs, path, tasksDir, otherDir, cleanup } = seedTwoFolderEnv();
            const locator = new TaskLocator({
                fs,
                tasksDir,
                foldersConfig: { folders: { [tasksDir]: {}, [otherDir]: {} } },
            });

            const result = await new TaskCheckService(fs, matrix, locator).check(path, '0100');
            cleanup();

            expect(edgeFindings(result)).toHaveLength(0);
        });

        test('still reports a genuinely absent parent and dependency', async () => {
            const { fs, path, tasksDir, otherDir, cleanup } = seedTwoFolderEnv();
            rmSync(join(otherDir, '0050_parent.md'));
            const locator = new TaskLocator({
                fs,
                tasksDir,
                foldersConfig: { folders: { [tasksDir]: {}, [otherDir]: {} } },
            });

            const result = await new TaskCheckService(fs, matrix, locator).check(path, '0100');
            cleanup();

            const codes = edgeFindings(result).map((f) => f.code);
            expect(codes).toContain(FINDING_CODES.L4_PARENT_NOT_FOUND);
            expect(codes).toContain(FINDING_CODES.L4_DEPENDENCY_NOT_FOUND);
        });

        test('without a locator, falls back to the checked file own folder', async () => {
            // The no-locator constructor stays backward compatible: a single-folder
            // corpus behaves exactly as before.
            const { fs, path, cleanup } = seedTwoFolderEnv();

            const result = await new TaskCheckService(fs, matrix).check(path, '0100');
            cleanup();

            expect(edgeFindings(result).length).toBeGreaterThan(0);
        });
    });
    // ── Task 0339: terminal-feature + content-free section enforcement ──────
    describe('TaskCheckService task 0339 (terminal-feature + content-free)', () => {
        test('R1: done task under done feature does NOT emit L4_FEATURE_TERMINAL', async () => {
            // WHY: a terminal task under a terminal feature is the correct end state.
            // The pre-0339 predicate fired on featureStatus alone and failed every
            // completed feature's tasks, proposing a re-parent that would destroy
            // exactly the traceability the corpus exists to hold.
            const content = taskFm({ status: 'done', feature_id: 'F1' });
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                features: { F1: featureFm('F1', 'done') },
            });
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            const terminalErrors = result.findings.filter(
                (f) => f.code === FINDING_CODES.L4_FEATURE_TERMINAL && f.severity === 'error',
            );
            expect(terminalErrors).toEqual([]);
        });

        test('R1: cancelled task under cancelled feature does NOT emit L4_FEATURE_TERMINAL', async () => {
            // WHY: symmetric to done-done. Both `done` and `cancelled` are terminal
            // statuses for both tasks and features; the narrowed predicate must hold
            // for the cancelled-cancelled end state too.
            const content = taskFm({ status: 'cancelled', feature_id: 'F1' });
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                features: { F1: featureFm('F1', 'cancelled') },
            });
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            const terminalErrors = result.findings.filter((f) => f.code === FINDING_CODES.L4_FEATURE_TERMINAL);
            expect(terminalErrors).toEqual([]);
        });

        test('R2: live (todo) task under done feature still emits L4_FEATURE_TERMINAL', async () => {
            // WHY: the rule was written for this case — a live task parented to a
            // terminal feature genuinely needs re-parenting. R1 narrows the
            // predicate; it must not silence the original signal.
            // R4 (0453): message must include the reopen command for done features.
            const content = taskFm({ status: 'todo', feature_id: 'F1' });
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                features: { F1: featureFm('F1', 'done') },
            });
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            const terminalErrors = result.findings.filter(
                (f) => f.code === FINDING_CODES.L4_FEATURE_TERMINAL && f.severity === 'error',
            );
            expect(terminalErrors.length).toBe(1);
            expect(terminalErrors[0]?.message).toContain('done');
            expect(terminalErrors[0]?.message).toContain('spur feature update');
            expect(terminalErrors[0]?.message).not.toContain('cancelled');
        });

        test('R2: live (wip) task under cancelled feature still emits L4_FEATURE_TERMINAL', async () => {
            // WHY: covers the cancelled-feature half of R2 and a non-todo live
            // status, so the predicate isn't accidentally keyed to `todo` only.
            // R4 (0453): cancelled features must NOT offer reopen.
            const content = taskFm({ status: 'wip', feature_id: 'F1' });
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                features: { F1: featureFm('F1', 'cancelled') },
            });
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            const terminalErrors = result.findings.filter(
                (f) => f.code === FINDING_CODES.L4_FEATURE_TERMINAL && f.severity === 'error',
            );
            expect(terminalErrors.length).toBe(1);
            expect(terminalErrors[0]?.message).toContain('cancelled');
            expect(terminalErrors[0]?.message).not.toContain('spur feature update');
        });

        test('R2 (1180): a live task under a deprecated feature warns (not errors) and advises re-parenting', async () => {
            const content = taskFm({ status: 'todo', feature_id: 'F1' });
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                features: { F1: featureFm('F1', 'deprecated') },
            });
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            const strictResult = await new TaskCheckService(fs, matrix).check(path, '0001', { strict: true });
            cleanup();

            const deprecated = result.findings.filter((f) => f.code === FINDING_CODES.L4_FEATURE_DEPRECATED);
            expect(deprecated).toHaveLength(1);
            expect(deprecated[0]?.severity).toBe('warning');
            expect(deprecated[0]?.message).toContain('deprecated');
            expect(deprecated[0]?.message).toContain('spur task update <wbs> --feature <otherId>');
            // The non-terminal frozen state must NOT trip the terminal error path.
            expect(result.findings.filter((f) => f.code === FINDING_CODES.L4_FEATURE_TERMINAL)).toEqual([]);
            // --strict elevates the warning through the shared base.
            expect(strictResult.findings.find((f) => f.code === FINDING_CODES.L4_FEATURE_DEPRECATED)?.severity).toBe(
                'error',
            );
        });

        test('R2 (1180): a terminal task under a deprecated feature gets no finding', async () => {
            // WHY: done-under-deprecated is the intended retained end state; flagging it
            // would re-litigate completed work exactly as 0339 R1 warns against.
            const content = taskFm({ status: 'done', feature_id: 'F1' });
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                features: { F1: featureFm('F1', 'deprecated') },
            });
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            expect(result.findings.filter((f) => f.code === FINDING_CODES.L4_FEATURE_DEPRECATED)).toEqual([]);
        });

        test('R4 (1190): a live dependent of a deprecated task warns and names the remedy', async () => {
            // ADR-137: the freeze is prospective — the edge recorded before the deprecation is
            // REPORTED, never rewritten. A live dependent is the reader who must act.
            const content = taskFm({ status: 'todo', dependencies: ['0050'] });
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                extraTasks: { '0050': taskFm({ name: 'Frozen dep', status: 'deprecated' }) },
            });
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            const strictResult = await new TaskCheckService(fs, matrix).check(path, '0001', { strict: true });
            cleanup();

            const frozen = result.findings.filter((f) => f.code === FINDING_CODES.L4_TASK_DEPRECATED);
            expect(frozen).toHaveLength(1);
            expect(frozen[0]?.severity).toBe('warning');
            expect(frozen[0]?.message).toContain('0050');
            expect(frozen[0]?.message).toContain('spur task update 0050 todo');
            // A warning never fails the check; --strict elevates through the shared base.
            expect(result.pass).toBe(true);
            expect(strictResult.findings.find((f) => f.code === FINDING_CODES.L4_TASK_DEPRECATED)?.severity).toBe(
                'error',
            );
        });

        test('R4 (1190): a terminal dependent of a deprecated task gets no finding', async () => {
            // WHY: a done record under a frozen dependency is a retained historical end state;
            // flagging it would re-litigate completed work (0339 R1 reasoning, applied to tasks).
            const content = taskFm({ status: 'done', dependencies: ['0050'] });
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                extraTasks: { '0050': taskFm({ name: 'Frozen dep', status: 'deprecated' }) },
            });
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            expect(result.findings.filter((f) => f.code === FINDING_CODES.L4_TASK_DEPRECATED)).toEqual([]);
        });

        test('R4 (1190): a live dependent of a live task gets no finding', async () => {
            // Guard against over-firing: only the frozen dependency raises the advisory.
            const content = taskFm({ status: 'todo', dependencies: ['0050'] });
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                extraTasks: { '0050': taskFm({ name: 'Live dep', status: 'wip' }) },
            });
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            expect(result.findings.filter((f) => f.code === FINDING_CODES.L4_TASK_DEPRECATED)).toEqual([]);
        });

        test('R6 (1190): checking a live dependent never rewrites the pre-existing edge', async () => {
            // ADR-137: the freeze is prospective — an edge recorded before the deprecation is
            // reported (R4), never deleted or rewritten by the reader.
            const content = taskFm({ status: 'todo', dependencies: ['0050'] });
            const { fs, path, cleanup } = seedEnv({
                taskContent: content,
                extraTasks: { '0050': taskFm({ name: 'Frozen dep', status: 'deprecated' }) },
            });
            const before = require('node:fs').readFileSync(path, 'utf8');
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            const after = require('node:fs').readFileSync(path, 'utf8');
            cleanup();

            expect(result.findings.some((f) => f.code === FINDING_CODES.L4_TASK_DEPRECATED)).toBe(true);
            expect(after).toBe(before);
            expect(after).toContain('0050');
        });

        test('R3 (F21 0787): placeholder-only Requirements is tolerated where the matrix does not require it', async () => {
            // WHY: 0337 made L3_REQUIREMENTS_EMPTY unconditional; F21 0787 R1
            // supersedes that — creation scaffolded placeholders everywhere, so a
            // task created bare then promoted to todo MUST still check clean. The
            // placeholder rule now fires only when the effective status's matrix
            // entry REQUIRES the section (`todo` does not require Requirements).
            const content = [
                taskFm({ status: 'todo' }),
                '',
                '### Requirements',
                '',
                '<!-- List the R-numbered requirements here. -->',
                '',
                '### Acceptance Criteria',
                '',
                '- Scenario: real AC',
                '  - WHEN check runs',
                '  - THEN pass',
            ].join('\n');
            const { fs, path, cleanup } = seedFile(content);
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            const emptyReq = result.findings.filter((f) => f.code === FINDING_CODES.L3_REQUIREMENTS_EMPTY);
            expect(emptyReq.length).toBe(0);
        });

        test('R3: placeholder-only Acceptance Criteria emits L3_AC_EMPTY (fails gate)', async () => {
            // WHY: the bug report (0337) had both placeholder Requirements AND a
            // placeholder AC whose body literally read "Do not leave placeholder AC
            // here". A task with a real Requirements but empty AC is equally
            // unverifiable — AC is the contract verify checks against.
            const content = [
                taskFm({ status: 'todo' }),
                '',
                '### Requirements',
                '',
                'R1. The gate must fail placeholder-only AC.',
                '',
                '### Acceptance Criteria',
                '',
                '<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->',
            ].join('\n');
            const { fs, path, cleanup } = seedFile(content);
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            const emptyAc = result.findings.filter((f) => f.code === FINDING_CODES.L3_AC_EMPTY);
            expect(emptyAc.length).toBe(1);
            expect(emptyAc[0]?.severity).toBe('error');
            expect(result.pass).toBe(false);
        });

        test('R3: populated Requirements and AC do NOT emit empty findings (passes)', async () => {
            // WHY: defense against over-firing. A well-authored task with real
            // R-numbered Requirements and real scenario AC must not trip the new
            // rules. Also confirms `pass: true` end-to-end.
            const content = [
                taskFm({ status: 'todo' }),
                '',
                '### Requirements',
                '',
                'R1. Real requirement one.',
                'R2. Real requirement two.',
                '',
                '### Acceptance Criteria',
                '',
                '- Scenario: happy path',
                '  - GIVEN a populated task',
                '  - WHEN check runs',
                '  - THEN no empty-section finding',
            ].join('\n');
            const { fs, path, cleanup } = seedFile(content);
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            const emptyFindings = result.findings.filter(
                (f) => f.code === FINDING_CODES.L3_REQUIREMENTS_EMPTY || f.code === FINDING_CODES.L3_AC_EMPTY,
            );
            expect(emptyFindings).toEqual([]);
        });

        test('R3: AC body with only a ```fence wrapper around placeholder is still empty', async () => {
            // WHY: stripAcFence must run before isPlaceholderBody so an AC that is
            // ```` ```\n<!-- placeholder -->\n``` ```` is detected as empty. A bare
            // isPlaceholderBody check would see the fence lines as "content".
            const content = [
                taskFm({ status: 'todo' }),
                '',
                '### Requirements',
                '',
                'R1. Fence-aware AC placeholder detection.',
                '',
                '### Acceptance Criteria',
                '',
                '```',
                '<!-- Do not leave placeholder AC here. -->',
                '```',
            ].join('\n');
            const { fs, path, cleanup } = seedFile(content);
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            const emptyAc = result.findings.filter((f) => f.code === FINDING_CODES.L3_AC_EMPTY);
            expect(emptyAc.length).toBe(1);
        });

        test('R3: missing Requirements section does NOT emit L3_REQUIREMENTS_EMPTY (L2 handles absence)', async () => {
            // WHY: AC "missing Requirements section is not double-reported". When the
            // section heading is absent, L2 owns matrix-driven presence; L3 empty-body
            // findings must not fire on a null body (that would double-report).
            const content = [
                taskFm({ status: 'backlog' }),
                '',
                '### Background',
                '',
                'No Requirements or AC headings — legitimate at backlog.',
            ].join('\n');
            const { fs, path, cleanup } = seedFile(content);
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();

            const emptyReq = result.findings.filter((f) => f.code === FINDING_CODES.L3_REQUIREMENTS_EMPTY);
            const emptyAc = result.findings.filter((f) => f.code === FINDING_CODES.L3_AC_EMPTY);
            expect(emptyReq).toEqual([]);
            expect(emptyAc).toEqual([]);
        });
    });

    describe('L3: Requirements ↔ Acceptance Criteria coverage (ac_numbering: task-local)', () => {
        // WHY: DD-09 (L4) compares a task's AC to its FEATURE's AC. Nothing compared a
        // task's AC to its OWN Requirements, so a requirement could carry zero scenarios
        // and every gate stayed green — how task 0465 shipped R1–R5 with AC covering only
        // R1–R2, leaving its highest-risk requirement untested.
        //
        // The check is opt-in because an audit of 117 task files found three coexisting
        // conventions (43 feature-scoped R-ids, 29 task-local, 38 unnumbered). Ungated it
        // fires on nearly every legacy task, so the gate is load-bearing, not cosmetic.
        const taskWith = (requirements: readonly string[], scenarios: readonly string[], optIn = true): string =>
            [
                '---',
                'schema_version: 1',
                'name: "Coverage"',
                'status: backlog',
                ...(optIn ? ['ac_numbering: task-local'] : []),
                'created_at: 2026-06-13T00:00:00.000Z',
                'updated_at: 2026-06-13T00:00:00.000Z',
                '---',
                '',
                '## 0001. Coverage',
                '',
                '### Background',
                '',
                'text',
                '',
                '### Requirements',
                '',
                ...requirements,
                '',
                '### Acceptance Criteria',
                '',
                '```gherkin',
                'Feature: Coverage',
                '',
                ...scenarios,
                '```',
            ].join('\n');

        const coverageFindings = async (content: string) => {
            const { fs, path, cleanup } = seedFile(content);
            const result = await new TaskCheckService(fs, matrix).check(path, '0001');
            cleanup();
            return result.findings.filter((f) => f.code === FINDING_CODES.L3_AC_REQUIREMENT_COVERAGE);
        };

        const scenario = (title: string): string[] => [
            `  Scenario: ${title}`,
            '    Given a thing',
            '    When acted on',
            '    Then it holds',
            '',
        ];

        test('is silent when every requirement has a scenario', async () => {
            const findings = await coverageFindings(
                taskWith(
                    ['- [ ] R1. Does X.', '- [ ] R2. Does Y.'],
                    [...scenario('R1 — X happens'), ...scenario('R2 — Y happens')],
                ),
            );
            expect(findings).toEqual([]);
        });

        test('one requirement may carry several scenarios without warning', async () => {
            // WHY: merging is legitimate — a scenario set smaller than the requirement
            // count must not be forced 1:1, the over-decomposition failure this repo
            // has already corrected twice.
            const findings = await coverageFindings(
                taskWith(['- [ ] R1. Does X.'], [...scenario('R1 — X happens'), ...scenario('R1 — X degrades safely')]),
            );
            expect(findings).toEqual([]);
        });

        test('stays silent on a legacy task that does not declare ac_numbering', async () => {
            // WHY: the 43 feature-scoped tasks legitimately carry the FEATURE's R-numbers
            // (Requirements R1–R5 beside `Scenario: R6`). Without the gate this fires on
            // all of them and the warning class becomes noise.
            const findings = await coverageFindings(
                taskWith(
                    ['- [ ] R1. Does X.', '- [ ] R2. Does Y.', '- [ ] R3. Does Z.'],
                    scenario('R6 — feature-numbered scenario'),
                    false,
                ),
            );
            expect(findings).toEqual([]);
        });
    });
});

describe('F92 R2 — target-status (asStatus) validation projection', () => {
    // A task currently at `wip` (matrix wip row requires Background/AC/Design/Plan,
    // NOT Solution/Testing/Review). Evaluating it AS `testing` / `done` must apply
    // the TARGET row: missing Solution becomes a finding only when projected.
    const wipTaskMissingSolution = [
        '---',
        'schema_version: 1',
        'name: "F92 wip task"',
        'status: wip',
        'template: standard',
        'created_at: 2026-08-18T00:00:00.000Z',
        'updated_at: 2026-08-18T00:00:00.000Z',
        '---',
        '',
        '## 0001. F92 wip task',
        '',
        '### Background',
        '',
        'Text',
        '',
        '### Acceptance Criteria',
        '',
        '- [x] AC1',
        '',
        '### Design',
        '',
        'Chosen approach.',
        '',
        '### Plan',
        '',
        '- step',
    ].join('\n');

    test('omitted asStatus evaluates the CURRENT wip row (behavior-compatible)', async () => {
        const { fs, path, cleanup } = seedFile(wipTaskMissingSolution);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        // wip does not require Solution — omitted --as must not flag it.
        expect(result.pass).toBe(true);
        expect(result.status).toBe('wip');
        expect(result.missingSections).not.toContain('Solution');
    });

    test("asStatus: 'testing' projects the missing Solution (from the current wip row)", async () => {
        const { fs, path, cleanup } = seedFile(wipTaskMissingSolution);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001', { asStatus: 'testing' });
        cleanup();
        expect(result.status).toBe('testing');
        expect(result.missingSections).toContain('Solution');
        expect(
            result.findings.some(
                (f) => f.code === FINDING_CODES.L2_MISSING_REQUIRED_SECTION && f.section === 'Solution',
            ),
        ).toBe(true);
    });

    test('R3: a testing task checks the CURRENT row but --as done checks the done row', async () => {
        // The R3 defect: testing→done guard historically evaluated the CURRENT
        // (testing) row, whose matrix entry does NOT require Review — so a task
        // missing the done-required Review could reach done. With --as done the
        // done (gate:true) row is evaluated and the transition must be denied.
        const testingTaskMissingReview = [
            '---',
            'schema_version: 1',
            'name: "F92 testing task"',
            'status: testing',
            'template: standard',
            'created_at: 2026-08-18T00:00:00.000Z',
            'updated_at: 2026-08-18T00:00:00.000Z',
            '---',
            '',
            '## 0001. F92 testing task',
            '',
            '### Solution',
            '',
            '`packages/app/src/services/x.ts:12` — change.',
            '',
            '### Testing',
            '',
            '`bun test` passed.',
            '',
            '### Background',
            '',
            'Text',
        ].join('\n');

        const { fs, path, cleanup } = seedEnv({ taskContent: testingTaskMissingReview });
        seedRepoFile(path, 'packages/app/src/services/x.ts', 'export const x = 1;\n'.repeat(14));
        const svc = new TaskCheckService(fs, matrix);

        // Plain check (current status = testing): testing requires Solution+Testing
        // only — Review is optional, so this passes and no done-row findings appear.
        const current = await svc.check(path, '0001');
        expect(current.status).toBe('testing');
        expect(current.pass).toBe(true);

        // Projected as done: done requires Review (gate:true) -> denial.
        const projected = await svc.check(path, '0001', { asStatus: 'done' });
        expect(projected.status).toBe('done');
        expect(projected.missingSections).toContain('Review');
        expect(projected.pass).toBe(false);

        cleanup();
    });

    test('asStatus is read-only: the task file stays byte-identical after projection', async () => {
        const { fs, path, cleanup } = seedFile(wipTaskMissingSolution);
        const before = require('node:fs').readFileSync(path, 'utf8');
        const svc = new TaskCheckService(fs, matrix);
        await svc.check(path, '0001', { asStatus: 'done' });
        await svc.check(path, '0001', { asStatus: 'testing' });
        const after = require('node:fs').readFileSync(path, 'utf8');
        cleanup();
        expect(after).toBe(before);
    });

    test("asStatus: 'done' flags the done-gate required trio as missing", async () => {
        const { fs, path, cleanup } = seedFile(wipTaskMissingSolution);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001', { asStatus: 'done' });
        cleanup();
        expect(result.status).toBe('done');
        for (const s of ['Solution', 'Testing', 'Review']) {
            expect(result.missingSections).toContain(s);
        }
        // done row is gate:true -> missing sections are hard errors -> projection fails.
        expect(result.pass).toBe(false);
    });
});

describe('0800 R1 — open Plan box is an error at a terminal transition target', () => {
    // A `testing` task whose Plan carries one unchecked box. The done gate runs
    // `spur task check --as done`; pre-0800 the open box was L3.unchecked-checklist
    // at WARNING and `pass: !hasError` dropped it — the transition sailed through
    // and the box became silent residue.
    const testingTaskOpenBox = [
        '---',
        'schema_version: 1',
        'name: "0800 testing task"',
        'status: testing',
        'template: standard',
        'created_at: 2026-09-07T00:00:00.000Z',
        'updated_at: 2026-09-07T00:00:00.000Z',
        '---',
        '',
        '## 0001. 0800 testing task',
        '',
        '### Background',
        '',
        'Text',
        '',
        '### Acceptance Criteria',
        '',
        '- [x] AC1',
        '',
        '### Design',
        '',
        'Chosen approach.',
        '',
        '### Plan',
        '',
        '- [x] 1. done step',
        '- [ ] 2. open step',
        '',
        '### Solution',
        '',
        '`packages/app/src/services/x.ts:12` — change.',
        '',
        '### Testing',
        '',
        '`bun test` passed.',
        '',
        '### Review',
        '',
        'Verdict: PASS',
        '',
        '| Priority | Finding |',
        '| --- | --- |',
        '| P3 | No blocking findings |',
        '',
        '### References',
        '',
        'None.',
        '',
        '### History',
        '',
        '- 2026-09-07 created',
    ].join('\n');

    const openBoxFinding = (result: { findings: Array<{ code: string; severity: string }> }) =>
        result.findings.find((f) => f.code === FINDING_CODES.L3_UNCHECKED_CHECKLIST);

    // The fixture cites `packages/app/src/services/x.ts:12`; seed it under the seeded
    // repo root so the certification gate sees a resolvable anchor and this describe
    // stays about open-box severity. Terminal variants are exempt from the gate
    // anyway, but seeding them too keeps one fixture shape.
    function seedOpenBox(content: string) {
        const env = seedEnv({ taskContent: content });
        seedRepoFile(env.path, 'packages/app/src/services/x.ts', 'export const x = 1;\n'.repeat(14));
        return env;
    }

    test('no --as on the same testing task reports nothing (non-terminal current row)', async () => {
        const { fs, path, cleanup } = seedOpenBox(testingTaskOpenBox);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        expect(openBoxFinding(result)).toBeUndefined();
        expect(result.pass).toBe(true);
    });

    test('--as testing (a differing but non-terminal target) reports nothing', async () => {
        const wip = testingTaskOpenBox.replace('status: testing', 'status: wip');
        const { fs, path, cleanup } = seedOpenBox(wip);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001', { asStatus: 'testing' });
        cleanup();
        expect(openBoxFinding(result)).toBeUndefined();
        expect(result.pass).toBe(true);
    });
});

describe('0625 R3 — hollow-Testing stub detection', () => {
    const stubTask = (testingBody: string): string =>
        [
            '---',
            'schema_version: 1',
            'name: "Stub testing task"',
            'status: done',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Stub testing task',
            '',
            '### Background',
            'text',
            '',
            '### Solution',
            '`packages/app/src/services/task-check.ts:10-20` implements the check.',
            '',
            '### Testing',
            testingBody,
            '',
            '### Review',
            '| P1 | path | finding | fix |',
            '| P2 | foo.ts | issue | done |',
        ].join('\n');

    test('no stub finding when Testing carries a populated requirement table', async () => {
        const body = [
            '**Pipeline verify results**',
            '',
            '- Verdict: PASS (from verdict artifact)',
            '',
            '| Requirement | Status | Evidence |',
            '|-------------|--------|----------|',
            '| R1 | MET | `packages/app/src/services/task-check.ts:10-20` |',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(stubTask(body));
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const stub = result.findings.filter((f) => f.code === FINDING_CODES.L4_TESTING_VERDICT_STUB);
        expect(stub).toHaveLength(0);
    });

    test('prose "no requirements recorded" in a sentence does not trip the row-shape match', async () => {
        const body = [
            '**Pipeline verify results**',
            '',
            '- Verdict: PASS (from verdict artifact)',
            '',
            'No requirements recorded — verified manually by re-running the pipeline.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(stubTask(body));
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const stub = result.findings.filter((f) => f.code === FINDING_CODES.L4_TESTING_VERDICT_STUB);
        expect(stub).toHaveLength(0);
    });
});

/** Feature fixture local to the 0700 block (file-scope helpers live inside describes). */
function feature0700(id: string, scenarios: string[]): string {
    const ac = [
        '```gherkin',
        `Feature: ${id}`,
        '',
        ...scenarios.flatMap((sc) => [`  Scenario: ${sc}`, '    Given x']),
        '```',
    ];
    return [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `name: "Feature ${id}"`,
        'status: active',
        'priority: P1',
        'created_at: 2026-06-13T00:00:00.000Z',
        'updated_at: 2026-06-13T00:00:00.000Z',
        '---',
        '',
        `# ${id}: Feature ${id}`,
        '',
        '## Goal',
        '',
        'g',
        '',
        '## Scope',
        '',
        'In scope: x',
        '',
        '## Acceptance Criteria',
        '',
        ...ac,
    ].join('\n');
}

// ── 0700 R5: requirements-format counts R-items, not blank-line blocks ──

const REQ_SECTION_TAIL = [
    '',
    '### Acceptance Criteria',
    '',
    '```gherkin',
    'Feature: T',
    '  Scenario: s',
    '    Given x',
    '```',
].join('\n');

const formatFindingsOf = async (reqBody: string) => {
    const content = [
        taskFm({ feature_id: 'F1', status: 'backlog', name: 'Shape task' }),
        '',
        '### Requirements',
        '',
        reqBody,
        REQ_SECTION_TAIL,
    ].join('\n');
    const { fs, path, cleanup } = seedEnv({
        taskContent: content,
        features: { F1: feature0700('F1', ['the real scenario']) },
    });
    const result = await new TaskCheckService(fs, matrix).check(path, '0001');
    cleanup();
    return result.findings.filter(
        (f) => f.code.includes('requirements-format') || f.code.includes('REQUIREMENTS_FORMAT'),
    );
};

test('0700 R5: contiguous R-items plus non-goals prose blocks do not warn', async () => {
    const findings = await formatFindingsOf(
        [
            '- [ ] R1. First requirement with body',
            '- [ ] R2. Second requirement with body',
            '- [ ] R3. Third requirement with body',
            '- [ ] R4. Fourth requirement with body',
            '',
            '**Out of scope.** Re-tightening the drift detector is a separate decision.',
            '',
            '**Non-goals.** No CLI surface changes.',
        ].join('\n'),
    );
    expect(findings).toHaveLength(0);
});

test('0700 R5: multi-paragraph R-item bodies still do not false-positive (0174)', async () => {
    const findings = await formatFindingsOf(
        [
            '- [ ] R1. First requirement',
            '',
            'Continuation paragraph of R1 carrying detail lines.',
            '',
            '- [ ] R2. Second requirement',
            '',
            'Second continuation paragraph.',
        ].join('\n'),
    );
    expect(findings).toHaveLength(0);
});

// ── 0700 R6: gate-language advisory reads frontmatter dependencies ──

const gateLanguageFindingsOf = async (overrides: Record<string, unknown>) => {
    // taskFm already emits the `### Background` skeleton — fill its body rather
    // than appending a duplicate section (getSection reads the first match).
    const content = taskFm({ feature_id: 'F1', status: 'backlog', name: 'Gate task', ...overrides }).replace(
        '### Background\n\ntext',
        '### Background\n\nThis step is a HITL approval merge event before the capstone.',
    );
    const { fs, path, cleanup } = seedEnv({
        taskContent: content,
        features: { F1: feature0700('F1', ['the real scenario']) },
    });
    const result = await new TaskCheckService(fs, matrix).check(path, '0001');
    cleanup();
    return result.findings.filter((f) => f.code.includes('gate-language'));
};

test('0700 R6: no advisory when the task already declares a dependency', async () => {
    const findings = await gateLanguageFindingsOf({ dependencies: ['0691'] });
    expect(findings).toHaveLength(0);
});

// ── 1112 R2: ambiguous gate tokens warn only with a gating cue in the same sentence ──

const gateLanguageFindingsForBody = async (body: string) => {
    const content = taskFm({ feature_id: 'F1', status: 'backlog', name: 'Gate task' }).replace(
        '### Background\n\ntext',
        `### Background\n\n${body}`,
    );
    const { fs, path, cleanup } = seedEnv({
        taskContent: content,
        features: { F1: feature0700('F1', ['the real scenario']) },
    });
    const result = await new TaskCheckService(fs, matrix).check(path, '0001');
    cleanup();
    return result.findings.filter((f) => f.code.includes('gate-language'));
};

test('1112 R2: composition prose without a gating cue stays silent', async () => {
    const findings = await gateLanguageFindingsForBody(
        'The review steps merged back into one step. The approved design passed.',
    );
    expect(findings).toHaveLength(0);
});

// Workflow tasks cite engine action kinds (`hitl.confirm`, `hitl.select`); a dotted identifier
// names an action, not a gate, and must not warn (feature D66 tasks 1248/1250 tripped this).
test('gate-language: dotted workflow action kinds stay silent', async () => {
    const findings = await gateLanguageFindingsForBody(
        'The `hitl.confirm` action received an empty answer. Replace kind: hitl.select with decide.',
    );
    expect(findings).toHaveLength(0);
});

// ── 0700 R2: stale non-passing Review beside PASS Testing on a closed task ──

const closedTaskWith = async (reviewBody: string, status = 'done') => {
    const content = [
        taskFm({ feature_id: 'F1', status, name: 'Closed task' }),
        '',
        '### Solution',
        '',
        'Did the thing.',
        '',
        '### Testing',
        '',
        '**Verdict: PASS** (R1–R4 MET, AC1–AC4 MET).',
        '',
        '### Review',
        '',
        reviewBody,
        REQ_SECTION_TAIL,
    ].join('\n');
    const { fs, path, cleanup } = seedEnv({
        taskContent: content,
        features: { F1: feature0700('F1', ['the real scenario']) },
    });
    const result = await new TaskCheckService(fs, matrix).check(path, '0001');
    cleanup();
    return result.findings.filter((f) => f.code.includes('review-testing-contradiction'));
};

test('0700 R2: a superseding PASS appended to the Review is authoritative — no finding', async () => {
    const findings = await closedTaskWith(
        [
            '**Verdict: PARTIAL — request-changes** (blocks gate; superseded below).',
            '',
            '**Verdict: PASS** (R1–R4 MET, AC1–AC4 MET). Supersedes the PARTIAL — request-changes above.',
        ].join('\n'),
    );
    expect(findings).toHaveLength(0);
});

test('0700 R2: the rule is gated on terminal status — a wip task is not flagged', async () => {
    const findings = await closedTaskWith('**Verdict: PARTIAL — request-changes** (blocks gate).', 'wip');
    expect(findings).toHaveLength(0);
});

describe('F21 0787: requiredSections reporting and candidate content policy', () => {
    const readyTodo = [
        '---',
        'schema_version: 1',
        'name: "Ready todo"',
        'status: todo',
        'created_at: 2026-06-13T00:00:00.000Z',
        'updated_at: 2026-06-13T00:00:00.000Z',
        '---',
        '',
        '## 0001. Ready todo',
        '',
        '### Background',
        '',
        'Context text.',
        '',
        '### Acceptance Criteria',
        '',
        'Given the check runs',
        'When all required sections exist',
        'Then requiredSections reports the full list',
        '',
        '### Design',
        '',
        'Use the existing checker service.',
        '',
        '### Plan',
        '',
        '- [ ] Step one',
    ].join('\n');

    test('requiredSections reports the FULL matrix obligation set even when nothing is missing (0787 R3)', async () => {
        const { fs, path, cleanup } = seedFile(readyTodo);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        expect(result.pass).toBe(true);
        expect(result.requiredSections).toEqual(['Background', 'Acceptance Criteria', 'Design', 'Plan']);
        expect(result.missingSections).toEqual([]);
    });

    test('missingSections reports the missing subset while requiredSections stays full (0787 R3)', async () => {
        // Drop the Plan section from an otherwise-complete todo task.
        const content = readyTodo.slice(0, readyTodo.indexOf('\n### Plan'));
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        expect(result.requiredSections).toEqual(['Background', 'Acceptance Criteria', 'Design', 'Plan']);
        expect(result.missingSections).toEqual(['Plan']);
    });

    test('checkContentPolicy passes a todo-ready candidate through the same policy (0787 R2)', async () => {
        const { fs, cleanup } = seedFile(readyTodo);
        const svc = new TaskCheckService(fs, matrix);
        cleanup();

        const { doc, findings, entry } = svc.checkContentPolicy(readyTodo, '0001', { asStatus: 'todo' });
        expect(doc).not.toBeNull();
        expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
        expect(entry?.required).toEqual(['Background', 'Acceptance Criteria', 'Design', 'Plan']);
    });

    test('checkContentPolicy flags schema-invalid frontmatter as an L1 error (0787 R2)', async () => {
        const svc = new TaskCheckService(createNodeFileSystem(), matrix);

        // Missing `name` (required by the task frontmatter schema) and no
        // sections at all — exactly the shape a malformed candidate would hit.
        const raw = [
            '---',
            'schema_version: 1',
            'status: todo',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Broken candidate',
        ].join('\n');
        const { findings } = svc.checkContentPolicy(raw, '0001', { asStatus: 'todo' });
        const l1 = findings.filter((f) => f.layer === 'L1');
        expect(l1.length).toBeGreaterThan(0);
        expect(l1.every((f) => f.severity === 'error')).toBe(true);
    });

    test('checkContentPolicy fails a placeholder-only candidate evaluated as todo (0787 R2)', async () => {
        const bare = [
            '---',
            'schema_version: 1',
            'name: "Bare candidate"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Bare candidate',
            '',
            '### Background',
            '',
            'Captured from the creation title: "Bare candidate".',
            '',
            '### Acceptance Criteria',
            '',
            '<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->',
            '',
            '### Design',
            '',
            '<!-- Document the chosen approach. -->',
            '',
            '### Plan',
            '',
            '<!-- Add an implementation checklist. -->',
        ].join('\n');
        const svc = new TaskCheckService(createNodeFileSystem(), matrix);

        const { findings } = svc.checkContentPolicy(bare, '0001', { asStatus: 'todo' });
        // Placeholder AC is a hard error when AC is required — this is exactly
        // why creation keeps such a candidate at backlog instead of todo.
        expect(findings.some((f) => f.severity === 'error')).toBe(true);
    });
});

// ── 0838: firstBlockingPrerequisite — the L4 readiness rule as a value (the strategy's injected gate) ──

describe('TaskCheckService.firstBlockingPrerequisite (0838)', () => {
    test('direct not-done prerequisite returns its wbs', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskFm({ dependencies: ['0002'] }),
            extraTasks: { '0002': taskFm({ name: 'Dep 1', status: 'wip' }) },
        });
        const svc = new TaskCheckService(fs, matrix);
        const blocked = await svc.firstBlockingPrerequisite(join(path, '..', ''), '0001');
        cleanup();
        expect(blocked).toBe('0002');
    });

    test('transitive prerequisite surfaces through the same walk (0002 done → 0003 todo)', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskFm({ dependencies: ['0002'] }),
            extraTasks: {
                '0002': taskFm({ name: 'Dep 1', status: 'done', dependencies: ['0003'] }),
                '0003': taskFm({ name: 'Dep 2', status: 'todo' }),
            },
        });
        const svc = new TaskCheckService(fs, matrix);
        const blocked = await svc.firstBlockingPrerequisite(join(path, '..', ''), '0001');
        cleanup();
        expect(blocked).toBe('0003');
    });

    test('all prerequisites done → null (dispatch-satisfied)', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskFm({ dependencies: ['0002', '0003'] }),
            extraTasks: {
                '0002': taskFm({ name: 'Dep 1', status: 'done' }),
                '0003': taskFm({ name: 'Dep 2', status: 'done' }),
            },
        });
        const svc = new TaskCheckService(fs, matrix);
        const blocked = await svc.firstBlockingPrerequisite(join(path, '..', ''), '0001');
        cleanup();
        expect(blocked).toBeNull();
    });

    test('prerequisite cycle hits the guard and returns null without hanging', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskFm({ dependencies: ['0002'] }),
            // both done, so the cycle is the ONLY anomaly on the walk
            extraTasks: { '0002': taskFm({ name: 'Dep 1', status: 'done', dependencies: ['0001'] }) },
        });
        const svc = new TaskCheckService(fs, matrix);
        const blocked = await svc.firstBlockingPrerequisite(join(path, '..', ''), '0001');
        cleanup();
        expect(blocked).toBeNull();
    });

    test('no declared dependencies → null', async () => {
        const { fs, path, cleanup } = seedEnv({ taskContent: taskFm() });
        const svc = new TaskCheckService(fs, matrix);
        const blocked = await svc.firstBlockingPrerequisite(join(path, '..', ''), '0001');
        cleanup();
        expect(blocked).toBeNull();
    });
});

// 2026-10-12: WBS allocation is per-tree, so two worktrees cut from one base both mint the same
// number and the collision appears only at integration (two `1183` files reached a real merge in
// this repo).`task check` in corpus mode already reported duplicates (0416 R6), but the per-task
// path every pipeline guard runs did not — this closes that gap with the same locator scan.
describe('L1.wbs-collision (2026-10-12)', () => {
    test('a WBS claimed by two files is an error naming both files', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '1183',
            taskContent: `${taskFm()}\n## Background\n\nfirst\n`,
            extraTasks: { '1183': `${taskFm({ name: 'Rival' })}\n## Background\n\nsecond\n` },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '1183');
        cleanup();
        const collisions = result.findings.filter((f) => f.code === FINDING_CODES.L1_WBS_COLLISION);
        expect(collisions).toHaveLength(1);
        expect(collisions[0]?.severity).toBe('error');
        expect(collisions[0]?.message).toContain('claimed by 2 task files');
        expect(collisions[0]?.message).toContain('1183_task.md');
        expect(collisions[0]?.message).toContain('1183_extra.md');
        expect(collisions[0]?.message).toContain('spur task create');
        expect(result.pass).toBe(false);
    });

    test('a unique WBS raises nothing', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '1185',
            taskContent: `${taskFm()}\n## Background\n\nonly\n`,
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '1185');
        cleanup();
        expect(result.findings.some((f) => f.code === FINDING_CODES.L1_WBS_COLLISION)).toBe(false);
    });
});
