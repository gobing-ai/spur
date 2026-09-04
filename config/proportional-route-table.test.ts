import { describe, expect, test } from 'bun:test';
import { evaluateRoute, ROUTE_TABLE, type RouteInput, safetyFloorHolds } from './proportional-route-table';

const BASE_INPUT: RouteInput = {
    runId: 'run-1',
    definitionDigest: 'sha256:abc',
    evidenceRefs: ['.spur/run/run-1-verdict.json'],
    costCoverage: 0.85,
    proofBinding: 'current',
    reviewerIndependent: true,
    runIdConfined: true,
};

describe('proportional route table scaffold (task 0758 WIP)', () => {
    test('safety-default is the only predicate in the pilot scaffold', () => {
        expect(ROUTE_TABLE).toHaveLength(1);
        expect(ROUTE_TABLE[0]?.id).toBe('safety-default');
        expect(ROUTE_TABLE[0]?.route).toBe('safety');
    });

    test('every input routes to the safety path until per-pilot predicates land', () => {
        const result = evaluateRoute(BASE_INPUT);
        expect(result.route).toBe('safety');
        expect(result.predicateId).toBe('safety-default');
        expect(result.reason).toContain('pilot scaffold');
    });

    test('safety floor holds only when all three invariants are true', () => {
        expect(safetyFloorHolds(BASE_INPUT)).toBe(true);

        const staleProof: RouteInput = { ...BASE_INPUT, proofBinding: 'stale' };
        expect(safetyFloorHolds(staleProof)).toBe(false);

        const noReviewer: RouteInput = { ...BASE_INPUT, reviewerIndependent: false };
        expect(safetyFloorHolds(noReviewer)).toBe(false);

        const noConfinement: RouteInput = { ...BASE_INPUT, runIdConfined: false };
        expect(safetyFloorHolds(noConfinement)).toBe(false);

        const missingProof: RouteInput = { ...BASE_INPUT, proofBinding: 'missing' };
        expect(safetyFloorHolds(missingProof)).toBe(false);
    });

    test('route table is frozen (immutable at runtime)', () => {
        expect(Object.isFrozen(ROUTE_TABLE)).toBe(true);
    });
});
