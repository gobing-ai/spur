import { describe, expect, test } from 'bun:test';
import {
    countPlanItems,
    countRItems,
    evaluateTaskSize,
    type TaskSizeLimits,
} from '../../src/services/task-size-precheck';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const SMALL_TASK = `## Requirements
- [ ] R1. First requirement
- [ ] R2. Second requirement

### Plan
- [ ] Step one
- [ ] Step two
`;

const LARGE_TASK = `## Requirements
- [ ] **R1.** First requirement
- [ ] R2. Second requirement
- [ ] **R3.** Third requirement
- [ ] R4. Fourth requirement
- [ ] R5. Fifth requirement
- [ ] **R6.** Sixth requirement — over limit

### Plan
- [ ] Step one
- [ ] Step two
- [ ] Step three
- [ ] Step four
- [ ] Step five
- [ ] Step six
- [ ] Step seven
- [ ] Step eight
- [ ] Step nine
- [ ] Step ten
`;

const NO_REQS_TASK = `## Some section
Just prose.

### Plan
- [ ] Step one
`;

const NO_PLAN_TASK = `## Requirements
- [ ] R1. Only one requirement
`;

const MIXED_CHECKBOXES = `## Requirements
- [ ] R1. Open requirement
- [x] R2. Completed requirement
- [X] **R3.** Another completed

### Plan
- [ ] Step one
- [x] Step two
`;

const ACTUAL_0454_TASK = `## Requirements
**P1 — prevent timeout cascade**

- [ ] **R1. Document + wire implement executor override (no fake TTFB SLA).**
  Some text.
- [ ] **R2. Deterministic task-size precheck before implement.**
  Some text.

**P2 — operator visibility & resume**

- [ ] **R3. Mid-hop progress on the existing observability path (not raw console).**
  Some text.
- [ ] **R4. Partial-work artifact: completed-requirements heuristic section.**
  Some text.
  `;

// ─── Tests: countRItems ─────────────────────────────────────────────────────

describe('countRItems', () => {
    test('counts simple R-items', () => {
        expect(countRItems(SMALL_TASK)).toBe(2);
    });

    test('counts with bold markers', () => {
        expect(countRItems(LARGE_TASK)).toBe(6);
    });

    test('mixed open/closed checkboxes', () => {
        expect(countRItems(MIXED_CHECKBOXES)).toBe(3);
    });

    test('no requirements returns 0', () => {
        expect(countRItems(NO_REQS_TASK)).toBe(0);
    });

    test('empty content returns 0', () => {
        expect(countRItems('')).toBe(0);
    });

    test('0454-style task with bold R-items', () => {
        expect(countRItems(ACTUAL_0454_TASK)).toBe(4);
    });
});

// ─── Tests: countPlanItems ──────────────────────────────────────────────────

describe('countPlanItems', () => {
    test('counts checklist items under ## Plan', () => {
        expect(countPlanItems(SMALL_TASK)).toBe(2);
    });

    test('counts under ### Plan', () => {
        expect(countPlanItems(LARGE_TASK)).toBe(10);
    });

    test('mixed open/closed under Plan', () => {
        expect(countPlanItems(MIXED_CHECKBOXES)).toBe(2);
    });

    test('returns 0 when no Plan section', () => {
        expect(countPlanItems(NO_PLAN_TASK)).toBe(0);
    });

    test('does not count items outside Plan section', () => {
        const content = `## Requirements
- [ ] R1. Some req
- [ ] R2. Another

### Plan
- [ ] Only this one matters
`;
        expect(countPlanItems(content)).toBe(1);
    });

    test('empty content returns 0', () => {
        expect(countPlanItems('')).toBe(0);
    });
});

// ─── Tests: evaluateTaskSize ─────────────────────────────────────────────────

describe('evaluateTaskSize', () => {
    test('small task passes with defaults', () => {
        const report = evaluateTaskSize(SMALL_TASK);
        expect(report.ok).toBe(true);
        expect(report.reqCount).toBe(2);
        expect(report.planItemCount).toBe(2);
        expect(report.reasons).toEqual([]);
    });

    test('large task fails with defaults', () => {
        const report = evaluateTaskSize(LARGE_TASK);
        expect(report.ok).toBe(false);
        expect(report.reqCount).toBe(6);
        expect(report.reasons.length).toBeGreaterThanOrEqual(1);
        expect(report.reasons[0]).toContain('6 R-items');
    });

    test('large task passes with raised limits', () => {
        const limits: TaskSizeLimits = { maxReqs: 10, maxPlanItems: 12 };
        const report = evaluateTaskSize(LARGE_TASK, limits);
        expect(report.ok).toBe(true);
    });

    test('fails on plan items only', () => {
        const limits: TaskSizeLimits = { maxReqs: 10, maxPlanItems: 2 };
        const report = evaluateTaskSize(LARGE_TASK, limits);
        expect(report.ok).toBe(false);
        expect(report.reasons[0]).toContain('10 Plan items');
    });

    test('fails on both reqs + plan items', () => {
        const limits: TaskSizeLimits = { maxReqs: 1, maxPlanItems: 1 };
        const report = evaluateTaskSize(LARGE_TASK, limits);
        expect(report.ok).toBe(false);
        expect(report.reasons.length).toBe(2);
    });

    test('0454-style task passes with defaults', () => {
        // 0454 has 4 R-items and 7 Plan items → both within limits
        // We test the R-items count; Plan items are in the actual task
        const report = evaluateTaskSize(ACTUAL_0454_TASK, { maxReqs: 5, maxPlanItems: 8 });
        expect(report.reqCount).toBe(4);
        expect(report.ok).toBe(true);
    });
});

describe('R3 (0487): size-vs-executor-capability gate', () => {
    const RAISED: TaskSizeLimits = { maxReqs: 10, maxPlanItems: 12 };

    test('a large task on a sub-capable executor blocks even with raised limits', () => {
        const report = evaluateTaskSize(LARGE_TASK, RAISED, { name: 'omp-dsv4-flash-volc', tier: 'cheap' });
        expect(report.ok).toBe(false);
        expect(report.reasons[0]).toContain('requires a capable executor');
        expect(report.reasons[0]).toContain('omp-dsv4-flash-volc');
        expect(report.reasons[0]).toContain('tier cheap');
    });

    test('a large task on a capable executor passes', () => {
        const report = evaluateTaskSize(LARGE_TASK, RAISED, { name: 'claude-opus', tier: 'capable-1' });
        expect(report.ok).toBe(true);
    });

    test('an unknown tier is treated as standard and blocks', () => {
        const report = evaluateTaskSize(LARGE_TASK, RAISED, { name: 'mystery', tier: undefined });
        expect(report.ok).toBe(false);
        expect(report.reasons[0]).toContain('tier standard');
    });

    test('a small task on a cheap executor is untouched by the gate', () => {
        const report = evaluateTaskSize(SMALL_TASK, RAISED, { name: 'omp-flash', tier: 'cheap' });
        expect(report.ok).toBe(true);
    });

    test('no executor supplied → size limits only (0454 behavior preserved)', () => {
        expect(evaluateTaskSize(LARGE_TASK, RAISED).ok).toBe(true);
    });
});
