import { describe, expect, test } from 'bun:test';
import type { HistoryArtifact } from '../../src/analytics/artifact';
import { HISTORY_ARTIFACT_SCHEMA_VERSION } from '../../src/analytics/artifact';
import { ArtifactNarrowError, narrowArtifact } from '../../src/analytics/narrow-artifact';

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

const PATH = '/tmp/analyze-abc.json';

describe('narrowArtifact (task 0564 R3)', () => {
    test('matching --task renders the artifact unchanged with a banner (it IS that task rows)', () => {
        const a = artifact({
            selector: { since: null, until: null, sources: null, sessionId: null, runId: null, taskWbs: '0042' },
        });
        const { artifact: narrowed, banner } = narrowArtifact(a, { task: '0042' }, PATH);
        expect(banner).toBe('task 0042');
        expect(narrowed).toBe(a); // no mutation, no copy when nothing changes
    });

    test('--task against an artifact with no task dimension throws naming artifact and dimension', () => {
        const a = artifact(); // selector.taskWbs === null
        try {
            narrowArtifact(a, { task: '0042' }, PATH);
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(ArtifactNarrowError);
            const err = e as ArtifactNarrowError;
            expect(err.dimension).toBe('task');
            expect(err.artifactPath).toBe(PATH);
            expect(err.message).toContain(PATH);
            expect(err.message).toContain('task');
        }
    });

    test('--task for a different task than the artifact covers throws (cannot answer)', () => {
        const a = artifact({
            selector: { since: null, until: null, sources: null, sessionId: null, runId: null, taskWbs: '0556' },
        });
        expect(() => narrowArtifact(a, { task: '0042' }, PATH)).toThrow(/0556/);
    });

    test('--top re-slices both leaderboards to depth and never mutates the input', () => {
        const a = artifact({
            byTool: [
                {
                    toolName: 'a',
                    calls: 3,
                    errors: 0,
                    durationMsTotal: 0,
                    durationMsMean: 0,
                    durationMsMax: 0,
                    durationUnmeasured: 0,
                    resultBytes: 0,
                },
                {
                    toolName: 'b',
                    calls: 2,
                    errors: 0,
                    durationMsTotal: 0,
                    durationMsMean: 0,
                    durationMsMax: 0,
                    durationUnmeasured: 0,
                    resultBytes: 0,
                },
                {
                    toolName: 'c',
                    calls: 1,
                    errors: 0,
                    durationMsTotal: 0,
                    durationMsMean: 0,
                    durationMsMax: 0,
                    durationUnmeasured: 0,
                    resultBytes: 0,
                },
            ],
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
                {
                    sessionId: 's2',
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
                {
                    sessionId: 's3',
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
        const { artifact: narrowed, banner } = narrowArtifact(a, { top: 2 }, PATH);
        expect(banner).toBe('top 2');
        expect(narrowed.byTool.map((t) => t.toolName)).toEqual(['a', 'b']);
        expect(narrowed.bySession.map((s) => s.sessionId)).toEqual(['s1', 's2']);
        // Input untouched.
        expect(a.byTool).toHaveLength(3);
        expect(a.bySession).toHaveLength(3);
    });

    test('HA-S1: --top re-slice lowers appliedTop but preserves the true population counts', () => {
        const a = artifact({
            byTool: [
                {
                    toolName: 'a',
                    calls: 3,
                    errors: 0,
                    durationMsTotal: 0,
                    durationMsMean: 0,
                    durationMsMax: 0,
                    durationUnmeasured: 0,
                    resultBytes: 0,
                },
                {
                    toolName: 'b',
                    calls: 2,
                    errors: 0,
                    durationMsTotal: 0,
                    durationMsMean: 0,
                    durationMsMax: 0,
                    durationUnmeasured: 0,
                    resultBytes: 0,
                },
            ],
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
                {
                    sessionId: 's2',
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
        const { artifact: narrowed } = narrowArtifact(a, { top: 1 }, PATH);
        // appliedTop lowered to the requested depth; population counts untouched.
        expect(narrowed.population?.appliedTop).toBe(1);
        expect(narrowed.population?.sessions).toBe(35);
        expect(narrowed.population?.tools).toBe(12);
        expect(narrowed.bySession).toHaveLength(1);
        // Input untouched.
        expect(a.population?.appliedTop).toBe(20);
    });

    test('HA-S1: narrowing a pre-addition artifact (no population) leaves it absent', () => {
        const a = artifact();
        const { artifact: narrowed } = narrowArtifact(a, { top: 1 }, PATH);
        expect(a.population).toBeUndefined();
        expect(narrowed.population).toBeUndefined();
    });

    test('no narrowing yields a null banner and the same artifact', () => {
        const a = artifact();
        const { artifact: narrowed, banner } = narrowArtifact(a, {}, PATH);
        expect(banner).toBeNull();
        expect(narrowed).toBe(a);
    });

    test('--top beyond the leaderboard depth still names itself in the banner (0564 P4-2)', () => {
        const a = artifact();
        const { artifact: narrowed, banner } = narrowArtifact(a, { top: 99 }, PATH);
        expect(banner).toBe('top 99');
        // Nothing to slice — the artifact is returned unchanged.
        expect(narrowed).toBe(a);
    });
});
