/**
 * Task 1134 R5/R6 — the scheduled observation-refresh job: drains pending availability
 * updates, reports the usage-snapshot age, and expires quota/probe-owned disables past
 * their TTL through the ownership-scoped recovery path. Asserts the zero-provider-request
 * contract structurally (the job holds no provider seam) and that an operator-owned
 * disable is never auto-re-enabled (AC6).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { applyCliMigrations } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { parse as parseYaml } from 'yaml';
import {
    observationRefreshStatusPath,
    QUOTA_DISABLE_TTL_MS,
    readObservationRefreshStatus,
    runObservationRefresh,
} from '../../src/services/agent-quota-refresh';
import { type AgentQuotaUpdatesContext, drainPendingAgentQuotaUpdates } from '../../src/services/agent-quota-updates';

const NOW = Date.parse('2026-10-09T20:00:00.000Z');
const EXPIRED_SINCE = new Date(NOW - QUOTA_DISABLE_TTL_MS - 60_000).toISOString();
const FRESH_SINCE = new Date(NOW - 60_000).toISOString();

let root: string;
let db: DbAdapter;
let warnings: string[];

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'agent-quota-refresh-'));
    mkdirSync(join(root, '.spur', 'memory'), { recursive: true });
    writeFileSync(
        join(root, '.spur', 'config.yaml'),
        [
            'agent:',
            '  executors:',
            '    - name: exhausted',
            '      agent: omp',
            '      disabled:',
            '        owner: quota',
            `        since: ${EXPIRED_SINCE}`,
            '        reason: agent.quota.exhausted exhausted',
            '    - name: recent',
            '      agent: claude',
            '      disabled:',
            '        owner: quota',
            `        since: ${FRESH_SINCE}`,
            '        reason: agent.quota.exhausted recent',
            '    - name: operator-pinned',
            '      agent: codex',
            '      disabled: true',
            '',
        ].join('\n'),
    );
    setEnvVar('SPUR_SKIP_GLOBAL_CONFIG', 'true');
    db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(db);
    warnings = [];
});

afterEach(() => {
    removeEnvVar('SPUR_SKIP_GLOBAL_CONFIG');
    rmSync(root, { recursive: true, force: true });
    db.close();
});

function context(): AgentQuotaUpdatesContext {
    return {
        getDb: async () => db,
        projectRoot: root,
        // Tests are exempt from the ADR-082 composition-root rule.
        loadAgentConfig: async (projectRoot: string) => {
            try {
                return await loadSpurConfig(projectRoot);
            } catch {
                return null;
            }
        },
        warn: (message) => warnings.push(message),
    };
}

function availability(executor: string): { disabled: unknown } {
    const parsed = parseYaml(readFileSync(join(root, '.spur', 'config.yaml'), 'utf8')) as {
        agent: { executors: Array<{ name: string; disabled: unknown }> };
    };
    const entry = parsed.agent.executors.find((candidate) => candidate.name === executor);
    if (entry === undefined) throw new Error(`missing executor ${executor}`);
    return entry;
}

describe('runObservationRefresh (1134 R5/AC6)', () => {
    test('expires a TTL-ed quota disable and leaves fresh and operator-owned ones alone', async () => {
        const outcome = await runObservationRefresh(context(), {
            now: () => NOW,
            snapshotPath: join(root, '.spur', 'memory', 'agent-usage.json'),
        });

        expect(outcome.expiredExecutors).toEqual(['exhausted']);
        expect(outcome.status.expired).toBe(1);
        // Ownership scope: one quota-owned row applied; the operator-owned disable is untouched.
        expect(outcome.status.applied).toBe(1);
        expect(availability('exhausted').disabled).toBe(false);
        expect(availability('recent').disabled).toMatchObject({ owner: 'quota' });
        expect(availability('operator-pinned').disabled).toBe(true);
        expect(warnings.some((message) => message.includes('operator-owned'))).toBe(false);
    });

    test('makes zero provider requests and reports a missing snapshot as stale', async () => {
        // No injected clock: the real `Date.now` default is part of the job's contract too.
        const outcome = await runObservationRefresh(context());
        // Structural: the job holds no provider seam at all, so the counter cannot move.
        expect(outcome.status.providerRequests).toBe(0);
        expect(outcome.status.snapshotAgeMs).toBeNull();
        expect(outcome.status.snapshotStale).toBe(true);
    });

    test('reports an aged snapshot without mutating it', async () => {
        const snapshotPath = join(root, '.spur', 'memory', 'agent-usage.json');
        writeFileSync(snapshotPath, `${JSON.stringify({ captured_at: '2026-10-09T10:00:00.000Z' })}\n`);
        const outcome = await runObservationRefresh(context(), { now: () => NOW, snapshotPath });
        expect(outcome.status.snapshotAgeMs).toBe(10 * 60 * 60 * 1000);
        expect(outcome.status.snapshotStale).toBe(true);
        expect(readFileSync(snapshotPath, 'utf8')).toContain('2026-10-09T10:00:00.000Z');
    });

    test('records a readable last-run summary and is idempotent on a second run', async () => {
        const first = await runObservationRefresh(context(), { now: () => NOW });
        expect(first.expiredExecutors).toEqual(['exhausted']);
        const status = readObservationRefreshStatus(root);
        expect(status?.ranAt).toBe(new Date(NOW).toISOString());
        expect(status?.expired).toBe(1);
        expect(readFileSync(observationRefreshStatusPath(root), 'utf8')).toContain('"providerRequests": 0');

        const second = await runObservationRefresh(context(), { now: () => NOW + 1000 });
        expect(second.expiredExecutors).toEqual([]);
        expect(second.status.expired).toBe(0);
        expect(availability('exhausted').disabled).toBe(false);
    });

    test('a drain with no pending rows reports zero applied', async () => {
        await expect(drainPendingAgentQuotaUpdates(context())).resolves.toMatchObject({ applied: 0, failed: 0 });
    });

    test('an unreadable or malformed status file reads as never-run', async () => {
        writeFileSync(observationRefreshStatusPath(root), '{ not json');
        expect(readObservationRefreshStatus(root)).toBeNull();
        writeFileSync(observationRefreshStatusPath(root), '"scalar"');
        expect(readObservationRefreshStatus(root)).toBeNull();
        writeFileSync(observationRefreshStatusPath(root), '{"applied": 2}');
        expect(readObservationRefreshStatus(root)).toBeNull();
    });

    test('an unavailable effective config is reported and expires nothing', async () => {
        const outcome = await runObservationRefresh(
            {
                ...context(),
                loadAgentConfig: async () => {
                    throw new Error('config unavailable');
                },
            },
            { now: () => NOW },
        );
        expect(outcome.expiredExecutors).toEqual([]);
        expect(warnings.some((message) => message.includes('effective agent config unavailable'))).toBe(true);
        expect(availability('exhausted').disabled).toMatchObject({ owner: 'quota' });
    });

    test('a classified recovery rejection is reported, never silently dropped', async () => {
        let reads = 0;
        const flaky: AgentQuotaUpdatesContext = {
            ...context(),
            // First read feeds the loop; every later read is unavailable, so the durable
            // consumer classifies the recovery as a rejection.
            loadAgentConfig: (projectRoot: string) => {
                reads += 1;
                return reads === 1 ? loadSpurConfig(projectRoot) : Promise.resolve(null);
            },
        };
        const outcome = await runObservationRefresh(flaky, { now: () => NOW });
        expect(outcome.expiredExecutors).toEqual([]);
        expect(warnings.some((message) => message.includes('not recorded'))).toBe(true);
    });

    test('an unparsable usage snapshot is reported as absent, never invented', async () => {
        const snapshotPath = join(root, '.spur', 'memory', 'agent-usage.json');
        writeFileSync(snapshotPath, 'not-json');
        const outcome = await runObservationRefresh(context(), { now: () => NOW, snapshotPath });
        expect(outcome.status.snapshotAgeMs).toBeNull();
        expect(outcome.status.snapshotStale).toBe(true);
    });
});
