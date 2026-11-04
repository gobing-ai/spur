/**
 * Thin-wrapper integration tests for apps/cli/src/commands/history.ts.
 * Behavioral tests for HistoryService live in packages/app/tests/services/history-service.test.ts.
 */

import { describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HISTORY_REFRESH_CONTEXT_ENV, HistoryService } from '@gobing-ai/spur-app';
import { getEnvVar, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import {
    type CoverageEntry,
    HISTORY_ARTIFACT_SCHEMA_VERSION,
    type HistoryArtifact,
    SystemEventDao,
    type SystemEventRow,
} from '@gobing-ai/spur-domain';
import { main } from '../../../src';
import { createMigratedDbAdapter } from '../../../src/context';
import type { CommandOutput } from '../../../src/output';

function capturingOutput(): { output: CommandOutput; lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        output: { write: (s: string) => lines.push(s), error: (s: string) => lines.push(s) },
    };
}

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

function makeCoverageEntry(overrides: Partial<CoverageEntry> = {}): CoverageEntry {
    return {
        source: 'claude',
        status: 'ok',
        files: 1,
        messages: 5,
        toolCalls: 0,
        parseErrors: 0,
        validationErrors: 0,
        unknownRecords: 0,
        lastImportedAt: '2026-08-07T00:00:00Z',
        parseErrorSamples: [],
        validationErrorSamples: [],
        ...overrides,
    };
}

function makeArtifact(overrides: Partial<HistoryArtifact> = {}): HistoryArtifact {
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

function makeTmpCwd(): string {
    return mkdtempSync(join(tmpdir(), 'spur-hist-'));
}

/** Read every system_events row newest-first from the workspace ledger. */
async function readSystemEvents(cwd: string): Promise<SystemEventRow[]> {
    const db = await createMigratedDbAdapter(cwd);
    try {
        return await new SystemEventDao(db).query({ limit: 500 });
    } finally {
        await db.close();
    }
}

describe('history command', () => {
    test('daily --root <empty> runs the full pipeline and emits the daily formatter', async () => {
        const cwd = makeTmpCwd();
        const emptyRoot = join(cwd, 'empty-history');
        mkdirSync(emptyRoot, { recursive: true });
        const { output, lines } = capturingOutput();
        const exitCode = await main(['history', 'daily', '--root', emptyRoot, '--source-timeout', '500'], {
            output,
            cwd,
            dbUrl: ':memory:',
        });

        // All sources empty under the empty root → exit 0.
        expect(exitCode).toBe(0);
        const joined = lines.join('');
        expect(joined).toContain('history daily');
        expect(joined).toContain('import:');
        expect(joined).toContain('exit_code: 0');
    });

    test('daily --root <empty> --json emits the structured DailyResult', async () => {
        const cwd = makeTmpCwd();
        const emptyRoot = join(cwd, 'empty-history');
        mkdirSync(emptyRoot, { recursive: true });
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'daily', '--root', emptyRoot, '--source-timeout', '500', '--json'], {
            output,
            cwd,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lines.join('')) as {
            fanOut: { entries: Array<{ source: string; status: string }>; exitCode: number };
            artifact: { totals: { messages: number } };
            pruned: unknown[];
        };
        expect(parsed.fanOut.entries.length).toBeGreaterThan(0);
        expect(parsed.fanOut.exitCode).toBe(0);
        expect(parsed.artifact.totals.messages).toBe(0);
    });

    test('daily consumes the queued refresh context and stamps child-owned events', async () => {
        const previous = getEnvVar(HISTORY_REFRESH_CONTEXT_ENV);
        const spy = spyOn(HistoryService.prototype, 'daily').mockResolvedValueOnce({
            fanOut: {
                entries: [makeCoverageEntry()],
                warnings: [],
                exitCode: 0,
                attribution: {
                    sessionsEvaluated: 0,
                    linksCreated: 0,
                    linksAlreadyPresent: 0,
                    skippedEvidence: 0,
                    ambiguousEvidence: 0,
                },
            },
            artifact: makeArtifact(),
            pruned: [],
            coverage: { refreshed: ['claude'], skipped: [], window: { since: null, until: null } },
            retained: {
                ruleEvalRuns: 0,
                queueJobs: 0,
                ledgerRows: 0,
                backupFiles: 0,
                compaction: { ran: false, skippedReason: 'empty-db', bytesBefore: 0, bytesAfter: 0 },
            },
        });
        const cwd = makeTmpCwd();
        setEnvVar(
            HISTORY_REFRESH_CONTEXT_ENV,
            JSON.stringify({
                trigger: 'manual',
                triggerId: 'refresh-1',
                windowStart: 10,
                windowEnd: 20,
                importMode: 'full',
            }),
        );

        try {
            const { output } = capturingOutput();
            const exitCode = await main(['history', 'daily', '--json'], { output, cwd });

            expect(exitCode).toBe(0);
            const dailyOptions = spy.mock.calls[0]?.[0];
            if (!dailyOptions) throw new Error('HistoryService.daily was not called');
            expect(dailyOptions.importMode).toBe('full');
            const rows = await readSystemEvents(cwd);
            for (const eventName of ['history.import.completed', 'history.analyze.completed']) {
                const row = rows.find((candidate) => candidate.event_name === eventName);
                expect(row).toBeDefined();
                const payload = JSON.parse(row?.payload_json ?? '{}');
                expect(payload.data).toMatchObject({
                    trigger: 'manual',
                    windowStart: 10,
                    windowEnd: 20,
                    importMode: 'full',
                });
                if (eventName === 'history.import.completed') {
                    expect(payload.data.coverage).toEqual({
                        refreshed: ['claude'],
                        skipped: [],
                        window: { since: null, until: null },
                    });
                }
            }
        } finally {
            if (previous === undefined) removeEnvVar(HISTORY_REFRESH_CONTEXT_ENV);
            else setEnvVar(HISTORY_REFRESH_CONTEXT_ENV, previous);
            spy.mockRestore();
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('daily subcommand handles exception failure in text and json mode', async () => {
        const spy = spyOn(HistoryService.prototype, 'daily').mockRejectedValue(new Error('forced daily exception'));

        try {
            const cwd = mkdtempSync(join(tmpdir(), 'spur-hist-fail-'));
            try {
                // Text mode
                const { output: outputText, lines: linesText } = capturingOutput();
                const exitCodeText = await main(['history', 'daily'], { output: outputText, cwd });
                expect(exitCodeText).toBe(1);
                expect(linesText.join('')).toContain('history daily failed: forced daily exception');

                // JSON mode
                const { output: outputJson, lines: linesJson } = capturingOutput();
                const exitCodeJson = await main(['history', 'daily', '--json'], {
                    output: outputJson,
                    cwd,
                });
                expect(exitCodeJson).toBe(1);
                const parsed = JSON.parse(linesJson.join('')) as { error: string };
                expect(parsed.error).toBe('forced daily exception');

                // Verify ledger captured history.daily.failed
                const rows = await readSystemEvents(cwd);
                const failedRow = rows.find((r) => r.event_name === 'history.daily.failed');
                expect(failedRow).toBeDefined();
                const payload = JSON.parse(failedRow?.payload_json ?? '{}');
                expect(payload.schemaVersion).toBe(2);
                expect(payload.data.detail).toBe('forced daily exception');
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        } finally {
            spy.mockRestore();
        }
    });

    test('daily subcommand formats failing fan-out entries and warnings', async () => {
        const spy = spyOn(HistoryService.prototype, 'daily').mockResolvedValueOnce({
            fanOut: {
                entries: [
                    makeCoverageEntry({ source: 'claude' }),
                    makeCoverageEntry({
                        source: 'codex',
                        status: 'failed',
                        files: 0,
                        messages: 0,
                        parseErrors: 2,
                        validationErrors: 1,
                    }),
                ],
                warnings: [{ code: 'IMP_ERR', source: 'codex', detail: 'failed to parse file' }],
                exitCode: 1,
                attribution: {
                    sessionsEvaluated: 0,
                    linksCreated: 0,
                    linksAlreadyPresent: 0,
                    skippedEvidence: 0,
                    ambiguousEvidence: 0,
                },
            },
            artifact: makeArtifact(),
            pruned: [],
            coverage: { refreshed: ['claude'], skipped: ['gemini'], window: { since: null, until: null } },
            retained: {
                ruleEvalRuns: 0,
                queueJobs: 0,
                ledgerRows: 0,
                backupFiles: 0,
                compaction: { ran: false, skippedReason: 'empty-db', bytesBefore: 0, bytesAfter: 0 },
            },
        });

        try {
            const cwd = mkdtempSync(join(tmpdir(), 'spur-hist-fanfail-'));
            try {
                const { output, lines } = capturingOutput();
                const exitCode = await main(['history', 'daily'], { output, cwd });
                expect(exitCode).toBe(1);
                const joined = lines.join('');
                expect(joined).toContain('warnings:');
                expect(joined).toContain('[IMP_ERR] codex: failed to parse file');
                expect(joined).toContain('exit_code: 1');

                // Verify ledger captured history.daily.failed with source detail
                const rows = await readSystemEvents(cwd);
                const failedRow = rows.find((r) => r.event_name === 'history.daily.failed');
                expect(failedRow).toBeDefined();
                const payload = JSON.parse(failedRow?.payload_json ?? '{}');
                expect(payload.data.detail).toContain('codex: failed (3 parse/validation errors)');
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        } finally {
            spy.mockRestore();
        }
    });

    test('daily subcommand handles non-zero exit with no failing source in entries', async () => {
        const spy = spyOn(HistoryService.prototype, 'daily').mockResolvedValueOnce({
            fanOut: {
                entries: [makeCoverageEntry({ source: 'claude' })],
                warnings: [],
                exitCode: 1,
                attribution: {
                    sessionsEvaluated: 0,
                    linksCreated: 0,
                    linksAlreadyPresent: 0,
                    skippedEvidence: 0,
                    ambiguousEvidence: 0,
                },
            },
            artifact: makeArtifact(),
            pruned: [],
            coverage: { refreshed: ['claude'], skipped: ['gemini'], window: { since: null, until: null } },
            retained: {
                ruleEvalRuns: 0,
                queueJobs: 0,
                ledgerRows: 0,
                backupFiles: 0,
                compaction: { ran: false, skippedReason: 'empty-db', bytesBefore: 0, bytesAfter: 0 },
            },
        });

        try {
            const cwd = mkdtempSync(join(tmpdir(), 'spur-hist-nofail-'));
            try {
                const { output } = capturingOutput();
                const exitCode = await main(['history', 'daily', '--json'], { output, cwd });
                expect(exitCode).toBe(1);

                const rows = await readSystemEvents(cwd);
                const failedRow = rows.find((r) => r.event_name === 'history.daily.failed');
                expect(failedRow).toBeDefined();
                const payload = JSON.parse(failedRow?.payload_json ?? '{}');
                expect(payload.data.detail).toBe(
                    'daily fan-out reported non-zero exit with no failing or degraded source',
                );
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        } finally {
            spy.mockRestore();
        }
    });
});

describe('CLI history events -> system_events ledger (0471 R2)', () => {
    test('daily success persists history.import.completed and history.analyze.completed (R2)', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-hist-evt-'));
        try {
            const emptyRoot = join(cwd, 'empty-history');
            mkdirSync(emptyRoot, { recursive: true });
            const { output } = capturingOutput();

            const exitCode = await main(
                ['history', 'daily', '--root', emptyRoot, '--source-timeout', '500', '--json'],
                { output, cwd },
            );
            expect(exitCode).toBe(0);

            const rows = await readSystemEvents(cwd);
            const names = rows.map((r) => r.event_name);
            expect(names).toContain('history.import.completed');
            expect(names).toContain('history.analyze.completed');
            // No failure event on success.
            expect(names).not.toContain('history.daily.failed');

            // Metadata-only: counts survive, no high-risk text fields leak.
            const importRow = rows.find((r) => r.event_name === 'history.import.completed');
            expect(importRow).toBeDefined();
            const payload = JSON.parse(importRow?.payload_json ?? '{}');
            expect(payload.schemaVersion).toBe(2);
            expect(payload.data.sources).toBeGreaterThan(0);
            expect(payload.data.durationMs).toBeGreaterThanOrEqual(0);
            // No high-risk text fields survive normalization (metadata-only policy).
            expect(payload.data.message ?? payload.data.content ?? payload.data.body).toBeUndefined();
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});

describe('history CLI usage-error coverage (0813 R3)', () => {
    test('daily rejects malformed --source-timeout before service construction (text)', async () => {
        const cwd = makeTmpCwd();
        const emptyRoot = join(cwd, 'empty-history');
        mkdirSync(emptyRoot, { recursive: true });
        const { output, lines } = capturingOutput();
        const exitCode = await main(['history', 'daily', '--root', emptyRoot, '--source-timeout', '1.5'], {
            output,
            cwd,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('spur history daily:');
    });

    test('daily rejects malformed --source-timeout (enveloped json)', async () => {
        const cwd = makeTmpCwd();
        const emptyRoot = join(cwd, 'empty-history');
        mkdirSync(emptyRoot, { recursive: true });
        const { output, lines } = capturingOutput();
        const exitCode = await main(
            [
                'history',
                'daily',
                '--root',
                emptyRoot,
                '--source-timeout',
                '99999999999999',
                '--json',
                '--json-envelope',
            ],
            { output, cwd, dbUrl: ':memory:' },
        );
        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lines.join('')) as { ok: boolean };
        expect(parsed.ok).toBe(false);
    });

    test('daily with malformed refresh context env fails before import (0717 R1)', async () => {
        const cwd = makeTmpCwd();
        const emptyRoot = join(cwd, 'empty-history');
        mkdirSync(emptyRoot, { recursive: true });
        const previous = getEnvVar('SPUR_HISTORY_REFRESH_CONTEXT');
        setEnvVar('SPUR_HISTORY_REFRESH_CONTEXT', 'not-json{');
        try {
            const { output, lines } = capturingOutput();
            const exitCode = await main(['history', 'daily', '--root', emptyRoot, '--source-timeout', 'none'], {
                output,
                cwd,
                dbUrl: ':memory:',
            });
            expect(exitCode).toBe(1);
            expect(lines.join('')).toContain('history daily failed:');
        } finally {
            if (previous === undefined) removeEnvVar('SPUR_HISTORY_REFRESH_CONTEXT');
            else setEnvVar('SPUR_HISTORY_REFRESH_CONTEXT', previous);
        }
    });
});
