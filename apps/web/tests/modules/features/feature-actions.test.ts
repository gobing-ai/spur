import { describe, expect, test } from 'bun:test';
import {
    AGENT_ACTIONS,
    CREATE_ACTIONS,
    FEATURE_ACTION_LABELS,
    FEATURE_STATUS_ACTIONS,
    FSM_ACTIONS,
    FSM_TRANSITION_TARGET,
    LINK_ACTIONS,
} from '../../../src/modules/features/feature-actions';

describe('feature-actions constants', () => {
    test('defines expected status actions', () => {
        expect(FEATURE_STATUS_ACTIONS.backlog).toContain('brainstorm');
        expect(FEATURE_STATUS_ACTIONS.active).toContain('add-task');
        expect(FEATURE_STATUS_ACTIONS.done).toEqual([]);
    });

    test('defines labels for each action', () => {
        expect(FEATURE_ACTION_LABELS.brainstorm).toBe('Brainstorm');
        expect(FEATURE_ACTION_LABELS.plan).toBe('Plan');
    });

    test('correctly maps FSM transition targets', () => {
        expect(FSM_ACTIONS.start).toBe(true);
        expect(FSM_TRANSITION_TARGET.start).toBe('active');
        expect(FSM_TRANSITION_TARGET.complete).toBe('done');
    });

    test('categorizes agent, create, and link actions', () => {
        expect(AGENT_ACTIONS.brainstorm).toBe(true);
        expect(CREATE_ACTIONS['add-task']).toBe(true);
        expect(LINK_ACTIONS['link-task']).toBe(true);
    });
});
