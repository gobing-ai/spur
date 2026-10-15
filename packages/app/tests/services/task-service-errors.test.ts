import { describe, expect, test } from 'bun:test';
import {
    DependencyMutationError,
    DuplicateFollowUpError,
    ParentFeatureStatusError,
    SectionMutationError,
    TaskCandidateInvalidError,
    WbsCollisionError,
} from '../../src/services/task-service-errors';

describe('task service errors', () => {
    test('mutation errors carry their code and name', () => {
        const dep = new DependencyMutationError('cycle', 'loop');
        expect([dep.name, dep.code, dep.message]).toEqual(['DependencyMutationError', 'cycle', 'loop']);
        const sec = new SectionMutationError('unknown-section', 'nope');
        expect([sec.name, sec.code]).toEqual(['SectionMutationError', 'unknown-section']);
    });

    test('DuplicateFollowUpError and WbsCollisionError name the existing task and the remedy', () => {
        const dup = new DuplicateFollowUpError('0042', 'Fix x', 'Fix x');
        expect(dup.message).toContain('task 0042 ("Fix x")');
        expect(dup.message).toContain('--allow-duplicate-name');
        expect([dup.existingWbs, dup.existingName, dup.attemptedName]).toEqual(['0042', 'Fix x', 'Fix x']);
        const col = new WbsCollisionError('0042', 'a.md', 'b.md');
        expect(col.message).toContain('WBS 0042 already exists at "a.md"');
        expect([col.wbs, col.existingPath, col.attemptedPath]).toEqual(['0042', 'a.md', 'b.md']);
    });

    test('TaskCandidateInvalidError lists only error-severity findings, with optional context', () => {
        const findings = [
            { layer: 'L3', code: 'x', severity: 'error', section: 'Acceptance Criteria', message: 'empty' },
            { layer: 'L2', code: 'y', severity: 'warning', section: '', message: 'ignored' },
            { layer: 'L1', code: 'z', severity: 'error', section: '', message: 'bad frontmatter' },
        ] as never;
        const err = new TaskCandidateInvalidError('T', findings, 'batch item 1/1');
        expect(err.message).toBe(
            'candidate task "T" (batch item 1/1) rejected before persistence — it would fail `spur task check`: ' +
                'L3/Acceptance Criteria: empty; L1: bad frontmatter',
        );
        expect(err.findings).toBe(findings);
        expect(new TaskCandidateInvalidError('T', []).message).not.toContain('(');
    });

    test('ParentFeatureStatusError explains deprecated, sibling and no-sibling cases', () => {
        expect(new ParentFeatureStatusError('B2', 'deprecated', []).message).toContain('spur feature update B2 active');
        expect(new ParentFeatureStatusError('B2', 'done', ['B3']).message).toContain('active siblings in group B: B3');
        const none = new ParentFeatureStatusError('B2', 'cancelled', []);
        expect(none.message).toContain('reopen B2 to active first');
        expect([none.featureId, none.status, none.activeSiblings]).toEqual(['B2', 'cancelled', []]);
    });
});
