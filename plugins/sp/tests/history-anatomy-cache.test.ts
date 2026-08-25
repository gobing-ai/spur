import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type CacheProvenance,
    checkReportStructure,
    decideCache,
    parseProvenance,
    publishAtomically,
    runCacheCli,
    semanticArtifactDigest,
} from '../scripts/history-anatomy-cache';

function baseProvenance(over: Partial<CacheProvenance> = {}): CacheProvenance {
    const prov: CacheProvenance = {
        identity: {
            contractVersion: '1',
            mode: 'daily',
            date: '2026-08-24',
            timezone: 'America/Los_Angeles',
            bounds: { since: '2026-08-24T00:00:00-07:00', until: '2026-08-25T00:00:00-07:00' },
            sources: ['claude', 'codex'],
        },
        windowState: 'closed',
        generatedAt: '2026-08-24T23:00:00Z',
        validatedAt: '2026-08-24T23:05:00Z',
        artifactDigest: 'abc123',
        baselineArtifactDigest: null,
        contractDigest: 'cf',
        skillDigest: 'sf',
        workflowDigest: 'wf',
        coverage: [
            { source: 'claude', status: 'ok', lastImportedAt: '2026-08-24T23:00:00Z' },
            { source: 'codex', status: 'ok', lastImportedAt: '2026-08-24T23:00:00Z' },
        ],
        ...over,
    };
    return prov;
}

describe('semanticArtifactDigest (R1)', () => {
    test('key order and array order do not change the digest (excluding rankings)', () => {
        const a = { totals: { messages: 3, toolCalls: 2 }, bySource: { claude: { messages: 3 } }, generatedAt: 'X' };
        const b = { bySource: { claude: { messages: 3 } }, totals: { toolCalls: 2, messages: 3 }, generatedAt: 'Y' };
        expect(semanticArtifactDigest(a)).toBe(semanticArtifactDigest(b));
    });

    test('changing evidence changes the digest', () => {
        const a = { totals: { messages: 3 }, population: { sessions: 4 } };
        const b = { totals: { messages: 3 }, population: { sessions: 5 } };
        expect(semanticArtifactDigest(a)).not.toBe(semanticArtifactDigest(b));
    });

    test('ranked arrays keep order; plain lists sort; nested lists normalize', () => {
        const rankedSort = { byTool: [{ toolName: 'a' }, { toolName: 'b' }], plain: ['b', 'a'] };
        const same = { byTool: [{ toolName: 'b' }, { toolName: 'a' }], plain: ['a', 'b'] };
        expect(semanticArtifactDigest(rankedSort)).not.toBe(semanticArtifactDigest(same));
        expect(semanticArtifactDigest({ a: { nested: [{ z: 1 }, { x: 2 }] } })).toBe(
            semanticArtifactDigest({ a: { nested: [{ x: 2 }, { z: 1 }] } }),
        );
    });
});

describe('parseProvenance (R3)', () => {
    const fm = (body: string): string => `---\n${body}\n---\n# Report`;
    const valid = [
        'identity:',
        '  contractVersion: "1"',
        '  mode: daily',
        '  date: "2026-08-24"',
        '  timezone: America/Los_Angeles',
        '  bounds:',
        '    since: 2026-08-24T00:00:00-07:00',
        '    until: 2026-08-25T00:00:00-07:00',
        'windowState: closed',
        'generatedAt: 2026-08-24T23:00:00Z',
        'validatedAt: 2026-08-24T23:05:00Z',
        'artifactDigest: abc123',
        'contractDigest: cf',
        'skillDigest: sf',
        'workflowDigest: wf',
        'coverage:',
        '  - source: claude, status: ok, lastImportedAt: null',
        '  - source: codex, status: ok, lastImportedAt: null',
    ].join('\n');

    test('valid frontmatter parses to a cache identity', () => {
        const p = parseProvenance(fm(valid));
        expect(p).not.toBeNull();
        expect(p?.identity.date).toBe('2026-08-24');
        expect(p?.coverage.length).toBe(2);
    });

    test('no frontmatter returns null, does not throw', () => {
        expect(parseProvenance('# just a heading')).toBeNull();
    });

    test('truncated/unparsable frontmatter returns null', () => {
        expect(parseProvenance('---\nidentity: {unclosed\n')).toBeNull();
    });
});

describe('decideCache invalidation matrix (R2, R4)', () => {
    test('identical cache is a hit', () => {
        const d = decideCache(baseProvenance(), baseProvenance(), { recompute: false, dayClosed: true });
        expect(d.disposition).toBe('hit');
        expect(d.reasons).toEqual([]);
    });

    test('changed artifact digest is a data-changed miss', () => {
        const cur = baseProvenance({ artifactDigest: 'different' });
        const d = decideCache(baseProvenance(), cur, { recompute: false, dayClosed: true });
        expect(d.disposition).toBe('miss');
        expect(d.reasons).toContain('data-changed');
    });

    test('changed logic digest is a logic-changed miss', () => {
        const cur = baseProvenance({ skillDigest: 'new-skill' });
        const d = decideCache(baseProvenance(), cur, { recompute: false, dayClosed: true });
        expect(d.reasons).toContain('logic-changed:skill');
    });

    test('identity mismatch (date) is a miss', () => {
        const cur = baseProvenance({ identity: { ...baseProvenance().identity, date: '2026-08-25' } });
        const d = decideCache(baseProvenance(), cur, { recompute: false, dayClosed: true });
        expect(d.disposition).toBe('miss');
        expect(d.reasons).toContain('identity:date');
    });

    test('no cache is a miss', () => {
        const d = decideCache(null, baseProvenance(), { recompute: false, dayClosed: true });
        expect(d.disposition).toBe('miss');
        expect(d.reasons).toContain('no-cache');
    });

    test('degraded coverage is a miss', () => {
        const cur = baseProvenance({ coverage: [{ source: 'claude', status: 'ok', lastImportedAt: null }] });
        const d = decideCache(baseProvenance(), cur, { recompute: false, dayClosed: true });
        expect(d.reasons).toContain('coverage-degraded');
    });

    test('provisional cache read after day closed is invalidated (R4)', () => {
        const cached = baseProvenance({ windowState: 'provisional' });
        const d = decideCache(cached, baseProvenance(), { recompute: false, dayClosed: true });
        expect(d.disposition).toBe('miss');
        expect(d.reasons).toContain('window-closed');
    });

    test('--recompute forces recompute regardless of match', () => {
        const d = decideCache(baseProvenance(), baseProvenance(), { recompute: true, dayClosed: true });
        expect(d.disposition).toBe('forced-recompute');
    });
});

describe('checkReportStructure (R5)', () => {
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
        'Positive patterns',
        'Evidence ledger',
    ];
    const good = sections.map((s) => `## ${s}\n\nbody`).join('\n\n');

    test('a report with all sections passes', () => {
        expect(checkReportStructure(good).ok).toBe(true);
    });

    test('a missing section fails by name', () => {
        const bad = sections
            .slice(0, 5)
            .map((s) => `## ${s}\n\nbody`)
            .join('\n');
        const r = checkReportStructure(bad);
        expect(r.ok).toBe(false);
        expect(r.problems.some((p) => p.includes('section-missing'))).toBe(true);
    });

    test('a placeholder / TODO fails', () => {
        const r = checkReportStructure(`${good}\n\nTODO\n`);
        expect(r.ok).toBe(false);
        expect(r.problems.some((p) => p.includes('placeholder'))).toBe(true);
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

describe('publishAtomically (R6)', () => {
    test('publishes a candidate onto the target atomically', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-cache-'));
        const target = join(dir, 'report.md');
        const candidate = join(dir, 'candidate.md');
        writeFileSync(target, 'OLD');
        writeFileSync(candidate, 'NEW');
        publishAtomically(candidate, target);
        expect(readFileSync(target, 'utf8')).toBe('NEW');
        expect(existsSync(`${target}.tmp`)).toBe(false);
        rmSync(dir, { recursive: true, force: true });
    });

    test('a failed candidate leaves the prior target byte-identical', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-cache-'));
        const target = join(dir, 'report.md');
        // Candidate path that does not exist → publish throws, target untouched.
        writeFileSync(target, 'OLD');
        expect(() => publishAtomically(join(dir, 'missing.md'), target)).toThrow();
        expect(readFileSync(target, 'utf8')).toBe('OLD');
        expect(existsSync(`${target}.tmp`)).toBe(false);
        rmSync(dir, { recursive: true, force: true });
    });
});
