import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { FINDING_CODES } from '../../src/services/finding-codes';
import {
    citedLinesNameSubject,
    classifyExternalEvidence,
    extractReviewSectionBody,
    extractSubjectTokens,
    hasPopulatedPriorityTable,
    TaskCheckService,
} from '../../src/services/task-check';
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
            'status: done',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Review test',
            '',
            '### Solution',
            '',
            'Fixed `src/foo.ts:10-15` — added validation.',
            '',
            '### Testing',
            '',
            'Coverage: 95%.',
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
    test('L3: Review with empty-cell P-table scaffold does not satisfy the rule (hardening)', async () => {
        // The shipped review template scaffolds an empty-cell P-table. A bare /P[1-4]/
        // match would falsely accept it; the hardened rule treats it as a placeholder so
        // a review task can't reach a Review-required status with an empty findings table.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Empty scaffold"',
            'status: done',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Empty scaffold',
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
            'Post-implementation reflection — to be filled after the first fix round.',
            '',
            '| Severity | File | Finding | Recommendation |',
            '| -------- | ---- | ------- | -------------- |',
            '| P1       |      |         |                |',
            '| P2       |      |         |                |',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reviewErrors = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Review');
        expect(reviewErrors.length).toBeGreaterThan(0);
        expect(reviewErrors[0]?.severity).toBe('error');
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
    test('L3: dash-filled P-table placeholder does not satisfy the rule where Review is required (0297)', async () => {
        // A `| P1 | — | — | — |` row is a placeholder, not a finding. The pre-0297
        // rule counted any non-empty cell as content, so an all-dash table passed the
        // done-gate's Review L3 layer — empirically how task 0296 reached `done` with
        // an unauthored Review. Dash/`n/a`-only cells must count as empty.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Dash placeholder"',
            'status: done',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Dash placeholder',
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
            '| P2 | — | — | — |',
            '| P3 | n/a | - | N/A |',
            '| P4 | — | — | — |',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reviewErrors = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Review');
        expect(reviewErrors.length).toBeGreaterThan(0);
        expect(reviewErrors[0]?.severity).toBe('error');
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
    test('L3: prose-only ### Review (no table) at required status still errors (guard)', async () => {
        // WHY: the tolerance for prose-only Review must NOT extend to statuses where
        // Review is *required* (wip+). A prose body with no findings table must still
        // trigger the L3 error once Review is mandatory — otherwise a review task
        // could reach done with no findings table at all.
        const reviewMatrix = {
            variants: {
                review: {
                    wip: { required: ['Background', 'Review'] },
                },
            },
        };
        const content = [
            '---',
            'schema_version: 1',
            'name: "Prose-only at wip"',
            'status: wip',
            'template: review',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Prose-only at wip',
            '',
            '### Background',
            '',
            'Context.',
            '',
            '### Review',
            '',
            'Post-implementation reflection — all findings were stale so I wrote prose.',
        ].join('\n');

        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, reviewMatrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reviewErrors = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Review' && f.severity === 'error',
        );
        expect(reviewErrors.length).toBeGreaterThan(0); // prose-only at required status must error
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
    test('L3: Requirements without R-numbering warns', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Req test"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Req test',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Requirements',
            '',
            'The system shall do X.',
            'The system shall do Y.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const reqWarnings = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Requirements' && f.severity === 'warning',
        );
        expect(reqWarnings.length).toBeGreaterThan(0);
        expect(reqWarnings[0]?.message).toContain('R-numbered');
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

    test('L3: a real Solution body without a file:line citation still errors', async () => {
        // WHY: once Solution carries actual prose it must cite where the change is —
        // the placeholder skip must not weaken the rule for authored content.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Uncited sol"',
            'status: wip',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Uncited sol',
            '',
            '### Solution',
            '',
            'Refactored the parser to handle the new case.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        const solErrors = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Solution' && f.severity === 'error',
        );
        expect(solErrors.length).toBeGreaterThan(0);
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

    test('L3: Solution table with file path but NO adjacent line column still errors', async () => {
        // WHY: the table-format detection must not false-positive on a file column
        // whose adjacent column is NOT a line number — only genuine file+line pairs count.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Table no line"',
            'status: done',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Table no line',
            '',
            '### Solution',
            '',
            '| File | Description |',
            '| ---- | ----------- |',
            '| src/foo.ts | added validation |',
            '',
            '### Testing',
            '',
            'Coverage: 95%.',
            '',
            '### Review',
            '',
            '| Severity | File | Finding | Recommendation |',
            '| -------- | ---- | ------- | -------------- |',
            '| P2 | src/foo.ts | fixed | — |',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();
        const solErrors = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Solution' && f.severity === 'error',
        );
        expect(solErrors.length).toBeGreaterThan(0);
    });

    test('L3: Testing without coverage claim warns', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Test no cov"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Test no cov',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Testing',
            '',
            'We ran the tests and they passed.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const testWarnings = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Testing' && f.severity === 'warning',
        );
        expect(testWarnings.length).toBeGreaterThan(0);
        expect(testWarnings[0]?.message).toContain('coverage');
    });

    test('L3: Testing with N/A coverage produces no warning', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Test na"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Test na',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Testing',
            '',
            'N/A',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const testWarnings = result.findings.filter((f) => f.layer === 'L3' && f.section === 'Testing');
        expect(testWarnings).toHaveLength(0);
    });

    test('L3: Plan as free-form prose warns', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Plan prose"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Plan prose',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Plan',
            '',
            'First we will do X. Then we will do Y. Finally we will do Z.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const planWarnings = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Plan' && f.severity === 'warning',
        );
        expect(planWarnings.length).toBeGreaterThan(0);
        expect(planWarnings[0]?.message).toContain('checklist');
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

    test('L3: Plan as free-form prose still warns after permissive fix (guard against over-matching)', async () => {
        // WHY: the multiline fix must not suppress warnings for genuinely free-form prose Plans.
        // Pure paragraph text with no list markers must still trigger the L3 warning.
        const content = [
            '---',
            'schema_version: 1',
            'name: "Plan prose guard"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Plan prose guard',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Plan',
            '',
            '**Phase A — Setup:**',
            'First we install the dependencies. Then we configure the environment.',
            '',
            '**Phase B — Implementation:**',
            'We write the fix and add a regression test.',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const svc = new TaskCheckService(fs, matrix);
        const result = await svc.check(path, '0001');
        cleanup();

        const planWarnings = result.findings.filter(
            (f) => f.layer === 'L3' && f.section === 'Plan' && f.severity === 'warning',
        );
        expect(planWarnings.length).toBeGreaterThan(0);
        expect(planWarnings[0]?.message).toContain('checklist');
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

    test('readiness: prose dependency must be mirrored in frontmatter dependencies', async () => {
        const content = [
            taskFm({ feature_id: 'F1' }),
            '',
            '### Requirements',
            '',
            'R1. This task depends on 0002 before implementation.',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': taskFm({ feature_id: 'F1', name: 'Dep 1', status: 'done' }) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const prose = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('not mirrored'));
        expect(prose).toHaveLength(1);
        expect(prose[0]?.section).toBe('Requirements');
    });

    // ── Frozen prose-prerequisite rule (task 0475): precision without recall loss ──

    test('readiness: incidental keyword across a sentence boundary infers no edge (R1)', async () => {
        // The exact task-0474 shape: a downstream WBS precedes an incidental 'after'
        // across a period. It asserts nothing about task order and must not be an edge.
        const content = [
            taskFm({ feature_id: 'F1' }),
            '',
            '### Design',
            '',
            '0469 renders and must never open the DB. Any shape change after this lands is a schemaVersion.',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const prose = result.findings.filter(
            (f) => f.layer === 'L4' && f.code === FINDING_CODES.L4_PROSE_PREREQUISITE_UNLISTED,
        );
        expect(prose).toHaveLength(0);
    });

    test('readiness: the "tasks X and Y" list form infers every named prerequisite (R1)', async () => {
        const content = [
            taskFm({ feature_id: 'F1' }),
            '',
            '### Requirements',
            '',
            'This task Depends on tasks 0465 and 0474 for the data plane.',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const msgs = result.findings
            .filter((f) => f.layer === 'L4' && f.code === FINDING_CODES.L4_PROSE_PREREQUISITE_UNLISTED)
            .map((f) => f.message);
        expect(msgs.some((m) => m.includes('0465'))).toBe(true);
        expect(msgs.some((m) => m.includes('0474'))).toBe(true);
    });

    test('readiness: a WBS inside a fenced code block infers no edge (R2)', async () => {
        const content = [
            taskFm({ feature_id: 'F1' }),
            '',
            '### Design',
            '',
            'Example finding output:',
            '',
            '```',
            'Prose prerequisite 0466 is not mirrored in frontmatter dependencies[]',
            'This depends on 0470 inside the block.',
            '```',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const prose = result.findings.filter(
            (f) => f.layer === 'L4' && f.code === FINDING_CODES.L4_PROSE_PREREQUISITE_UNLISTED,
        );
        expect(prose).toHaveLength(0);
    });

    test('readiness: a WBS in a markdown table row infers no edge (R2)', async () => {
        const content = [
            taskFm({ feature_id: 'F1' }),
            '',
            '### Design',
            '',
            '| dep | note |',
            '| --- | --- |',
            '| 0474 | wrong claim: depends on 0466 |',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const prose = result.findings.filter(
            (f) => f.layer === 'L4' && f.code === FINDING_CODES.L4_PROSE_PREREQUISITE_UNLISTED,
        );
        expect(prose).toHaveLength(0);
    });

    test('readiness: a WBS in an inline code span infers no edge (R2)', async () => {
        const content = [
            taskFm({ feature_id: 'F1' }),
            '',
            '### Design',
            '',
            'The test covers `depends on 0466` as a backtick example.',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const prose = result.findings.filter(
            (f) => f.layer === 'L4' && f.code === FINDING_CODES.L4_PROSE_PREREQUISITE_UNLISTED,
        );
        expect(prose).toHaveLength(0);
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

    test('readiness: gate language is surfaced as a prerequisite advisory', async () => {
        const content = [
            taskFm({ feature_id: 'F1' }),
            '',
            '### Design',
            '',
            'GATED on operator approval after the design doc is reviewed.',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: content,
            features: { F1: featureFm('F1', 'active') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();

        const gate = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('gate language'));
        expect(gate).toHaveLength(1);
        expect(gate[0]?.section).toBe('Design');
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

    test('R1: task scenario NOT in the feature AC warns (subset rule, DD-09)', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAc('F1', ['rogue scenario']),
            features: { F1: featureWithAc('F1', ['the real scenario']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const cov = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('subset rule'));
        expect(cov).toHaveLength(1);
        expect(cov[0]?.severity).toBe('warning'); // default warning (C04)
    });

    test('R1: task scenario covered by the feature AC produces no coverage warning', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAc('F1', ['shared scenario']),
            features: { F1: featureWithAc('F1', ['shared scenario', 'another']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        expect(result.findings.filter((f) => f.message.includes('subset rule'))).toHaveLength(0);
    });

    test('R1: partial coverage — only the uncovered task scenario warns, not the covered one', async () => {
        const { fs, path, cleanup } = seedEnv({
            // Task has two scenarios; "alpha" matches the feature, "zeta" does not.
            taskContent: taskWithAc('F1', ['alpha', 'zeta']),
            features: { F1: featureWithAc('F1', ['alpha', 'omega']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const cov = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('subset rule'));
        expect(cov).toHaveLength(1); // exactly one — the covered "alpha" is NOT flagged
        expect(cov[0]?.message).toContain('"zeta"');
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

    test('R1: checklist item with no matching feature scenario warns (subset rule)', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithChecklist('F1', ['something the feature never specified']),
            features: { F1: featureWithAc('F1', ['the only real scenario']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const cov = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('subset rule'));
        expect(cov.length).toBeGreaterThan(0);
        expect(cov.every((f) => f.severity === 'warning')).toBe(true);
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

    test('R2: non-map tag does NOT skip DD-09 — only wayfinder-map is exempt', async () => {
        // A different tag should not suppress the subset check.
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAc('F1', ['rogue scenario']),
            features: { F1: featureWithAcAndTag('F1', ['the real scenario'], 'some-other-tag') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const cov = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('subset rule'));
        expect(cov).toHaveLength(1);
    });

    test('R2: untagged feature with scenarios still applies DD-09 (no regression)', async () => {
        // Baseline behavior unchanged for non-map features.
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAc('F1', ['rogue scenario']),
            features: { F1: featureWithAc('F1', ['the real scenario']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const cov = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('subset rule'));
        expect(cov).toHaveLength(1);
    });
    test('R1: only DD-09 is skipped — map-parented task still reports unrelated defects', async () => {
        // A map-parented task that also has a Requirements section with non-R-numbered
        // items should still get the L3 format finding. Only the DD-09 comparison is
        // suppressed for map parents; every other layer stays live.
        const taskWithDefect = [
            '---',
            'schema_version: 1',
            'name: "Defective task"',
            'status: backlog',
            'feature_id: F1',
            'created_at: 2026-06-13T00:00:00Z',
            'updated_at: 2026-06-13T00:00:00Z',
            '---',
            '',
            '## 0001. Defective task',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Requirements',
            '',
            'some unnumbered requirement without the R-prefix',
            'another line that also lacks the pattern',
            '',
            '### Acceptance Criteria',
            '',
            '```gherkin',
            'Feature: T',
            '  Scenario: rogue scenario',
            '    Given x',
            '```',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithDefect,
            features: { F1: featureWithAcAndTag('F1', ['the real scenario'], 'wayfinder-map') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        // DD-09 is suppressed (map parent) ...
        expect(result.findings.filter((f) => f.message.includes('subset rule'))).toHaveLength(0);
        // ... but the L3 format defect is still reported.
        const formatFindings = result.findings.filter(
            (f) => f.code.includes('requirements-format') || f.code.includes('REQUIREMENTS_FORMAT'),
        );
        expect(formatFindings.length).toBeGreaterThanOrEqual(1);
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

    test('R4/R5: a graduating task with drifted titles still reports (field, not notation)', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAltitude('graduating', 'Drifted title that matches nothing'),
            features: { F1: featureWithAc('F1', ['the real scenario']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const cov = result.findings.filter((f) => f.message.includes('subset rule'));
        expect(cov).toHaveLength(1);
        expect(cov[0]?.message).toContain('Drifted title that matches nothing');
    });

    test('R3: absent altitude keeps legacy behavior — subset rule still enforced', async () => {
        const { fs, path, cleanup } = seedEnv({
            taskContent: taskWithAltitude(undefined, 'rogue scenario'),
            features: { F1: featureWithAc('F1', ['the real scenario']) },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const cov = result.findings.filter((f) => f.message.includes('subset rule'));
        expect(cov).toHaveLength(1);
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

    test('roll-up: parent done while a child is open warns (drift down)', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: parentBody({ wbs: '0001', status: 'done', withRoster: true }),
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': childBody('0001', 'wip') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const drift = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.message.includes('still open'),
        );
        expect(drift.length).toBeGreaterThan(0);
        expect(drift[0]?.message).toContain('0002');
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

    test('roll-up: parent with children but no roster table warns (R2 — the 0109 gap)', async () => {
        const { fs, path, cleanup } = seedEnv({
            wbs: '0001',
            taskContent: parentBody({ wbs: '0001', status: 'wip', withRoster: false }),
            features: { F1: featureFm('F1', 'active') },
            extraTasks: { '0002': childBody('0001', 'wip') },
        });
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const roster = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.message.includes('roster'),
        );
        expect(roster.length).toBeGreaterThan(0);
        expect(roster[0]?.section).toBe('Plan');
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
        const roster = result.findings.filter((f) => f.layer === 'L4' && f.message.includes('roster'));
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

    test('terminal-status boxes: a done task with an unchecked box triggers the warning', async () => {
        const content = [
            taskFm({ status: 'done', name: 'Closed task' }),
            '',
            '### Plan',
            '',
            '- [x] Step one',
            '- [ ] Step two',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const boxes = result.findings.filter(
            (f) => f.layer === 'L3' && f.severity === 'warning' && f.message.includes('unchecked checklist box'),
        );
        expect(boxes).toHaveLength(1);
        expect(boxes[0]?.message).toContain('done');
        expect(boxes[0]?.message).toContain('1 unchecked');
    });

    test('terminal-status boxes: a cancelled task with an unchecked box triggers the warning', async () => {
        const content = [
            taskFm({ status: 'cancelled', name: 'Cancelled task' }),
            '',
            '### Plan',
            '',
            '- [ ] Step one',
            '- [ ] Step two',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const boxes = result.findings.filter(
            (f) => f.layer === 'L3' && f.severity === 'warning' && f.message.includes('unchecked checklist box'),
        );
        expect(boxes).toHaveLength(1);
        expect(boxes[0]?.message).toContain('cancelled');
        expect(boxes[0]?.message).toContain('2 unchecked');
    });

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

    test('R4: placeholder Design at wip warns (empty body)', async () => {
        // WHY: a wip task must have a real Design record before implementation.
        // An empty Design heading means the operator started coding without
        // an agreed approach — exactly the signal this check exists to surface.
        const content = [taskFm({ status: 'wip', name: 'Empty design at wip' }), '', '### Design', '', ''].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const designWarnings = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.section === 'Design',
        );
        expect(designWarnings).toHaveLength(1);
        expect(designWarnings[0]?.message).toContain('present but empty');
    });

    test('R4: placeholder Design at todo warns (HTML comment + TBD only)', async () => {
        // WHY: the scaffolded Design section typically ships with HTML guidance
        // comments and a `> TBD` marker. Those must NOT count as filled —
        // stripping them is what `isPlaceholderBody` does.
        const content = [
            taskFm({ status: 'todo', name: 'TBD design' }),
            '',
            '### Design',
            '',
            '<!-- Describe the approach: interfaces, data flow, tradeoffs -->',
            '> TBD',
        ].join('\n');
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const designWarnings = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.section === 'Design',
        );
        expect(designWarnings).toHaveLength(1);
    });

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

    test('R4: placeholder Design at testing still warns after Design becomes optional', async () => {
        // WHY: advancing status must not make a hollow standard-task Design
        // record disappear from the audit. The warning is template-scoped, not
        // coupled to the current status entry's required-section list.
        const content = [taskFm({ status: 'testing', name: 'Testing empty design' }), '', '### Design', '', ''].join(
            '\n',
        );
        const { fs, path, cleanup } = seedFile(content);
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const designWarnings = result.findings.filter(
            (f) => f.layer === 'L4' && f.severity === 'warning' && f.section === 'Design',
        );
        expect(designWarnings).toHaveLength(1);
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

        test('R3: placeholder-only Requirements emits L3_REQUIREMENTS_EMPTY (fails gate)', async () => {
            // WHY: task 0337 had only template placeholder comments in Requirements
            // and still passed. A task with no requirements is unverifiable by
            // construction — the gate must fail it.
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
            expect(emptyReq.length).toBe(1);
            expect(emptyReq[0]?.severity).toBe('error');
            expect(result.pass).toBe(false);
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

        test('warns naming each requirement that has no scenario', async () => {
            const findings = await coverageFindings(
                taskWith(['- [ ] R1. Does X.', '- [ ] R2. Does Y.', '- [ ] R3. Does Z.'], scenario('R1 — X happens')),
            );
            expect(findings).toHaveLength(1);
            expect(findings[0]?.message).toContain('R2, R3');
        });

        test('warns when a scenario cites a requirement that does not exist', async () => {
            const findings = await coverageFindings(
                taskWith(['- [ ] R1. Does X.'], [...scenario('R1 — X happens'), ...scenario('R7 — superseded')]),
            );
            expect(findings).toHaveLength(1);
            expect(findings[0]?.message).toContain('R7');
            expect(findings[0]?.message).toContain('stale');
        });

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

        test('warns when opted in but no scenario is R-numbered', async () => {
            const findings = await coverageFindings(taskWith(['- [ ] R1. Does X.'], scenario('X happens')));
            expect(findings).toHaveLength(1);
            expect(findings[0]?.message).toContain('no scenario is R-numbered');
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

    describe('R1 (0479): L4_MALFORMED_VERDICT_ARTIFACT check', () => {
        test('emits L4_MALFORMED_VERDICT_ARTIFACT when status is testing and verdict artifact has empty requirements and AC', async () => {
            const { fs, path, cleanup } = seedEnv({
                wbs: '0479',
                taskContent:
                    taskFm({ status: 'testing', template: 'standard' }) +
                    '\n\n## Solution\n`file:1`\n\n## Testing\n`file:1`\n',
            });
            try {
                // Write empty verdict artifact in .spur/run/0479-verdict.json
                const { dirname: pathDirname } = require('node:path');
                const runDir = join(pathDirname(pathDirname(path)), '.spur', 'run');
                const { mkdirSync, writeFileSync } = require('node:fs');
                mkdirSync(runDir, { recursive: true });
                writeFileSync(
                    join(runDir, '0479-verdict.json'),
                    JSON.stringify({ wbs: '0479', verdict: 'UNKNOWN', requirements: [], acceptanceCriteria: [] }),
                );

                const tasksDir = pathDirname(path);
                const svc = new TaskCheckService(
                    fs,
                    matrix,
                    new TaskLocator({ fs, tasksDir, foldersConfig: { active_folder: tasksDir, folders: {} } as never }),
                );
                const res = await svc.check(path, '0479');
                const malformed = res.findings.filter((f) => f.code === FINDING_CODES.L4_MALFORMED_VERDICT_ARTIFACT);
                expect(malformed.length).toBeGreaterThan(0);
                expect(malformed[0]?.message).toContain('verdict is UNKNOWN');
            } finally {
                cleanup();
            }
        });
    });
});

describe('R7 (0487): Review gate robustness', () => {
    test('a prose severity cell (`P1 (blocker)`) counts as a populated findings row', () => {
        const body = ['| Sev | File | Finding |', '| --- | --- | --- |', '| P1 (blocker) | a.ts:1 | leaks |'].join(
            '\n',
        );
        expect(hasPopulatedPriorityTable(body)).toBe(true);
    });

    test('the empty scaffold table is still rejected, prose severity or not', () => {
        const body = ['| Sev | File | Finding |', '| --- | --- | --- |', '| P1 (blocker) | | |'].join('\n');
        expect(hasPopulatedPriorityTable(body)).toBe(false);
    });

    test('a severity-like label beyond P4 is not a findings row', () => {
        const body = '| P12 | a.ts:1 | not a severity |';
        expect(hasPopulatedPriorityTable(body)).toBe(false);
    });

    test('a Review body containing an uppercase Z is not truncated', () => {
        const markdown = ['### Review', '', 'Zero blockers found.', '', '### References', '', 'x', ''].join('\n');
        const body = extractReviewSectionBody(markdown);
        expect(body).toContain('Zero blockers found.');
        expect(body).not.toContain('### References');
    });

    test('a Review section that is the last section still matches', () => {
        const markdown = ['### Design', '', 'd', '', '### Review', '', '| P2 | a.ts:1 | nit |', ''].join('\n');
        const body = extractReviewSectionBody(markdown);
        expect(body).not.toBeNull();
        expect(hasPopulatedPriorityTable(body ?? '')).toBe(true);
    });

    test('an absent Review section still returns null', () => {
        expect(extractReviewSectionBody('### Design\n\nd\n')).toBeNull();
    });
});

describe('subject-token exclusion (0583 R5 verify)', () => {
    const cite = 'packages/app/src/services/project-registry.ts:357-378';
    const cited = 'let sawInUse = false;\nlet probedAny = false;\nconst probe = await probePort(port);';

    // Regression: the extractor fed the citation itself and the verdict-table status
    // word in as "subject" tokens. Neither can ever appear in cited source, so a
    // minimal, correct evidence row reported every time — 262 of the corpus's
    // anchor-subject warnings were this shape.
    test('a minimal correct evidence row does not report', () => {
        const tokens = extractSubjectTokens(`| R1 | MET | \`${cite}\` |`, cite);
        expect(tokens).not.toContain(cite.toLowerCase());
        expect(tokens).not.toContain('met');
        expect(citedLinesNameSubject(tokens, cited)).toBe(true);
    });

    test('a row naming an identifier present in the cited lines does not report', () => {
        const row = `| R1 | MET | \`${cite}\` (\`probedAny\` separates denied from exhaustion) |`;
        expect(citedLinesNameSubject(extractSubjectTokens(row, cite), cited)).toBe(true);
    });

    // The rule must stay sharp: a real subject that is absent still reports.
    test('a row naming an identifier absent from the cited lines still reports', () => {
        const row = `| R1 | MET | \`${cite}\` (\`renderForensics\` builds the report) |`;
        expect(citedLinesNameSubject(extractSubjectTokens(row, cite), cited)).toBe(false);
    });
});

describe('classifyExternalEvidence — frozen external form (0584 R1/R2)', () => {
    test('R1: recognizes a named origin + backticked path + line number outside the backticks', () => {
        const body = 'Evidence: @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 481 — omp call_id write';
        const cites = classifyExternalEvidence(body);
        expect(cites).toHaveLength(1);
        expect(cites[0]).toMatchObject({
            origin: '@gobing-ai/ts-llm-jsonl-importer',
            path: 'src/mappers.ts',
            startLine: 481,
        });
    });

    test('R1: accepts a line range and plural line wording', () => {
        const body = 'See @some-org/lib `src/mappers.ts` lines 481-483 — float path';
        const cites = classifyExternalEvidence(body);
        expect(cites).toHaveLength(1);
        expect(cites[0]?.path).toBe('src/mappers.ts');
        expect(cites[0]?.startLine).toBe(481);
        expect(cites[0]?.endLine).toBe(483);
    });

    test('R1: a repo-root backtick anchor (line inside backticks) is NOT external evidence', () => {
        const body = 'Verified: `packages/app/src/services/task-check.ts:207` still matches';
        expect(classifyExternalEvidence(body)).toHaveLength(0);
    });

    test('R1: prose line numbers without a named-origin are not classified', () => {
        // Same shape as 0494/0493 corpus prose — a path and line number in the
        // same sentence but NOT the frozen form; must stay invisible (no new
        // baseline debt).
        const body =
            'Anchors re-read at their cited lines: `plugins/sp/skills/next-router/references/routing-table.md` line 32 now sits at line 33';
        const cites = classifyExternalEvidence(body);
        // The frozen form requires the line number OUTSIDE backticks AND a named
        // origin directly before the path — bare path-cell prose has neither
        // structure guaranteed, and extracting an origin from free prose is
        // exactly the re-interpretation 0583 must not do. The classifier is
        // deliberately the classification, not a parser: any backtick+line
        // adjacency that came from prose should not be promoted to external.
        expect(cites).toHaveLength(0);
    });

    test('R2: an in-repo path cited in external form is flagged by checkLineAnchors', async () => {
        // The frozen form names an in-repo file with the line outside backticks.
        // R2: it is in-repo evidence and must use a repo-relative anchor, so the
        // checker still reports it (recognized as external-form → reclassified).
        const content = [
            '---',
            'schema_version: 1',
            'name: "Ext task"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Ext task',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Solution',
            '',
            'Evidence: @local/repo `README.md` line 3 — advisory, in-repo path in external form',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({ taskContent: content });
        // The repo root resolves one level up from tasksDir; seed README.md there.
        const root = join(path, '..', '..');
        const { writeFileSync: w } = await import('node:fs');
        w(join(root, 'README.md'), 'a\nb\nc\n');
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const stale = result.findings.filter((f) => f.code === FINDING_CODES.L4_STALE_LINE_ANCHOR);
        expect(stale.length).toBeGreaterThanOrEqual(1);
        expect(stale[0]?.message).toContain('R2');
    });

    // Regression (0584 R2 verify): the in-repo test was a single boolean over the whole
    // set, so ONE resolvable basename flagged EVERY external citation in the section —
    // each with a message naming its own path as in-repo, false for all but one.
    test('R2: only the citation that resolves in-repo is flagged, not its external siblings', async () => {
        const content = [
            '---',
            'schema_version: 1',
            'name: "Mixed ext task"',
            'status: backlog',
            'created_at: 2026-06-13T00:00:00.000Z',
            'updated_at: 2026-06-13T00:00:00.000Z',
            '---',
            '',
            '## 0001. Mixed ext task',
            '',
            '### Background',
            '',
            'text',
            '',
            '### Solution',
            '',
            'Evidence: @local/repo `README.md` line 3 — in-repo, must be repo-relative',
            '',
            'Evidence: @gobing-ai/ts-llm-jsonl-importer `src/never-in-this-repo.ts` line 481 — genuinely external',
        ].join('\n');
        const { fs, path, cleanup } = seedEnv({ taskContent: content });
        const root = join(path, '..', '..');
        const { writeFileSync: w } = await import('node:fs');
        w(join(root, 'README.md'), 'a\nb\nc\n');
        const result = await new TaskCheckService(fs, matrix).check(path, '0001');
        cleanup();
        const stale = result.findings.filter((f) => f.code === FINDING_CODES.L4_STALE_LINE_ANCHOR);
        expect(stale).toHaveLength(1);
        expect(stale[0]?.message).toContain('README.md');
        expect(stale[0]?.message).not.toContain('never-in-this-repo.ts');
    });
});

describe('accepted baseline debt in TaskCheckService.check (0586 R1, R2, R5)', () => {
    const brokenTask = [
        '---',
        'schema_version: 1',
        'name: "Anchor mismatch task"',
        'status: done',
        'created_at: 2026-06-13T00:00:00.000Z',
        'updated_at: 2026-06-13T00:00:00.000Z',
        '---',
        '',
        '## 0121. Anchor mismatch task',
        '',
        '### Background',
        'text',
        '',
        '### Solution',
        '| R1 | MET | `testfile.ts:1-3` (`renderForensics` builds the report) |',
        '',
        '### Testing',
        'Tested in tests/unit.test.ts',
        '',
        '### Review',
        '| P1 | path | finding | fix |',
        '| P2 | foo.ts | issue | done |',
    ].join('\n');

    function seedMismatchEnv() {
        const env = seedFile(brokenTask);
        const root = join(env.path, '..', '..');
        writeFileSync(join(root, 'testfile.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
        return env;
    }

    test('R1: baselined finding at matching error severity is dropped and passes check', async () => {
        const { fs, path, cleanup } = seedMismatchEnv();
        const svc = new TaskCheckService(fs, matrix);

        // When severity override treats anchor mismatch as error
        const severityOverrides = { [FINDING_CODES.L4_ANCHOR_SUBJECT_MISMATCH]: 'error' as const };
        const accepted = new Map([['task:0121:L4.anchor-subject-mismatch', 'error' as const]]);

        const result = await svc.check(path, '0121', { severityOverrides, accepted });
        cleanup();

        const mismatchFindings = result.findings.filter((f) => f.code === FINDING_CODES.L4_ANCHOR_SUBJECT_MISMATCH);
        expect(mismatchFindings).toHaveLength(0);
        expect(result.pass).toBe(true);
    });

    test('R2: baseline entry at warning does NOT cover an error finding', async () => {
        const { fs, path, cleanup } = seedMismatchEnv();
        const svc = new TaskCheckService(fs, matrix);

        // Finding is error, but baseline entry is warning
        const severityOverrides = { [FINDING_CODES.L4_ANCHOR_SUBJECT_MISMATCH]: 'error' as const };
        const accepted = new Map([['task:0121:L4.anchor-subject-mismatch', 'warning' as const]]);

        const result = await svc.check(path, '0121', { severityOverrides, accepted });
        cleanup();

        const mismatchFindings = result.findings.filter((f) => f.code === FINDING_CODES.L4_ANCHOR_SUBJECT_MISMATCH);
        expect(mismatchFindings).toHaveLength(1);
        expect(mismatchFindings[0]?.severity).toBe('error');
        expect(result.pass).toBe(false);
    });

    test('R2: under strict mode, finding elevated to error is not covered by warning baseline', async () => {
        const { fs, path, cleanup } = seedMismatchEnv();
        const svc = new TaskCheckService(fs, matrix);

        // Finding is warning by default, but strict: true elevates to error
        const accepted = new Map([['task:0121:L4.anchor-subject-mismatch', 'warning' as const]]);

        const result = await svc.check(path, '0121', { strict: true, accepted });
        cleanup();

        const mismatchFindings = result.findings.filter((f) => f.code === FINDING_CODES.L4_ANCHOR_SUBJECT_MISMATCH);
        expect(mismatchFindings.length).toBeGreaterThanOrEqual(1);
        expect(mismatchFindings.some((f) => f.severity === 'error')).toBe(true);
        expect(result.pass).toBe(false);
    });

    test('R5: unbaselined mismatch fails the check', async () => {
        const { fs, path, cleanup } = seedMismatchEnv();
        const svc = new TaskCheckService(fs, matrix);

        const severityOverrides = { [FINDING_CODES.L4_ANCHOR_SUBJECT_MISMATCH]: 'error' as const };
        // Empty acceptance map
        const accepted = new Map<string, 'error' | 'warning'>();

        const result = await svc.check(path, '0121', { severityOverrides, accepted });
        cleanup();

        const mismatchFindings = result.findings.filter((f) => f.code === FINDING_CODES.L4_ANCHOR_SUBJECT_MISMATCH);
        expect(mismatchFindings).toHaveLength(1);
        expect(result.pass).toBe(false);
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

        const { fs, path, cleanup } = seedFile(testingTaskMissingReview);
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
