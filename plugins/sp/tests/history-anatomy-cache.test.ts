import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARTIFACT_ARRAY_CLASSIFICATION, RANKED_ARTIFACT_KEYS } from '../lib/artifact-digest.generated.mjs';
import {
    type CacheCliResult,
    type CacheProvenance,
    checkReportStructure,
    decideCache,
    diffPorcelain,
    importedSnapshotAsOf,
    logicDigest,
    parseProvenance,
    publishAtomically,
    resolvePaths,
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
            const git = (...args: string[]): void =>
                execFileSync('git', args, {
                    cwd: dir,
                    env: {
                        ...process.env,
                        GIT_AUTHOR_NAME: 't',
                        GIT_COMMITTER_NAME: 't',
                        GIT_AUTHOR_EMAIL: 't@t',
                        GIT_COMMITTER_EMAIL: 't@t',
                    },
                });
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
