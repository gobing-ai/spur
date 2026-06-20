import { describe, expect, test } from 'bun:test';
import {
    buildTaskSkeleton,
    extractTemplateBodies,
    SECTION_GUIDANCE,
    sectionMatrixSchema,
} from '../../src/planning/task-skeleton';

describe('buildTaskSkeleton', () => {
    const base = {
        wbs: '0099',
        title: 'Sample',
        frontmatter: 'schema_version: 1\nname: "Sample"\nstatus: todo',
    };

    test('emits sections in canonical order regardless of input order', () => {
        // WHY: the canonical vocabulary (DD-08) defines a fixed reading order so
        // every task file looks the same; the producer must not leak caller order.
        const out = buildTaskSkeleton({
            ...base,
            sections: ['Plan', 'Background', 'Design', 'Acceptance Criteria'],
        });
        const order = ['Background', 'Acceptance Criteria', 'Design', 'Plan'].map((s) => out.indexOf(`### ${s}`));
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(order.every((i) => i >= 0)).toBe(true);
    });

    test('renders a provided body and omits the guidance comment for that section', () => {
        // WHY: a pre-filled section (e.g. feature-derived Background) must show the
        // real content, never the placeholder guidance.
        const out = buildTaskSkeleton({
            ...base,
            sections: ['Background'],
            bodies: { Background: 'Real background.' },
        });
        expect(out).toContain('### Background\n\nReal background.');
        expect(out).not.toContain(SECTION_GUIDANCE.Background);
    });

    test('renders a guidance comment for an empty section', () => {
        // WHY: an unfilled section guides the author (the comment is invisible in a
        // viewer and ignored by the validators) instead of shipping a blank heading.
        const out = buildTaskSkeleton({ ...base, sections: ['Design'] });
        expect(out).toContain(`### Design\n\n<!-- ${SECTION_GUIDANCE.Design} -->`);
    });

    test('never emits a guidance comment for History', () => {
        // WHY: History is the machine-appended transition log; a guidance comment
        // there would be parsed/echoed by history tooling.
        const out = buildTaskSkeleton({ ...base, sections: ['History'] });
        expect(out).toContain('### History');
        expect(out).not.toContain('<!-- Auto-appended');
    });

    test('ignores unknown section names (closed-world DD-08)', () => {
        const out = buildTaskSkeleton({ ...base, sections: ['Background', 'NotASection'] });
        expect(out).not.toContain('### NotASection');
        expect(out).toContain('### Background');
    });

    test('de-duplicates repeated sections', () => {
        const out = buildTaskSkeleton({ ...base, sections: ['Background', 'Background'] });
        expect(out.match(/### Background/g)).toHaveLength(1);
    });

    test('guidance can be disabled', () => {
        const out = buildTaskSkeleton({ ...base, sections: ['Design'], guidance: false });
        expect(out).toContain('### Design');
        expect(out).not.toContain(SECTION_GUIDANCE.Design);
    });
});

describe('extractTemplateBodies', () => {
    test('extracts non-empty canonical section bodies, dropping the Background placeholder', () => {
        // WHY: per-variant boilerplate (e.g. a review P1–P4 table) lives in the
        // template files as DATA; the producer seeds it without hardcoding.
        const template = [
            '---',
            'schema_version: 1',
            '---',
            '',
            '## {{ WBS }}. {{ NAME }}',
            '',
            '### Background',
            '',
            '{{ BACKGROUND }}',
            '',
            '### Review',
            '',
            '| Severity | File |',
            '| -------- | ---- |',
            '| P1       |      |',
            '',
            '### History',
        ].join('\n');
        const bodies = extractTemplateBodies(template);
        // Background was only the placeholder → dropped.
        expect(bodies.Background).toBeUndefined();
        // Review carries the real table.
        expect(bodies.Review).toContain('| P1');
        // Empty History → not included.
        expect(bodies.History).toBeUndefined();
    });
});

describe('sectionMatrixSchema', () => {
    test('accepts a valid matrix', () => {
        const ok = sectionMatrixSchema.safeParse({
            variants: { standard: { backlog: { required: ['Background'], forbidden: ['Solution'] } } },
        });
        expect(ok.success).toBe(true);
    });

    test('rejects a typo in a section name (the human-error guard)', () => {
        // WHY: an unvalidated typo'd section becomes a silently-dead rule.
        const bad = sectionMatrixSchema.safeParse({
            variants: { standard: { backlog: { required: ['Backgrund'] } } },
        });
        expect(bad.success).toBe(false);
    });

    test('rejects an unknown status key', () => {
        const bad = sectionMatrixSchema.safeParse({
            variants: { standard: { someday: { required: ['Background'] } } },
        });
        expect(bad.success).toBe(false);
    });
});
