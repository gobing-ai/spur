import { describe, expect, test } from 'bun:test';
import { shouldRenderBanner } from '../src/index';
import { isWorkflowTransportInvocation, WORKFLOW_TRANSPORT_VERBS } from '../src/workflow-transport-argv';

/** Early-dispatch classification of `spur workflow inline|commit-guard` (script-absorption PR-4). */
describe('workflow transport routing', () => {
    test('the transport verbs are exactly inline and commit-guard', () => {
        expect(WORKFLOW_TRANSPORT_VERBS).toEqual(['inline', 'commit-guard']);
    });

    test('argv detection ignores global flags and only claims inline / commit-guard', () => {
        expect(isWorkflowTransportInvocation(['workflow', 'inline', 'begin'])).toBe(true);
        expect(isWorkflowTransportInvocation(['--no-logo', 'workflow', 'commit-guard'])).toBe(true);
        expect(isWorkflowTransportInvocation(['workflow', 'run'])).toBe(false);
        expect(isWorkflowTransportInvocation(['workflow'])).toBe(false);
        expect(isWorkflowTransportInvocation(['task', 'inline'])).toBe(false);
    });

    test('the banner is suppressed for the transports only', () => {
        expect(shouldRenderBanner(['workflow', 'inline', 'close'])).toBe(false);
        expect(shouldRenderBanner(['workflow', 'commit-guard', 'check'])).toBe(false);
        expect(shouldRenderBanner(['workflow', 'list'])).toBe(true);
    });
});
