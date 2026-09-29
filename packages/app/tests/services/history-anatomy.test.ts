/**
 * History-anatomy cache core (feature I8, HA-S1 0659 / ADR-079) — ported to packages/app
 * (task 1005 R2).
 *
 * Behavioral cases for the moved logic — the semantic digest canonicalization, provenance
 * parsing, invalidation matrix, report structure gate, atomic publish and selector grammar — run
 * against packages/app/src/services/history-anatomy.ts. The CLI-surface and bare-node twin pins
 * stay in plugins/sp/tests/history-anatomy-cache.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARTIFACT_ARRAY_CLASSIFICATION, RANKED_ARTIFACT_KEYS } from '@gobing-ai/spur-domain';
import {
    bannerLine,
    buildProvenance,
    type CacheProvenance,
    checkReportStructure,
    decideCache,
    diffPorcelain,
    importedSnapshotAsOf,
    logicDigest,
    parseProvenance,
    probe,
    publishAtomically,
    refreshReport,
    resolvePaths,
    semanticArtifactDigest,
    stampReport,
    validateSelector,
} from '../../src/services/history-anatomy';

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
        helperDigest: 'hf',
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

    // Task 0669: the ranked-versus-set classification lives beside `HistoryArtifact` in
    // packages/domain (artifact-digest.ts) and reaches this test through the generated plugin copy —
    // no hand-maintained mirror. The drift guard derives its key list from that classification, so a
    // new ranked array without a classification fails tsc, and a mis-classification fails here.
    test('every ranked artifact array preserves order in the digest (drift guard)', () => {
        const rankedKeys = [...RANKED_ARTIFACT_KEYS];
        expect(rankedKeys.length).toBeGreaterThan(0);
        for (const key of rankedKeys) {
            const a = {
                [key]: [
                    { id: 'A', n: 2 },
                    { id: 'B', n: 1 },
                ],
            };
            const b = {
                [key]: [
                    { id: 'B', n: 1 },
                    { id: 'A', n: 2 },
                ],
            };
            expect(semanticArtifactDigest(a), `${key} is a ranking — reordering it must change the digest`).not.toBe(
                semanticArtifactDigest(b),
            );
        }
        // Counterexample: a set-valued array must still sort, or the digest is unstable.
        const setKeys = Object.entries(ARTIFACT_ARRAY_CLASSIFICATION)
            .filter(([, kind]) => kind === 'set')
            .map(([key]) => key);
        for (const key of setKeys) {
            const a = { [key]: [{ id: 'A' }, { id: 'B' }] };
            const b = { [key]: [{ id: 'B' }, { id: 'A' }] };
            expect(semanticArtifactDigest(a), `${key} is a set — order must not change the digest`).toBe(
                semanticArtifactDigest(b),
            );
        }
    });

    // R3 gate made test-visible: the classification must cover every ArtifactArrayKey. In the
    // domain this is enforced at compile time (exhaustive Record over the recursive array-key type),
    // so adding an array field to HistoryArtifact without classifying it fails `tsc --noEmit` naming
    // the field — and fails here too, naming it, per the AC.
    test('classification covers every artifact array key (R3)', () => {
        const keys = Object.keys(ARTIFACT_ARRAY_CLASSIFICATION);
        expect(keys.length).toBeGreaterThan(0);
        expect(new Set(keys).size).toBe(keys.length);
        for (const [key, kind] of Object.entries(ARTIFACT_ARRAY_CLASSIFICATION)) {
            expect(
                ['ranked', 'set'],
                `${key} must be classified ranked or set — order-as-evidence must be declared`,
            ).toContain(kind);
        }
    });

    // R4: the move from plugins/sp/scripts to packages/domain must not change any digest value,
    // or every published report's recorded artifactDigest would be invalidated. This fixture
    // exercises all six ranked arrays and all twelve set arrays (including selector sources/tools/
    // skills/models and nested derived.phases.phases), plus the excluded volatile fields.
    // The hex literal was captured from the PRE-MOVE implementation before it was deleted; if this
    // ever fails, canonicalization behavior drifted — that is a regression, not a refactor.
    test('post-move implementation reproduces the pre-move digest byte-for-byte (R4)', () => {
        const fixture = {
            schemaVersion: 1,
            generatedAt: '2026-08-25T00:00:00Z',
            spurVersion: '0.0.0-test',
            validatedAt: '2026-08-25T01:00:00Z',
            baselineArtifactDigest: 'deadbeef',
            population: { sessions: 2, tools: 3, loops: 4, warnings: 5, appliedTop: 10 },
            totals: { messages: 42, toolCalls: 7 },
            bySource: { claude: { messages: 20 }, codex: { messages: 22 } },
            byModel: { m1: { messages: 30 }, m2: { messages: 12 } },
            selector: {
                since: '2026-08-24T00:00:00-07:00',
                until: '2026-08-25T00:00:00-07:00',
                sources: ['codex', 'claude'],
                models: ['m2', 'm1'],
                tools: ['Bash', 'Edit'],
                skills: ['zeta', 'alpha'],
                sessionId: null,
                runId: null,
                taskWbs: '0669',
            },
            coverage: [
                { source: 'codex', status: 'ok', files: 3 },
                { source: 'claude', status: 'ok', files: 2 },
            ],
            daily: [
                { date: '2026-08-25', messages: 12 },
                { date: '2026-08-24', messages: 30 },
            ],
            byTool: [
                { toolName: 'Bash', calls: 5 },
                { toolName: 'Edit', calls: 2 },
            ],
            bySession: [
                { sessionId: 's-b', tokens: 100 },
                { sessionId: 's-a', tokens: 200 },
            ],
            topStepsByTokens: [
                { sessionId: 's-a', inputTokens: 900 },
                { sessionId: 's-b', inputTokens: 300 },
            ],
            topStepsByDuration: [
                { sessionId: 's-b', durationMs: 5000 },
                { sessionId: 's-a', durationMs: 1000 },
            ],
            loops: [
                { sessionId: 's-a', repeats: 3 },
                { sessionId: 's-b', repeats: 9 },
            ],
            warnings: [
                { code: 'w2', detail: 'two' },
                { code: 'w1', detail: 'one' },
            ],
            pairings: [{ executor: 'omp', role: 'coder', dispatches: 4 }],
            ladderSnapshot: [
                { name: 'omp', tier: 'standard', order: 0 },
                { name: 'pi', tier: 'capable-1', order: 1 },
            ],
            derived: {
                phases: {
                    phaseSupport: 'supported',
                    phases: [
                        {
                            name: 'p2',
                            startedAt: '2026-08-24T01:00:00Z',
                            endedAt: '2026-08-24T02:00:00Z',
                            source: 'todo',
                        },
                        {
                            name: 'p1',
                            startedAt: '2026-08-24T03:00:00Z',
                            endedAt: '2026-08-24T04:00:00Z',
                            source: 'todo',
                        },
                    ],
                },
                timeDecomposition: {
                    llmMs: 100,
                    toolMs: 50,
                    idleMs: 25,
                    unattributedMs: 5,
                    spanMs: 180,
                    spanExcludedSessions: 0,
                },
                bottlenecks: [
                    { label: 'llm', ms: 100, share: 0.55 },
                    { label: 'tool', ms: 50, share: 0.28 },
                ],
            },
            cacheWaste: {
                steps: 6,
                inputTokens: 1234,
                topSteps: [
                    { sessionId: 's-c', cacheReadTokens: 700 },
                    { sessionId: 's-d', cacheReadTokens: 200 },
                ],
            },
            stepSupport: [
                { source: 'codex', assistantSteps: 9 },
                { source: 'claude', assistantSteps: 4 },
            ],
        };
        expect(semanticArtifactDigest(fixture)).toBe(
            'c7df4f4deb63fb4d267365fda07f8fda52558aae142437938c2e4e1f72f83271',
        );

        // Reordering every ranked array must change the digest...
        const reordered = structuredClone(fixture);
        reordered.byTool.reverse();
        reordered.bySession.reverse();
        reordered.topStepsByTokens.reverse();
        reordered.topStepsByDuration.reverse();
        reordered.cacheWaste.topSteps.reverse();
        reordered.derived.bottlenecks.reverse();
        expect(semanticArtifactDigest(reordered)).not.toBe(semanticArtifactDigest(fixture));

        // ...while shuffling every set array must not.
        const shuffled = structuredClone(fixture);
        shuffled.coverage.reverse();
        shuffled.daily.reverse();
        shuffled.loops.reverse();
        shuffled.warnings.reverse();
        shuffled.pairings.reverse();
        shuffled.ladderSnapshot.reverse();
        shuffled.stepSupport.reverse();
        shuffled.derived.phases.phases.reverse();
        shuffled.selector.sources = [...shuffled.selector.sources].reverse();
        shuffled.selector.models = [...shuffled.selector.models].reverse();
        shuffled.selector.tools = [...shuffled.selector.tools].reverse();
        shuffled.selector.skills = [...shuffled.selector.skills].reverse();
        expect(semanticArtifactDigest(shuffled)).toBe(semanticArtifactDigest(fixture));
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

    // 0771: the executing helper twin is part of cache identity.
    test('changed helper digest is a logic-changed:helper miss', () => {
        const cur = baseProvenance({ helperDigest: 'new-helper' });
        const d = decideCache(baseProvenance(), cur, { recompute: false, dayClosed: true });
        expect(d.disposition).toBe('miss');
        expect(d.reasons).toContain('logic-changed:helper');
    });

    test('pre-0771 provenance without a helper digest misses once, then hits', () => {
        const older = baseProvenance() as Partial<CacheProvenance>;
        delete (older as { helperDigest?: string }).helperDigest;
        const d = decideCache(older as CacheProvenance, baseProvenance(), { recompute: false, dayClosed: true });
        expect(d.reasons).toContain('logic-changed:helper');
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
        'Report-only advisories',
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

    // R5/R26: the anchor gate must inspect *every* claim, and must not mistake a table's own
    // header row for an unanchored claim — the two halves of the same defect.
    const head = sections
        .slice(0, 11)
        .map((s) => `## ${s}\n\nbody`)
        .join('\n\n');
    const ledger = (rows: string) => `${head}\n\n## Evidence ledger\n\n| Claim | Anchor |\n| --- | --- |\n${rows}`;

    test('a fully anchored ledger table passes — the header row is structure, not a claim', () => {
        const r = checkReportStructure(
            ledger(
                '| tokens rose 20% | `packages/app/src/x.ts:10` |\n| loop detected | `packages/domain/src/y.ts:42` |\n',
            ),
        );
        expect(r.problems).toEqual([]);
        expect(r.ok).toBe(true);
    });

    test('an unanchored claim after an anchored first claim still fails', () => {
        const r = checkReportStructure(
            ledger('| tokens rose 20% | `packages/app/src/x.ts:10` |\n| sessions were slow | none whatsoever |\n'),
        );
        expect(r.ok).toBe(false);
        expect(r.problems).toContain('evidence-claim-without-anchor');
    });

    test('a blockquote ledger is scanned past its first line', () => {
        const r = checkReportStructure(
            `${head}\n\n## Evidence ledger\n\n> tokens rose 20% — \`packages/app/src/x.ts:10\`\n> loop detected — no anchor here\n`,
        );
        expect(r.ok).toBe(false);
        expect(r.problems).toContain('evidence-claim-without-anchor');
    });

    // 0690 R3: the anchor gate keeps pinning the backticked format from the 0687 fix pass —
    // the `current #/pointer` artifact vocabulary enrich models actually emit never matches.
    test('a `current #/pointer` claim row fails evidence-claim-without-anchor', () => {
        const r = checkReportStructure(ledger('| repeated session spike | current #/sessions/pi-deepseek |\n'));
        expect(r.ok).toBe(false);
        expect(r.problems).toContain('evidence-claim-without-anchor');
    });

    test('backticked path and path:line anchors satisfy the gate directly (0690 R3)', () => {
        const r = checkReportStructure(
            ledger(
                '| artifact digest changed | `.spur/run/x-history-anatomy-current.json` |\n| gate regex drifted | `plugins/sp/scripts/history-anatomy-cache.mjs:330` |\n',
            ),
        );
        expect(r.problems).toEqual([]);
        expect(r.ok).toBe(true);
    });

    // 0690: a replica of run 99333080's candidate reproduces all three observed gate classes by name.
    test('the 99333080 failure classes reproduce together and by name', () => {
        const bad = sections
            .filter((s) => s !== 'Report-only advisories')
            .map((s) => `## ${s}\n\nbody`)
            .join('\n\n');
        const replica = `${bad.replace('body', 'TODO: fill')}\n\n## Evidence ledger\n\n| Claim | Anchor |\n| --- | --- |\n| repeated session spike | current #/sessions/pi-deepseek |\n`;
        const r = checkReportStructure(replica);
        expect(r.ok).toBe(false);
        expect(r.problems).toContain('placeholder-or-todo-present');
        expect(r.problems).toContain('evidence-claim-without-anchor');
        expect(r.problems).toContain('section-missing-or-out-of-order:Report-only advisories');
    });
});

describe('diffPorcelain (0676 R3)', () => {
    test('names paths gained since baseline, excluding declared outputs', () => {
        const before = ' M docs/tasks/0001.md\n?? .spur/run/x.env\n';
        const now = ' M docs/tasks/0001.md\n?? .spur/run/x.env\n?? history-anatomy..md\n';
        const undeclared = diffPorcelain(before, now, new Set(['.spur/run/candidate.md']));
        expect(undeclared).toEqual(['history-anatomy..md']);
    });
    test('declared outputs and pre-existing dirt are not violations', () => {
        const before = '?? already-dirty.txt\n';
        const now = '?? already-dirty.txt\n?? .spur/run/candidate.md\n';
        expect(diffPorcelain(before, now, new Set(['.spur/run/candidate.md']))).toEqual([]);
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
describe('checkReportStructure triage fields + advisory section (0680)', () => {
    // A finding row must now carry the three triage fields — the gate fails one missing any.
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
    const head = sections.map((s) => `## ${s}\n\nbody`).join('\n\n');

    // Finding blocks live INSIDE the `## Findings` section — build it that way.
    const findingBlock = (bullets: string): string => {
        const i = sections.indexOf('Findings');
        const before = sections
            .slice(0, i + 1)
            .map((s) => `## ${s}\n\nbody`)
            .join('\n\n');
        const after = sections
            .slice(i + 1)
            .map((s) => `## ${s}\n\nbody`)
            .join('\n\n');
        return `${before}\n\n### A finding\n\n${bullets}\n\n${after}`;
    };

    test('a bullet finding with all triage fields passes', () => {
        const fields =
            '- `key`: `coverage:analytics:pairs`\n- `category`: `coverage`\n' +
            '- `impact`: i\n- `trend`: `new`\n' +
            '- `observation`: o\n- `inference`: inf\n- `confidence`: high\n' +
            '- `contradictions`: none\n- `evidenceAnchor`: `a.md`\n' +
            '- `severity`: `P2`\n- `reproCommand`: `bun run x`\n- `ownerSurface`: `packages/domain/src/analytics/pairings.ts`';
        expect(checkReportStructure(findingBlock(fields)).ok).toBe(true);
    });

    test('missing severity / reproCommand / ownerSurface each fail by name', () => {
        const lines = [
            '- `key`: `coverage:analytics:pairs`',
            '- `category`: `coverage`',
            '- `observation`: o',
            '- `inference`: inf',
            '- `confidence`: high',
            '- `contradictions`: none',
            '- `evidenceAnchor`: `a.md`',
            '- `severity`: `P2`',
            '- `reproCommand`: `bun run x`',
            '- `ownerSurface`: `pairings.ts`',
        ];
        for (const drop of ['severity', 'reproCommand', 'ownerSurface']) {
            const without = lines.filter((l) => !l.startsWith(`- \`${drop}\``)).join('\n');
            const r = checkReportStructure(findingBlock(without));
            expect(r.ok).toBe(false);
            expect(r.problems).toContain(`finding-missing-field:${drop}`);
        }
    });

    test('an out-of-vocabulary severity fails the gate', () => {
        const r = checkReportStructure(
            findingBlock(
                [
                    '- `key`: `coverage:analytics:pairs`',
                    '- `category`: `coverage`',
                    '- `observation`: o',
                    '- `inference`: inf',
                    '- `confidence`: high',
                    '- `contradictions`: none',
                    '- `evidenceAnchor`: `a.md`',
                    '- `severity`: `critical`',
                    '- `reproCommand`: `bun run x`',
                    '- `ownerSurface`: `pairings.ts`',
                ].join('\n'),
            ),
        );
        expect(r.problems).toContain('finding-invalid-severity');
    });

    test('non-finding blocks under Findings are not policed (positive-patterns style prose)', () => {
        expect(checkReportStructure(head).ok).toBe(true);
    });
});

describe('checkReportStructure closed category vocabulary (0686/I9)', () => {
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
    const findingBlock = (bullets: string): string => {
        const i = sections.indexOf('Findings');
        const before = sections
            .slice(0, i + 1)
            .map((s) => `## ${s}\n\nbody`)
            .join('\n\n');
        const after = sections
            .slice(i + 1)
            .map((s) => `## ${s}\n\nbody`)
            .join('\n\n');
        return `${before}\n\n### A finding\n\n${bullets}\n\n${after}`;
    };

    // Full 13-field bullet set so only vocabulary varies — field gates stay satisfied.
    const fullFinding = (key: string, cat: string): string =>
        [
            `- \`key\`: \`${key}\``,
            `- \`category\`: \`${cat}\``,
            '- `impact`: i',
            '- `trend`: `new`',
            '- `observation`: o',
            '- `inference`: inf',
            '- `confidence`: high',
            '- `contradictions`: none',
            '- `evidenceAnchor`: `a.md`',
            '- `severity`: `P2`',
            '- `reproCommand`: `bun run x`',
            '- `ownerSurface`: `pairings.ts`',
        ].join('\n');

    test('a report whose findings use only closed categories still passes', () => {
        expect(
            checkReportStructure(
                findingBlock(fullFinding('telemetry:history-analyze:duration-coverage-gap', 'telemetry')),
            ).problems.filter((p) => p.startsWith('finding-')),
        ).toEqual([]);
    });

    // R12/R7: section 9 stays additive report grammar — ordinary unprojected numbered prose is
    // still valid alongside closed-vocabulary findings; the gate adds no section-9 parser branch.
    test('unprojected numbered section 9 prose still passes alongside closed categories', () => {
        const numbered = '1. Shorten the always-loaded preamble.\n2. Pin the agent spec in the run header.';
        const report = findingBlock(fullFinding('workflow:agents-md:navigation', 'workflow')).replace(
            '## Workflow and process improvements\n\nbody',
            `## Workflow and process improvements\n\n${numbered}`,
        );
        expect(report).toContain('1. Shorten the always-loaded preamble.');
        expect(checkReportStructure(report).problems.filter((p) => p.startsWith('finding-'))).toEqual([]);
    });

    test('an environment-signal key (workflow:agents-md:navigation) passes — retro names live in <signal>', () => {
        expect(
            checkReportStructure(
                findingBlock(fullFinding('workflow:agents-md:navigation', 'workflow')),
            ).problems.filter((p) => p.startsWith('finding-')),
        ).toEqual([]);
    });

    test('an out-of-vocabulary explicit category fails by name', () => {
        const r = checkReportStructure(findingBlock(fullFinding('workflow:agents-md:navigation', 'navigation')));
        expect(r.problems).toContain('finding-invalid-category:navigation');
    });

    test('a stable key whose first segment falls outside the closed set fails by name', () => {
        const r = checkReportStructure(findingBlock(fullFinding('navigation:agents-md:pointer', 'workflow')));
        expect(r.problems).toContain('finding-invalid-key-category:navigation');
    });

    test('spaced or kebab-case retro names fail automatically because neither is in the closed set', () => {
        const r1 = checkReportStructure(
            findingBlock(fullFinding('workflow:review:coding-standards', 'coding standards')),
        );
        expect(r1.problems).toContain('finding-invalid-category:coding standards');
        const r2 = checkReportStructure(
            findingBlock(fullFinding('automated-checks:typecheck:new-rule', 'reliability')),
        );
        expect(r2.problems).toContain('finding-invalid-key-category:automated-checks');
    });

    test('legacy pipe rows keep their field gate and gain the same closed first-segment rule', () => {
        const i = sections.indexOf('Findings');
        const body = [...sections]
            .slice(0, i + 1)
            .map((s) => `## ${s}\n\nbody`)
            .join('\n\n');
        const withRow = `${body}\n\n| workflow:category:key impact trend observation inference confidence contradictions evidenceAnchor severity reproCommand ownerSurface |\n\n${sections
            .slice(i + 1)
            .map((s) => `## ${s}\n\nbody`)
            .join('\n\n')}`;
        // Valid row: no finding problems.
        expect(checkReportStructure(withRow).problems.filter((p) => p.startsWith('finding-'))).toEqual([]);
        // Retro name as the first segment: fails by name instead of passing vacuously.
        const bad = withRow.replace('workflow:category:key', 'navigation:category:key');
        expect(checkReportStructure(bad).problems).toContain('finding-invalid-key-category:navigation');
    });
});

// 0771: the publish guard is the workflow YAML's anchored final-line check, so the fixture

// ── Module-level ports for logic that the CLI tests exercise via the bundle (task 1005 R2) ──
// The bundle is excluded from coverage measurement, so these behaviors are pinned against the
// app source directly, mirroring the 0920 selector grammar and 0771 helper-identity cases.

describe('logicDigest (module-level, 0771)', () => {
    test('file digest is the sha256 of the body; missing/undefined paths read as unknown', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-digest-'));
        try {
            const f = join(dir, 'a.md');
            writeFileSync(f, 'hello');
            expect(logicDigest(f)).toBe(createHash('sha256').update('hello').digest('hex'));
            expect(logicDigest(join(dir, 'missing.yaml'))).toBe('not available');
            expect(logicDigest(undefined)).toBe('not available');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('directory digest folds sorted .md/.yaml names and bodies; renames and edits change it', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-digest-dir-'));
        try {
            writeFileSync(join(dir, 'b.md'), 'B');
            writeFileSync(join(dir, 'a.md'), 'A');
            writeFileSync(join(dir, 'ignored.txt'), 'nope');
            const nested = join(dir, 'sub');
            mkdirSync(nested);
            writeFileSync(join(nested, 'c.yaml'), 'C');
            const first = logicDigest(dir);
            expect(first).not.toBe('not available');
            const renamed = logicDigest(dir);
            rmSync(join(dir, 'a.md'));
            writeFileSync(join(dir, 'a2.md'), 'A');
            expect(logicDigest(dir)).not.toBe(renamed);
            writeFileSync(join(dir, 'b.md'), 'B2');
            expect(logicDigest(dir)).not.toBe(first);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('importedSnapshotAsOf (module-level, 0660 R3)', () => {
    test('earliest lastImportedAt wins; absent stamps read as unknown', () => {
        expect(
            importedSnapshotAsOf([
                { source: 'a', status: 'ok', lastImportedAt: '2026-08-24T23:00:00Z' },
                { source: 'b', status: 'ok', lastImportedAt: '2026-08-23T10:00:00Z' },
            ]),
        ).toBe('2026-08-23T10:00:00Z');
        expect(importedSnapshotAsOf([{ source: 'a', status: 'ok', lastImportedAt: null }])).toBe('not available');
        expect(importedSnapshotAsOf([])).toBe('not available');
    });
});

describe('resolvePaths (module-level, 0660 R4 / 0674)', () => {
    test('monorepo layout resolves the skill dir; daily bounds and defaults derive from the zone', () => {
        const env = resolvePaths({
            helper: '/repo/plugins/sp/scripts/history-anatomy-cache.ts',
            reportDir: '/repo/.spur/reports',
            tz: 'UTC',
            now: new Date(Date.parse('2026-08-24T12:00:00Z')),
        });
        expect(env).toContain('HA_HELPER=/repo/plugins/sp/scripts/history-anatomy-cache.ts');
        expect(env).toContain('HA_SKILL=/repo/plugins/sp/skills/history-anatomy');
        expect(env).toContain('HA_DATE=2026-08-24');
        expect(env).toContain('HA_TARGET=/repo/.spur/reports/2026-08-24-history-anatomy.md');
        expect(env).toContain('HA_SINCE=2026-08-24T00:00:00.000+00:00');
        expect(env).toContain('HA_UNTIL=2026-08-24T23:59:59.999+00:00');
        expect(env).toContain('HA_BASELINE_SINCE=2026-08-23T00:00:00.000+00:00');
    });

    test('installed layout names <plugin>-history-anatomy; ad-hoc bounds pass through untouched', () => {
        const env = resolvePaths({
            helper: '/opt/x/scripts/sp/history-anatomy-cache.mjs',
            reportDir: '/r',
            tz: 'UTC',
            mode: 'ad-hoc',
            since: '2026-08-01T00:00:00Z',
            until: '2026-08-05T00:00:00Z',
        });
        expect(env).toContain('HA_SKILL=/opt/x/skills/sp-history-anatomy');
        expect(env).toContain('HA_SINCE=2026-08-01T00:00:00Z');
        expect(env).toContain('HA_UNTIL=2026-08-05T00:00:00Z');
        expect(env).not.toContain('HA_BASELINE_SINCE');
    });

    test('explicit date/output override the derived values; a zoned day carries its real offset', () => {
        const env = resolvePaths({
            helper: '/r/s/h.ts',
            reportDir: '/r',
            date: '2026-02-01',
            output: '/r/out.md',
            tz: 'America/Los_Angeles',
        });
        expect(env).toContain('HA_TARGET=/r/out.md');
        expect(env).toContain('HA_DATE=2026-02-01');
        expect(env).toContain('HA_SINCE=2026-02-01T00:00:00.000-08:00');
    });
});

describe('selector grammar (0920 — ported direct validateSelector cases)', () => {
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
});

describe('probe / stamp / refresh round-trip (module-level, 0659 / 0771)', () => {
    const NOW = new Date('2026-08-24T23:30:00Z');

    function fixture(dir: string) {
        const helper = join(dir, 'helper.mjs');
        writeFileSync(helper, 'export {};\n');
        const skillDir = join(dir, 'skill');
        mkdirSync(skillDir);
        writeFileSync(join(skillDir, 'SKILL.md'), '# skill\n');
        const artifact = join(dir, 'artifact.json');
        writeFileSync(
            artifact,
            JSON.stringify({
                selector: { since: 's', until: 'u' },
                coverage: [{ source: 'x', status: 'ok', lastImportedAt: '2026-08-24T23:00:00Z' }],
            }),
        );
        return { helper, skillDir, artifact, target: join(dir, 'report.md'), baseline: join(dir, 'baseline.json') };
    }

    function probeOpts(f: ReturnType<typeof fixture>) {
        return {
            artifact: f.artifact,
            target: f.target,
            mode: 'daily' as const,
            recompute: false,
            skillDir: f.skillDir,
            helperFile: f.helper,
            now: NOW,
        };
    }

    test('fresh target misses with no-cache; identical rerun is a hit', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-probe-'));
        try {
            const f = fixture(dir);
            const first = probe(probeOpts(f));
            expect(first.decision.disposition).toBe('miss');
            expect(first.decision.reasons).toEqual(['no-cache']);
            expect(first.current.windowState).toBe('provisional');
            expect(first.current.identity.bounds).toEqual({ since: 's', until: 'u' });
            expect(first.current.artifactDigest).toBe(
                semanticArtifactDigest(JSON.parse(readFileSync(f.artifact, 'utf8'))),
            );
            writeFileSync(f.target, stampReport('# Body\n', first.current));
            const second = probe(probeOpts(f));
            expect(second.decision.disposition).toBe('hit');
            expect(second.decision.reasons).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('recompute forces; helper change invalidates; ad-hoc never caches', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-probe-'));
        try {
            const f = fixture(dir);
            const opts = probeOpts(f);
            expect(probe({ ...opts, recompute: true }).decision).toEqual({
                disposition: 'forced-recompute',
                reasons: ['recompute'],
            });
            writeFileSync(f.target, stampReport('# Body\n', probe(opts).current));
            writeFileSync(f.helper, 'export { changed };\n');
            const after = probe(opts);
            expect(after.decision.disposition).toBe('miss');
            expect(after.decision.reasons).toContain('logic-changed:helper');
            expect(probe({ ...opts, mode: 'ad-hoc' as const }).decision).toEqual({
                disposition: 'miss',
                reasons: ['ad-hoc-never-cached'],
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('provenance frontmatter round-trips through parseProvenance; refresh touches only stamped fields', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-probe-'));
        try {
            const f = fixture(dir);
            const { current } = probe(probeOpts(f));
            const stamped = stampReport('# Body\n', current);
            const reparsed = parseProvenance(stamped);
            expect(reparsed).not.toBeNull();
            expect(reparsed?.artifactDigest).toBe(current.artifactDigest);
            expect(reparsed?.identity).toEqual(current.identity);
            expect(reparsed?.schemaVersion).toBeUndefined();
            const later = refreshReport(stamped, '2026-08-25T00:00:00Z', 'hit');
            expect(later).toContain('validatedAt: "2026-08-25T00:00:00Z"');
            expect(later).toContain('cacheDisposition: "hit"');
            expect(later).toContain(`generatedAt: "${current.generatedAt}"`);
            expect(later).toContain('> imported snapshot as of 2026-08-24T23:00:00Z · window provisional · cache hit');
            expect(stampReport(stamped, current).split('---').length - 1).toBe(2);
            expect(bannerLine(current)).toContain('window provisional');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('baseline artifact digest records the prior cycle', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-probe-'));
        try {
            const f = fixture(dir);
            writeFileSync(f.baseline, JSON.stringify({ selector: { since: 'old', until: 'older' }, coverage: [] }));
            const { current } = probe({ ...probeOpts(f), baseline: f.baseline });
            expect(current.baselineArtifactDigest).toBe(
                semanticArtifactDigest(JSON.parse(readFileSync(f.baseline, 'utf8'))),
            );
            expect(current.baselineArtifactPath).toBe(f.baseline);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('malformed frontmatter parses to null', () => {
        expect(parseProvenance('---\nhello: world\n---\n')).toBeNull();
    });
});

describe('parse robustness / digest fallbacks (module-level)', () => {
    test('frontmatter with identity but no bounds parses to null', () => {
        expect(
            parseProvenance('---\nidentity:\n  mode: daily\ncoverage:\n  - source: a, status: ok\n---\n'),
        ).toBeNull();
    });

    test('blank line inside a nested frontmatter block is tolerated', () => {
        const md = [
            '---',
            'identity:',
            '  mode: daily',
            '',
            '  date: "2026-08-24"',
            '  timezone: "UTC"',
            '  bounds:',
            '    since: "s"',
            '    until: "u"',
            '  sources:',
            '    - source: a',
            'coverage:',
            '  - source: a, status: ok, lastImportedAt: null',
            '---',
            '',
        ].join('\n');
        const p = parseProvenance(md);
        expect(p?.identity.mode).toBe('daily');
        expect(p?.identity.date).toBe('2026-08-24');
        expect(p?.identity.bounds).toEqual({ since: 's', until: 'u' });
    });

    test('unreadable logic file digests to "not available" instead of throwing', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-digest-'));
        try {
            const f = join(dir, 'locked.md');
            writeFileSync(f, 'secret');
            chmodSync(f, 0o000);
            try {
                expect(logicDigest(f)).toBe('not available');
            } finally {
                chmodSync(f, 0o644); // let rmSync clean up
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('buildProvenance names the artifact path when its JSON cannot be parsed', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-artifact-'));
        try {
            const artifact = join(dir, 'artifact.json');
            writeFileSync(artifact, 'not json');
            expect(() =>
                buildProvenance({ artifact, target: join(dir, 'r.md'), mode: 'daily', recompute: false }),
            ).toThrow(/could not parse fresh analyze artifact/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
