import { describe, expect, test } from 'bun:test';
import type { HistoryArtifact } from '../../src/analytics/artifact';
import { HISTORY_ARTIFACT_SCHEMA_VERSION } from '../../src/analytics/artifact';
import type { DerivedVariables } from '../../src/analytics/derived';
import { fmtWall, naOrValue, renderForensics } from '../../src/analytics/render-forensics';

function emptyTokens() {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        records: 0,
        recordsWithUsage: 0,
        messages: 0,
        toolCalls: 0,
        durationMs: 0,
        durationUnmeasured: 0,
        assistantDurationMs: 0,
        assistantDurationUnmeasured: 0,
    };
}

function derived(): DerivedVariables {
    return {
        phases: {
            phaseSupport: 'supported',
            invalidPhaseCount: 0,
            phases: [
                { name: 'recon', startedAt: '2026-08-13T10:00:00Z', endedAt: '2026-08-13T10:02:30Z', source: 'todo' },
                {
                    name: 'implement',
                    startedAt: '2026-08-13T10:02:30Z',
                    endedAt: '2026-08-13T10:10:00Z',
                    source: 'todo',
                },
            ],
        },
        timeDecomposition: {
            llmMs: 120_000,
            toolMs: 180_000,
            idleMs: 60_000,
            unattributedMs: 30_000,
            spanMs: 390_000,
            spanExcludedSessions: 0,
        },
        bottlenecks: [{ label: 'LLM latency', ms: 120_000, share: 0.31 }],
    };
}

function artifact(overrides: Partial<HistoryArtifact> = {}): HistoryArtifact {
    return {
        schemaVersion: HISTORY_ARTIFACT_SCHEMA_VERSION,
        generatedAt: '2026-08-07T00:00:00Z',
        spurVersion: '1.0.0',
        selector: { since: null, until: null, sources: null, sessionId: null, runId: null, taskWbs: null },
        coverage: [],
        totals: {
            ...emptyTokens(),
            inputTokens: 1_000_000,
            outputTokens: 500_000,
            cacheReadTokens: 400_000,
            cacheWriteTokens: 100_000,
            records: 10,
            recordsWithUsage: 8,
            messages: 40,
            toolCalls: 25,
        },
        bySource: { claude: { ...emptyTokens(), records: 10 } },
        byModel: { 'claude-3': { ...emptyTokens(), records: 10 } },
        daily: [],
        byTool: [
            {
                toolName: 'Read',
                calls: 10,
                errors: 1,
                durationMsTotal: 5000,
                durationMsMean: 500,
                durationMsMax: 1200,
                durationUnmeasured: 0,
                resultBytes: 2048,
            },
        ],
        bySession: [],
        loops: [],
        warnings: [],
        derived: derived(),
        ...overrides,
    };
}

describe('renderForensics — the 8 derivable sections (R2)', () => {
    const out = renderForensics(artifact());

    test('renders all 8 section headings', () => {
        for (const heading of [
            '## Session Data Summary',
            '### Tool Breakdown',
            '### Token Profile',
            '## Time Decomposition',
            '## Per-Phase Breakdown',
            '## Per-Tool Execution Time',
            '## Bottleneck Ranking',
            '## Raw Data',
        ]) {
            expect(out).toContain(heading);
        }
    });

    test('cache-hit ratio is computed over billed input, never a currency value', () => {
        expect(out).toContain('40.0% of billed input served from cache');
        // R3: no currency anywhere — no $, no USD, no cost line.
        expect(out.includes('$')).toBe(false);
        expect(out.includes('USD')).toBe(false);
        expect(out.toLowerCase().includes('cost')).toBe(false);
    });

    test('per-phase wall renders from stored boundaries', () => {
        expect(out).toContain('recon');
        expect(out).toContain('2.5m');
    });
});

describe('renderForensics — honest unavailability (R5)', () => {
    test('no derived block → not-available lines, not zeros', () => {
        const a = artifact();
        delete (a as Partial<HistoryArtifact>).derived;
        const out = renderForensics(a);
        expect(out).toContain('not available — artifact has no derived block');
        expect(out).not.toContain('| 0% |');
    });

    test('phaseSupport unsupported → its own not-available line', () => {
        const a = artifact({
            derived: { ...derived(), phases: { phaseSupport: 'unsupported', invalidPhaseCount: 0, phases: [] } },
        });
        const out = renderForensics(a);
        expect(out).toContain('no todo-tool phase signal');
        expect(out).toContain('## Time Decomposition');
    });

    test('recordsWithUsage 0 → cache ratio renders n/a, never 0%', () => {
        const t = emptyTokens();
        const a = artifact({
            totals: { ...t, records: 5, messages: 5, toolCalls: 3 },
            bySource: { claude: { ...t, records: 5 } },
            byModel: {},
        });
        const out = renderForensics(a);
        expect(out).toContain('n/a — no records carried provider usage data');
        expect(out).not.toContain('0.0% of billed input');
    });
});

describe('renderForensics — empty buckets and appendix edges', () => {
    test('no tool calls → both tool sections render their empty marker, never divide by zero', () => {
        const out = renderForensics(artifact({ byTool: [] }));
        expect(out).toContain('| (no tool calls in selection) |');
        expect(out.match(/\(no tool calls in selection\)/g)?.length).toBe(2);
    });

    test('todo signal present but zero phases → placeholder row, headings intact', () => {
        const out = renderForensics(
            artifact({
                derived: { ...derived(), phases: { phaseSupport: 'supported', invalidPhaseCount: 0, phases: [] } },
            }),
        );
        expect(out).toContain('| (todo signal present but no phases extracted) |');
    });

    test('zero bottlenecks → threshold marker row', () => {
        const out = renderForensics(artifact({ derived: { ...derived(), bottlenecks: [] } }));
        expect(out).toContain('| (no bottleneck exceeded the ranking threshold) |');
    });

    test('warnings and coverage rows land in the Raw Data appendix', () => {
        const a = artifact();
        a.warnings = [{ code: 'derived-unattributed-time', detail: 'x' }];
        a.coverage = [
            {
                source: 'claude',
                status: 'ok',
                files: 3,
                messages: 40,
                toolCalls: 25,
                unknownRecords: 0,
                lastImportedAt: null,
                parseErrors: 0,
                parseErrorSamples: [],
                validationErrors: 0,
                validationErrorSamples: [],
            },
        ];
        const out = renderForensics(a);
        expect(out).toContain('  - derived-unattributed-time — x');
        expect(out).toContain('| claude | ok | 3 | 40 | 25 | 0 | not available | 0 | 0 |');
    });

    test('HA-S1: population > applied depth renders top N of M, never the array length', () => {
        const a = artifact({
            bySession: [
                {
                    sessionId: 's1',
                    source: 'claude',
                    startedAt: null,
                    messages: 1,
                    toolCalls: 0,
                    tokens: 0,
                    costUsd: 0,
                    topTool: null,
                    assistantDurationMs: 0,
                    assistantDurationUnmeasured: 0,
                },
            ],
            population: { sessions: 35, tools: 12, loops: 4, warnings: 2, appliedTop: 20 },
        });
        const out = renderForensics(a);
        expect(out).toContain('| Sessions | top 20 of 35 |');
        expect(out).toContain('top 20 of 35 sessions · 12 tools · 4 loops · 2 warnings');
    });

    test('HA-S1: whole population shown when population <= array length renders plain count', () => {
        const a = artifact({ population: { sessions: 35, tools: 12, loops: 4, warnings: 2, appliedTop: 50 } });
        a.bySession = [];
        a.byTool = [];
        const out = renderForensics(a);
        expect(out).toContain('| Sessions | 35 |');
        expect(out).toContain('· 12 tools · 4 loops · 2 warnings');
    });

    test('HA-S1: pre-addition artifact (no population) renders not available, never a fabricated count', () => {
        const a = artifact({
            bySession: [
                {
                    sessionId: 's1',
                    source: 'claude',
                    startedAt: null,
                    messages: 1,
                    toolCalls: 0,
                    tokens: 0,
                    costUsd: 0,
                    topTool: null,
                    assistantDurationMs: 0,
                    assistantDurationUnmeasured: 0,
                },
            ],
        });
        const out = renderForensics(a);
        expect(out).toContain('| Sessions | not available |');
        expect(out).toContain('not available sessions');
    });

    test('HA-S1: coverage truncation note appears when error samples hit the cap', () => {
        const a = artifact();
        a.coverage = [
            {
                source: 'claude',
                status: 'degraded',
                files: 3,
                messages: 40,
                toolCalls: 25,
                unknownRecords: 0,
                lastImportedAt: '2026-08-01T00:00:00Z',
                parseErrors: 5,
                parseErrorSamples: Array.from({ length: 20 }, (_, i) => `err${i}`),
                validationErrors: 2,
                validationErrorSamples: [],
            },
        ];
        const out = renderForensics(a);
        expect(out).toContain('| claude | degraded | 3 | 40 | 25 | 0 | 2026-08-01T00:00:00Z | 5 (truncated) | 2 |');
    });

    test('tool with all calls unmeasured renders n/a durations, not 0s', () => {
        const a = artifact();
        a.byTool = [
            {
                toolName: 'Grep',
                calls: 4,
                errors: 0,
                durationMsTotal: 0,
                durationMsMean: 0,
                durationMsMax: 0,
                durationUnmeasured: 4,
                resultBytes: 0,
            },
        ];
        const out = renderForensics(a);
        expect(out).toContain('| Grep | n/a | n/a | n/a | 4 |');
    });

    test('usage records but zero input tokens → n/a, never 0.0%', () => {
        const t = emptyTokens();
        t.records = 5;
        t.recordsWithUsage = 5;
        t.outputTokens = 1_000;
        const a = artifact({ totals: t });
        const out = renderForensics(a);
        expect(out).toContain('n/a — no input tokens reported');
    });

    test('fmtWall scales across forensics ranges', () => {
        expect(fmtWall(86)).toBe('86ms');
        expect(fmtWall(1_230)).toBe('1.2s');
        expect(fmtWall(150_000)).toBe('2.5m');
        expect(fmtWall(7_200_000)).toBe('2.0h');
    });

    test('two tools → both tables sort by descending activity', () => {
        const t = emptyTokens();
        t.records = 6;
        t.recordsWithUsage = 6;
        t.inputTokens = 100;
        const a = artifact({
            totals: t,
            byTool: [
                {
                    toolName: 'Read',
                    calls: 2,
                    errors: 0,
                    durationMsTotal: 3000,
                    durationMsMean: 1500,
                    durationMsMax: 2000,
                    durationUnmeasured: 0,
                    resultBytes: 512,
                },
                {
                    toolName: 'Bash',
                    calls: 9,
                    errors: 1,
                    durationMsTotal: 8000,
                    durationMsMean: 888,
                    durationMsMax: 3000,
                    durationUnmeasured: 0,
                    resultBytes: 1024,
                },
            ],
        });
        const out = renderForensics(a);
        // Calls-descending in Tool Breakdown: Bash (9) before Read (2).
        expect(out.indexOf('| Bash |')).toBeLessThan(out.indexOf('| Read |'));
    });
});

describe('renderForensics — per-step sections (0581)', () => {
    test('pre-0581 artifact → per-step sections state not available (R5)', () => {
        const out = renderForensics(artifact());
        expect(out).toContain(
            '> not available - artifact predates the per-step sections (rerun `spur history analyze`)',
        );
    });

    test('step tables render tokens, support verdicts, and cache-waste aggregates', () => {
        const a = artifact({
            topStepsByTokens: [
                {
                    sessionId: 'sess-long-0001',
                    source: 'omp',
                    ts: '2026-08-17T00:00:00Z',
                    model: 'deepseek-v4-flash',
                    inputTokens: 591_744,
                    cacheReadTokens: 152,
                    outputTokens: 1_775,
                    costUsd: 0.009027,
                    durationMs: 21_605,
                },
            ],
            topStepsByDuration: [
                {
                    sessionId: 'sess-long-0001',
                    source: 'omp',
                    ts: '2026-08-17T00:00:00Z',
                    model: 'glm-5.1',
                    inputTokens: 2_000,
                    cacheReadTokens: null,
                    outputTokens: null,
                    costUsd: null,
                    durationMs: 1_412_287,
                },
            ],
            cacheWaste: {
                steps: 2_478,
                inputTokens: 354_130_045,
                topSteps: [
                    {
                        sessionId: 'sess-long-0001',
                        source: 'omp',
                        ts: '2026-08-17T00:00:00Z',
                        model: 'deepseek-v4-flash',
                        inputTokens: 2_478,
                        cacheReadTokens: 300,
                        outputTokens: 100,
                        costUsd: null,
                        durationMs: 1000,
                    },
                ],
            },
            stepSupport: [
                {
                    source: 'omp',
                    assistantSteps: 81_726,
                    stepsWithUsage: 81_724,
                    stepsWithDuration: 12_900,
                    stepsWithDerivedDuration: 0,
                    stepsWithCacheRead: 81_724,
                },
            ],
        });
        const out = renderForensics(a);
        expect(out).toContain('## Per-Step Analysis');
        expect(out).toContain('### Top Steps by Total Tokens');
        expect(out).toContain('### Top Steps by Duration');
        expect(out).toContain('### Cache Re-Send Waste');
        expect(out).toContain('| omp | 81,726 | yes | yes | yes |');
        // Token cells render with thousands separators; null duration stays `n/a`.
        expect(out).toContain('591,744');
        expect(out).toContain('1,775');
        expect(out).toContain('21.6s');
        expect(out).toContain('sess-long-00…');
        // Duration section: unmeasured exclusion note and n/a cells.
        expect(out).toContain('Excluding 68,826 assistant step(s) without measured duration.');
        expect(out).toContain('n/a');
        // Cache waste: aggregate line with baseline numbers + reuse %.
        expect(out).toContain(
            'Re-sent context: 2,478 steps · 354,130,045 fresh input tokens (input > 100,000 and < 10% cache reuse).',
        );
        expect(out).toContain('12.1%');
    });

    test('no currency in per-step sections (R3)', () => {
        const a = artifact({
            topStepsByTokens: [
                {
                    sessionId: 's1',
                    source: 'omp',
                    ts: null,
                    model: 'm',
                    inputTokens: 1,
                    cacheReadTokens: 0,
                    outputTokens: 0,
                    costUsd: 0.5,
                    durationMs: null,
                },
            ],
            cacheWaste: { steps: 1, inputTokens: 1, topSteps: [] },
        });
        const out = renderForensics(a);
        expect(out.includes('$')).toBe(false);
        expect(out.toLowerCase().includes('cost')).toBe(false);
        expect(out).toContain('n/a'); // NULL duration renders n/a, never zero
    });

    test('empty per-step sections render their markers, never zeros (R5)', () => {
        const a = artifact({
            topStepsByTokens: [],
            topStepsByDuration: [],
            cacheWaste: { steps: 0, inputTokens: 0, topSteps: [] },
            stepSupport: [],
        });
        const out = renderForensics(a);
        expect(out).toContain('(no assistant steps with provider usage in selection)');
        expect(out).toContain('(no assistant steps carry measured duration in selection)');
        expect(out).toContain(
            '(no assistant step met the re-send filter: input > 100,000 tokens and < 10% cache reuse)',
        );
    });

    test('measurement-less source reads unsupported, not zero (AC6)', () => {
        const a = artifact({
            topStepsByTokens: [],
            topStepsByDuration: [],
            cacheWaste: { steps: 0, inputTokens: 0, topSteps: [] },
            stepSupport: [
                {
                    source: 'claude',
                    assistantSteps: 4,
                    stepsWithUsage: 0,
                    stepsWithDuration: 0,
                    stepsWithDerivedDuration: 0,
                    stepsWithCacheRead: 0,
                },
            ],
        });
        const out = renderForensics(a);
        // Support verdicts are `no`, and the section bodies stay honest: no ranked rows,
        // no fabricated numbers.
        expect(out).toContain('| claude | 4 | no | no | no |');
        expect(out).toContain('(no assistant steps with provider usage in selection)');
        expect(out).toContain('(no assistant steps carry measured duration in selection)');
    });
});

describe('0677 absent-not-zero rendering', () => {
    test('naOrValue: null renders "not available"; a measured zero renders as zero', () => {
        expect(naOrValue(null, fmtWall)).toBe('not available');
        expect(naOrValue(0, fmtWall)).toBe(fmtWall(0));
        expect(naOrValue(0, fmtWall)).toBe('0ms');
    });

    test('phase with a null boundary renders not available, never a fabricated wall time', () => {
        const base = derived();
        base.phases.phases = [
            { name: 'no-start', startedAt: null, endedAt: '2026-08-13T10:02:30Z', source: 'todo' },
            {
                name: 'fully-measured',
                startedAt: '2026-08-13T10:00:00Z',
                endedAt: '2026-08-13T10:01:00Z',
                source: 'todo',
            },
        ];
        const md = renderForensics(artifact({ derived: base }));
        expect(md).toContain('| no-start | not available | not available |');
        expect(md).not.toContain('| no-start | not available | 0ms');
        expect(md).toContain('fully-measured');
    });
});
