import { describe, expect, test } from 'bun:test';
import type { HistoryArtifact } from '../../src/analytics/artifact';
import { HISTORY_ARTIFACT_SCHEMA_VERSION } from '../../src/analytics/artifact';
import { formatSummary } from '../../src/analytics/costs';
import {
    ArtifactVersionError,
    artifactToSummary,
    assertArtifactVersion,
    isStale,
    renderReport,
    STALENESS_THRESHOLD_HOURS,
    stalenessBanner,
} from '../../src/analytics/render-report';

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

function artifact(overrides: Partial<HistoryArtifact> = {}): HistoryArtifact {
    return {
        schemaVersion: HISTORY_ARTIFACT_SCHEMA_VERSION,
        generatedAt: '2026-08-07T00:00:00Z',
        spurVersion: '1.0.0',
        selector: {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        },
        coverage: [],
        totals: { ...emptyTokens(), inputTokens: 1_000_000, outputTokens: 500_000, costUsd: 1.25, records: 10 },
        bySource: { claude: { ...emptyTokens(), costUsd: 1.25, records: 10 } },
        byModel: { 'claude-3': { ...emptyTokens(), costUsd: 1.25, records: 10 } },
        daily: [],
        byTool: [],
        bySession: [],
        loops: [],
        warnings: [],
        ...overrides,
    };
}

describe('artifactToSummary (R2 reuse)', () => {
    test('feeds formatSummary — the spend rollup is never re-implemented', () => {
        const a = artifact();
        const summary = artifactToSummary(a);
        const expected = formatSummary(summary);
        const report = renderReport(a);
        // The report MUST contain the exact formatSummary output (R2).
        expect(report).toContain(expected);
    });

    test('maps totals, bySource, byModel, daily 1:1', () => {
        const a = artifact();
        const s = artifactToSummary(a);
        expect(s.totals).toBe(a.totals);
        expect(s.bySource).toBe(a.bySource);
        expect(s.byModel).toBe(a.byModel);
        expect(s.daily).toBe(a.daily);
    });
});

describe('renderReport forensic sections (R3)', () => {
    test('renders per-tool time, calls, and result bytes', () => {
        const a = artifact({
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
        });
        const report = renderReport(a);
        expect(report).toContain('Per-tool time · calls · result bytes:');
        expect(report).toContain('Read');
        expect(report).toContain('10 calls');
        expect(report).toContain('1 err');
        expect(report).toContain('5.0s');
        expect(report).toContain('2.0 KB');
    });

    test('renders detected loops', () => {
        const a = artifact({
            loops: [
                {
                    sessionId: 'sess-abc123def456',
                    toolName: 'Bash',
                    argsDigest: 'a1b2c3d4',
                    repeats: 5,
                    firstSeq: 100,
                    lastSeq: 110,
                },
            ],
        });
        const report = renderReport(a);
        expect(report).toContain('Detected loops (1):');
        expect(report).toContain('Bash');
        expect(report).toContain('x  5');
    });

    test('renders session leaderboard with token and cost figures', () => {
        const a = artifact({
            bySession: [
                {
                    sessionId: 'sess-leader',
                    source: 'claude',
                    startedAt: '2026-08-07T01:00:00Z',
                    messages: 50,
                    toolCalls: 120,
                    tokens: 2_500_000,
                    costUsd: 3.4,
                    topTool: 'Read',
                    assistantDurationMs: 60_000,
                    assistantDurationUnmeasured: 2,
                },
            ],
        });
        const report = renderReport(a);
        expect(report).toContain('Session leaderboard (1):');
        expect(report).toContain('sess-leader');
        expect(report).toContain('2026-08-07');
        expect(report).toContain('$');
    });
});

describe('version gate (R4)', () => {
    test('accepts the current schema version', () => {
        expect(() => assertArtifactVersion(HISTORY_ARTIFACT_SCHEMA_VERSION, '/x.json')).not.toThrow();
    });

    test('throws ArtifactVersionError on unknown schema version', () => {
        expect(() => assertArtifactVersion(99, '/x.json')).toThrow(ArtifactVersionError);
    });

    test('error carries path, expected, and actual — emits nothing else', () => {
        try {
            assertArtifactVersion(2, '/path/to/art.json', 1);
            expect.unreachable('should have thrown');
        } catch (e) {
            const err = e as ArtifactVersionError;
            expect(err.artifactPath).toBe('/path/to/art.json');
            expect(err.expectedVersion).toBe(1);
            expect(err.actualVersion).toBe(2);
            expect(err.message).toContain('/path/to/art.json');
            expect(err.message).toContain('2');
            expect(err.message).toContain('1');
        }
    });
});

describe('unmeasured duration renders n/a (R5)', () => {
    test('tool with all durations unmeasured renders n/a, never 0', () => {
        const a = artifact({
            byTool: [
                {
                    toolName: 'MysteryTool',
                    calls: 3,
                    errors: 0,
                    durationMsTotal: 0,
                    durationMsMean: 0,
                    durationMsMax: 0,
                    durationUnmeasured: 3,
                    resultBytes: 0,
                },
            ],
        });
        const report = renderReport(a);
        expect(report).toContain('n/a');
        expect(report).not.toMatch(/0ms/);
    });

    test('tool with partial measurement renders real durations', () => {
        const a = artifact({
            byTool: [
                {
                    toolName: 'MixedTool',
                    calls: 4,
                    errors: 0,
                    durationMsTotal: 800,
                    durationMsMean: 200,
                    durationMsMax: 400,
                    durationUnmeasured: 1,
                    resultBytes: 0,
                },
            ],
        });
        const report = renderReport(a);
        expect(report).toContain('800ms');
        expect(report).toContain('200ms');
        expect(report).toContain('400ms');
    });
});

describe('staleness banner (R7)', () => {
    const FRESH = '2026-08-07T00:00:00Z';
    const STALE = '2026-08-01T00:00:00Z';
    const NOW = new Date('2026-08-07T12:00:00Z');

    test('threshold is 36 hours', () => {
        expect(STALENESS_THRESHOLD_HOURS).toBe(36);
    });

    test('null when artifact is fresh', () => {
        expect(stalenessBanner(FRESH, NOW)).toBeNull();
    });

    test('non-null banner when older than threshold', () => {
        const banner = stalenessBanner(STALE, NOW);
        expect(banner).not.toBeNull();
        expect(banner).toContain('STALE ARTIFACT');
        expect(banner).toContain('spur history analyze');
    });

    test('isStale is clock-parameterized — no wall-time dependency', () => {
        const generated = '2026-08-06T00:00:00Z';
        expect(isStale(generated, new Date('2026-08-07T00:00:00Z'))).toBe(false);
        expect(isStale(generated, new Date('2026-08-08T00:00:00Z'))).toBe(true);
    });

    test('banner reports age in days when over 24h', () => {
        const banner = stalenessBanner('2026-08-05T00:00:00Z', NOW);
        expect(banner).toContain('days');
    });
});
