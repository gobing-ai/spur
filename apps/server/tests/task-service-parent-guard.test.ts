import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SectionMatrix } from '@gobing-ai/spur-app';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createServerContext } from '../src/context';
import { mockRuntime } from './middleware/helpers';

/**
 * 1132 R2 through the HTTP surface (pass-3 review coverage gap). The server builds its
 * TaskService with the configured `features.dir` and a `featureTransition` port bound to the
 * feature lifecycle — without either, the parent-status guard either goes inert (basename
 * heuristic) or reopens through the TASK profile, whose FSM declares no `verifying` state.
 */

/** Minimal matrix: creation only needs the variant + status entries it validates against. */
const MATRIX: SectionMatrix = {
    variants: {
        'feature-impl': {
            backlog: { required: ['Background'], optional: ['Requirements', 'Acceptance Criteria', 'Design', 'Plan'] },
            todo: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
        },
    },
};

const FEATURE = (id: string, status: string): string =>
    [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `name: Feature ${id}`,
        `status: ${status}`,
        'created_at: 2026-10-01T00:00:00Z',
        'updated_at: 2026-10-01T00:00:00Z',
        '---',
        `# ${id} Feature ${id}`,
        '## Goal',
        'g',
        '## Scope',
        's',
        '## Acceptance Criteria',
        'ac',
        '## Tasks',
        '',
    ].join('\n');

describe('1132 — parent-status link guard on the server context', () => {
    test('a verifying parent is reopened through the feature lifecycle, not the task profile', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-1132-server-'));
        try {
            // A phase folder whose sibling is NOT `<tasks>/../features` by accident: the point is
            // that the configured features dir is used (pass-3 P1 residue on the HTTP surface).
            const tasksDir = join(root, 'docs', 'tasksP');
            // Deliberately NOT the sibling of tasksDir: the pre-fix wiring used
            // `<parent of tasksDir>/features`, so a fixture where the configured dir IS the
            // sibling passed with or without the fix (review pass 4 found this test
            // non-discriminating). With a non-sibling store, only the configured dir works.
            const featuresDir = join(root, 'docs', 'feature-store');
            mkdirSync(tasksDir, { recursive: true });
            mkdirSync(featuresDir, { recursive: true });
            mkdirSync(join(root, '.spur'), { recursive: true });
            writeFileSync(
                join(root, '.spur', 'config.yaml'),
                [
                    'version: "1"',
                    'tasks:',
                    '  folders:',
                    '    docs/tasksP:',
                    '      baseCounter: 0',
                    '  active: docs/tasksP',
                    'features:',
                    '  dir: docs/feature-store',
                    '',
                ].join('\n'),
            );
            writeFileSync(join(featuresDir, 'F2_verifying.md'), FEATURE('F2', 'verifying'));

            const ctx = createServerContext(mockRuntime(), {
                cwd: root,
                fs: createNodeFileSystem(root),
                dbUrl: ':memory:',
                sectionMatrix: MATRIX,
                // serve.ts resolves these from `.spur/config.yaml` and passes absolute paths;
                // mirroring that is the point of the test (a relative/basename fallback would
                // resolve against the process cwd instead of this fixture).
                folders: {
                    tasksDir,
                    featuresDir,
                    foldersConfig: { active_folder: tasksDir, folders: { [tasksDir]: { baseCounter: 0 } } },
                },
            });
            const result = await ctx.taskService().create({
                title: 'server reopen probe',
                featureId: 'F2',
                dedupeWithinSec: null,
            });

            expect(result.featureReopened).toEqual({ id: 'F2', from: 'verifying', to: 'active' });
            expect(readFileSync(join(featuresDir, 'F2_verifying.md'), 'utf8')).toContain('status: active');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
