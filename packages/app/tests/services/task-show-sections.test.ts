import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { SectionMatrix } from '../../src/services/planning-check-base';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import { TaskService } from '../../src/services/task-service';

/**
 * Canonical-standard section matrix mirroring task-service.test.ts (create needs
 * the matrix; the read verbs under test do not, batch-create does).
 */
const TEST_SECTION_MATRIX: SectionMatrix = {
    variants: {
        standard: {
            backlog: {
                required: ['Background'],
                optional: [
                    'Requirements',
                    'Acceptance Criteria',
                    'Q&A',
                    'Design',
                    'Plan',
                    'Solution',
                    'Testing',
                    'Review',
                ],
            },
            todo: {
                required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'],
                optional: ['Q&A', 'Requirements', 'Solution', 'Testing', 'Review'],
            },
        },
        'feature-impl': {
            backlog: {
                required: ['Background'],
                optional: [
                    'Requirements',
                    'Acceptance Criteria',
                    'Q&A',
                    'Design',
                    'Plan',
                    'Solution',
                    'Testing',
                    'Review',
                ],
            },
            todo: {
                required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'],
                optional: ['Q&A', 'Requirements', 'Solution', 'Testing', 'Review'],
            },
        },
    },
};

/** 1325 P1/P2 fixtures — a task file whose sections carry known, non-trivial bodies. */
const FIXTURE_TASK = [
    '---',
    'schema_version: 1',
    'name: "Sectioned fixture"',
    'status: todo',
    '---',
    '',
    '## 1325. Sectioned fixture',
    '',
    '### Background',
    '',
    'Ünicode body ✓ with multi-byte characters.',
    '',
    '### Plan',
    '',
    '- [ ] P1. First step',
    '- [ ] P2. Second step',
    '',
    '### History',
    '',
    '- 2026-11-10 backlog → todo',
    '',
].join('\n');

let tasksDir: string;
let svc: TaskService;
let fixturePath: string;
let fixtureRaw: string;

beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-task-show-sections-'));
    tasksDir = join(root, 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    const fs = createNodeFileSystem(root);
    const writeService = new PlanningWriteService({ fs });
    svc = new TaskService({ fs, tasksDir, writeService, sectionMatrix: TEST_SECTION_MATRIX });
    fixturePath = join(tasksDir, '1325_sectioned-fixture.md');
    writeFileSync(fixturePath, FIXTURE_TASK, 'utf-8');
    fixtureRaw = FIXTURE_TASK;
});

afterAll(() => {
    rmSync(tasksDir.replace('/tasks', ''), { recursive: true, force: true });
});

/** The byte-exact slice a section occupies in the raw file, computed independently of the service. */
function rawSectionSlice(name: string): string {
    const heading = `### ${name}`;
    const start = fixtureRaw.indexOf(heading);
    if (start === -1) throw new Error(`fixture has no section ${name}`);
    // findHeadings' section extent runs to the next heading's LINE START, so the
    // slice includes the newline that precedes the next `### `.
    const next = fixtureRaw.slice(start + 1).indexOf('\n### ');
    const end = next === -1 ? fixtureRaw.length : start + 1 + next + 1;
    return fixtureRaw.slice(start, end);
}

describe('TaskService showSections / showSummary (1325)', () => {
    test('showSections returns byte-identical section content (AC1)', async () => {
        const result = await svc.showSections('1325', ['Background']);

        expect(result.sections).toHaveLength(1);
        const entry = result.sections[0];
        expect(entry?.name).toBe('Background');
        expect(entry?.headingLine).toBe('### Background');
        // Byte-identity to the file's section content: exact slice, byte count agrees.
        expect(entry?.content).toBe(rawSectionSlice('Background'));
        expect(entry?.byteCount).toBe(Buffer.byteLength(rawSectionSlice('Background')));
    });

    test('showSections projects the same metadata summary as show', async () => {
        const result = await svc.showSections('1325', ['Plan']);
        expect(result.wbs).toBe('1325');
        expect(result.name).toBe('Sectioned fixture');
        expect(result.status).toBe('todo');
        expect(result.filePath).toBe(fixturePath);
        expect(result.frontmatter.status).toBe('todo');
        expect(result.totalBytes).toBe(Buffer.byteLength(fixtureRaw));
    });

    test('showSections returns sections in FILE order and dedupes repeated names', async () => {
        const result = await svc.showSections('1325', ['Plan', 'Background', 'Background']);
        expect(result.sections.map((s) => s.name)).toEqual(['Background', 'Plan']);
    });

    test('multi-byte bodies count bytes, not characters', async () => {
        const result = await svc.showSections('1325', ['Background']);
        const content = result.sections[0]?.content ?? '';
        expect(content.length).toBeLessThan(Buffer.byteLength(content)); // Ü and ✓ are multi-byte
        expect(result.sections[0]?.byteCount).toBe(Buffer.byteLength(content));
    });

    test('unknown section names fail listing the valid names (AC1)', async () => {
        const err: Error & { cliCode?: string } = (await svc
            .showSections('1325', ['Nope'])
            .catch((e: unknown) => e as Error & { cliCode?: string })) as Error & { cliCode?: string };
        expect(err.cliCode).toBe('VALIDATION_FAILED');
        expect(err.message).toContain('"Nope"');
        expect(err.message).toContain('Background, Plan, History');
    });

    test('showSummary returns the section index with byte counts and no bodies (AC2)', async () => {
        const result = await svc.showSummary('1325');

        expect(result.sections.map((s) => s.name)).toEqual(['Background', 'Plan', 'History']);
        expect(result.totalBytes).toBe(Buffer.byteLength(fixtureRaw));
        for (const entry of result.sections) {
            expect(entry.headingLine).toBe(`### ${entry.name}`);
            // Byte count matches the byte-exact file slice; the body itself is absent.
            expect(entry.byteCount).toBe(Buffer.byteLength(rawSectionSlice(entry.name)));
            expect(entry.content).toBeUndefined();
            expect('content' in entry).toBe(false);
        }
        // The summary never pays for bodies: index bytes < file bytes.
        const indexBytes = result.sections.reduce((sum, s) => sum + s.byteCount, 0);
        expect(indexBytes).toBeLessThan(result.totalBytes);
    });

    // ── 1325 P3: write-time size-budget advisory ──

    test('batch-create with 11 R-items warns at write time without blocking', async () => {
        const batchPath = join(tasksDir, '..', '.tmp-batch-oversize.json');
        const reqs = Array.from({ length: 11 }, (_, i) => `- [ ] **R${i + 1}.** Requirement ${i + 1}`).join('\n');
        writeFileSync(batchPath, JSON.stringify([{ name: 'Oversize batch', requirements: reqs }]), 'utf-8');

        const result = await svc.batchCreate(batchPath);

        expect(result.children).toHaveLength(1);
        const warnings = (result.children[0]?.warnings ?? []).filter((w) => w.includes('R-items'));
        expect(warnings.join('\n')).toContain('Task has 11 R-items (max 10)');
        // Non-blocking: the file landed.
        expect(existsSync(result.children[0]?.ref.filePath ?? '')).toBe(true);
    });

    test('updateBody on a task with no Requirements section warns on preamble R-items', async () => {
        const barePath = join(tasksDir, '9901_bare-preamble.md');
        writeFileSync(
            barePath,
            '---\nschema_version: 1\nname: "Bare preamble"\nstatus: backlog\n' +
                'created_at: 2026-11-10T00:00:00.000Z\nupdated_at: 2026-11-10T00:00:00.000Z\n---\n\n' +
                '## 9901. Bare preamble\n\n',
            'utf-8',
        );
        const reqs = Array.from({ length: 11 }, (_, i) => `- [ ] **R${i + 1}.** Requirement ${i + 1}`).join('\n');

        const result = await svc.updateBody('9901', `Starter prose.\n\n${reqs}\n`);

        const warnings = (result.warnings ?? []).filter((w) => w.includes('R-items'));
        expect(warnings.join('\n')).toContain('Task has 11 R-items (max 10)');
        expect(readFileSync(barePath, 'utf-8')).toContain('R11.');
    });

    test('a conforming updateBody stays silent', async () => {
        const okPath = join(tasksDir, '9902_clean-body.md');
        writeFileSync(
            okPath,
            '---\nschema_version: 1\nname: "Clean body"\nstatus: backlog\n' +
                'created_at: 2026-11-10T00:00:00.000Z\nupdated_at: 2026-11-10T00:00:00.000Z\n---\n\n' +
                '## 9902. Clean body\n\n',
            'utf-8',
        );
        const result = await svc.updateBody('9902', 'Small prose body.\n');
        expect(result.warnings ?? []).toHaveLength(0);
        expect(readFileSync(okPath, 'utf-8')).toContain('Small prose body.');
    });
});
