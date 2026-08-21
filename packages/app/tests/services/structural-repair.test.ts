import { describe, expect, test } from 'bun:test';
import type { MatrixEntry } from '../../src/services/planning-check-base';
import { applyStructuralRepairs, structuralFindings } from '../../src/services/structural-repair';

// Task 0619 R1/R4/R5: the structural repair engine — heading presence, heading
// level, section order, R-item checkbox form; never authors content; byte-identical
// on a no-op; never removes an off-variant section.

const TASK_ENTRY: MatrixEntry = {
    required: [
        'Background',
        'Requirements',
        'Acceptance Criteria',
        'Q&A',
        'Design',
        'Plan',
        'Testing',
        'Review',
        'History',
    ],
};

function taskDoc(extra = ''): string {
    return `---
status: wip
template: feature-impl
---

## 9999. Probe

### Background

text
### Requirements

- [ ] R1. one
### Acceptance Criteria

scenario
### Q&A

none
### Design

note
### Plan

- [ ] step
### Testing

later
### Review

pending
### History

- entry
${extra}`;
}

describe('structuralFindings', () => {
    test('reports a mis-levelled canonical heading', () => {
        const raw = `---\nstatus: wip\n---\n\n## 9999. Probe\n\n## Requirements\n\n- R1. x\n`;
        const findings = structuralFindings(raw, 'task');
        const level = findings.find((f) => f.code === 'L2.heading-level');
        expect(level).toBeDefined();
        expect(level?.section).toBe('Requirements');
        expect(level?.message).toContain('### Requirements');
    });

    test('reports out-of-order canonical sections', () => {
        const raw = `---\nstatus: wip\n---\n\n## 9999. Probe\n\n### Plan\n\nsteps\n\n### Background\n\ntext\n`;
        const findings = structuralFindings(raw, 'task');
        expect(findings.some((f) => f.code === 'L2.section-order')).toBe(true);
    });

    test('reports R-items missing the checkbox marker', () => {
        const raw = `---\nstatus: wip\n---\n\n## 9999. Probe\n\n### Requirements\n\n- R1. first\n- [ ] R2. second\n`;
        const findings = structuralFindings(raw, 'task');
        const cb = findings.find((f) => f.code === 'L3.requirements-checkbox');
        expect(cb).toBeDefined();
        expect(cb?.message).toContain('1 R-item');
    });

    test('produces no findings on a well-formed task', () => {
        const findings = structuralFindings(taskDoc(), 'task');
        expect(findings).toEqual([]);
    });
});

describe('applyStructuralRepairs', () => {
    test('fixes a mis-levelled heading in place', () => {
        const raw = `---\nstatus: wip\n---\n\n## 9999. Probe\n\n## Requirements\n\n- R1. x\n`;
        const r = applyStructuralRepairs(raw, 'task', TASK_ENTRY);
        expect(r.changed).toBe(true);
        expect(r.content).toContain('### Requirements');
        expect(r.repairs.some((p) => p.kind === 'heading-level' && p.section === 'Requirements')).toBe(true);
        // Re-run is a no-op (byte-identical trust property).
        const r2 = applyStructuralRepairs(r.content, 'task', TASK_ENTRY);
        expect(r2.changed).toBe(false);
    });

    test('inserts missing required sections as bare headings (never content)', () => {
        const raw = `---\nstatus: wip\n---\n\n## 9999. Probe\n\n### Background\n\ntext\n`;
        const r = applyStructuralRepairs(raw, 'task', TASK_ENTRY);
        expect(r.changed).toBe(true);
        for (const name of TASK_ENTRY.required ?? []) {
            if (name !== 'Background') {
                expect(r.content).toContain(`### ${name}`);
            }
        }
        // No content authored into the inserted sections.
        expect(r.repairs.filter((p) => p.kind === 'missing-section').length).toBeGreaterThan(0);
    });

    test('reorders out-of-order canonical sections', () => {
        const raw = `---\nstatus: wip\n---\n\n## 9999. Probe\n\n### Plan\n\nsteps\n\n### Background\n\ntext\n\n### Requirements\n\n- [ ] R1. x\n`;
        const r = applyStructuralRepairs(raw, 'task', TASK_ENTRY);
        expect(r.changed).toBe(true);
        expect(r.repairs.some((p) => p.kind === 'section-order')).toBe(true);
        const bg = r.content.indexOf('### Background');
        const req = r.content.indexOf('### Requirements');
        const plan = r.content.indexOf('### Plan');
        expect(bg).toBeGreaterThan(-1);
        expect(bg).toBeLessThan(req);
        expect(req).toBeLessThan(plan);
    });

    test('adds the checkbox marker to R-items', () => {
        const raw = `---\nstatus: wip\n---\n\n## 9999. Probe\n\n### Requirements\n\n- R1. first\n- R2. second\n`;
        const r = applyStructuralRepairs(raw, 'task', TASK_ENTRY);
        expect(r.changed).toBe(true);
        expect(r.content).toContain('- [ ] R1. first');
        expect(r.content).toContain('- [ ] R2. second');
    });

    test('leaves a well-formed file byte-identical', () => {
        const raw = taskDoc();
        const r = applyStructuralRepairs(raw, 'task', TASK_ENTRY);
        expect(r.changed).toBe(false);
        expect(r.content).toBe(raw);
        expect(r.repairs).toEqual([]);
    });

    test('never removes an off-variant section and skips reordering around it', () => {
        const raw = `---\nstatus: wip\n---\n\n## 9999. Probe\n\n### Background\n\ntext\n\n### Fancy Extra\n\nkeep me\n\n### Design\n\nnote\n`;
        const r = applyStructuralRepairs(raw, 'task', TASK_ENTRY);
        // Fancy Extra is non-canonical — never deleted, and order is left alone.
        expect(r.content).toContain('### Fancy Extra');
        expect(r.content).toContain('keep me');
        expect(r.repairs.some((p) => p.kind === 'section-order')).toBe(false);
        // Missing required sections still get inserted (the off-variant block is not an obstacle).
        expect(r.content).toContain('### Requirements');
    });

    test('handles the feature domain (## sections)', () => {
        const raw = `---\nstatus: active\n---\n\n# A9: Probe\n\n## Scope\n\nscope\n\n## Goal\n\ngoal\n`;
        const entry: MatrixEntry = { required: ['Goal', 'Scope', 'History'] };
        const r = applyStructuralRepairs(raw, 'feature', entry);
        expect(r.changed).toBe(true);
        expect(r.content).toContain('## History');
        const goal = r.content.indexOf('## Goal');
        const scope = r.content.indexOf('## Scope');
        expect(goal).toBeGreaterThan(-1);
        expect(goal).toBeLessThan(scope);
    });
});
