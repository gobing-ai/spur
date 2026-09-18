/**
 * Producer-level tests for `runAgentUsageProducer` (B6 0892 R1–R3):
 * snapshot + quota-owned apply, dry-run write-nothing, and fail-closed capture.
 * In-memory SQLite + injectable fake source; no real spawn.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentExecutorUpdateDao, applyCliMigrations } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import {
    type AgentUsageProducerContext,
    type RunAgentUsageOptions,
    runAgentUsageProducer,
} from '../../src/services/agent-usage-producer';
import { type UsageCapture, type UsageSource, UsageSourceError } from '../../src/services/agent-usage-source';

function healthyEntry(provider: string, usedPercent: number): unknown {
    return { provider, usage: { primary: { usedPercent }, secondary: null, tertiary: null } };
}

function fakeSource(stdout: string, exitCode = 0): UsageSource {
    const capture = (): Promise<UsageCapture> => Promise.resolve({ exitCode, stdout, stderr: '' });
    return { name: 'codexbar', capture };
}

describe('runAgentUsageProducer', () => {
    let db: DbAdapter;
    let dir: string;
    let context: AgentUsageProducerContext;
    let dao: AgentExecutorUpdateDao;

    beforeEach(async () => {
        db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        dao = new AgentExecutorUpdateDao(db);
        dir = mkdtempSync(join(tmpdir(), 'usage-producer-'));
        context = {
            getDb: () => db,
            projectRoot: dir,
            loadAgentConfig: async () => ({
                agent: {
                    executors: [{ name: 'alpha', agent: 'alpha', disabled: { reason: 'quota', owner: 'quota' } }],
                },
            }),
            warn: () => {},
        } as unknown as AgentUsageProducerContext;
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    test('R1: applies quota-owned disable→enable for a matching executor and writes the snapshot', async () => {
        await dao.recordObservation({
            project_id: dir,
            executor_name: 'alpha',
            observation_id: 'obs-1',
            observed_at: '2025-12-31T00:00:00.000Z',
            agent: null,
            model: null,
            disabled: true,
            owner: 'quota',
            layer: 'global',
        });
        const snapshotPath = join(dir, 'agent-usage.json');
        const stdout = JSON.stringify([healthyEntry('alpha', 12.5)]);
        const result = await runAgentUsageProducer(context, {
            source: fakeSource(stdout),
            snapshotPath,
            now: () => new Date('2026-01-01T00:00:00Z'),
        });
        expect(result.source).toBe('codexbar');
        expect(result.erroredProviders).toHaveLength(0);
        expect(result.changes.some((c) => c.executor === 'alpha' && c.action === 'applied')).toBe(true);
        expect(result.snapshotPath).toBe(snapshotPath);
        expect(result.drain).not.toBeNull();
        const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as { source: string };
        expect(snapshot.source).toBe('codexbar');
    });

    test('R2: dry run reports would-be changes but writes neither snapshot nor rows', async () => {
        const snapshotPath = join(dir, 'unused.json');
        const stdout = JSON.stringify([healthyEntry('alpha', 80)]);
        const result = await runAgentUsageProducer(context, {
            source: fakeSource(stdout),
            snapshotPath,
            dryRun: true,
        });
        expect(result.snapshotPath).toBeNull();
        expect(result.drain).toBeNull();
        expect(existsSync(snapshotPath)).toBe(false);
        expect(await dao.getUpdate(dir, 'alpha')).toBeUndefined();
    });

    test('R3: unusable capture throws UsageSourceError and touches nothing', async () => {
        const snapshotPath = join(dir, 'never.json');
        try {
            await runAgentUsageProducer(context, {
                source: {
                    name: 'codexbar',
                    capture: () => Promise.reject(new UsageSourceError('spawn failed')),
                } satisfies UsageSource,
                snapshotPath,
            });
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(UsageSourceError);
        }
        expect(existsSync(snapshotPath)).toBe(false);
        expect(await dao.getUpdate(dir, 'alpha')).toBeUndefined();
    });
});

// Type-only guard: options stay structural for CLI injection.
export type { RunAgentUsageOptions };
