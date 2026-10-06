/**
 * history-anatomy-cache script contract (feature I8, HA-S1 0659 / ADR-079; task 1005 R2/R4).
 *
 * Behavioral cases for the moved logic live in packages/app/tests/services/history-anatomy.test.ts;
 * this suite keeps the thin script pins — the bare-`node` twin runs (0669 R2 backstop, 0686/I9
 * closed categories), the runCacheCli verb surface (digest/check/publish/assert-clean, the
 * 0660 cache cycle, the 0771 workflow guards) and the 0920 paths grammar, mirroring the
 * idea-handoff script-test pattern over the generated bundle
 * `plugins/sp/lib/history-anatomy.generated.mjs`.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';
import {
    type CacheCliResult,
    importedSnapshotAsOf,
    logicDigest,
    parseProvenance,
    resolvePaths,
    runCacheCli,
    semanticArtifactDigest,
    validateSelector,
} from '../scripts/history-anatomy-cache';

describe('semanticArtifactDigest twin parity (0669 R2, bare node)', () => {
    // R2 backstop (task 0669 Q&A): script-contract-check compares the twin only against its direct
    // .ts source, so a regenerated lib with a stale twin goes unnoticed there. This invokes the
    // committed .mjs twin's `digest` verb under bare node and requires the same hex as the
    // in-process implementation over an identical fixture.
    test('.mjs twin runs under bare node and digests identically (R2)', () => {
        const twin = join(import.meta.dir, '../scripts/history-anatomy-cache.mjs');
        expect(existsSync(twin)).toBeTrue();
        const twinText = readFileSync(twin, 'utf8');
        expect(twinText, 'ADR-065 twin must not import from packages/').not.toMatch(/packages\//);

        const dir = mkdtempSync(join(tmpdir(), 'ha-twin-'));
        const fixturePath = join(dir, 'fixture.json');
        const fixtureJson = JSON.stringify({
            totals: { messages: 42 },
            byTool: [{ id: 'A' }, { id: 'B' }],
        });
        writeFileSync(fixturePath, fixtureJson);
        try {
            const proc = Bun.spawnSync(['node', twin, 'digest', fixturePath]);
            if (proc.exitCode !== 0) {
                throw new Error(`bare-node twin run failed: ${proc.stderr.toString()}`);
            }
            expect(proc.stdout.toString().trim()).toBe(semanticArtifactDigest(JSON.parse(fixtureJson)));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // 0686/I9 AC: the closed-category gate must also hold when the twin runs under bare node.
    test('.mjs twin check fails a retro-named category and passes a closed one under bare node', () => {
        const twin = join(import.meta.dir, '../scripts/history-anatomy-cache.mjs');
        const dir = mkdtempSync(join(tmpdir(), 'ha-twin-check-'));
        const sections = [
            'Scope and provenance',
            'Executive summary',
            'Baseline comparison',
            'Findings',
            'Recurrence ledger',
            'Telemetry gaps',
            'Remediation options',
            'Performance analysis',
            'Workflow and process improvements',
            'Report-only advisories',
            'Positive patterns',
            'Evidence ledger',
        ];
        const finding =
            '- `key`: `workflow:agents-md:navigation`\n- `category`: `<cat>`\n- `impact`: i\n- `trend`: `new`\n' +
            '- `observation`: o\n- `inference`: inf\n- `confidence`: high\n- `contradictions`: none\n' +
            '- `evidenceAnchor`: `a.md`\n- `severity`: `P2`\n- `reproCommand`: `bun run x`\n- `ownerSurface`: `s.ts`';
        const report = (cat: string) =>
            sections
                .map((s) => `## ${s}\n\nbody`)
                .join('\n\n')
                .replace('## Findings\n\nbody', `## Findings\n\n### f\n\n${finding.replace('<cat>', cat)}\n`);
        const goodPath = join(dir, 'good.md');
        const badPath = join(dir, 'bad.md');
        writeFileSync(goodPath, report('workflow'));
        writeFileSync(badPath, report('navigation'));
        try {
            expect(Bun.spawnSync(['node', twin, 'check', goodPath]).exitCode).toBe(0);
            const proc = Bun.spawnSync(['node', twin, 'check', badPath]);
            expect(proc.exitCode).toBe(1);
            expect(proc.stdout.toString()).toContain('finding-invalid-category:navigation');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // Confidence-vocabulary gate must also hold under bare node: the production helper runs the
    // generated twin, so a level outside high/medium/low must fail there by name too.
    test('.mjs twin check fails an out-of-vocabulary confidence under bare node', () => {
        const twin = join(import.meta.dir, '../scripts/history-anatomy-cache.mjs');
        const dir = mkdtempSync(join(tmpdir(), 'ha-twin-conf-'));
        const sections = [
            'Scope and provenance',
            'Executive summary',
            'Baseline comparison',
            'Findings',
            'Recurrence ledger',
            'Telemetry gaps',
            'Remediation options',
            'Performance analysis',
            'Workflow and process improvements',
            'Report-only advisories',
            'Positive patterns',
            'Evidence ledger',
        ];
        const finding = (conf: string) =>
            '- `key`: `coverage:analytics:pairs`\n- `category`: `coverage`\n- `impact`: i\n- `trend`: `new`\n' +
            '- `observation`: o\n- `inference`: inf\n' +
            `- \`confidence\`: ${conf}\n` +
            '- `contradictions`: none\n- `evidenceAnchor`: `a.md`\n- `severity`: `P2`\n' +
            '- `reproCommand`: `bun run x`\n- `ownerSurface`: `s.ts`';
        const report = (conf: string) =>
            sections
                .map((s) => `## ${s}\n\nbody`)
                .join('\n\n')
                .replace('## Findings\n\nbody', `## Findings\n\n### f\n\n${finding(conf)}\n`);
        const goodPath = join(dir, 'good.md');
        const badPath = join(dir, 'bad.md');
        writeFileSync(goodPath, report('high'));
        writeFileSync(badPath, report('`certain`'));
        try {
            expect(Bun.spawnSync(['node', twin, 'check', goodPath]).exitCode).toBe(0);
            const proc = Bun.spawnSync(['node', twin, 'check', badPath]);
            expect(proc.exitCode).toBe(1);
            expect(proc.stdout.toString()).toContain('finding-invalid-confidence:certain');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
describe('CLI entry (runCacheCli)', () => {
    test('digest command computes, check validates, publish is atomic, usage errors return 1', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-cli-'));
        const art = join(dir, 'a.json');
        const report = join(dir, 'r.md');
        const target = join(dir, 'out.md');
        writeFileSync(art, JSON.stringify({ totals: { messages: 1 }, population: { sessions: 2 } }));
        writeFileSync(report, '## Executive summary\nbody');
        writeFileSync(target, 'old');

        expect(runCacheCli(['digest', art]).exitCode).toBe(0);
        expect(runCacheCli(['digest', art]).stdout.trim().length).toBe(64);
        expect(runCacheCli(['digest']).exitCode).toBe(1); // missing arg
        expect(runCacheCli(['check', report]).exitCode).toBe(1); // fails structure gate
        expect(runCacheCli(['check', report]).stdout).toContain('section-missing');
        expect(runCacheCli(['check']).exitCode).toBe(1);
        expect(runCacheCli(['publish', report, target]).exitCode).toBe(0);
        expect(runCacheCli(['publish', report]).exitCode).toBe(1); // missing target
        expect(runCacheCli(['bogus']).exitCode).toBe(1); // unknown command
        expect(readFileSync(target, 'utf8')).toBe('## Executive summary\nbody');
        rmSync(dir, { recursive: true, force: true });
    });
});
// ── 0660 R3/R5/R7: provenance emission and the end-to-end cache cycle ──────────────────────────
//
// The cache branch is only real if a published report carries provenance the NEXT run can read
// back. These tests drive the actual CLI surface the workflow invokes (paths → probe → stamp →
// publish → probe), because that seam — not the exported predicates — is where the feature lives.

describe('provenance + full cache cycle (0660 R3, R5, R7)', () => {
    const artifact = (over: Record<string, unknown> = {}) => ({
        schemaVersion: 1,
        selector: { since: '2026-08-24T00:00:00-07:00', until: '2026-08-25T00:00:00-07:00' },
        totals: { messages: 42 },
        population: { sessions: 9, tools: 4, loops: 0, warnings: 0, appliedTop: 20 },
        coverage: [
            { source: 'claude', status: 'ok', lastImportedAt: '2026-08-24T23:00:00Z' },
            { source: 'codex', status: 'ok', lastImportedAt: '2026-08-24T22:30:00Z' },
        ],
        loops: [],
        warnings: [],
        bySession: [],
        byTool: [],
        ...over,
    });

    /** A fixture project: artifact + logic files + a candidate report, all under one temp dir. */
    function fixture(over: Record<string, unknown> = {}) {
        const dir = mkdtempSync(join(tmpdir(), 'ha-cycle-'));
        writeFileSync(join(dir, 'art.json'), JSON.stringify(artifact(over)));
        writeFileSync(join(dir, 'contract.md'), 'contract v1');
        writeFileSync(join(dir, 'wf.yaml'), 'wf: 1');
        writeFileSync(join(dir, 'candidate.md'), '# body\n\ncontent here\n');
        return dir;
    }

    const probeArgs = (dir: string, extra: string[] = []) => [
        'probe',
        '--artifact',
        join(dir, 'art.json'),
        '--target',
        join(dir, 'report.md'),
        '--mode',
        'daily',
        '--date',
        '2026-08-24',
        '--contract',
        join(dir, 'contract.md'),
        '--workflow',
        join(dir, 'wf.yaml'),
        '--run-id',
        'r1',
        '--out',
        join(dir, 'prov.json'),
        ...extra,
    ];

    /** probe → stamp → publish: the miss path, leaving a published report with provenance. */
    function publishOnce(dir: string, extra: string[] = []): CacheCliResult {
        const p = runCacheCli(probeArgs(dir, extra));
        runCacheCli([
            'stamp',
            '--candidate',
            join(dir, 'candidate.md'),
            '--provenance',
            join(dir, 'prov.json'),
            '--out',
            join(dir, 'publishable.md'),
        ]);
        runCacheCli(['publish', join(dir, 'publishable.md'), join(dir, 'report.md')]);
        return p;
    }

    test('R7: the published report carries the full provenance block and it parses back', () => {
        const dir = fixture();
        publishOnce(dir);
        const published = readFileSync(join(dir, 'report.md'), 'utf8');
        for (const field of [
            'identity:',
            'contractVersion:',
            'mode: daily',
            'timezone:',
            'bounds:',
            'windowState:',
            'generatedAt:',
            'validatedAt:',
            'artifactDigest:',
            'baselineArtifactDigest:',
            'contractDigest:',
            'skillDigest:',
            'workflowDigest:',
            'runId:',
            'currentArtifactPath:',
            'spurVersion:',
            'schemaVersion:',
            'executor:',
            'cacheDisposition:',
            'coverage:',
        ]) {
            expect(published, `frontmatter must carry ${field}`).toContain(field);
        }
        const back = parseProvenance(published);
        expect(back?.identity.sources).toEqual(['claude', 'codex']);
        expect(back?.identity.bounds.since).toBe('2026-08-24T00:00:00-07:00');
        expect(back?.coverage.length).toBe(2);
        rmSync(dir, { recursive: true, force: true });
    });

    test('R8: the banner reports the EARLIEST lastImportedAt, never a later one', () => {
        const dir = fixture();
        publishOnce(dir);
        const published = readFileSync(join(dir, 'report.md'), 'utf8');
        // codex (22:30) is older than claude (23:00) — claiming 23:00 would overstate codex.
        expect(published).toContain('> imported snapshot as of 2026-08-24T22:30:00Z');
        expect(published).not.toContain('as of 2026-08-24T23:00:00Z');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R5: an unchanged second run is a hit against the report published by the first', () => {
        const dir = fixture();
        expect(publishOnce(dir).stdout).toBe('miss\n- no-cache\n');
        expect(runCacheCli(probeArgs(dir)).stdout).toBe('hit\n');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R6: changed imported data invalidates the published cache', () => {
        const dir = fixture();
        publishOnce(dir);
        writeFileSync(join(dir, 'art.json'), JSON.stringify(artifact({ totals: { messages: 99 } })));
        expect(runCacheCli(probeArgs(dir)).stdout).toContain('data-changed');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R7-logic: changed contract logic invalidates even when the data is identical', () => {
        const dir = fixture();
        publishOnce(dir);
        writeFileSync(join(dir, 'contract.md'), 'contract v2');
        const out = runCacheCli(probeArgs(dir)).stdout;
        expect(out).toContain('miss');
        expect(out).toContain('logic-changed:contract');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R12: a source dropping out of coverage invalidates the published cache', () => {
        const dir = fixture();
        publishOnce(dir);
        writeFileSync(
            join(dir, 'art.json'),
            JSON.stringify(artifact({ coverage: [{ source: 'claude', status: 'ok', lastImportedAt: null }] })),
        );
        expect(runCacheCli(probeArgs(dir)).stdout).toContain('coverage-degraded');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R9: --recompute forces recompute against a cache that would otherwise hit', () => {
        const dir = fixture();
        publishOnce(dir);
        expect(runCacheCli(probeArgs(dir)).stdout).toBe('hit\n');
        expect(runCacheCli(probeArgs(dir, ['--recompute', 'true'])).stdout).toContain('forced-recompute');
        rmSync(dir, { recursive: true, force: true });
    });

    test('ad-hoc never takes the hit branch even against a valid cache', () => {
        const dir = fixture();
        publishOnce(dir);
        const out = runCacheCli(probeArgs(dir, ['--mode', 'ad-hoc'])).stdout;
        expect(out).toContain('miss');
        expect(out).toContain('ad-hoc-never-cached');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R11: a malformed published report probes as a miss, not a crash', () => {
        const dir = fixture();
        writeFileSync(join(dir, 'report.md'), '---\nidentity: {unclosed\n# body\n');
        const r = runCacheCli(probeArgs(dir));
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('no-cache');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R3: refresh updates validatedAt, disposition and banner but not the recorded evidence', () => {
        const dir = fixture();
        publishOnce(dir);
        const before = parseProvenance(readFileSync(join(dir, 'report.md'), 'utf8'));
        runCacheCli([
            'refresh',
            '--report',
            join(dir, 'report.md'),
            '--out',
            join(dir, 'refreshed.md'),
            '--disposition',
            'hit',
            '--validated-at',
            '2026-08-25T09:00:00Z',
        ]);
        const text = readFileSync(join(dir, 'refreshed.md'), 'utf8');
        const after = parseProvenance(text);
        expect(after?.validatedAt).toBe('2026-08-25T09:00:00Z');
        expect(after?.cacheDisposition).toBe('hit');
        // The evidence the model half was authored from is untouched.
        expect(after?.generatedAt).toBe(before?.generatedAt);
        expect(after?.artifactDigest).toBe(before?.artifactDigest);
        // R7: republishing must not strip the audit block — a hit republishes from this object.
        expect(after?.runId).toBe('r1');
        expect(after?.currentArtifactPath).toBe(before?.currentArtifactPath);
        expect(after?.schemaVersion).toBe(1);
        expect(text).toContain('runId:');
        expect(text).toContain('executor:');
        // Idempotent: exactly one banner survives a refresh of a refreshed report.
        expect(text.match(/imported snapshot as of/g)?.length).toBe(1);
        expect(text).toContain('cache hit');
        rmSync(dir, { recursive: true, force: true });
    });

    test('windowState is provisional for today and closed for a past day', () => {
        const dir = fixture();
        const today = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(new Date());
        runCacheCli(probeArgs(dir, ['--date', today]));
        expect(JSON.parse(readFileSync(join(dir, 'prov.json'), 'utf8')).windowState).toBe('provisional');
        runCacheCli(probeArgs(dir));
        expect(JSON.parse(readFileSync(join(dir, 'prov.json'), 'utf8')).windowState).toBe('closed');
        rmSync(dir, { recursive: true, force: true });
    });

    test('a provisional cache read once the day has closed is invalidated', () => {
        const dir = fixture();
        const today = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(new Date());
        publishOnce(dir, ['--date', today]);
        // Same report, now requested as a past (closed) day: windowState must invalidate it.
        const published = readFileSync(join(dir, 'report.md'), 'utf8').replace(
            `date: "${today}"`,
            'date: "2026-08-24"',
        );
        writeFileSync(join(dir, 'report.md'), published);
        expect(runCacheCli(probeArgs(dir)).stdout).toContain('window-closed');
        rmSync(dir, { recursive: true, force: true });
    });

    test('logicDigest: missing paths read not available; a directory folds in file names', () => {
        const dir = fixture();
        expect(logicDigest(join(dir, 'nope.md'))).toBe('not available');
        expect(logicDigest(undefined)).toBe('not available');
        const d = join(dir, 'skill');
        mkdirSync(join(d, 'references'), { recursive: true });
        writeFileSync(join(d, 'SKILL.md'), 'a');
        const one = logicDigest(d);
        writeFileSync(join(d, 'references', 'modes.md'), 'b');
        expect(logicDigest(d)).not.toBe(one);
        rmSync(dir, { recursive: true, force: true });
    });

    test('importedSnapshotAsOf reads not available when any source lacks a timestamp', () => {
        expect(importedSnapshotAsOf([{ source: 'a', status: 'ok', lastImportedAt: null }])).toBe('not available');
        expect(importedSnapshotAsOf([])).toBe('not available');
        expect(
            importedSnapshotAsOf([
                { source: 'a', status: 'ok', lastImportedAt: '2026-08-02T00:00:00Z' },
                { source: 'b', status: 'ok', lastImportedAt: '2026-08-01T00:00:00Z' },
            ]),
        ).toBe('2026-08-01T00:00:00Z');
    });

    test('paths resolves the skill dir beside the helper and defaults the target', () => {
        const env = resolvePaths({
            helper: '/p/sp/scripts/history-anatomy-cache.mjs',
            reportDir: 'docs/report',
            date: '2026-08-24',
        });
        expect(env).toContain('HA_SKILL=/p/sp/skills/history-anatomy');
        expect(env).toContain('HA_TARGET=docs/report/2026-08-24-history-anatomy.md');
        expect(env).toContain('HA_DATE=2026-08-24');
        // An explicit --output wins over the derived daily path.
        expect(
            resolvePaths({
                helper: '/p/sp/scripts/h.mjs',
                reportDir: 'docs/report',
                date: '2026-08-24',
                output: '/tmp/x.md',
            }),
        ).toContain('HA_TARGET=/tmp/x.md');
    });

    // 0674 R1/R2/R3: the resolved window reaches analyze via the env file. A local calendar
    // day is 23/24/25h under DST, so bounds are asserted on epoch ordering, not wall-clock text.
    const parse = (s: string): number => Date.parse(s);

    test('daily bounds cover exactly one normal (non-DST) local day and order before them a preceding day', () => {
        const env = resolvePaths({ helper: '/p/h.mjs', reportDir: 'r', date: '2026-08-24', tz: 'America/Los_Angeles' });
        const get = (k: string): string =>
            env
                .split('\n')
                .find((l) => l.startsWith(`${k}=`))
                ?.slice(k.length + 1) ?? '';
        expect(get('HA_SINCE')).toBe('2026-08-24T00:00:00.000-07:00');
        expect(get('HA_UNTIL')).toBe('2026-08-24T23:59:59.999-07:00');
        expect(get('HA_BASELINE_SINCE')).toBe('2026-08-23T00:00:00.000-07:00');
        expect(get('HA_BASELINE_UNTIL')).toBe('2026-08-23T23:59:59.999-07:00');
        // ordered + disjoint: baseline pair strictly precedes current pair
        expect(parse(get('HA_BASELINE_UNTIL'))).toBeLessThan(parse(get('HA_SINCE')));
    });

    test('paths resolves the superskill-installed layout (scripts/<plugin>/<file> → skills/<plugin>-history-anatomy)', () => {
        const env = resolvePaths({
            helper: '/home/u/.agents/scripts/sp/history-anatomy-cache.mjs',
            reportDir: 'docs/report',
            date: '2026-08-24',
        });
        expect(env).toContain('HA_SKILL=/home/u/.agents/skills/sp-history-anatomy');
    });

    test('spring-forward day keeps 24 distinct instants with correct offsets (PST morning, PDT night)', () => {
        const env = resolvePaths({ helper: '/p/h.mjs', reportDir: 'r', date: '2026-03-08', tz: 'America/Los_Angeles' });
        const get = (k: string): string =>
            env
                .split('\n')
                .find((l) => l.startsWith(`${k}=`))
                ?.slice(k.length + 1) ?? '';
        expect(get('HA_SINCE')).toBe('2026-03-08T00:00:00.000-08:00');
        expect(get('HA_UNTIL')).toBe('2026-03-08T23:59:59.999-07:00');
        expect(parse(get('HA_UNTIL')) - parse(get('HA_SINCE')) + 1).toBe(23 * 3_600_000);
    });

    test('fall-back day spans 25 hours and the preceding-day pair stays ordered and disjoint', () => {
        const env = resolvePaths({ helper: '/p/h.mjs', reportDir: 'r', date: '2026-11-01', tz: 'America/Los_Angeles' });
        const get = (k: string): string =>
            env
                .split('\n')
                .find((l) => l.startsWith(`${k}=`))
                ?.slice(k.length + 1) ?? '';
        expect(get('HA_BASELINE_SINCE')).toBe('2026-10-31T00:00:00.000-07:00');
        expect(get('HA_UNTIL')).toBe('2026-11-01T23:59:59.999-08:00');
        expect(parse(get('HA_UNTIL')) - parse(get('HA_SINCE')) + 1).toBe(25 * 3_600_000);
        expect(parse(get('HA_BASELINE_UNTIL'))).toBeLessThan(parse(get('HA_SINCE')));
    });

    test('ad-hoc passes operator bounds through untouched and emits no baseline pair', () => {
        const env = resolvePaths({
            helper: '/p/h.mjs',
            reportDir: 'r',
            mode: 'ad-hoc',
            since: '2026-08-01T09:30:00.000+05:30',
            until: '2026-08-05T18:00:00.000+05:30',
            tz: 'UTC',
        });
        expect(env).toContain('HA_SINCE=2026-08-01T09:30:00.000+05:30');
        expect(env).toContain('HA_UNTIL=2026-08-05T18:00:00.000+05:30');
        expect(env).not.toContain('HA_BASELINE_');
    });

    test('unknown and malformed invocations report the full verb list without throwing', () => {
        expect(runCacheCli(['nope']).stderr).toContain(
            'digest, check, paths, assert-clean, probe, stamp, refresh, publish',
        );
        expect(runCacheCli(['probe']).exitCode).toBe(1);
        expect(runCacheCli(['stamp']).exitCode).toBe(1);
        expect(runCacheCli(['refresh']).exitCode).toBe(1);
        expect(runCacheCli(['paths']).exitCode).toBe(1);
    });
});

describe('CLI assert-clean (0676 R3)', () => {
    test('usage error without --baseline', () => {
        expect(runCacheCli(['assert-clean']).exitCode).toBe(1);
        expect(runCacheCli(['assert-clean']).stderr).toContain('--baseline');
    });

    test('clean tree passes; undeclared write fails naming the path', async () => {
        const { mkdirSync, mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
        const { execFileSync } = await import('node:child_process');
        const dir = mkdtempSync(join(tmpdir(), 'assert-clean-'));
        try {
            const git = (...args: string[]): void => {
                execFileSync('git', args, {
                    cwd: dir,
                    env: {
                        ...getEnvVars(),
                        GIT_AUTHOR_NAME: 't',
                        GIT_COMMITTER_NAME: 't',
                        GIT_AUTHOR_EMAIL: 't@t',
                        GIT_COMMITTER_EMAIL: 't@t',
                    },
                });
            };
            git('init', '-q');
            // Mirror the real repo: .spur/ run glue is gitignored, so porcelain reports only
            // genuinely undeclared writes outside the sanctioned namespace (0676 R3 scope).
            mkdirSync(join(dir, '.spur'), { recursive: true });
            writeFileSync(join(dir, '.gitignore'), '.spur/\n');
            writeFileSync(join(dir, 'committed.txt'), 'x');
            git('add', '.');
            git('commit', '-qm', 'init');
            // Baseline lives OUTSIDE the watched tree so its own untracked presence never counts.
            const baseline = join(mkdtempSync(join(tmpdir(), 'ac-baseline-')), 'baseline.txt');
            writeFileSync(baseline, '');
            const ok = runCacheCli([
                'assert-clean',
                '--baseline',
                baseline,
                '--expect=.spur/run/candidate.md',
                '--cwd',
                dir,
            ]);
            expect(ok.exitCode).toBe(0);

            writeFileSync(join(dir, 'history-anatomy..md'), 'leak');
            const bad = runCacheCli([
                'assert-clean',
                '--baseline',
                baseline,
                '--expect=.spur/run/candidate.md',
                '--cwd',
                dir,
            ]);
            expect(bad.exitCode).toBe(1);
            expect(bad.stderr).toContain('undeclared write: history-anatomy..md');

            mkdirSync(join(dir, '.spur/run'), { recursive: true });
            rmSync(join(dir, 'history-anatomy..md'));
            writeFileSync(join(dir, '.spur/run/candidate.md'), 'report');
            const declaredOk = runCacheCli([
                'assert-clean',
                '--baseline',
                baseline,
                '--expect=.spur/run/candidate.md',
                '--cwd',
                dir,
            ]);
            expect(declaredOk.exitCode).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
// parses the actual guard out of history-anatomy.yaml and runs it against spoofed verdict
// artifacts — no whole-YAML equality.
describe('validate publish guard (0771 anchored verdict)', () => {
    const { parse } = require('yaml') as typeof import('yaml');
    const ROOT = join(import.meta.dir, '..', '..', '..');
    const guard = ((): { toStamp: string; toCorrect: string } => {
        const doc = parse(readFileSync(join(ROOT, 'config', 'workflows', 'history-anatomy.yaml'), 'utf8')) as {
            transitions: Array<{ from: string; to: string; guard?: { kind: string; options?: { command?: string } } }>;
        };
        const toStamp = doc.transitions.find((t) => t.from === 'validate' && t.to === 'stamp');
        const toCorrect = doc.transitions.find((t) => t.from === 'validate' && t.to === 'correct');
        if (!toStamp?.guard?.options?.command || !toCorrect?.guard?.options?.command) {
            throw new Error('validate guards missing');
        }
        return { toStamp: toStamp.guard.options.command, toCorrect: toCorrect.guard.options.command };
    })();

    const sh = (cmd: string, cwd: string): number =>
        Bun.spawnSync(['/bin/sh', '-c', cmd], { cwd, stdout: 'ignore', stderr: 'ignore' }).exitCode ?? -1;

    test('exact final PASS publishes; PASS-then-FAIL, negation, and missing file do not', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-guard-'));
        const validation = join(dir, 'validation.txt');
        const runId = '__runId';
        try {
            const sub = (cmd: string): string =>
                cmd.replaceAll(`.spur/run/$${runId}-validation.txt`, validation).replaceAll('$__runId', runId);
            writeFileSync(validation, 'Verdict: PASS\n');
            expect(sh(sub(guard.toStamp), dir)).toBe(0);
            expect(sh(sub(guard.toCorrect), dir)).not.toBe(0);
            writeFileSync(validation, 'Verdict: PASS\nVerdict: FAIL\n');
            expect(sh(sub(guard.toStamp), dir)).not.toBe(0);
            writeFileSync(validation, 'not Verdict: PASS\n');
            expect(sh(sub(guard.toStamp), dir)).not.toBe(0);
            writeFileSync(validation, 'trailing verdict text Verdict: PASS\n');
            expect(sh(sub(guard.toStamp), dir)).not.toBe(0);
            rmSync(validation);
            expect(sh(sub(guard.toStamp), dir)).not.toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// 0771: probe CLI carries --helper into the provenance so the cache identity includes the twin.
describe('probe --helper digest identity (0771)', () => {
    test('helperDigest records the sha256 of the helper twin', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-helper-'));
        try {
            const helper = join(dir, 'helper.mjs');
            writeFileSync(helper, 'export {};\n');
            const artifact = join(dir, 'artifact.json');
            writeFileSync(
                artifact,
                JSON.stringify({ selector: { since: 's', until: 'u' }, coverage: [{ source: 'x', status: 'ok' }] }),
            );
            const out = join(dir, 'prov.json');
            const r = runCacheCli([
                'probe',
                '--artifact',
                artifact,
                '--target',
                join(dir, 'report.md'),
                '--mode',
                'daily',
                '--out',
                out,
                '--helper',
                helper,
            ]);
            expect(r.exitCode).toBe(0);
            const prov = JSON.parse(readFileSync(out, 'utf8')) as { helperDigest: string };
            expect(prov.helperDigest).toBe(logicDigest(helper));
            expect(prov.helperDigest).not.toBe('not available');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
describe('paths grammar validation (0920 — deterministic scope owner)', () => {
    test('daily default and explicit real date pass; invalid calendar day fails by name', () => {
        expect(validateSelector({ mode: 'daily', date: '2026-08-24' })).toEqual({
            ok: true,
            mode: 'daily',
            date: '2026-08-24',
            focus: null,
            since: null,
            until: null,
        });
        expect(validateSelector({ date: '2026-02-30' })).toMatchObject({ ok: false });
        const invalidDate = validateSelector({ date: '2026-02-30' });
        expect(invalidDate.ok === false && invalidDate.errors[0]).toContain('--date');
        expect(validateSelector({ date: '2024-02-29' }).ok).toBe(true); // leap day is real
    });

    test('daily rejects focus/since/until/output, naming every attributable flag', () => {
        const v = validateSelector({
            mode: 'daily',
            focus: 'f',
            since: '2026-01-01T00:00:00Z',
            until: '2026-01-02T00:00:00Z',
            output: 'o.md',
        });
        expect(v.ok).toBe(false);
        if (!v.ok) {
            expect(v.errors.some((e) => e.includes('--focus'))).toBe(true);
            expect(v.errors.some((e) => e.includes('--since'))).toBe(true);
            expect(v.errors.some((e) => e.includes('--until'))).toBe(true);
            expect(v.errors.some((e) => e.includes('--output'))).toBe(true);
        }
    });

    test('unknown mode, bad recompute literal fail by name', () => {
        expect(validateSelector({ mode: 'weekly' }).ok).toBe(false);
        const invalidMode = validateSelector({ mode: 'weekly' });
        expect(invalidMode.ok === false && invalidMode.errors[0]).toContain('--mode');
        expect(validateSelector({ recompute: 'yes' }).ok).toBe(false);
    });

    test('ad-hoc: valid ordered inclusive bounds pass untouched; ordering/parse failures named', () => {
        const ok = validateSelector({
            mode: 'ad-hoc',
            focus: 'auth refactor',
            since: '2026-08-01T09:30:00+05:30',
            until: '2026-08-05T18:00:00+05:30',
        });
        expect(ok).toEqual({
            ok: true,
            mode: 'ad-hoc',
            date: null,
            focus: 'auth refactor',
            since: '2026-08-01T09:30:00+05:30',
            until: '2026-08-05T18:00:00+05:30',
        });
        const ordered = validateSelector({
            mode: 'ad-hoc',
            focus: 'f',
            since: '2026-08-05T00:00:00Z',
            until: '2026-08-01T00:00:00Z',
        });
        expect(ordered.ok === false && ordered.errors[0]).toContain('--since must not be after --until');
        const badInstant = validateSelector({
            mode: 'ad-hoc',
            focus: 'f',
            since: 'not-a-date',
            until: '2026-08-05T00:00:00Z',
        });
        expect(badInstant.ok === false && badInstant.errors.some((e) => e.includes('--since'))).toBe(true);
        expect(
            validateSelector({ mode: 'ad-hoc', since: '2026-08-01T00:00:00Z', until: '2026-08-05T00:00:00Z' }).ok,
        ).toBe(false); // no focus
    });

    test('ad-hoc rejects --date and --recompute; daily allows recompute', () => {
        const v = validateSelector({
            mode: 'ad-hoc',
            focus: 'f',
            since: '2026-08-01T00:00:00Z',
            until: '2026-08-05T00:00:00Z',
            date: '2026-08-02',
            recompute: 'true',
        });
        expect(v.ok).toBe(false);
        if (!v.ok) {
            expect(v.errors.some((e) => e.includes('--date'))).toBe(true);
            expect(v.errors.some((e) => e.includes('--recompute'))).toBe(true);
        }
        expect(validateSelector({ mode: 'daily', recompute: 'true' }).ok).toBe(true);
        expect(
            validateSelector({
                mode: 'ad-hoc',
                recompute: 'false',
                focus: 'f',
                since: '2026-08-01T00:00:00Z',
                until: '2026-08-05T00:00:00Z',
            }).ok,
        ).toBe(true);
    });

    test('CLI: failure leaves no paths file; success writes env and selector observation', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-paths-'));
        const envOut = join(dir, 'paths.env');
        try {
            const bad = runCacheCli([
                'paths',
                '--helper',
                '/p/h.mjs',
                '--out',
                envOut,
                '--mode',
                'ad-hoc',
                '--since',
                '2026-08-01T00:00:00Z',
                '--until',
                '2026-08-05T00:00:00Z',
            ]);
            expect(bad.exitCode).toBe(1);
            expect(bad.stderr).toContain('--focus');
            expect(existsSync(envOut)).toBe(false); // no usable paths file on invalid input

            const ok = runCacheCli([
                'paths',
                '--helper',
                '/p/h.mjs',
                '--out',
                envOut,
                '--mode',
                'ad-hoc',
                '--focus',
                'auth',
                '--since',
                '2026-08-01T09:30:00+05:30',
                '--until',
                '2026-08-05T18:00:00+05:30',
                '--run-id',
                'testsel0920',
            ]);
            expect(ok.exitCode).toBe(0);
            const env = readFileSync(envOut, 'utf8');
            expect(env).toContain('HA_SINCE=2026-08-01T09:30:00+05:30'); // inclusive bounds untouched
            expect(env).not.toContain('HA_BASELINE_');
            const sel = JSON.parse(readFileSync('.spur/run/testsel0920-selector.json', 'utf8')) as Record<
                string,
                unknown
            >;
            expect(sel).toMatchObject({
                mode: 'ad-hoc',
                focus: 'auth',
                since: '2026-08-01T09:30:00+05:30',
                until: '2026-08-05T18:00:00+05:30',
            });
            expect(sel.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // effective local day
            expect(typeof sel.timezone).toBe('string');
        } finally {
            rmSync(dir, { recursive: true, force: true });
            rmSync('.spur/run/testsel0920-selector.json', { force: true });
        }
    });
});
