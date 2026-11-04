import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type SearchResponse,
    searchResponseDataSchema,
    searchResponseSchema,
    searchStatusSchema,
} from '@gobing-ai/spur-contracts';
import { main } from '../../../src';
import { formatSearchResponse, formatSearchStatus } from '../../../src/commands/self/search';
import { runCli } from '../../helpers';

/**
 * `spur self search` (feature A34, task 1286).
 *
 * Three layers of proof:
 *  1. rendering — pure functions over a fixture response (every output branch);
 *  2. in-process transport — real `main()` dispatch against a temp project, so the
 *     command's flag mapping, exit codes and envelope handling are measured;
 *  3. subprocess degradation — a PATH holding rg but not zg (and vice versa) is the
 *     only honest way to prove `Bun.which` misses a binary.
 *
 * Every probe persists its captured result under `ARTIFACT_DIR` as a repeatable artifact.
 */

const ARTIFACT_DIR = join(tmpdir(), 'spur-search-e2e-artifacts');

interface ProbeResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

/** Persist one probe result as a repeatable artifact, then return it. */
async function record(name: string, command: string, result: ProbeResult): Promise<ProbeResult> {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await writeFile(
        join(ARTIFACT_DIR, `${name}.json`),
        `${JSON.stringify({ command, code: result.code, stdout: result.stdout, stderr: result.stderr }, null, 2)}\n`,
    );
    return result;
}

// ─── Rendering (pure) ────────────────────────────────────────────────────────

function fixtureResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
    return searchResponseDataSchema.parse({
        query: 'alpha',
        mode: 'auto',
        scope: 'all',
        groups: {
            exact: [
                {
                    rank: 1,
                    path: 'docs/guide.md',
                    startLine: 3,
                    endLine: 3,
                    snippet: 'line one\nline two\nline three\nline four',
                    route: 'exact',
                    matchedBy: ['exact', 'fuzzy'],
                },
            ],
            fuzzy: [
                {
                    rank: 1,
                    path: 'src/app.ts',
                    startLine: 10,
                    endLine: 24,
                    snippet: 'export const alpha = 1;',
                    route: 'fuzzy',
                    matchedBy: ['fuzzy'],
                },
            ],
        },
        skipped: [
            { route: 'fuzzy', reason: 'zg-index-missing', hint: 'zg --index --embedding local/potion-code-16m-v2' },
        ],
        status: { rg: { available: true, version: '14.1.0' }, zg: { available: true, index: 'missing' } },
        ...overrides,
    });
}

describe('formatSearchResponse', () => {
    test('renders one header per non-null group with path:range, matchedBy and a 3-line snippet', () => {
        const lines = formatSearchResponse(fixtureResponse()).split('\n');
        expect(lines).toEqual([
            'exact (1)',
            'docs/guide.md:3  [exact+fuzzy]',
            '    line one',
            '    line two',
            '    line three',
            'fuzzy (1)',
            'src/app.ts:10-24  [fuzzy]',
            '    export const alpha = 1;',
            'skipped fuzzy: zg-index-missing — zg --index --embedding local/potion-code-16m-v2',
        ]);
    });

    test('omits a null group and its header', () => {
        const response = fixtureResponse();
        response.groups.fuzzy = null;
        response.skipped = [];
        expect(formatSearchResponse(response).split('\n')[0]).toBe('exact (1)');
        expect(formatSearchResponse(response)).not.toContain('fuzzy (');
    });

    test('prints `no matches` when every group is empty or null, then the skipped reasons', () => {
        const response = fixtureResponse();
        response.groups.exact = [];
        response.groups.fuzzy = null;
        expect(formatSearchResponse(response).split('\n')).toEqual([
            'exact (0)',
            'no matches',
            'skipped fuzzy: zg-index-missing — zg --index --embedding local/potion-code-16m-v2',
        ]);
    });

    test('a skip without a hint renders the reason alone', () => {
        const response = fixtureResponse({ skipped: [{ route: 'fuzzy', reason: 'zg-failed' }] });
        response.groups.exact = null;
        expect(formatSearchResponse(response)).toContain('skipped fuzzy: zg-failed');
        expect(formatSearchResponse(response)).not.toContain('zg-failed —');
    });
});

describe('formatSearchStatus', () => {
    test('reports both backends with their index readiness and hint', () => {
        const text = formatSearchStatus({
            rg: { available: true, version: '14.1.0' },
            zg: { available: true, version: '0.2.2', index: 'missing', hint: 'zg --index' },
        });
        expect(text.split('\n')).toEqual(['rg: 14.1.0', 'zg: 0.2.2 index=missing', 'hint: zg --index']);
    });

    test('reports absent binaries without inventing versions', () => {
        const text = formatSearchStatus({ rg: { available: false }, zg: { available: false, index: 'unknown' } });
        expect(text.split('\n')).toEqual(['rg: not installed', 'zg: not installed index=unknown']);
    });
});

// ─── In-process transport ────────────────────────────────────────────────────

const FIXTURE_CONFIG = 'project: search-fixture\n';

describe('spur self search — in-process transport', () => {
    let root = '';

    beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), 'spur-search-inproc-'));
        await mkdir(join(root, '.spur'), { recursive: true });
        await mkdir(join(root, 'docs'), { recursive: true });
        await mkdir(join(root, 'src'), { recursive: true });
        await writeFile(join(root, '.spur', 'config.yaml'), FIXTURE_CONFIG);
        await writeFile(join(root, 'docs', 'guide.md'), '# Guide\n\nHybrid alpha search lives here.\n');
        await writeFile(join(root, 'src', 'app.ts'), 'export const alpha = 1;\n');
    });

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
    });

    /** Dispatch one `spur self search` invocation in this process and capture its output. */
    async function search(args: string[]): Promise<ProbeResult> {
        const messages: string[] = [];
        const errors: string[] = [];
        const code = await main(['--no-logo', 'self', 'search', ...args], {
            cwd: root,
            output: { write: (message) => messages.push(message), error: (message) => errors.push(message) },
            dbUrl: ':memory:',
        });
        return { code, stdout: messages.join('\n'), stderr: errors.join('\n') };
    }

    test('--json emits the raw search response envelope payload', async () => {
        const result = await record(
            'json-exact',
            'spur self search alpha --mode exact --json',
            await search(['alpha', '--mode', 'exact', '--json']),
        );
        expect(result.code).toBe(0);
        const response = searchResponseDataSchema.parse(JSON.parse(result.stdout));
        expect(response.query).toBe('alpha');
        expect(response.mode).toBe('exact');
        expect(response.groups.fuzzy).toBeNull();
        expect(response.groups.exact?.map((hit) => hit.path).sort()).toEqual(['docs/guide.md', 'src/app.ts']);
        expect(response.groups.exact?.[0]?.matchedBy).toEqual(['exact']);
    });

    test('--json-envelope wraps the payload in the ADR-091 {ok, data} envelope', async () => {
        const result = await record(
            'json-envelope',
            'spur self search alpha --mode exact --json --json-envelope',
            await search(['alpha', '--mode', 'exact', '--json', '--json-envelope']),
        );
        expect(result.code).toBe(0);
        const envelope = searchResponseSchema.parse(JSON.parse(result.stdout));
        expect(envelope.ok).toBe(true);
        expect(envelope.data.query).toBe('alpha');
    });

    test('--glob narrows the exact group to matching paths', async () => {
        const result = await record(
            'glob-md',
            "spur self search alpha --mode exact --glob '*.md' --json",
            await search(['alpha', '--mode', 'exact', '--glob', '*.md', '--json']),
        );
        expect(result.code).toBe(0);
        const response = searchResponseDataSchema.parse(JSON.parse(result.stdout));
        expect(response.groups.exact?.map((hit) => hit.path)).toEqual(['docs/guide.md']);
    });

    test('--limit caps the group size', async () => {
        const result = await search(['alpha', '--mode', 'exact', '--limit', '1', '--json']);
        expect(result.code).toBe(0);
        expect(searchResponseDataSchema.parse(JSON.parse(result.stdout)).groups.exact).toHaveLength(1);
    });

    test('auto mode degrades to exact with a skipped fuzzy route and still exits 0', async () => {
        const result = await record(
            'auto-degraded',
            'spur self search alpha --json',
            await search(['alpha', '--json']),
        );
        expect(result.code).toBe(0);
        const response = searchResponseDataSchema.parse(JSON.parse(result.stdout));
        expect(response.mode).toBe('auto');
        expect(response.groups.exact).not.toBeNull();
        expect(response.groups.fuzzy).toBeNull();
        // This fixture has no zg index, so the only skip reason possible is the index
        // (zg is installed) or the missing binary (zg is not).
        expect(['zg-index-missing', 'zg-not-installed']).toContain(response.skipped[0]?.reason ?? '');
    });

    test('human output renders the group header and no matches', async () => {
        const hit = await record(
            'human-hits',
            'spur self search alpha --mode exact',
            await search(['alpha', '--mode', 'exact']),
        );
        expect(hit.code).toBe(0);
        expect(hit.stdout.split('\n')[0]).toBe('exact (2)');
        expect(hit.stdout).toContain('docs/guide.md:3  [exact]');

        const empty = await search(['zzz-no-such-term-xyz', '--mode', 'exact']);
        expect(empty.code).toBe(0);
        expect(empty.stdout).toContain('no matches');
    });

    test('--status without a query prints the readiness payload as JSON', async () => {
        const result = await record(
            'status-json',
            'spur self search --status --json',
            await search(['--status', '--json']),
        );
        expect(result.code).toBe(0);
        const status = searchStatusSchema.parse(JSON.parse(result.stdout));
        expect(typeof status.rg.available).toBe('boolean');
        expect(['ready', 'stale', 'missing', 'unknown']).toContain(status.zg.index);
    });

    test('--status without a query prints the human readiness lines', async () => {
        const result = await search(['--status']);
        expect(result.code).toBe(0);
        expect(result.stdout.split('\n')[0]).toStartWith('rg: ');
        expect(result.stdout).toContain('zg: ');
    });

    test('a missing query without --status is a usage error (exit 2)', async () => {
        const result = await record('missing-query', 'spur self search', await search([]));
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('usage: spur self search');
    });

    test('an invalid mode, limit or empty query fails with an actionable message (exit 1)', async () => {
        for (const [args, expected] of [
            [['alpha', '--mode', 'both'], 'Invalid search request'],
            [['alpha', '--limit', '0'], 'Invalid search request'],
            [['alpha', '--limit', '101'], 'Invalid search request'],
            [['alpha', '--limit', 'abc'], 'Invalid search request'],
            [['   '], 'Invalid search request'],
        ] as const) {
            const result = await search([...args]);
            expect(result.code).toBe(1);
            expect(result.stderr).toContain(expected);
        }
    });

    test('an invalid mode fails with the ADR-091 error envelope under --json-envelope', async () => {
        const result = await search(['alpha', '--mode', 'both', '--json', '--json-envelope']);
        expect(result.code).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    });
});

// ─── Subprocess degradation (real PATH) ──────────────────────────────────────

/** A PATH directory holding only the named binaries, symlinked from the host PATH. */
async function binDir(name: string, bins: string[]): Promise<string> {
    const dir = join(tmpdir(), `spur-search-bin-${name}`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const bin of bins) {
        const resolved = Bun.which(bin);
        if (resolved !== null) await symlink(resolved, join(dir, bin));
    }
    return dir;
}

describe('spur self search — backend degradation over PATH', () => {
    let root = '';

    beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), 'spur-search-e2e-'));
        await mkdir(join(root, '.spur'), { recursive: true });
        await writeFile(join(root, '.spur', 'config.yaml'), FIXTURE_CONFIG);
        await writeFile(join(root, 'guide.md'), 'Hybrid alpha search lives here.\n');
    });

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('without zg, auto mode reports zg-not-installed and exits 0', async () => {
        const path = await binDir('no-zg', ['bun', 'rg']);
        const result = await record(
            'path-no-zg',
            'PATH=<bun+rg> spur self search alpha --json',
            await runCli(['--no-logo', 'self', 'search', 'alpha', '--json'], root, { PATH: path }),
        );
        expect(result.code).toBe(0);
        const response = searchResponseDataSchema.parse(JSON.parse(result.stdout));
        expect(response.groups.exact).not.toBeNull();
        expect(response.groups.fuzzy).toBeNull();
        expect(response.skipped).toEqual([
            { route: 'fuzzy', reason: 'zg-not-installed', hint: 'bun add -g @zvec/zvec-grep' },
        ]);
    });

    test('without rg, exact mode exits 1 with the ripgrep install hint', async () => {
        const path = await binDir('no-rg', ['bun', 'zg']);
        const result = await record(
            'path-no-rg',
            'PATH=<bun+zg> spur self search alpha --mode exact',
            await runCli(['--no-logo', 'self', 'search', 'alpha', '--mode', 'exact'], root, { PATH: path }),
        );
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('ripgrep is not installed');
        expect(result.stderr).toContain('brew install ripgrep');
    });
});
