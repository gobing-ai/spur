/**
 * Pipeline run-link helper + TASK_FORWARD_CHAIN parity (task 0436 residuals).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCliMigrations, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { ensurePipelineRunLink, TASK_FORWARD_CHAIN } from '../../src/services/pipeline-run-link';

describe('TASK_FORWARD_CHAIN', () => {
    test('matches config/workflows/task-lifecycle.yaml forward path order', () => {
        // Parity lock: if the lifecycle FSM forward path changes, update
        // TASK_FORWARD_CHAIN (and this test) in the same commit.
        const yamlPath = join(import.meta.dir, '../../../../config/workflows/task-lifecycle.yaml');
        const yaml = readFileSync(yamlPath, 'utf8');
        // Prefer the documented comment; fall back to scanning forward transitions.
        const commentMatch = yaml.match(/Forward path:\s*([^\n]+)/i);
        let chainFromYaml: string[] | undefined;
        if (commentMatch?.[1]) {
            chainFromYaml = commentMatch[1]
                .split('→')
                .map((s) => s.trim())
                .filter(Boolean);
        }
        expect(chainFromYaml).toEqual([...TASK_FORWARD_CHAIN]);
    });
});

describe('ensurePipelineRunLink', () => {
    const adapters: Array<{ close: () => void }> = [];

    afterAll(() => {
        for (const db of adapters) db.close();
    });

    test('creates a pipeline link when none exists', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        adapters.push(db);
        await applyCliMigrations(db);

        const result = await ensurePipelineRunLink(db, '9999', { runId: 'test:9999' });
        expect(result.created).toBe(true);
        expect(result.kind).toBe('pipeline');
        expect(result.wbs).toBe('9999');
        expect(result.runId).toBe('test:9999');

        const links = await new TaskRunLinkDao(db).listByWbs('9999', 20);
        expect(links).toHaveLength(1);
        expect(links[0]?.kind).toBe('pipeline');
    });

    test('is idempotent — second call does not insert another pipeline link', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        adapters.push(db);
        await applyCliMigrations(db);

        const first = await ensurePipelineRunLink(db, '9998', { runId: 'test:first' });
        const second = await ensurePipelineRunLink(db, '9998', { runId: 'test:second' });
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.id).toBe(first.id);
        expect(second.runId).toBe('test:first'); // keeps the original

        const links = await new TaskRunLinkDao(db).listByWbs('9998', 20);
        expect(links.filter((l) => l.kind === 'pipeline')).toHaveLength(1);
    });
});
