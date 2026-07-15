import { afterEach, describe, expect, mock, test } from 'bun:test';

import { ATTACH_EVENT, consumePendingAttach, requestAttach } from '../../../src/modules/teams/attach-bus';

describe('attach-bus', () => {
    afterEach(() => {
        // Drain any leftover intent so tests don't bleed into each other.
        consumePendingAttach();
    });

    describe('requestAttach', () => {
        test('stores the agentId as the pending intent', () => {
            requestAttach('planner');
            expect(consumePendingAttach()).toBe('planner');
        });

        test('dispatches a teams:attach-process CustomEvent with the agentId', () => {
            const handler = mock((_event: Event) => {});
            globalThis.addEventListener(ATTACH_EVENT, handler);
            try {
                requestAttach('coder');
            } finally {
                globalThis.removeEventListener(ATTACH_EVENT, handler);
            }

            expect(handler).toHaveBeenCalledTimes(1);
            const firstCall = handler.mock.calls[0];
            const event = (firstCall ? firstCall[0] : undefined) as CustomEvent<{ agentId: string }>;
            expect(event.type).toBe(ATTACH_EVENT);
            expect(event.detail).toEqual({ agentId: 'coder' });
        });

        test('overwrites a previous un-consumed intent (latest wins)', () => {
            requestAttach('planner');
            requestAttach('coder');
            expect(consumePendingAttach()).toBe('coder');
        });
    });

    describe('consumePendingAttach', () => {
        test('returns null when no intent was requested', () => {
            expect(consumePendingAttach()).toBeNull();
        });

        test('returns the pending agentId and clears it', () => {
            requestAttach('planner');
            expect(consumePendingAttach()).toBe('planner');
        });

        test('returns null on the second call (clear-on-read)', () => {
            requestAttach('planner');
            consumePendingAttach();
            expect(consumePendingAttach()).toBeNull();
        });
    });

    describe('ATTACH_EVENT', () => {
        test('is the expected event name', () => {
            expect(ATTACH_EVENT).toBe('teams:attach-process');
        });
    });
});
