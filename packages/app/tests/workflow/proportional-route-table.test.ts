import { describe, expect, test } from 'bun:test';
import {
    evaluateLifecycleRoute,
    evaluateRoute,
    evaluateWrapupRoute,
    ROUTE_TABLE,
    type RouteInput,
    safetyFloorHolds,
} from '../../../../config/proportional-route-table';

const BASE_INPUT: RouteInput = {
    runId: 'run-1',
    definitionDigest: 'sha256:abc',
    evidenceRefs: ['.spur/run/run-1-verdict.json'],
    costCoverage: 0.85,
    proofBinding: 'current',
    reviewerIndependent: true,
    runIdConfined: true,
};

describe('proportional route table (task 0758)', () => {
    test('route table contains closed set of routes', () => {
        expect(ROUTE_TABLE).toHaveLength(3);
        const routeIds = ROUTE_TABLE.map((r) => r.route);
        expect(routeIds).toContain('safety');
        expect(routeIds).toContain('fast');
        expect(routeIds).toContain('skipped');
    });

    test('evaluateWrapupRoute maps every input to exactly one route with bounded reason', () => {
        // empty tasks -> skipped
        expect(evaluateWrapupRoute({ tasks: [] })).toEqual({
            route: 'skipped',
            predicateId: 'skipped-empty',
            reason: 'skipped:empty task list',
        });
        expect(evaluateWrapupRoute({ tasks: '[]' })).toEqual({
            route: 'skipped',
            predicateId: 'skipped-empty',
            reason: 'skipped:empty task list',
        });

        // tasks > 0 + mode=fast -> fast
        expect(evaluateWrapupRoute({ tasks: ['0001'], mode: 'fast' })).toEqual({
            route: 'fast',
            predicateId: 'fast-complete',
            reason: 'fast:evidence complete+consistent',
        });

        // tasks > 0 + mode empty -> safety
        expect(evaluateWrapupRoute({ tasks: ['0001'] })).toEqual({
            route: 'safety',
            predicateId: 'safety-default',
            reason: 'safety:missing evidence (mode empty)',
        });

        // tasks > 0 + mode unknown -> safety
        expect(evaluateWrapupRoute({ tasks: ['0001'], mode: 'unknown' })).toEqual({
            route: 'safety',
            predicateId: 'safety-default',
            reason: 'safety:unknown evidence quality',
        });

        // tasks > 0 + mode conflict -> safety
        expect(evaluateWrapupRoute({ tasks: ['0001'], mode: 'conflict' })).toEqual({
            route: 'safety',
            predicateId: 'safety-default',
            reason: 'safety:conflicting evidence',
        });

        // tasks > 0 + mode other -> safety
        expect(evaluateWrapupRoute({ tasks: ['0001'], mode: 'random' })).toEqual({
            route: 'safety',
            predicateId: 'safety-default',
            reason: 'safety:unrecognized evidence (mode=random)',
        });
    });

    test('evaluateLifecycleRoute routes to fast or safety based on mode', () => {
        expect(evaluateLifecycleRoute({ mode: 'fast' })).toEqual({
            route: 'fast',
            predicateId: 'fast-complete',
            reason: 'fast:evidence complete+consistent',
        });
        expect(evaluateLifecycleRoute({})).toEqual({
            route: 'safety',
            predicateId: 'safety-default',
            reason: 'safety:standard verification',
        });
    });

    test('generic evaluateRoute checks costCoverage, proofBinding, and reviewer independence', () => {
        expect(evaluateRoute(BASE_INPUT).route).toBe('fast');
        expect(evaluateRoute({ ...BASE_INPUT, costCoverage: 0.5 }).route).toBe('safety');
        expect(evaluateRoute({ ...BASE_INPUT, proofBinding: 'stale' }).route).toBe('safety');
        expect(evaluateRoute({ ...BASE_INPUT, reviewerIndependent: false }).route).toBe('safety');
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
