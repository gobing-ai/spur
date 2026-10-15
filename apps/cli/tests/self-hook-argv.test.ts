/** PR-L lazy CLI loading — `self hook` detection without importing the hook runner. */

import { expect, test } from 'bun:test';
import * as selfHook from '../src/self-hook';
import { isSelfHookInvocation, SELF_HOOK_VERB } from '../src/self-hook-argv';

test('detects `self hook` with global flags anywhere, nothing else', () => {
    expect(SELF_HOOK_VERB).toBe('hook');
    expect(isSelfHookInvocation(['self', 'hook', 'careful-guard'])).toBe(true);
    expect(isSelfHookInvocation(['--no-logo', '-v', 'self', '--cli-verbose', 'hook', 'list'])).toBe(true);
    expect(isSelfHookInvocation(['self', 'status'])).toBe(false);
    expect(isSelfHookInvocation(['hook', 'self'])).toBe(false);
    expect(isSelfHookInvocation([])).toBe(false);
});

test('self-hook.ts re-exports the same detector for existing callers', () => {
    expect(selfHook.isSelfHookInvocation).toBe(isSelfHookInvocation);
    expect(selfHook.SELF_HOOK_VERB).toBe(SELF_HOOK_VERB);
});
