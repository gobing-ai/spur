import { describe, expect, test } from 'bun:test';
import { shouldRenderBanner } from '../src/index';
import { isWorkflowTransportInvocation, WORKFLOW_TRANSPORT_VERBS } from '../src/workflow-transport-argv';

/** Early-dispatch classification of `spur workflow commit-guard` (script-absorption PR-4). */
describe('workflow transport routing', () => {
    test('the transport verbs are commit-guard plus the flat landing verbs', () => {
        expect(WORKFLOW_TRANSPORT_VERBS).toEqual(['commit-guard', 'persist-out', 'persist-check']);
    });

    test('argv detection ignores global flags and only claims commit-guard', () => {
        expect(isWorkflowTransportInvocation(['workflow', 'commit-guard', 'check'])).toBe(true);
        expect(isWorkflowTransportInvocation(['workflow', 'persist-out', '--from', 'wt'])).toBe(true);
        expect(isWorkflowTransportInvocation(['workflow', 'persist-check', '--from', 'wt'])).toBe(true);
        expect(isWorkflowTransportInvocation(['--no-logo', 'workflow', 'commit-guard'])).toBe(true);
        // D65 1242: the retired inline driver is not a transport (or a command) any more.
        expect(isWorkflowTransportInvocation(['workflow', 'inline', 'begin'])).toBe(false);
        expect(isWorkflowTransportInvocation(['workflow', 'run'])).toBe(false);
        expect(isWorkflowTransportInvocation(['workflow'])).toBe(false);
        expect(isWorkflowTransportInvocation(['task', 'inline'])).toBe(false);
    });

    test('the banner is suppressed for the transport only', () => {
        expect(shouldRenderBanner(['workflow', 'commit-guard', 'check'])).toBe(false);
        expect(shouldRenderBanner(['workflow', 'persist-out', '--from', 'wt'])).toBe(false);
        expect(shouldRenderBanner(['workflow', 'inline', 'close'])).toBe(true);
        expect(shouldRenderBanner(['workflow', 'list'])).toBe(true);
    });
});
