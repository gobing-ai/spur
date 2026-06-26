import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { join } from 'node:path';
import type { LifecycleProfile } from '@gobing-ai/spur-app';
import { LifecycleAdapter, TASK_LIFECYCLE_PROFILE } from '@gobing-ai/spur-app';
import * as configModule from '@gobing-ai/spur-config/loader';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';
import { makeLifecycleAdapter } from '../../src/workflow/make-lifecycle-adapter';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('makeLifecycleAdapter', () => {
    const spies: ReturnType<typeof spyOn>[] = [];

    afterEach((): void => {
        while (spies.length > 0) {
            const spy = spies.pop();
            if (spy) spy.mockRestore();
        }
    });

    test('returns undefined when bundledConfigRoot resolves to null', (): void => {
        const spy = spyOn(configModule, 'bundledConfigRoot').mockReturnValue(null);
        spies.push(spy);

        const ctx = createCliContext({ output: nullOutput() });
        const result = makeLifecycleAdapter(ctx, TASK_LIFECYCLE_PROFILE);

        expect(result).toBeUndefined();
    });

    test('returns undefined when the workflow YAML is missing on disk', (): void => {
        const profile: LifecycleProfile = { ...TASK_LIFECYCLE_PROFILE, workflowName: 'does-not-exist' };

        const ctx = createCliContext({ output: nullOutput() });
        const result = makeLifecycleAdapter(ctx, profile);

        expect(result).toBeUndefined();
    });

    test('constructs workflowPath from config root and profile.workflowName', (): void => {
        const configRoot = configModule.bundledConfigRoot();
        expect(configRoot).not.toBeNull();

        const spy = spyOn(fs, 'existsSync').mockReturnValue(true);
        spies.push(spy);

        const ctx = createCliContext({ output: nullOutput() });
        makeLifecycleAdapter(ctx, TASK_LIFECYCLE_PROFILE);

        const checkedPath = spy.mock.calls[0]?.[0];
        expect(checkedPath).toBe(join(configRoot as string, 'workflows', 'task-lifecycle.yaml'));
    });

    test('returns a LifecycleAdapter instance when config root and workflow exist', (): void => {
        const ctx = createCliContext({ output: nullOutput() });
        const result = makeLifecycleAdapter(ctx, TASK_LIFECYCLE_PROFILE);

        expect(result).toBeInstanceOf(LifecycleAdapter);
    });
});
