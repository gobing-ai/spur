import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SearchRequest } from '@gobing-ai/spur-contracts';
import {
    defaultSearchDeps,
    type SearchDeps,
    SearchError,
    scopeGlobs,
    searchProject,
    searchStatus,
    ZG_INDEX_HINT,
    ZG_INSTALL_HINT,
    ZG_REFRESH_HINT,
} from '../../src/services/search';

const fx = (name: string) => readFileSync(join(import.meta.dir, '../fixtures/zg', name), 'utf8');

// ─── Fake process deps ───────────────────────────────────────────────────────

interface FakeOpts {
    rgAvailable?: boolean;
    zgAvailable?: boolean;
    statusOut?: string;
    queryOut?: string;
    queryExit?: number;
    queryStderr?: string;
    queryTimedOut?: boolean;
    queryThrow?: Error;
    statusExit?: number;
    rgEvents?: string;
    rgExit?: number;
    rgStderr?: string;
    rgThrow?: Error;
    rgTimedOut?: boolean;
    rgOutcome?: string;
    rgOutputTruncated?: boolean;
}

function fakeDeps(opts: FakeOpts = {}) {
    const calls: Array<{ command: string; args: string[] }> = [];
    const deps: SearchDeps = {
        which: (bin) => {
            if (bin === 'rg') return (opts.rgAvailable ?? true) ? '/opt/homebrew/bin/rg' : null;
            if (bin === 'zg') return (opts.zgAvailable ?? true) ? '/Users/robin/.bun/bin/zg' : null;
            return null;
        },
        run: async (command, args) => {
            calls.push({ command, args });
            const bin = command.split('/').pop() ?? command;
            if (bin === 'rg') {
                if (args[0] === '--version')
                    return { exitCode: 0, stdout: 'ripgrep 15.2.0\n', stderr: '', timedOut: false };
                if (opts.rgThrow) throw opts.rgThrow;
                return {
                    exitCode: opts.rgExit ?? 0,
                    stdout: opts.rgEvents ?? '',
                    stderr: opts.rgStderr ?? '',
                    timedOut: opts.rgTimedOut ?? false,
                    outcome: opts.rgOutcome,
                    outputTruncated: opts.rgOutputTruncated,
                };
            }
            if (bin === 'zg') {
                // `zg version` is NOT a subcommand — zg treats it as search text (and may start an index build).
                if (args[0] === '--version') return { exitCode: 0, stdout: '0.3.0\n', stderr: '', timedOut: false };
                if (args[0] === '--status')
                    return {
                        exitCode: opts.statusExit ?? 0,
                        stdout: opts.statusOut ?? '✓ fresh\n',
                        stderr: '',
                        timedOut: false,
                    };
                if (args[0] === '--hybrid') {
                    if (opts.queryThrow) throw opts.queryThrow;
                    return {
                        exitCode: opts.queryExit ?? 0,
                        stdout: opts.queryOut ?? '',
                        stderr: opts.queryStderr ?? '',
                        timedOut: opts.queryTimedOut ?? false,
                    };
                }
            }
            return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
        },
    };
    return { deps, calls };
}

const rgMatch = (path: string, line: number, text: string) =>
    JSON.stringify({
        type: 'match',
        data: { path: { text: path }, lines: { text }, line_number: line, submatches: [] },
    });

const baseReq = (overrides: Partial<SearchRequest> = {}): SearchRequest => ({
    query: 'paused resume',
    mode: 'auto',
    scope: 'all',
    limit: 10,
    globs: [],
    regex: false,
    ...overrides,
});

// ─── scopeGlobs mapping ──────────────────────────────────────────────────────

describe('scopeGlobs (design §2)', () => {
    test('docs → doc extensions', () => {
        expect(scopeGlobs('docs')).toEqual(['*.md', '*.mdx', '*.txt', '*.rst']);
    });
    test('code → negated doc extensions', () => {
        expect(scopeGlobs('code')).toEqual(['!*.md', '!*.mdx', '!*.txt', '!*.rst']);
    });
    test('all → no globs', () => {
        expect(scopeGlobs('all')).toEqual([]);
    });
});

// ─── searchStatus ────────────────────────────────────────────────────────────

describe('searchStatus probes (never throws)', () => {
    test('fresh install: rg+zg versions and ready index', async () => {
        const { deps } = fakeDeps({ statusOut: '✓ fresh\n' });
        const status = await searchStatus('/repo', deps);
        expect(status.rg).toEqual({ available: true, version: 'ripgrep 15.2.0' });
        expect(status.zg).toMatchObject({ available: true, version: '0.3.0', index: 'ready' });
        expect(status.zg.hint).toBeUndefined();
    });

    test('missing index → zg hint is the exact index command', async () => {
        // Real zg 0.3.0 `--status` output for an unindexed tree (exit 0).
        const { deps, calls } = fakeDeps({ statusOut: fx('status-missing-0.3.txt') });
        const status = await searchStatus('/repo', deps);
        expect(calls.some((c) => c.command === 'zg' && c.args[0] === '--status')).toBe(true);
        expect(status.zg.index).toBe('missing');
        expect(status.zg.hint).toBe(ZG_INDEX_HINT);
    });

    test('stale index → zg hint is the refresh command', async () => {
        const { deps } = fakeDeps({ statusOut: fx('status-stale.txt') });
        const status = await searchStatus('/repo', deps);
        expect(status.zg.index).toBe('stale');
        expect(status.zg.hint).toBe(ZG_REFRESH_HINT);
    });

    test('failed zg status probe keeps index unknown without inventing a missing-index hint', async () => {
        const { deps } = fakeDeps({ statusExit: 1 });
        const status = await searchStatus('/repo', deps);
        expect(status.zg.index).toBe('unknown');
        expect(status.zg.hint).toBeUndefined();
    });

    test('zg absent → available false with the install hint', async () => {
        const { deps } = fakeDeps({ zgAvailable: false });
        const status = await searchStatus('/repo', deps);
        expect(status.zg).toEqual({ available: false, index: 'unknown', hint: ZG_INSTALL_HINT });
    });

    test('rg absent → available false, other probes unaffected', async () => {
        const { deps } = fakeDeps({ rgAvailable: false });
        const status = await searchStatus('/repo', deps);
        expect(status.rg).toEqual({ available: false });
        expect(status.zg.index).toBe('ready');
    });
});

// ─── Request validation ──────────────────────────────────────────────────────

describe('searchProject request validation', () => {
    test('empty/whitespace query → SearchError invalid-request', async () => {
        await expect(searchProject(baseReq({ query: '   ' }), '/repo', fakeDeps().deps)).rejects.toThrow(SearchError);
        await expect(searchProject(baseReq({ query: '   ' }), '/repo', fakeDeps().deps)).rejects.toMatchObject({
            code: 'invalid-request',
        });
    });
    test('limit 0 and 101 → SearchError invalid-request', async () => {
        await expect(searchProject(baseReq({ limit: 0 }), '/repo', fakeDeps().deps)).rejects.toMatchObject({
            code: 'invalid-request',
        });
        await expect(searchProject(baseReq({ limit: 101 }), '/repo', fakeDeps().deps)).rejects.toMatchObject({
            code: 'invalid-request',
        });
    });
    test('bad mode/scope → SearchError invalid-request', async () => {
        await expect(
            searchProject({ ...baseReq(), mode: 'bogus' } as unknown as SearchRequest, '/repo', fakeDeps().deps),
        ).rejects.toMatchObject({
            code: 'invalid-request',
        });
        await expect(
            searchProject({ ...baseReq(), scope: 'bogus' } as unknown as SearchRequest, '/repo', fakeDeps().deps),
        ).rejects.toMatchObject({
            code: 'invalid-request',
        });
    });
});

// ─── Availability invariants ─────────────────────────────────────────────────

describe('availability invariants (design §3)', () => {
    test('rg absent in exact mode → SearchError rg-not-installed', async () => {
        await expect(
            searchProject(baseReq({ mode: 'exact' }), '/repo', fakeDeps({ rgAvailable: false }).deps),
        ).rejects.toMatchObject({
            code: 'rg-not-installed',
        });
    });

    test('rg absent in auto mode → SearchError rg-not-installed even when zg is ready', async () => {
        await expect(
            searchProject(baseReq({ mode: 'auto' }), '/repo', fakeDeps({ rgAvailable: false }).deps),
        ).rejects.toMatchObject({
            code: 'rg-not-installed',
        });
    });

    test('explicit fuzzy never spawns rg — rg absence is irrelevant', async () => {
        const { deps, calls } = fakeDeps({ rgAvailable: false, queryOut: fx('query-hybrid.txt') });
        const res = await searchProject(baseReq({ mode: 'fuzzy' }), '/repo', deps);
        expect(calls.some((c) => c.command === 'rg')).toBe(false);
        expect(res.groups.exact).toBeNull();
        expect(res.groups.fuzzy).toHaveLength(3);
    });
});

// ─── Exact route ─────────────────────────────────────────────────────────────

describe('exact route (rg --json)', () => {
    test('timeout is an explicit rg failure, not a no-match result', async () => {
        await expect(
            searchProject(baseReq({ mode: 'exact' }), '/repo', fakeDeps({ rgTimedOut: true }).deps),
        ).rejects.toMatchObject({ code: 'rg-failed', message: expect.stringContaining('timed out') });
    });

    test.each(['cancelled', 'signal'])(
        '%s process outcome is an explicit failure, not empty success',
        async (outcome) => {
            await expect(
                searchProject(baseReq({ mode: 'exact' }), '/repo', fakeDeps({ rgOutcome: outcome }).deps),
            ).rejects.toMatchObject({ code: 'rg-failed', message: expect.stringContaining(outcome) });
        },
    );

    test('bounded output is an explicit rg failure instead of a truncated success', async () => {
        await expect(
            searchProject(baseReq({ mode: 'exact', limit: 1 }), '/repo', fakeDeps({ rgOutputTruncated: true }).deps),
        ).rejects.toMatchObject({ code: 'rg-failed', message: expect.stringContaining('2 MiB') });
    });

    test('malformed JSON match events are explicit failures, even with a no-match exit', async () => {
        await expect(
            searchProject(baseReq({ mode: 'exact' }), '/repo', fakeDeps({ rgExit: 1, rgEvents: '{not-json' }).deps),
        ).rejects.toMatchObject({ code: 'rg-failed', message: expect.stringContaining('malformed JSON') });
    });

    test('exit 1 means zero matches, not an error', async () => {
        const { deps } = fakeDeps({ rgExit: 1 });
        const res = await searchProject(baseReq({ mode: 'exact' }), '/repo', deps);
        expect(res.groups.exact).toEqual([]);
        expect(res.groups.fuzzy).toBeNull();
    });

    test('exit 2 → SearchError rg-failed carrying stderr', async () => {
        await expect(
            searchProject(
                baseReq({ mode: 'exact' }),
                '/repo',
                fakeDeps({ rgExit: 2, rgStderr: 'unrecognized flag' }).deps,
            ),
        ).rejects.toMatchObject({ code: 'rg-failed' });
    });

    test('spawn failure → SearchError rg-failed', async () => {
        await expect(
            searchProject(baseReq({ mode: 'exact' }), '/repo', fakeDeps({ rgThrow: new Error('ENOEXEC') }).deps),
        ).rejects.toMatchObject({
            code: 'rg-failed',
        });
    });

    test('match events become ranked hits; ./ path prefix is stripped; snippet trimmed and capped', async () => {
        const events = [
            rgMatch('./docs/x.md', 12, '  paused resume here  '),
            rgMatch('docs/y.md', 3, 'z'.repeat(400)),
        ].join('\n');
        const res = await searchProject(baseReq({ mode: 'exact' }), '/repo', fakeDeps({ rgEvents: events }).deps);
        const resExact = res.groups.exact ?? [];
        expect(res.groups.exact).toHaveLength(2);
        expect(resExact[0]).toMatchObject({
            rank: 1,
            path: 'docs/x.md',
            startLine: 12,
            endLine: 12,
            matchedBy: ['exact'],
        });
        expect(resExact[0]?.snippet).toBe('paused resume here');
        expect(resExact[1]?.snippet.length).toBe(300);
    });

    test('overall truncation to limit with contiguous ranks', async () => {
        const events = Array.from({ length: 25 }, (_, i) => rgMatch(`f${i}.ts`, i + 1, `hit ${i}`)).join('\n');
        const res = await searchProject(
            baseReq({ mode: 'exact', limit: 10 }),
            '/repo',
            fakeDeps({ rgEvents: events }).deps,
        );
        expect(res.groups.exact).toHaveLength(10);
        const resExact = res.groups.exact ?? [];
        expect(resExact.map((h) => h.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    test('regex=false passes -F; regex=true omits it; args end with -- <query> .', async () => {
        const { deps, calls } = fakeDeps({ rgExit: 1 });
        await searchProject(baseReq({ mode: 'exact', regex: false }), '/repo', deps);
        await searchProject(baseReq({ mode: 'exact', regex: true }), '/repo', deps);
        const rgCalls = calls.filter((c) => c.command === 'rg');
        const [fixed, regex] = rgCalls;
        if (!fixed || !regex) throw new Error('expected two rg invocations');
        expect(fixed.args).toContain('-F');
        expect(regex.args).not.toContain('-F');
        for (const call of [fixed, regex]) {
            expect(call.args.slice(-3)).toEqual(['--', 'paused resume', '.']);
            expect(call.args[0]).toBe('--json');
        }
    });

    test('scope + user globs are appended in order as -g flags', async () => {
        const { deps, calls } = fakeDeps({ rgExit: 1 });
        await searchProject(baseReq({ mode: 'exact', scope: 'docs', globs: ['src/**'] }), '/repo', deps);
        const rgCall = calls.find((c) => c.command === 'rg');
        if (!rgCall) throw new Error('rg was not invoked');
        const args = rgCall.args;
        const globFlags = args.filter((a) => a !== '-g' && args[args.indexOf(a) - 1] === '-g');
        expect(globFlags).toEqual(['*.md', '*.mdx', '*.txt', '*.rst', 'src/**']);
    });
});

// ─── Fuzzy route ─────────────────────────────────────────────────────────────

describe('fuzzy route (zg --hybrid)', () => {
    test('golden fixture end-to-end: ranked hits with ranges and metadata', async () => {
        const { deps, calls } = fakeDeps({ queryOut: fx('query-hybrid.txt') });
        const res = await searchProject(baseReq({ mode: 'fuzzy', limit: 3 }), '/repo', deps);
        const resFuzzy = res.groups.fuzzy ?? [];
        expect(res.groups.fuzzy).toHaveLength(3);
        expect(resFuzzy[0]).toMatchObject({
            rank: 1,
            path: 'packages/app/tests/services/agent-quota-updates.test.ts',
            startLine: 537,
            endLine: 537,
            symbol: '[function] alpha',
            matchedBy: ['fuzzy'],
        });
        const queryCall = calls.find((c) => c.command === 'zg' && c.args[0] === '--hybrid');
        if (!queryCall) throw new Error('zg query was not invoked');
        expect(queryCall.args.slice(0, 4)).toEqual(['--hybrid', 'paused resume', '--limit', '3']);
    });

    test('timeout → skipped zg-timeout, exit 0, no throw', async () => {
        const { deps } = fakeDeps({ queryTimedOut: true });
        const res = await searchProject(baseReq({ mode: 'fuzzy' }), '/repo', deps);
        expect(res.groups.fuzzy).toBeNull();
        expect(res.skipped).toEqual([{ route: 'fuzzy', reason: 'zg-timeout' }]);
    });

    test('zg 0.3.0 nonzero exit with ZG.ENGINE.NOT_FOUND stderr → skipped zg-index-missing', async () => {
        const { deps } = fakeDeps({
            queryExit: 1,
            queryStderr:
                'Error[ZG.ENGINE.NOT_FOUND]: No index found in /repo. Run `zg --index --embedding <model>` to build it, then retry the query.\n',
        });
        const res = await searchProject(baseReq({ mode: 'fuzzy' }), '/repo', deps);
        expect(res.skipped).toEqual([{ route: 'fuzzy', reason: 'zg-index-missing', hint: ZG_INDEX_HINT }]);
    });

    test('nonzero exit with [INDEX_MISSING] stderr → skipped zg-index-missing with hint', async () => {
        const { deps } = fakeDeps({ queryExit: 1, queryStderr: 'Error: [INDEX_MISSING] no index here' });
        const res = await searchProject(baseReq({ mode: 'fuzzy' }), '/repo', deps);
        expect(res.groups.fuzzy).toBeNull();
        expect(res.skipped).toEqual([{ route: 'fuzzy', reason: 'zg-index-missing', hint: ZG_INDEX_HINT }]);
    });

    test('other nonzero exit → skipped zg-failed', async () => {
        const { deps } = fakeDeps({ queryExit: 3, queryStderr: 'boom' });
        const res = await searchProject(baseReq({ mode: 'fuzzy' }), '/repo', deps);
        expect(res.skipped).toEqual([{ route: 'fuzzy', reason: 'zg-failed' }]);
    });

    test('malformed successful output → skipped zg-output-error with version + sample in hint', async () => {
        const { deps } = fakeDeps({ queryOut: fx('malformed.txt') });
        const res = await searchProject(baseReq({ mode: 'fuzzy' }), '/repo', deps);
        expect(res.groups.fuzzy).toBeNull();
        expect(res.skipped).toHaveLength(1);
        expect(res.skipped[0]?.reason).toBe('zg-output-error');
        expect(res.skipped[0]?.hint).toContain('0.3.0');
        expect(res.skipped[0]?.hint).toContain('search results for');
    });

    test('zg-output-error hint names the offending line even past the first 300 chars of output', async () => {
        const good = Array.from({ length: 6 }, (_, i) => [`#${i + 1} docs/x${i}.md:1`, `  1: ${'y'.repeat(60)}`, '']);
        const queryOut = [...good.flat(), 'UNEXPECTED trailer'].join('\n');
        const { deps } = fakeDeps({ queryOut });
        const res = await searchProject(baseReq({ mode: 'fuzzy' }), '/repo', deps);
        expect(res.skipped[0]?.hint).toContain('UNEXPECTED trailer');
    });

    test('zg unavailable → skipped zg-not-installed with install hint (no probe crash)', async () => {
        const { deps } = fakeDeps({ zgAvailable: false, rgEvents: rgMatch('a.ts', 1, 'exact only\n') });
        const res = await searchProject(baseReq({ mode: 'fuzzy' }), '/repo', deps);
        expect(res.groups.exact).toBeNull();
        expect(res.skipped).toEqual([{ route: 'fuzzy', reason: 'zg-not-installed', hint: ZG_INSTALL_HINT }]);
    });

    test('status said ready but query still hit missing index → runtime skip wins (R6)', async () => {
        const { deps } = fakeDeps({
            statusOut: '✓ fresh\n',
            queryExit: 1,
            queryStderr: 'Error: [INDEX_MISSING] vanished',
        });
        const res = await searchProject(baseReq({ mode: 'fuzzy' }), '/repo', deps);
        expect(res.skipped[0]).toMatchObject({ reason: 'zg-index-missing', hint: ZG_INDEX_HINT });
    });
});

// ─── Auto mode ───────────────────────────────────────────────────────────────

describe('auto mode grouping and overlap', () => {
    test('zg absent → exact only + skipped fuzzy (R6 / AC6)', async () => {
        const { deps, calls } = fakeDeps({ zgAvailable: false, rgEvents: rgMatch('docs/x.md', 5, 'exact match\n') });
        const res = await searchProject(baseReq({ mode: 'auto' }), '/repo', deps);
        expect(calls.some((c) => c.command === 'zg' && c.args[0] === '--hybrid')).toBe(false);
        expect(res.groups.exact).toHaveLength(1);
        expect(res.groups.fuzzy).toBeNull();
        expect(res.skipped).toEqual([{ route: 'fuzzy', reason: 'zg-not-installed', hint: ZG_INSTALL_HINT }]);
    });

    test('index missing → exact only + skipped zg-index-missing', async () => {
        const { deps, calls } = fakeDeps({
            statusOut: fx('status-missing.txt'),
            rgEvents: rgMatch('docs/x.md', 5, 'exact match\n'),
        });
        const res = await searchProject(baseReq({ mode: 'auto' }), '/repo', deps);
        expect(calls.some((c) => c.command === 'zg' && c.args[0] === '--hybrid')).toBe(false);
        expect(res.groups.exact).toHaveLength(1);
        expect(res.groups.fuzzy).toBeNull();
        expect(res.skipped).toEqual([{ route: 'fuzzy', reason: 'zg-index-missing', hint: ZG_INDEX_HINT }]);
    });

    test('unknown index status plus a failed fuzzy backend keeps the skipped route null', async () => {
        const { deps, calls } = fakeDeps({
            statusExit: 1,
            queryExit: 3,
            rgEvents: rgMatch('docs/x.md', 5, 'exact match\n'),
        });
        const res = await searchProject(baseReq({ mode: 'auto' }), '/repo', deps);
        expect(calls.some((c) => c.command === 'zg' && c.args[0] === '--hybrid')).toBe(true);
        expect(res.status.zg.index).toBe('unknown');
        expect(res.groups.fuzzy).toBeNull();
        expect(res.skipped).toEqual([{ route: 'fuzzy', reason: 'zg-failed' }]);
    });

    test('failed fuzzy backend keeps the auto route null instead of returning an empty group', async () => {
        const { deps } = fakeDeps({ queryExit: 3, rgEvents: rgMatch('docs/x.md', 5, 'exact match\n') });
        const res = await searchProject(baseReq({ mode: 'auto' }), '/repo', deps);
        expect(res.groups.fuzzy).toBeNull();
        expect(res.skipped).toEqual([{ route: 'fuzzy', reason: 'zg-failed' }]);
    });

    test('successfully empty fuzzy output stays an empty array in auto mode', async () => {
        const { deps } = fakeDeps({ queryOut: 'No matches.\n', rgEvents: rgMatch('docs/x.md', 5, 'exact match\n') });
        const res = await searchProject(baseReq({ mode: 'auto' }), '/repo', deps);
        expect(res.groups.fuzzy).toEqual([]);
        expect(res.skipped).toEqual([]);
    });

    test('ready index → both groups run concurrently; overlap marks matchedBy on both hits', async () => {
        const queryOut = [
            '#1 docs/shared.md:10-20',
            '  10: fuzzy shared',
            '',
            '#2 docs/only-fuzzy.md:30',
            '  30: fuzzy only',
        ].join('\n');
        const rgEvents = [
            rgMatch('docs/shared.md', 12, 'exact shared\n'),
            rgMatch('docs/exact-only.md', 2, 'exact only\n'),
        ].join('\n');
        const { deps } = fakeDeps({ queryOut, rgEvents });
        const res = await searchProject(baseReq({ mode: 'auto', limit: 5 }), '/repo', deps);
        const resExact = res.groups.exact ?? [];
        const resFuzzy = res.groups.fuzzy ?? [];
        expect(res.groups.exact).toHaveLength(2);
        expect(res.groups.fuzzy).toHaveLength(2);
        expect(res.skipped).toEqual([]);
        const exactShared = resExact.find((h) => h.path === 'docs/shared.md');
        const fuzzyShared = resFuzzy.find((h) => h.path === 'docs/shared.md');
        if (!exactShared || !fuzzyShared) throw new Error('overlap fixture hits missing');
        expect(exactShared.matchedBy).toEqual(['exact', 'fuzzy']);
        expect(fuzzyShared.matchedBy).toEqual(['exact', 'fuzzy']);
        // 12 inside [10, 20] overlaps; the others stay single-source
        expect(resExact.find((h) => h.path === 'docs/exact-only.md')?.matchedBy).toEqual(['exact']);
        expect(resFuzzy.find((h) => h.path === 'docs/only-fuzzy.md')?.matchedBy).toEqual(['fuzzy']);
    });

    test('stale index still runs fuzzy (degradation, not skip)', async () => {
        const { deps, calls } = fakeDeps({
            statusOut: fx('status-stale.txt'),
            queryOut: fx('query-hybrid.txt'),
            rgEvents: rgMatch('a.ts', 1, 'x\n'),
        });
        const res = await searchProject(baseReq({ mode: 'auto' }), '/repo', deps);
        expect(calls.some((c) => c.command === 'zg' && c.args[0] === '--hybrid')).toBe(true);
        expect(res.status.zg.index).toBe('stale');
        expect(res.groups.fuzzy).toHaveLength(3);
        expect(res.skipped).toEqual([]);
    });

    test('response carries query, resolved mode/scope, limits and embedded status', async () => {
        const { deps } = fakeDeps({ rgEvents: rgMatch('a.ts', 1, 'x\n') });
        const res = await searchProject(baseReq({ mode: 'exact', scope: 'docs', limit: 7 }), '/repo', deps);
        expect(res.query).toBe('paused resume');
        expect(res.mode).toBe('exact');
        expect(res.scope).toBe('docs');
        expect(res.groups.fuzzy).toBeNull();
        expect(res.status.rg.available).toBe(true);
        expect(res.status.zg.available).toBe(true);
    });
});

// ─── Default deps wiring (shape only; binary presence is environment truth) ──

describe('defaultSearchDeps', () => {
    test('wraps NodeProcessExecutor: which + run return the documented shape', async () => {
        expect(typeof defaultSearchDeps.which).toBe('function');
        expect(
            defaultSearchDeps.which('rg') !== null || defaultSearchDeps.which('definitely-not-a-binary') === null,
        ).toBe(true);
        const result = await defaultSearchDeps.run('echo', ['hi'], { cwd: import.meta.dir, timeout: 5000 });
        expect(result).toMatchObject({ exitCode: 0, stdout: 'hi' });
        expect(typeof result.timedOut).toBe('boolean');
    });

    test('marks output at the 2 MiB process cap as truncated', async () => {
        const result = await defaultSearchDeps.run('bun', ['-e', 'process.stdout.write("x".repeat(3 * 1024 * 1024))'], {
            cwd: import.meta.dir,
            timeout: 5000,
        });
        expect(result.outputTruncated).toBe(true);
    });
});
