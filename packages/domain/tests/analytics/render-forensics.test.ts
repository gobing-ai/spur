import { describe, expect, test } from 'bun:test';
import type { HistoryArtifact } from '../../src/analytics/artifact';
import { HISTORY_ARTIFACT_SCHEMA_VERSION } from '../../src/analytics/artifact';
import type { DerivedVariables } from '../../src/analytics/derived';
import { fmtWall, renderForensics } from '../../src/analytics/render-forensics';

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
        timeDecomposition: { llmMs: 120_000, toolMs: 180_000, idleMs: 60_000, unattributedMs: 30_000, spanMs: 390_000 },
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
        const a = artifact({ derived: { ...derived(), phases: { phaseSupport: 'unsupported', phases: [] } } });
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
            artifact({ derived: { ...derived(), phases: { phaseSupport: 'supported', phases: [] } } }),
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
        expect(out).toContain('- Warning codes: derived-unattributed-time');
        expect(out).toContain('| claude | ok | 3 | 40 | 25 | 0 |');
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
