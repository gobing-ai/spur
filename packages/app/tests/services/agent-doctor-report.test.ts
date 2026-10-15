import { describe, expect, test } from 'bun:test';
import { type DoctorResult, getAgentSessionCapability } from '@gobing-ai/ts-ai-runner';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import {
    buildDoctorRows,
    cachedDoctorRunner,
    DOCTOR_CACHE_REL,
    type DoctorRow,
    executorFingerprint,
    readFreshDoctorCache,
    readUsageSnapshot,
    renderDoctorDetail,
    renderDoctorTable,
    renderRoleLadder,
    roleCoveredByCache,
    syntheticDisabledRows,
    versionCore,
    withDisabledRows,
    withoutAuthenticated,
    writeDoctorCacheFile,
} from '../../src/services/agent-doctor-report';
import type { AgentRoleDefinition } from '../../src/services/agent-service';
import type { AgentExecutorConfig } from '../../src/services/executor-tier';

/** In-memory FileSystem slice: only the members the doctor cache layer touches. */
function memFs(files: Record<string, string> = {}, opts: { failWrite?: unknown } = {}) {
    const store = new Map(Object.entries(files));
    const fs = {
        resolve: (p: string) => `/root/${p}`,
        exists: (p: string) => store.has(p),
        readFile: (p: string) => {
            const v = store.get(p);
            if (v === undefined) throw new Error(`ENOENT ${p}`);
            return v;
        },
        writeFile: async (p: string, body: string) => {
            if (opts.failWrite !== undefined) throw opts.failWrite;
            store.set(p, body);
        },
        rename: async (from: string, to: string) => {
            store.set(to, store.get(from) as string);
            store.delete(from);
        },
    };
    return { fs: fs as unknown as FileSystem, store };
}

const cachePath = `/root/${DOCTOR_CACHE_REL}`;

function result(agent: string, over: Partial<DoctorResult> = {}): DoctorResult {
    return {
        agent,
        installed: true,
        version: null,
        authenticated: 'unknown',
        usable: true,
        tier: 1,
        channels: [],
        error: null,
        ...over,
    } as DoctorResult;
}

const fastExecutor: AgentExecutorConfig = { name: 'fast', agent: 'claude', model: 'haiku', disabled: false };
const executors: AgentExecutorConfig[] = [
    fastExecutor,
    { name: 'big', agent: 'claude', model: 'opus', disabled: false },
    { name: 'off', agent: 'codex', disabled: { owner: 'quota', since: '2026-10-01', reason: 'limit' } },
];

const roles = new Map<string, AgentRoleDefinition>([
    ['scout', { tier: 'cheap', stages: [] }],
    ['architect', { tier: 'capable-1', stages: [] }],
]);

describe('executorFingerprint', () => {
    test('is order-independent and changes with the disabled flag', () => {
        const a = executorFingerprint(executors);
        expect(executorFingerprint([...executors].reverse())).toBe(a);
        expect(executorFingerprint([{ ...fastExecutor, disabled: true }, ...executors.slice(1)])).not.toBe(a);
        expect(executorFingerprint(undefined)).toBe(executorFingerprint([]));
    });
});

describe('readUsageSnapshot', () => {
    const now = () => Date.parse('2026-10-14T12:00:00Z');
    test('absent path, missing file, malformed payloads → null', () => {
        const { fs } = memFs({
            '/bad': '{',
            '/null': 'null',
            '/nostr': '{"captured_at":1}',
            '/nan': '{"captured_at":"x"}',
        });
        expect(readUsageSnapshot(fs, undefined, now)).toBeNull();
        expect(readUsageSnapshot(fs, '/missing', now)).toBeNull();
        for (const p of ['/bad', '/null', '/nostr', '/nan']) expect(readUsageSnapshot(fs, p, now)).toBeNull();
    });
    test('fresh and stale snapshots; future capture clamps age to 0', () => {
        const { fs } = memFs({
            '/fresh': '{"captured_at":"2026-10-14T11:30:00Z"}',
            '/stale': '{"captured_at":"2026-10-14T05:00:00Z"}',
            '/future': '{"captured_at":"2026-10-14T13:00:00Z"}',
        });
        expect(readUsageSnapshot(fs, '/fresh', now)).toEqual({
            capturedAt: '2026-10-14T11:30:00Z',
            age: 30 * 60_000,
            stale: false,
        });
        expect(readUsageSnapshot(fs, '/stale', now)?.stale).toBe(true);
        expect(readUsageSnapshot(fs, '/future', now)?.age).toBe(0);
    });
});

describe('doctor cache read/write', () => {
    const t0 = Date.parse('2026-10-14T12:00:00Z');
    test('round-trips within the TTL and misses on fingerprint, age, or schema', async () => {
        const { fs, store } = memFs();
        expect(readFreshDoctorCache(fs, 'fp', () => t0)).toBeNull();
        expect(await writeDoctorCacheFile(fs, 'fp', [result('fast')], () => t0)).toBeNull();
        expect(store.has(`${cachePath}.tmp`)).toBe(false);
        expect(readFreshDoctorCache(fs, 'fp', () => t0 + 1_000)).toEqual({ results: [result('fast')], ageMs: 1_000 });
        expect(readFreshDoctorCache(fs, 'other', () => t0)).toBeNull();
        expect(readFreshDoctorCache(fs, 'fp', () => t0 + 60_000)).toBeNull();
        expect(readFreshDoctorCache(fs, 'fp', () => t0 - 1)).toBeNull();
        store.set(cachePath, JSON.stringify({ schemaVersion: 2, fingerprint: 'fp', capturedAt: '', results: [] }));
        expect(readFreshDoctorCache(fs, 'fp', () => t0)).toBeNull();
        store.set(cachePath, 'not json');
        expect(readFreshDoctorCache(fs, 'fp', () => t0)).toBeNull();
    });
    test('write failures come back as a note, never a throw', async () => {
        expect(await writeDoctorCacheFile(memFs({}, { failWrite: new Error('EACCES') }).fs, 'fp', [], () => 0)).toBe(
            'EACCES',
        );
        expect(await writeDoctorCacheFile(memFs({}, { failWrite: 'raw' }).fs, 'fp', [], () => 0)).toBe('raw');
    });
});

describe('cache coverage and runner', () => {
    test('roleCoveredByCache requires every eligible executor row', () => {
        expect(roleCoveredByCache([result('fast'), result('big')], executors, 'cheap')).toBe(true);
        expect(roleCoveredByCache([result('fast')], executors, 'cheap')).toBe(false);
        expect(roleCoveredByCache([], undefined, 'cheap')).toBe(true);
    });
    test('cachedDoctorRunner serves cached rows and a not-covered placeholder', async () => {
        const runner = cachedDoctorRunner([result('fast')]);
        expect(await runner.runAll()).toEqual([result('fast')]);
        expect(await runner.runOne('fast')).toEqual(result('fast'));
        expect(await runner.runOne('nope')).toMatchObject({
            agent: 'nope',
            usable: false,
            error: 'not covered by cache',
        });
    });
});

describe('disabled rows', () => {
    test('synthesizes rows only for disabled profiles and does not duplicate probed ones', () => {
        expect(syntheticDisabledRows(undefined)).toEqual([]);
        const synth = syntheticDisabledRows(executors);
        expect(synth.map((r) => r.agent)).toEqual(['off']);
        expect(synth[0]).toMatchObject({
            usable: false,
            tier: 2,
            error: 'disabled by config (agent.executors.off.disabled)',
        });
        expect(withDisabledRows([result('fast')], executors).map((r) => r.agent)).toEqual(['fast', 'off']);
        expect(withDisabledRows([result('off')], executors).map((r) => r.agent)).toEqual(['off']);
    });
    test('withoutAuthenticated drops only the auth field', () => {
        expect(withoutAuthenticated({ a: 1, authenticated: true })).toEqual({ a: 1 });
    });
});

describe('versionCore', () => {
    test('extracts the first semver-shaped token', () => {
        expect(versionCore('2.1.274 (Claude Code)')).toBe('2.1.274');
        expect(versionCore('codex-cli 0.154.0-beta.1')).toBe('0.154.0-beta.1');
        expect(versionCore('omp/18.2')).toBe('18.2');
        expect(versionCore('unverified')).toBeNull();
    });
});

describe('buildDoctorRows', () => {
    const verified = getAgentSessionCapability('claude').verifiedAgainst;
    test('joins configs, eligibility, elections, availability and capability staleness', () => {
        const rows = buildDoctorRows(
            [
                result('fast', { version: `${versionCore(verified) ?? verified} (Claude Code)` }),
                result('big', { version: '0.0.1' }),
                ...syntheticDisabledRows(executors),
                result('mystery-bin', { usable: false, error: 'not installed' }),
            ],
            executors,
            roles,
        );
        const [fast, big, off, mystery] = rows as [DoctorRow, DoctorRow, DoctorRow, DoctorRow];
        expect(fast).toMatchObject({
            executor: 'fast',
            agentBinary: 'claude',
            capabilityTier: 'cheap',
            model: 'haiku',
        });
        expect(fast.roles).toEqual(['scout']);
        expect(fast.elected).toEqual(['scout']);
        expect(fast.capabilities).not.toBeNull();
        expect(big.roles).toEqual(['scout', 'architect']);
        expect(big.elected).toEqual(['architect']);
        if (versionCore(verified) !== null) {
            expect(fast.capabilityStale).toBeNull();
            expect(big.capabilityStale).toEqual({ verifiedAgainst: verified, detected: '0.0.1' });
        }
        expect(off).toMatchObject({
            disabled: true,
            agentBinary: 'codex',
            availability: { disabled: true, owner: 'quota' },
        });
        expect(mystery).toMatchObject({ agentBinary: 'mystery-bin', disabled: false, model: null, capabilities: null });
    });
    test('without roles or executors there is no eligibility or election', () => {
        const [row] = buildDoctorRows([result('claude')], undefined, undefined);
        expect(row).toMatchObject({ executor: 'claude', roles: [], elected: [] });
        expect(buildDoctorRows([result('fast')], [], roles)[0]?.elected).toEqual([]);
    });
});

function row(over: Partial<DoctorRow> = {}): DoctorRow {
    return {
        executor: 'fast',
        agentBinary: 'claude',
        usable: true,
        tier: 1,
        capabilityTier: 'cheap',
        model: 'haiku',
        roles: ['scout', 'reviewer'],
        elected: ['scout'],
        version: '1.0.0',
        error: null,
        disabled: false,
        capabilities: {
            supportsResumeById: true,
            supportsSessionDir: false,
            supportsPersistentStdin: true,
            supportsStructuredOutput: false,
            verifiedAgainst: '1.0.0',
        },
        capabilityStale: null,
        availability: { disabled: false, owner: undefined, since: undefined, reason: undefined },
        ...over,
    } as DoctorRow;
}

describe('renderDoctorTable', () => {
    test('renders header, glyphs, caps, election stars and footers', () => {
        const out = renderDoctorTable(
            [
                row(),
                row({
                    executor: 'old',
                    usable: false,
                    model: null,
                    version: null,
                    capabilities: null,
                    roles: [],
                    elected: [],
                }),
                row({
                    executor: 'off',
                    usable: false,
                    disabled: true,
                    elected: [],
                    capabilityStale: { verifiedAgainst: '1.0.0', detected: '2.0.0' },
                    availability: { disabled: true, owner: 'quota', since: '2026-10-01', reason: 'limit' },
                }),
                row({
                    executor: 'anon',
                    usable: false,
                    disabled: true,
                    elected: [],
                    availability: { disabled: true } as DoctorRow['availability'],
                }),
            ],
            { capturedAt: '2026-10-14T00:00:00Z', age: 5 * 60_000, stale: false },
        );
        const lines = out.split('\n');
        expect(lines[0]).toMatch(
            /^ {2}STATUS +EXECUTOR +AGENT +MODEL +TIER +VERSION +CAPS +ROLES +OWNER +SINCE +REASON$/,
        );
        expect(lines[1]).toContain('✓ usable');
        expect(lines[1]).toContain('r✓d✗s✓o✗');
        expect(lines[1]).toContain('scout*,reviewer');
        expect(lines[2]).toMatch(/✗ missing +old +claude +— +cheap +— +— +—/);
        expect(lines[3]).toContain('r✓d✗s✓o✗⚠');
        expect(lines[3]).toContain('quota');
        expect(lines[3]).toContain('limit');
        expect(out).toContain('1 usable, 1 missing, 2 disabled');
        expect(out).toContain('usage: 2026-10-14T00:00:00Z (5m)');
        expect(out).toContain('(* = elected executor for that role)');
    });
    test('footer variants: no usage, stale usage, sub-minute and hour ages, no elections', () => {
        const plain = [row({ elected: [] })];
        expect(renderDoctorTable(plain)).toContain('1 usable, 0 missing\nusage: none');
        expect(renderDoctorTable(plain, null)).not.toContain('elected executor');
        expect(renderDoctorTable(plain, { capturedAt: 'c', age: 0, stale: true })).toContain('usage: c (stale)');
        expect(renderDoctorTable(plain, { capturedAt: 'c', age: 10, stale: false })).toContain('(<1m)');
        expect(renderDoctorTable(plain, { capturedAt: 'c', age: 2 * 3_600_000, stale: false })).toContain('(2h)');
    });
});

describe('renderRoleLadder', () => {
    test('marks the elected row and gives per-row reasons', () => {
        const out = renderRoleLadder(
            'scout',
            'cheap',
            [
                row(),
                row({ executor: 'spare' }),
                row({ executor: 'gone', usable: false, error: 'binary missing' }),
                row({ executor: 'nada', usable: false, error: null }),
                row({ executor: 'off', usable: false, disabled: true }),
            ],
            'fast',
        );
        expect(out).toContain('scout (min tier cheap) — eligible ladder');
        expect(out).toContain('✓ fast   usable  ELECTED');
        expect(out).toContain('spare  usable  eligible');
        expect(out).toContain('gone   missing  binary missing');
        expect(out).toContain('nada   missing  not installed');
        expect(out).toContain('off    disabled  disabled by config');
        expect(out).toContain('4 eligible, 2 usable, elected: fast');
    });
    test('empty ladder', () => {
        const out = renderRoleLadder('architect', 'capable-1', [], undefined);
        expect(out).toContain('(no eligible executor)');
        expect(out).toContain('0 eligible, 0 usable, elected: none');
    });
});

describe('renderDoctorDetail', () => {
    test('null result', () => {
        expect(renderDoctorDetail(null)).toBe('No result.');
    });
    test('full detail with caps note, staleness and model health', () => {
        const out = renderDoctorDetail(
            row({
                capabilities: {
                    ...(row().capabilities as NonNullable<DoctorRow['capabilities']>),
                    note: 'flags inferred',
                },
                capabilityStale: { verifiedAgainst: '1.0.0', detected: '2.0.0' },
                modelStatus: { status: 'available', checkedAt: 'now', detail: 'ok 200' } as DoctorRow['modelStatus'],
            }),
        );
        expect(out).toContain('✓ fast  (cheap)');
        expect(out).toContain('status:     usable');
        expect(out).toContain('verified:   1.0.0 — flags inferred');
        expect(out).toContain('capability-declaration-stale — detects 2.0.0');
        expect(out).toContain('health:     available');
        expect(out).toContain('detail:     ok 200');
    });
    test('unknown binary, disabled/missing status, health without detail', () => {
        const disabled = renderDoctorDetail(
            row({
                usable: false,
                disabled: true,
                version: null,
                model: null,
                capabilities: null,
                modelStatus: { status: 'unavailable', checkedAt: 't' } as DoctorRow['modelStatus'],
            }),
        );
        expect(disabled).toContain('✗ fast');
        expect(disabled).toContain('status:     disabled by config');
        expect(disabled).toContain('version:    —');
        expect(disabled).toContain('pinned:     —');
        expect(disabled).toContain('binary unknown to the runner');
        expect(disabled).not.toContain('detail:');
        expect(renderDoctorDetail(row({ usable: false }))).toContain('status:     missing');
        expect(renderDoctorDetail(row())).toMatch(/verified: {3}1\.0\.0$/);
    });
});
