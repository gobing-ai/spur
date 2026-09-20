/**
 * Producer-level tests for `runAgentUsageProducer` (B6 0892 R1–R3; 0907 R1–R4):
 * snapshot + quota-owned apply with exact-observation reconciliation, dry-run
 * write-nothing, fail-closed capture, conservative no-usage/operator handling.
 * Temporary project configs + the real loader/drain writer; SPUR_SKIP_GLOBAL_CONFIG
 * keeps global writes hermetic; in-memory SQLite; no real spawn.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { AgentExecutorUpdateDao, applyCliMigrations } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { parse as parseYaml } from 'yaml';
import {
    type AgentUsageProducerContext,
    type RunAgentUsageOptions,
    runAgentUsageProducer,
} from '../../src/services/agent-usage-producer';
import { type UsageCapture, type UsageSource, UsageSourceError } from '../../src/services/agent-usage-source';

function healthyEntry(provider: string, usedPercent: number, resetsAt?: string): unknown {
    return { provider, usage: { primary: { usedPercent, resetsAt }, secondary: null, tertiary: null } };
}

/** All windows null — a capture with no usable signal (0907 R1). */
function noUsageEntry(provider: string): unknown {
    return { provider, usage: { primary: null, secondary: null, tertiary: null } };
}

function fakeSource(stdout: string, exitCode = 0): UsageSource {
    const capture = (): Promise<UsageCapture> => Promise.resolve({ exitCode, stdout, stderr: '' });
    return { name: 'codexbar', capture };
}

let root: string;
let db: DbAdapter;
let dao: AgentExecutorUpdateDao;
let warnings: string[];

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'usage-producer-'));
    mkdirSync(join(root, '.spur'), { recursive: true });
    setEnvVar('SPUR_SKIP_GLOBAL_CONFIG', 'true');
    db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(db);
    dao = new AgentExecutorUpdateDao(db);
    warnings = [];
});

afterEach(async () => {
    removeEnvVar('SPUR_SKIP_GLOBAL_CONFIG');
    rmSync(root, { recursive: true, force: true });
    db.close();
});

function writeConfig(executors: string[]): void {
    writeFileSync(join(root, '.spur', 'config.yaml'), ['agent:', '  executors:', ...executors].join('\n'));
}

/** Loader-backed context — same semantics the CLI composition root injects. */
function context(overrides: Partial<AgentUsageProducerContext> = {}): AgentUsageProducerContext {
    return {
        getDb: async () => db,
        projectRoot: root,
        loadAgentConfig: async (projectRoot: string) => {
            try {
                return await loadSpurConfig(projectRoot);
            } catch {
                return null;
            }
        },
        warn: (message: string) => warnings.push(message),
        ...overrides,
    };
}

function run(
    stdout: string,
    options: Omit<RunAgentUsageOptions, 'source' | 'snapshotPath'> = {},
): ReturnType<typeof runAgentUsageProducer> {
    return runAgentUsageProducer(context(), {
        source: fakeSource(stdout),
        snapshotPath: join(root, 'agent-usage.json'),
        now: () => new Date('2026-01-01T00:00:00.000Z'),
        ...options,
    });
}

async function yamlRawDisabled(executor: string): Promise<unknown> {
    const parsed = parseYaml(readFileSync(join(root, '.spur', 'config.yaml'), 'utf8')) as {
        agent: { executors: Array<{ name: string; disabled?: unknown }> };
    };
    return parsed.agent.executors.find((entry) => entry.name === executor)?.disabled;
}

describe('runAgentUsageProducer', () => {
    test('R1/R3: quota disable + headroom recovers end-to-end; applied only after the exact ack', async () => {
        writeConfig([
            '    - name: alpha',
            '      agent: alpha',
            '      disabled:',
            '        owner: quota',
            '        since: 2025-12-31T00:00:00.000Z',
            '        reason: codexbar alpha exhausted',
        ]);
        const result = await run(JSON.stringify([healthyEntry('alpha', 12.5)]));
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]?.action).toBe('applied');
        expect(result.changes[0]?.to).toBe('enabled');
        expect(result.drain?.applied).toBe(1);
        expect(await yamlRawDisabled('alpha')).toBe(false);
        const row = await dao.getUpdate(root, 'alpha');
        expect(row?.applied_observation_id).toBe(row?.observation_id);
        expect(row?.skipped_reason).toBeNull();
        const snapshot = JSON.parse(readFileSync(join(root, 'agent-usage.json'), 'utf8')) as {
            providers: Array<{ provider: string; status: string }>;
        };
        expect(snapshot.providers[0]?.status).toBe('headroom');
    });

    test('R2 (0892): dry run reports would-apply but writes neither snapshot nor rows', async () => {
        writeConfig([
            '    - name: alpha',
            '      agent: alpha',
            '      disabled:',
            '        owner: quota',
            '        since: 2025-12-31T00:00:00.000Z',
            '        reason: codexbar alpha exhausted',
        ]);
        const snapshotPath = join(root, 'unused.json');
        const result = await runAgentUsageProducer(context(), {
            source: fakeSource(JSON.stringify([healthyEntry('alpha', 80)])),
            snapshotPath,
            dryRun: true,
        });
        expect(result.changes[0]?.action).toBe('would-apply');
        expect(result.snapshotPath).toBeNull();
        expect(result.drain).toBeNull();
        expect(existsSync(snapshotPath)).toBe(false);
        expect(await dao.getUpdate(root, 'alpha')).toBeUndefined();
    });

    test('R3 (0892): unusable capture throws UsageSourceError and touches nothing', async () => {
        const snapshotPath = join(root, 'never.json');
        try {
            await runAgentUsageProducer(context(), {
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
        expect(await dao.getUpdate(root, 'alpha')).toBeUndefined();
    });

    // 0908 R4/AC4: a timed-out capture (injected rejection, as the CLI source
    // now raises) leaves the previous snapshot, config and observation state
    // byte-identical — fail-closed writes, no partial availability update.
    test('R4 (0908): timed-out capture leaves prior snapshot/config/observation state intact', async () => {
        writeConfig([
            '    - name: alpha',
            '      agent: alpha',
            '      disabled:',
            '        owner: quota',
            '        since: 2025-12-31T00:00:00.000Z',
            '        reason: codexbar alpha exhausted',
        ]);
        const snapshotPath = join(root, 'agent-usage.json');
        await run(JSON.stringify([healthyEntry('alpha', 95)]));
        const snapshotBefore = readFileSync(snapshotPath, 'utf8');
        const rowBefore = await dao.getUpdate(root, 'alpha');
        const disabledBefore = await yamlRawDisabled('alpha');
        try {
            await runAgentUsageProducer(context(), {
                source: {
                    name: 'codexbar',
                    capture: () =>
                        Promise.reject(
                            new UsageSourceError(
                                '`codexbar usage --format json --provider all` capture exceeded the 180000 ms deadline',
                            ),
                        ),
                } satisfies UsageSource,
                snapshotPath,
                now: () => new Date('2026-01-02T00:00:00.000Z'),
            });
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(UsageSourceError);
            expect((error as UsageSourceError).message).toContain('deadline');
        }
        expect(readFileSync(snapshotPath, 'utf8')).toBe(snapshotBefore);
        expect(await dao.getUpdate(root, 'alpha')).toEqual(rowBefore);
        expect(await yamlRawDisabled('alpha')).toEqual(disabledBefore);
    });

    test('R1 (0907): a no-usage provider drives no decision and no observation, stays diagnostic', async () => {
        writeConfig(['    - name: solo', '      agent: solo']);
        const result = await run(JSON.stringify([noUsageEntry('solo')]));
        expect(result.noUsageProviders).toEqual(['solo']);
        expect(result.changes).toHaveLength(0);
        expect(await dao.getUpdate(root, 'solo')).toBeUndefined();
        const snapshot = JSON.parse(readFileSync(join(root, 'agent-usage.json'), 'utf8')) as {
            providers: Array<{ provider: string; status: string; mappedExecutors: string[]; reason?: string }>;
        };
        expect(snapshot.providers[0]?.status).toBe('no-usage');
        expect(snapshot.providers[0]?.mappedExecutors).toEqual(['solo']);
        expect(snapshot.providers[0]?.reason).toBeUndefined();
    });

    test('R1 (0907): shared executor — exhausted valid signal wins over an absent one', async () => {
        writeConfig(['    - name: shared', '      agent: p1', '      model: p2/m']);
        const result = await run(JSON.stringify([healthyEntry('p1', 100, '2026-01-02T00:00:00Z'), noUsageEntry('p2')]));
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]?.action).toBe('applied');
        expect(result.changes[0]?.providers).toEqual(['p1']);
        expect(result.changes[0]?.reason).toContain('codexbar p1 exhausted');
        expect(result.changes[0]?.reason).not.toContain('p2');
        const raw = await yamlRawDisabled('shared');
        expect(raw).toMatchObject({ owner: 'quota' });
    });

    test('R1 (0907): shared executor — headroom wins and the absent signal cannot claim the recovery', async () => {
        writeConfig([
            '    - name: shared',
            '      agent: p1',
            '      model: p2/m',
            '      disabled:',
            '        owner: quota',
            '        since: 2025-12-31T00:00:00.000Z',
            '        reason: codexbar p1 exhausted',
        ]);
        const result = await run(JSON.stringify([healthyEntry('p1', 40), noUsageEntry('p2')]));
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]?.action).toBe('applied');
        expect(result.changes[0]?.to).toBe('enabled');
        expect(result.changes[0]?.reason).toContain('codexbar p1 headroom');
        expect(await yamlRawDisabled('shared')).toBe(false);
    });

    test('R2 (0907): bare disabled:true survives apply — no-op with ownership reason, no row', async () => {
        writeConfig(['    - name: alpha', '      agent: alpha', '      disabled: true']);
        const result = await run(JSON.stringify([healthyEntry('alpha', 12.5)]));
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]?.action).toBe('no-op');
        expect(result.changes[0]?.from).toBe('disabled(operator)');
        expect(result.changes[0]?.to).toBe('disabled(operator)');
        expect(result.changes[0]?.reason).toContain('operator-owned');
        expect(await dao.getUpdate(root, 'alpha')).toBeUndefined();
        expect(await yamlRawDisabled('alpha')).toBe(true);
    });

    test('R2 (0907): an operator-owned disable is preserved even against exhaustion', async () => {
        writeConfig([
            '    - name: opexec',
            '      agent: opexec',
            '      disabled:',
            '        owner: operator',
            '        since: 2025-12-01T00:00:00.000Z',
            '        reason: manual pause',
        ]);
        const result = await run(JSON.stringify([healthyEntry('opexec', 100)]));
        expect(result.changes[0]?.action).toBe('no-op');
        expect(result.changes[0]?.to).toBe('disabled(operator)');
        expect(result.changes[0]?.reason).toContain('since 2025-12-01T00:00:00.000Z');
        expect(await dao.getUpdate(root, 'opexec')).toBeUndefined();
        expect(await yamlRawDisabled('opexec')).toMatchObject({ owner: 'operator' });
    });

    test('R3 (0907): a recording rejected as superseded is skipped, never success', async () => {
        writeConfig([
            '    - name: alpha',
            '      agent: alpha',
            '      disabled:',
            '        owner: quota',
            '        since: 2025-12-31T00:00:00.000Z',
            '        reason: codexbar alpha exhausted',
        ]);
        // A newer, already-acknowledged observation is retained: this run's older
        // recording is rejected by the latest-observation guard.
        await dao.recordObservation({
            project_id: root,
            executor_name: 'alpha',
            observation_id: 'seed-newer',
            observed_at: '2026-06-01T00:00:00.000Z',
            agent: 'alpha',
            model: null,
            disabled: true,
            owner: 'quota',
            layer: 'project',
        });
        await dao.ackApplied(root, 'alpha', 'seed-newer', '2026-06-01T00:00:01.000Z');
        const result = await run(JSON.stringify([healthyEntry('alpha', 12.5)]));
        expect(result.changes[0]?.action).toBe('skipped');
        expect(result.changes[0]?.reason).toContain('not recorded (superseded)');
        expect(result.drain?.applied).toBe(0);
        expect(await yamlRawDisabled('alpha')).toMatchObject({ owner: 'quota' });
    });

    test('R3 (0907): a failed delivery is pending with the reason, never applied', async () => {
        writeConfig([
            '    - name: alpha',
            '      agent: alpha',
            '      disabled:',
            '        owner: quota',
            '        since: 2025-12-31T00:00:00.000Z',
            '        reason: codexbar alpha exhausted',
        ]);
        let calls = 0;
        const failing = context({
            // First call (producer planning) succeeds; every drain reload fails.
            loadAgentConfig: async (projectRoot: string) => {
                calls += 1;
                if (calls > 1) return null;
                try {
                    return await loadSpurConfig(projectRoot);
                } catch {
                    return null;
                }
            },
        });
        const result = await runAgentUsageProducer(failing, {
            source: fakeSource(JSON.stringify([healthyEntry('alpha', 12.5)])),
            snapshotPath: join(root, 'agent-usage.json'),
            now: () => new Date('2026-01-01T00:00:00.000Z'),
        });
        expect(result.changes[0]?.action).toBe('pending');
        expect(result.changes[0]?.reason).toContain('delivery failed');
        expect(result.drain?.failed).toBe(1);
        expect(await yamlRawDisabled('alpha')).toMatchObject({ owner: 'quota' });
        const row = await dao.getUpdate(root, 'alpha');
        expect(row?.applied_observation_id).toBeNull();
        expect(row?.last_error).toContain('effective agent config unavailable');
    });
});

// Type-only guard: options stay structural for CLI injection.
export type { RunAgentUsageOptions };
