/**
 * Task 0799: durable `agent_executor_updates` consumer — trusted-attribution
 * recording, latest-observation semantics, version-conditional drain, and the
 * long-lived consumer lifecycle. Uses temporary project configs + in-memory
 * SQLite; byte-level YAML assertions reuse the 0797 updater fixtures.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { AgentExecutorUpdateDao, applyCliMigrations } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { EventBus } from '@gobing-ai/ts-infra';
import { parse as parseYaml } from 'yaml';
import {
    type AgentQuotaUpdatesContext,
    attachAgentQuotaUpdates,
    drainPendingAgentQuotaUpdates,
    MAX_QUOTA_DRAIN_ATTEMPTS_PER_ACTIVATION,
    recordAgentQuotaEvent,
    startAgentQuotaUpdateConsumer,
} from '../../src/services/agent-quota-updates';

let root: string;
let db: DbAdapter;

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'agent-quota-updates-'));
    mkdirSync(join(root, '.spur'), { recursive: true });
    writeFileSync(
        join(root, '.spur', 'config.yaml'),
        [
            'agent:',
            '  executors:',
            '    - name: alpha',
            '      agent: omp',
            '      model: gpt-5',
            '    - name: beta',
            '      agent: claude',
            '',
        ].join('\n'),
    );
    process.env.SPUR_SKIP_GLOBAL_CONFIG = 'true';
    db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(db);
});

afterEach(async () => {
    delete process.env.SPUR_SKIP_GLOBAL_CONFIG;
    rmSync(root, { recursive: true, force: true });
    db.close();
});

/** Loader-backed accessor — tests are exempt from the composition-root rule. */
const testLoadAgentConfig = async (projectRoot: string) => {
    try {
        return await loadSpurConfig(projectRoot);
    } catch {
        return null;
    }
};

function context(warn: (message: string) => void = () => {}): AgentQuotaUpdatesContext {
    return {
        getDb: async () => db,
        projectRoot: root,
        // Tests are exempt from the ADR-082 composition-root rule, so the
        // injected accessor wraps the real loader (same semantics as the
        // production closures in serve.ts / cli index.ts).
        loadAgentConfig: async (projectRoot: string) => {
            try {
                return await loadSpurConfig(projectRoot);
            } catch {
                return null;
            }
        },
        warn,
    };
}

function exhaustion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        observationId: 'obs-1',
        observedAt: '2026-02-01T10:00:00.000Z',
        evidenceSource: 'buffered-error',
        reason: 'usage_limit_reached',
        attribution: { projectId: root, executor: 'alpha', agent: 'omp', model: 'gpt-5' },
        correlation: { runId: 'run-1' },
        ...overrides,
    };
}

function recovery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        observationId: 'obs-1',
        recoveredAt: '2026-02-01T11:00:00.000Z',
        attribution: { projectId: root, executor: 'alpha', agent: 'omp' },
        ...overrides,
    };
}

async function yamlDisabled(executor: string): Promise<boolean | undefined> {
    const parsed = parseYaml(readFileSync(join(root, '.spur', 'config.yaml'), 'utf8')) as {
        agent: { executors: Array<{ name: string; disabled?: boolean }> };
    };
    return parsed.agent.executors.find((entry) => entry.name === executor)?.disabled;
}

describe('recordAgentQuotaEvent (0799 R1/R2)', () => {
    test('records a trusted attributed exhaustion as pending disabled=true', async () => {
        expect(await recordAgentQuotaEvent(context(), exhaustion(), true)).toBe('recorded');
        const row = await new AgentExecutorUpdateDao(db).getUpdate(root, 'alpha');
        expect(row?.disabled).toBe(1);
        expect(row?.observed_at).toBe('2026-02-01T10:00:00.000Z');
    });

    test('maps a trusted recovery to pending disabled=false', async () => {
        await recordAgentQuotaEvent(context(), exhaustion(), true);
        expect(await recordAgentQuotaEvent(context(), recovery({ observationId: 'obs-2' }), false)).toBe('recorded');
        const row = await new AgentExecutorUpdateDao(db).getUpdate(root, 'alpha');
        expect(row?.disabled).toBe(0);
        expect(row?.observation_id).toBe('obs-2');
    });

    test('rejects malformed, unattributed, foreign, unknown, replaced-binding and unparsable events without a row', async () => {
        const dao = new AgentExecutorUpdateDao(db);
        const cases: Array<[string, unknown, boolean]> = [
            ['malformed', { nope: true }, true],
            ['unattributed', exhaustion({ attribution: undefined }), true],
            [
                'foreign project',
                exhaustion({ attribution: { projectId: '/elsewhere', executor: 'alpha', agent: 'omp' } }),
                true,
            ],
            [
                'unknown executor',
                exhaustion({ attribution: { projectId: root, executor: 'ghost', agent: 'omp' } }),
                true,
            ],
            [
                'replaced agent',
                exhaustion({ attribution: { projectId: root, executor: 'alpha', agent: 'claude' } }),
                true,
            ],
            [
                'replaced model',
                exhaustion({ attribution: { projectId: root, executor: 'alpha', agent: 'omp', model: 'claude-4' } }),
                true,
            ],
            ['bad timestamp', exhaustion({ observedAt: 'not-a-date' }), true],
            ['malformed recovery', { observationId: 'x' }, false],
            ['foreign recovery', recovery({ attribution: { projectId: '/elsewhere', executor: 'alpha' } }), false],
        ];
        for (const [name, event, isExhaustion] of cases) {
            const outcome = await recordAgentQuotaEvent(context(), event, isExhaustion);
            expect(typeof outcome === 'object' && 'rejected' in outcome, name).toBe(true);
        }
        expect(await dao.pendingUpdates()).toHaveLength(0);
    });

    test('redelivery of the same observationId is an idempotent duplicate (crash replay)', async () => {
        await recordAgentQuotaEvent(context(), exhaustion(), true);
        expect(await recordAgentQuotaEvent(context(), exhaustion(), true)).toBe('duplicate');
        expect(await new AgentExecutorUpdateDao(db).pendingUpdates()).toHaveLength(1);
    });

    test('a newer observation supersedes the retained row', async () => {
        await recordAgentQuotaEvent(context(), exhaustion(), true);
        expect(
            await recordAgentQuotaEvent(
                context(),
                exhaustion({ observationId: 'obs-2', observedAt: '2026-02-01T12:00:00.000Z' }),
                true,
            ),
        ).toBe('recorded');
        expect(
            await recordAgentQuotaEvent(
                context(),
                exhaustion({ observationId: 'obs-0', observedAt: '2026-02-01T09:00:00.000Z' }),
                true,
            ),
        ).toBe('superseded');
        const row = await new AgentExecutorUpdateDao(db).getUpdate(root, 'alpha');
        expect(row?.observation_id).toBe('obs-2');
    });
});

describe('attachAgentQuotaUpdates (0799 R5)', () => {
    test('persists bus events and surfaces rejections through warn', async () => {
        const warnings: string[] = [];
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const attachment = attachAgentQuotaUpdates(
            bus,
            context((m) => warnings.push(m)),
        );
        bus.emit('agent.quota.exhausted', exhaustion());
        await attachment.flush();
        expect(await new AgentExecutorUpdateDao(db).pendingUpdates()).toHaveLength(1);
        bus.emit('agent.quota.exhausted', exhaustion({ attribution: undefined }));
        await attachment.flush();
        expect(warnings.some((w) => w.includes('rejected: missing project/executor attribution'))).toBe(true);
        attachment.unsubscribe();
        bus.emit('agent.quota.exhausted', exhaustion({ observationId: 'obs-9' }));
        await attachment.flush();
        expect(await new AgentExecutorUpdateDao(db).pendingUpdates()).toHaveLength(1);
    });
});

describe('drainPendingAgentQuotaUpdates (0799 R1/R2/R5)', () => {
    test('applies pending exhaustion to the YAML and acks version-specifically', async () => {
        await recordAgentQuotaEvent(context(), exhaustion(), true);
        const summary = await drainPendingAgentQuotaUpdates(context());
        expect(summary.applied).toBe(1);
        expect(await yamlDisabled('alpha')).toBe(true);
        expect(await new AgentExecutorUpdateDao(db).pendingUpdates()).toHaveLength(0);
    });

    test('applies a recovery to disabled=false without a timer or polling producer', async () => {
        await setImmediate(async () => {});
        await recordAgentQuotaEvent(context(), exhaustion(), true);
        await drainPendingAgentQuotaUpdates(context());
        await recordAgentQuotaEvent(
            context(),
            recovery({ observationId: 'obs-2', recoveredAt: '2026-02-01T11:00:00.000Z' }),
            false,
        );
        const summary = await drainPendingAgentQuotaUpdates(context());
        expect(summary.applied).toBe(1);
        expect(await yamlDisabled('alpha')).toBe(false);
    });

    test('replaying an observation from the crash-before-ack window is an updater no-op, still acked', async () => {
        await recordAgentQuotaEvent(context(), exhaustion(), true);
        await drainPendingAgentQuotaUpdates(context());
        // Simulate the crash window: YAML renamed, ack lost — applied marker reset.
        await db.run('UPDATE agent_executor_updates SET applied_observation_id = NULL, applied_at = NULL');
        const summary = await drainPendingAgentQuotaUpdates(context());
        expect(summary.applied).toBe(1);
        expect(await yamlDisabled('alpha')).toBe(true);
        expect(await new AgentExecutorUpdateDao(db).pendingUpdates()).toHaveLength(0);
    });

    test('a superseding recovery during the write keeps the newer row pending (conditional ack)', async () => {
        await recordAgentQuotaEvent(context(), exhaustion(), true);
        // Newer recovery lands BEFORE the drain reads, but we simulate the classic
        // interleaving by acking the OLD version directly — the conditional ack must
        // refuse to mark it applied once a newer observation owns the row.
        const dao = new AgentExecutorUpdateDao(db);
        await recordAgentQuotaEvent(context(), recovery({ observationId: 'obs-2' }), false);
        expect(await dao.ackApplied(root, 'alpha', 'obs-1', '2026-02-01T10:05:00.000Z')).toBe(false);
        const summary = await drainPendingAgentQuotaUpdates(context());
        expect(summary.applied).toBe(1);
        expect(await yamlDisabled('alpha')).toBe(false);
        expect(await dao.pendingUpdates()).toHaveLength(0);
    });

    test('unknown executor at drain time is acknowledged as a visible no-op', async () => {
        await recordAgentQuotaEvent(context(), exhaustion(), true);
        writeFileSync(
            join(root, '.spur', 'config.yaml'),
            ['agent:', '  executors:', '    - name: beta', '      agent: claude', ''].join('\n'),
        );
        const warnings: string[] = [];
        const summary = await drainPendingAgentQuotaUpdates(context((m) => warnings.push(m)));
        expect(summary.skippedUnknownExecutor).toBe(1);
        expect(await new AgentExecutorUpdateDao(db).pendingUpdates()).toHaveLength(0);
        expect(warnings.some((w) => w.includes('unknown executor'))).toBe(true);
    });

    test('replaced profile binding at drain time is acknowledged as a visible no-op', async () => {
        await recordAgentQuotaEvent(context(), exhaustion(), true);
        writeFileSync(
            join(root, '.spur', 'config.yaml'),
            [
                'agent:',
                '  executors:',
                '    - name: alpha',
                '      agent: claude',
                '      model: claude-4',
                '    - name: beta',
                '      agent: claude',
                '',
            ].join('\n'),
        );
        const summary = await drainPendingAgentQuotaUpdates(context());
        expect(summary.skippedBindingReplaced).toBe(1);
        expect(await new AgentExecutorUpdateDao(db).pendingUpdates()).toHaveLength(0);
        expect(await yamlDisabled('alpha')).toBeUndefined();
    });

    test('a failed write stays pending and visible, retried to the activation bound, never acked', async () => {
        await recordAgentQuotaEvent(context(), exhaustion(), true);
        // Block ONLY the updater's atomic temp write: a directory squatting on the
        // `.config.yaml.tmp-<pid>` path makes `open(..., 'wx')` fail fast (EEXIST →
        // CONFIG_WRITE_FAILED) while loadSpurConfig still validates the real config.
        const configPath = join(root, '.spur', 'config.yaml');
        const tmpBlocker = join(root, '.spur', `.${basename(configPath)}.tmp-${process.pid}`);
        mkdirSync(tmpBlocker);
        const summary = await drainPendingAgentQuotaUpdates(context());
        expect(summary.failed).toBe(1);
        const dao = new AgentExecutorUpdateDao(db);
        const row = await dao.getUpdate(root, 'alpha');
        expect(row?.applied_observation_id).toBeNull();
        expect(row?.attempts).toBe(MAX_QUOTA_DRAIN_ATTEMPTS_PER_ACTIVATION);
        expect(row?.last_error).toContain('failed to commit project config update');
        // Remove the blocker; the retained row retries and heals.
        rmdirSync(tmpBlocker);
        const healed = await drainPendingAgentQuotaUpdates(context());
        expect(healed.applied).toBe(1);
        expect(await yamlDisabled('alpha')).toBe(true);
    });
});

describe('startAgentQuotaUpdateConsumer (0799 R5)', () => {
    test('drains on wake and drains once more on stop; handlers detach after stop', async () => {
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const consumer = startAgentQuotaUpdateConsumer(bus, context(), { pollIntervalMs: 60_000 });
        bus.emit('agent.quota.exhausted', exhaustion());
        // Let the async record path settle before the serialized drain reads.
        await new Promise((resolve) => setTimeout(resolve, 20));
        const summary = await consumer.drain();
        expect(summary.applied).toBe(1);
        expect(await yamlDisabled('alpha')).toBe(true);
        await consumer.stop();
        bus.emit('agent.quota.exhausted', exhaustion({ observationId: 'obs-9' }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        // After stop the handler is detached; the replayed event must not persist.
        expect(await new AgentExecutorUpdateDao(db).pendingUpdates()).toHaveLength(0);
    });
});

describe('failure isolation branches (0799 R2/R5 coverage)', () => {
    test('record rejects with a classified warning when the effective config is unavailable', async () => {
        // A MISSING file loads as an empty default config; a MALFORMED one makes
        // the loader throw, which is the classified "unavailable" rejection.
        writeFileSync(join(root, '.spur', 'config.yaml'), 'agent: [unclosed');
        const outcome = await recordAgentQuotaEvent(context(), exhaustion(), true);
        expect(outcome).toEqual({ rejected: expect.stringContaining('effective agent config unavailable') });
    });

    test('bus surface warns on superseded outcomes and persistence failures', async () => {
        const warnings: string[] = [];
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const attachment = attachAgentQuotaUpdates(
            bus,
            context((m) => warnings.push(m)),
        );
        bus.emit('agent.quota.exhausted', exhaustion({ observationId: 'obs-new' }));
        await attachment.flush();
        // Stale arrival: retained row is newer, so the outcome is `superseded`.
        bus.emit(
            'agent.quota.exhausted',
            exhaustion({ observationId: 'obs-old', observedAt: '2026-01-01T09:00:00.000Z' }),
        );
        await attachment.flush();
        expect(warnings.some((w) => w.includes('superseded by a newer observation'))).toBe(true);
        attachment.unsubscribe();

        // Persistence failure: getDb rejects, the handler warns and never throws.
        const broken: AgentQuotaUpdatesContext = {
            getDb: async () => {
                throw new Error('db unavailable');
            },
            projectRoot: root,
            loadAgentConfig: testLoadAgentConfig,
            warn: (m) => warnings.push(m),
        };
        const bus2 = new EventBus<Record<string, (event: unknown) => void>>();
        const attachment2 = attachAgentQuotaUpdates(bus2, broken);
        bus2.emit('agent.quota.exhausted', exhaustion({ observationId: 'obs-broken' }));
        await attachment2.flush();
        expect(warnings.some((w) => w.includes('persistence failed'))).toBe(true);
        attachment2.unsubscribe();
    });

    test('drain with an unavailable config records visible failures and defers within the bound', async () => {
        const outcome = await recordAgentQuotaEvent(context(), exhaustion(), true);
        expect(outcome).toBe('recorded');
        writeFileSync(join(root, '.spur', 'config.yaml'), 'agent: [unclosed');
        const warnings: string[] = [];
        const summary = await drainPendingAgentQuotaUpdates(context((m) => warnings.push(m)));
        expect(summary.applied).toBe(0);
        expect(summary.failed).toBe(1);
        expect(summary.deferred).toBe(1);
        const dao = new AgentExecutorUpdateDao(db);
        const row = await dao.getUpdate(root, 'alpha');
        expect(row?.attempts).toBe(MAX_QUOTA_DRAIN_ATTEMPTS_PER_ACTIVATION);
        expect(row?.last_error).toContain('effective agent config unavailable');
        // Still pending: a failed write is never acknowledged (R2).
        expect(await dao.pendingUpdates()).toHaveLength(1);
    });

    test('drain acknowledges a no-op when the recorded model binding was replaced', async () => {
        expect(await recordAgentQuotaEvent(context(), exhaustion(), true)).toBe('recorded');
        writeFileSync(
            join(root, '.spur', 'config.yaml'),
            [
                'agent:',
                '  executors:',
                '    - name: alpha',
                '      agent: omp',
                '      model: gpt-6',
                '    - name: beta',
                '      agent: claude',
                '',
            ].join('\n'),
        );
        const summary = await drainPendingAgentQuotaUpdates(context());
        expect(summary.skippedBindingReplaced).toBe(1);
        expect(summary.applied).toBe(0);
        const row = await new AgentExecutorUpdateDao(db).getUpdate(root, 'alpha');
        // Acked as applied (the observation version recorded), pending work cleared.
        expect(row?.applied_observation_id).toBe('obs-1');
        expect(await yamlDisabled('alpha')).toBeUndefined();
    });

    test('consumer wake and final-drain failures surface through warn and stop still resolves', async () => {
        const warnings: string[] = [];
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const broken: AgentQuotaUpdatesContext = {
            getDb: async () => {
                throw new Error('db unavailable');
            },
            projectRoot: root,
            loadAgentConfig: testLoadAgentConfig,
            warn: (m) => warnings.push(m),
        };
        const consumer = startAgentQuotaUpdateConsumer(bus, broken, { pollIntervalMs: 1 });
        // Poll timer fires wake() at 1ms; give the serialized drain time to fail.
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(warnings.some((w) => w.includes('drain failed'))).toBe(true);
        await consumer.stop();
        expect(warnings.some((w) => w.includes('final drain failed'))).toBe(true);
    });
});
