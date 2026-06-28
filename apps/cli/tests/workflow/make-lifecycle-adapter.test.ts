import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

    test('returns undefined when bundledConfigRoot resolves to null AND no project-local YAML', (): void => {
        // WHY (Issue A fix): nulling bundledConfigRoot alone no longer returns undefined —
        // the adapter now falls through to the project-local path. To confirm it returns
        // undefined, we must also point cwd at a directory that has no .spur/workflows/.
        // We use a non-existent workflow name so neither path resolves.
        const spy = spyOn(configModule, 'bundledConfigRoot').mockReturnValue(null);
        spies.push(spy);

        const ctx = createCliContext({ output: nullOutput() });
        const profile: LifecycleProfile = { ...TASK_LIFECYCLE_PROFILE, workflowName: 'non-existent-workflow-xyz' };
        const result = makeLifecycleAdapter(ctx, profile);

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

    describe('Issue A fix — project-local .spur/workflows/ fallback', () => {
        // WHY: When bundledConfigRoot() returns null (e.g. compiled binary without a
        // sibling config/) but the project was initialised with `spur init` and carries
        // `.spur/workflows/<name>.yaml`, the adapter should still be constructable.
        // Without this fix, `makeLifecycleAdapter` always returned undefined when the
        // bundled root was absent — triggering the inline fallback and Issue B.
        let tmpDir: string;

        beforeAll(() => {
            tmpDir = join(import.meta.dir, '..', `.tmp-lifecycle-test-${Date.now()}`);
            const workflowsDir = join(tmpDir, '.spur', 'workflows');
            mkdirSync(workflowsDir, { recursive: true });
            // Seed a minimal valid-looking YAML — the adapter only checks file existence here.
            writeFileSync(
                join(workflowsDir, 'task-lifecycle.yaml'),
                'kind: state-machine\nname: task-lifecycle\ninitialState: backlog\nstates: []\ntransitions: []\n',
            );
        });

        afterAll(() => {
            rmSync(tmpDir, { recursive: true, force: true });
        });

        test('returns a LifecycleAdapter when bundledConfigRoot is null but project-local YAML exists', (): void => {
            const nullRootSpy = spyOn(configModule, 'bundledConfigRoot').mockReturnValue(null);
            spies.push(nullRootSpy);

            // The context cwd points at our tmpDir which has `.spur/workflows/task-lifecycle.yaml`.
            const ctx = createCliContext({ output: nullOutput(), cwd: tmpDir });
            const result = makeLifecycleAdapter(ctx, TASK_LIFECYCLE_PROFILE);

            expect(result).toBeInstanceOf(LifecycleAdapter);
        });

        test('returns undefined when bundledConfigRoot is null AND project-local YAML is missing', (): void => {
            const nullRootSpy = spyOn(configModule, 'bundledConfigRoot').mockReturnValue(null);
            spies.push(nullRootSpy);

            // No .spur/workflows/ directory — cwd is one level above the tmpDir.
            const ctx = createCliContext({ output: nullOutput(), cwd: join(tmpDir, '..') });
            const result = makeLifecycleAdapter(ctx, { ...TASK_LIFECYCLE_PROFILE, workflowName: 'does-not-exist' });

            expect(result).toBeUndefined();
        });
    });
});
