import { describe, expect, test } from 'bun:test';
import {
    classifyReceipt,
    RECEIPT_LABELS,
    type RequestReceipt,
    type RequestReceiptState,
} from '../../../src/modules/projects/receipt';
import type { ProjectFleetSnapshot } from '../../../src/modules/projects/useProjectContext';

function receipt(overrides: Partial<RequestReceipt> = {}): RequestReceipt {
    return {
        messageId: 'm1',
        requestKey: 'rk1',
        deliveryStatus: 'queued',
        injectAttempts: 0,
        injectError: null,
        runId: null,
        taskId: null,
        outcome: null,
        reason: null,
        hold: null,
        ...overrides,
    };
}

function fleet(
    overrides: {
        orchestrator?: Partial<ProjectFleetSnapshot['orchestrator']>;
        members?: ProjectFleetSnapshot['members'];
        strategyName?: 'rest' | 'gtd';
    } = {},
): ProjectFleetSnapshot {
    return {
        path: '/repo/wt',
        strategy: { name: overrides.strategyName ?? 'gtd', version: 1 },
        orchestrator: { state: 'bound-online', instanceId: 'lead', ...overrides.orchestrator },
        members: overrides.members ?? [
            {
                instanceId: 'lead',
                role: 'planner',
                executor: 'claude',
                enabled: true,
                writeCapable: true,
                capabilityState: 'available',
            },
        ],
        capacity: { total: 1, enabled: 1, writeCapable: 1, missing: [] },
    };
}

function classifyFor(
    r: Partial<RequestReceipt>,
    f: ProjectFleetSnapshot | null = fleet(),
    inFlight = false,
): RequestReceiptState {
    return classifyReceipt(receipt(r), f, inFlight);
}

describe('classifyReceipt precedence (0844 R5/R6 — one test per row, first match wins)', () => {
    test('1. inFlight with no durable receipt → pending', () => {
        expect(classifyReceipt(null, fleet(), true)).toBe('pending');
    });

    test('2. deliveryStatus failed → failed-delivery', () => {
        expect(classifyFor({ deliveryStatus: 'failed' })).toBe('failed-delivery');
    });

    test('3. reason outcome-unknown → outcome-unknown', () => {
        expect(classifyFor({ reason: 'outcome-unknown' })).toBe('outcome-unknown');
    });

    test('4. reason attempts-exhausted → failed-delivery', () => {
        expect(classifyFor({ reason: 'attempts-exhausted' })).toBe('failed-delivery');
    });

    test('5. outcome verified → completed-verified', () => {
        expect(classifyFor({ outcome: 'verified', runId: 'r1' })).toBe('completed-verified');
    });

    test('6. outcome run-exit-only → completed-exit-only (a run exit is NEVER shown as verified)', () => {
        expect(classifyFor({ outcome: 'run-exit-only', runId: 'r1' })).toBe('completed-exit-only');
    });

    test('7. outcome errored → failed-delivery', () => {
        expect(classifyFor({ outcome: 'errored', runId: 'r1' })).toBe('failed-delivery');
    });

    test('8. hold rest-after-drain → rest-held', () => {
        expect(classifyFor({ hold: 'rest-after-drain' })).toBe('rest-held');
    });

    test('9. hold executor-unavailable → executor-unavailable', () => {
        expect(classifyFor({ hold: 'executor-unavailable' })).toBe('executor-unavailable');
    });

    test('10. any other hold (unmet-dependency) → blocked', () => {
        expect(classifyFor({ hold: 'unmet-dependency' })).toBe('blocked');
        expect(classifyFor({ hold: 'unauthorized' })).toBe('blocked');
        expect(classifyFor({ hold: 'not-ready' })).toBe('blocked');
        expect(classifyFor({ hold: 'no-idle-instance' })).toBe('blocked');
    });

    test('11. injected or delivered → accepted-working (occupancy, not a verified result)', () => {
        expect(classifyFor({ deliveryStatus: 'injected', runId: 'r1' })).toBe('accepted-working');
        expect(classifyFor({ deliveryStatus: 'delivered' })).toBe('accepted-working');
    });

    test('12. queued + orchestrator missing/unresolvable → orchestrator-missing', () => {
        expect(classifyFor({}, fleet({ orchestrator: { state: 'missing', instanceId: undefined } }))).toBe(
            'orchestrator-missing',
        );
        expect(classifyFor({}, fleet({ orchestrator: { state: 'unresolvable', instanceId: undefined } }))).toBe(
            'orchestrator-missing',
        );
    });

    test('13. queued + bound-offline → orchestrator-offline', () => {
        expect(classifyFor({}, fleet({ orchestrator: { state: 'bound-offline' } }))).toBe('orchestrator-offline');
    });

    test('14. queued + orchestrator member disabled or capabilityState unavailable → executor-unavailable', () => {
        const disabled = fleet({
            members: [
                {
                    instanceId: 'lead',
                    executor: 'claude',
                    enabled: false,
                    writeCapable: false,
                    capabilityState: 'available',
                },
            ],
        });
        expect(classifyFor({}, disabled)).toBe('executor-unavailable');
        const incapable = fleet({
            members: [
                {
                    instanceId: 'lead',
                    executor: 'claude',
                    enabled: true,
                    writeCapable: false,
                    capabilityState: 'unavailable',
                },
            ],
        });
        expect(classifyFor({}, incapable)).toBe('executor-unavailable');
    });

    test('15. queued + strategy rest → rest-held', () => {
        expect(classifyFor({}, fleet({ strategyName: 'rest' }))).toBe('rest-held');
    });

    test('16. otherwise → queued-awaiting-orchestrator; capabilityState unknown is NOT executor-unavailable (CLOSED)', () => {
        expect(classifyFor({}, fleet(), false)).toBe('queued-awaiting-orchestrator');
        const unknown = fleet({
            members: [
                {
                    instanceId: 'lead',
                    executor: 'claude',
                    enabled: true,
                    writeCapable: false,
                    capabilityState: 'unknown',
                },
            ],
        });
        expect(classifyFor({}, unknown)).toBe('queued-awaiting-orchestrator');
    });

    test('run state outranks project state: consumed request with rest strategy still resolves by run', () => {
        expect(classifyFor({ deliveryStatus: 'injected', runId: 'r1' }, fleet({ strategyName: 'rest' }))).toBe(
            'accepted-working',
        );
    });

    test('total without a fleet or receipt: not inFlight → queued-awaiting-orchestrator (never a throw)', () => {
        expect(classifyReceipt(null, null, false)).toBe('queued-awaiting-orchestrator');
        expect(classifyReceipt(null, fleet(), false)).toBe('queued-awaiting-orchestrator');
    });
});

describe('RECEIPT_LABELS (0844 R5 — every non-nominal state named and actionable)', () => {
    const STATES: RequestReceiptState[] = [
        'pending',
        'queued-awaiting-orchestrator',
        'orchestrator-missing',
        'orchestrator-offline',
        'executor-unavailable',
        'rest-held',
        'blocked',
        'accepted-working',
        'failed-delivery',
        'outcome-unknown',
        'completed-exit-only',
        'completed-verified',
    ];

    test('the vocabulary is closed at exactly the twelve frozen states', () => {
        expect(Object.keys(RECEIPT_LABELS).sort()).toEqual([...STATES].sort());
    });

    test('every label has icon + label + meaning + action + tone (never color alone, G63 R7)', () => {
        for (const state of STATES) {
            const label = RECEIPT_LABELS[state];
            expect(label.icon.length, state).toBeGreaterThan(0);
            expect(label.label.length, state).toBeGreaterThan(0);
            expect(label.meaning.length, state).toBeGreaterThan(0);
            expect(label.action.length, state).toBeGreaterThan(0);
            expect(['ok', 'warn', 'err'], state).toContain(label.tone);
        }
    });

    test('completed-exit-only is labelled unverified (R6)', () => {
        expect(RECEIPT_LABELS['completed-exit-only'].label).toContain('unverified');
        expect(RECEIPT_LABELS['completed-verified'].label).toContain('verified');
        expect(RECEIPT_LABELS['completed-verified'].label).not.toBe(RECEIPT_LABELS['completed-exit-only'].label);
    });
});
