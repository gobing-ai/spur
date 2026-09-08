/**
 * Unit tests for `attachAgentQuotaPersistence` (task 0799 R1) — the CLI
 * EventBus → `agent_executor_updates` bridge, mirroring the
 * system-event-ledger coverage: recorded rows, rejection surface, and
 * failure-isolation on an unavailable DB.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { AgentExecutorUpdateDao, applyCliMigrations } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { EventBus } from '@gobing-ai/ts-infra';
import { attachAgentQuotaPersistence } from '../src/agent-quota-persistence';
import { createCapturedOutput } from './helpers';

describe('attachAgentQuotaPersistence (0799 R1)', () => {
    let db: DbAdapter;
    let root: string;

    beforeEach(async () => {
        db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        root = mkdtempSync(join(tmpdir(), 'quota-persistence-'));
        // Recording resolves the executor against the effective project config.
        mkdirSync(join(root, '.spur'), { recursive: true });
        writeFileSync(
            join(root, '.spur', 'config.yaml'),
            ['agent:', '  executors:', '    - name: alpha', '      agent: omp', '      model: gpt-5', ''].join('\n'),
        );
        // NOTE: deliberately NOT setting SPUR_SKIP_GLOBAL_CONFIG here. bun test
        // runs every apps/cli test file in ONE process; toggling that env var in
        // an early-alphabet file poisons first-load memoization for later command
        // tests whose fixtures rely on default layering. The project layer wins
        // the merge, so `alpha` resolves with or without the global layer.
    });

    afterEach(async () => {
        db.close();
        rmSync(root, { recursive: true, force: true });
    });

    function context(getDb: () => Promise<DbAdapter>) {
        return {
            cwd: root,
            getDb,
            // Loader-backed accessor — tests are exempt from the composition-root rule.
            loadAgentConfig: async (projectRoot: string) => {
                try {
                    return await loadSpurConfig(projectRoot);
                } catch {
                    return null;
                }
            },
            output: createCapturedOutput(),
        };
    }

    function exhaustionEvent() {
        return {
            observationId: 'obs-1',
            observedAt: '2026-02-01T10:00:00.000Z',
            evidenceSource: 'buffered-error',
            reason: 'usage_limit_reached',
            attribution: { projectId: root, executor: 'alpha', agent: 'omp', model: 'gpt-5' },
            correlation: { runId: 'run-1' },
        };
    }

    test('persists bus events into the project delivery table and flushes before exit', async () => {
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const ctx = context(async () => db);
        const attachment = attachAgentQuotaPersistence(bus as never, ctx as never);
        bus.emit('agent.quota.exhausted', exhaustionEvent());
        await attachment.flush();
        attachment.unsubscribe();
        const row = await new AgentExecutorUpdateDao(db).getUpdate(root, 'alpha');
        expect(row?.observation_id).toBe('obs-1');
        expect(row?.disabled).toBe(1);
    });

    test('degrades to stderr warnings when the DB is unavailable', async () => {
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const ctx = context(async () => {
            throw new Error('unmigrated workspace');
        });
        const attachment = attachAgentQuotaPersistence(bus as never, ctx as never);
        bus.emit('agent.quota.exhausted', exhaustionEvent());
        await attachment.flush();
        attachment.unsubscribe();
        expect(ctx.output.errors.some((m) => m.includes('persistence failed'))).toBe(true);
        expect(ctx.output.errors.some((m) => m.includes('unmigrated workspace'))).toBe(true);
    });
});
