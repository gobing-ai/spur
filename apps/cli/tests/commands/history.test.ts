/**
 * Thin-wrapper integration tests for apps/cli/src/commands/history.ts.
 * Behavioral tests for HistoryService live in packages/app/tests/services/history-service.test.ts.
 */

import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    HISTORY_REFRESH_CONTEXT_ENV,
    HistoryService,
    MIN_SAFE_PI_BASH_IMPORTER_VERSION,
    parseImporterVersion,
} from '@gobing-ai/spur-app';
import {
    type CoverageEntry,
    type DbAdapter,
    HISTORY_ARTIFACT_SCHEMA_VERSION,
    type HistoryArtifact,
    SystemEventDao,
    type SystemEventRow,
} from '@gobing-ai/spur-domain';
import { main } from '../../src';
import { createMigratedDbAdapter } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

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

function writeArtifactFile(dir: string, name: string, artifact: HistoryArtifact): string {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(artifact, null, 2));
    return path;
}

describe('history command', () => {
    test('unknown subcommand returns 1', async () => {
        const exitCode = await main(['history', 'unknown-cmd'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    test('analyze subcommand returns a number', async () => {
        const exitCode = await main(['history', 'analyze', '--json'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(typeof exitCode).toBe('number');
    });

    test('reset refuses without --yes (text)', async () => {
        const spy = spyOn(HistoryService.prototype, 'resetHistory');
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'reset'], { output, dbUrl: ':memory:' });

        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('refusing to wipe history tables without --yes');
        // The guard fires before the database-backed service is constructed.
        expect(spy).not.toHaveBeenCalled();
    });

    test('reset refuses without --yes (enveloped json emits structured usage error)', async () => {
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'reset', '--json', '--json-envelope'], {
            output,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lines.join('')) as {
            ok: boolean;
            error?: { code: string; details?: { cliCode?: string } };
        };
        expect(parsed.ok).toBe(false);
        expect(parsed.error?.code).toBe('INTERNAL_ERROR');
        expect(parsed.error?.details?.cliCode).toBe('usage');
    });

    test('reset --yes reports cleared/skipped and warns on unlisted tables (text)', async () => {
        const spy = spyOn(HistoryService.prototype, 'resetHistory').mockResolvedValueOnce({
            cleared: ['history_message', 'history_etl_pi'],
            skipped: ['history_board_daily'],
            unknown: ['history_zz_rogue'],
        });
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'reset', '--yes'], { output, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const joined = lines.join('');
        expect(joined).toContain('cleared 2 history tables (1 not present)');
        expect(joined).toContain('WARNING: 1 unlisted history_* table(s) left intact: history_zz_rogue');
        expect(spy).toHaveBeenCalledTimes(1);
    });

    test('reset --yes --json emits the structured result', async () => {
        const spy = spyOn(HistoryService.prototype, 'resetHistory').mockResolvedValueOnce({
            cleared: ['history_message'],
            skipped: [],
            unknown: [],
        });
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'reset', '--yes', '--json'], { output, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lines.join('')) as {
            cleared: string[];
            skipped: string[];
            unknown: string[];
            clearedCount: number;
        };
        expect(parsed.cleared).toEqual(['history_message']);
        expect(parsed.skipped).toEqual([]);
        expect(parsed.unknown).toEqual([]);
        expect(parsed.clearedCount).toBe(1);
        spy.mockRestore();
    });

    test('report with explicit path renders the spend rollup and exits 0', async () => {
        const cwd = makeTmpCwd();
        const artifactPath = writeArtifactFile(cwd, 'a.json', makeArtifact());
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'report', artifactPath], { output, cwd });

        expect(exitCode).toBe(0);
        const joined = lines.join('');
        expect(joined).toContain('Total:');
        expect(joined).toContain('$1.25');
    });

    test('report --json emits the parsed artifact as JSON', async () => {
        const cwd = makeTmpCwd();
        const artifactPath = writeArtifactFile(cwd, 'a.json', makeArtifact());
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'report', artifactPath, '--json'], { output, cwd });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lines.join('')) as HistoryArtifact;
        expect(parsed.schemaVersion).toBe(HISTORY_ARTIFACT_SCHEMA_VERSION);
        expect(parsed.totals.costUsd).toBe(1.25);
    });

    test('report writes a .md sidecar next to the artifact (R8)', async () => {
        const cwd = makeTmpCwd();
        const artifactPath = writeArtifactFile(cwd, 'a.json', makeArtifact());
        const { output } = capturingOutput();

        await main(['history', 'report', artifactPath], { output, cwd });

        // Sidecar has same basename, .md extension — use readFileSync to verify it exists.
        const sidecar = artifactPath.replace(/\.json$/, '.md');
        expect(existsSync(sidecar)).toBe(true);
        const md = readFileSync(sidecar, 'utf8');
        expect(md).toContain('```');
        expect(md).toContain('Total:');
    });

    test('report resolves via latest.json pointer when no path given (R6)', async () => {
        const cwd = makeTmpCwd();
        const artifact = makeArtifact();
        // Place artifact in the dated reports dir and point latest.json at it.
        const reportsDir = join(cwd, '.spur', 'reports', 'history');
        mkdirSync(reportsDir, { recursive: true });
        const artifactPath = join(reportsDir, 'analyze-deadbeef.json');
        writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
        symlinkSync(artifactPath, join(reportsDir, 'latest.json'));

        const { output, lines } = capturingOutput();
        const exitCode = await main(['history', 'report'], { output, cwd });

        expect(exitCode).toBe(0);
        expect(lines.join('')).toContain('Total:');
    });

    test('report prints staleness banner when pointer artifact is older than 36h (R7)', async () => {
        const cwd = makeTmpCwd();
        // Generated 5 days ago — well past the 36h threshold.
        const stale = makeArtifact({ generatedAt: '2026-08-02T00:00:00Z' });
        const reportsDir = join(cwd, '.spur', 'reports', 'history');
        mkdirSync(reportsDir, { recursive: true });
        const artifactPath = join(reportsDir, 'analyze-stale.json');
        writeFileSync(artifactPath, JSON.stringify(stale, null, 2));
        symlinkSync(artifactPath, join(reportsDir, 'latest.json'));

        const { output, lines } = capturingOutput();
        const exitCode = await main(['history', 'report'], { output, cwd });

        expect(exitCode).toBe(0);
        const joined = lines.join('');
        expect(joined).toContain('STALE ARTIFACT');
    });

    test('report does NOT print staleness banner for explicit path even when old (R7)', async () => {
        const cwd = makeTmpCwd();
        const stale = makeArtifact({ generatedAt: '2026-08-02T00:00:00Z' });
        const artifactPath = writeArtifactFile(cwd, 'stale.json', stale);
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'report', artifactPath], { output, cwd });

        expect(exitCode).toBe(0);
        expect(lines.join('')).not.toContain('STALE ARTIFACT');
    });

    test('report exits 1 with clear message when artifact has wrong schemaVersion (R4)', async () => {
        const cwd = makeTmpCwd();
        const bad = makeArtifact({ schemaVersion: 99 });
        const artifactPath = writeArtifactFile(cwd, 'bad.json', bad);
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'report', artifactPath], { output, cwd });

        expect(exitCode).toBe(1);
        const joined = lines.join('');
        expect(joined).toContain('schemaVersion');
        expect(joined).toContain(artifactPath);
    });

    test('report exits 1 when no path and no latest pointer exists', async () => {
        const cwd = makeTmpCwd();
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'report'], { output, cwd });

        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('failed');
    });
    test('import --file with --source all is rejected up front', async () => {
        const cwd = makeTmpCwd();
        const file = join(cwd, 'h.jsonl');
        writeFileSync(file, `${JSON.stringify({ id: 'm1', timestamp: '2026-05-30T00:00:00Z', content: 'x' })}\n`);
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'import', '--source', 'all', '--file', file], {
            output,
            cwd,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('--file requires a single --source');
    });

    test('import --mode bad is a CLI usage error on stderr (not a soft source warning)', async () => {
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'import', '--source', 'codex', '--mode', 'bad'], {
            output,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('Invalid history import mode');
    });

    test('import --mode bad --json emits structured error on stdout', async () => {
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'import', '--source', 'codex', '--mode', 'bad', '--json'], {
            output,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lines.join('')) as { status: string; message: string };
        expect(parsed.status).toBe('error');
        expect(parsed.message).toContain('Invalid history import mode');
    });

    test('import --file --mode full without --dry-run is rejected before any import (0506 R2)', async () => {
        const cwd = makeTmpCwd();
        const file = join(cwd, 'probe.jsonl');
        writeFileSync(file, `${JSON.stringify({ id: 'm1', timestamp: '2026-05-30T00:00:00Z', content: 'x' })}\n`);
        const { output, lines } = capturingOutput();

        const importSpy = spyOn(HistoryService.prototype, 'importAll');
        const exitCode = await main(
            ['history', 'import', '--source', 'antigravity', '--file', file, '--mode', 'full'],
            { output, cwd, dbUrl: ':memory:' },
        );

        expect(exitCode).toBe(1);
        const joined = lines.join('');
        // Names both supported alternatives so a probe self-corrects.
        expect(joined).toContain('--dry-run');
        expect(joined).toContain('--mode force-file');
        // The guard fires before the database-backed service is constructed or used.
        expect(importSpy).not.toHaveBeenCalled();
    });

    test('import --file --mode full without --dry-run --json emits a structured error naming both alternatives (0506 R2)', async () => {
        const cwd = makeTmpCwd();
        const file = join(cwd, 'probe.jsonl');
        writeFileSync(file, `${JSON.stringify({ id: 'm1', timestamp: '2026-05-30T00:00:00Z', content: 'x' })}\n`);
        const { output, lines } = capturingOutput();

        const exitCode = await main(
            ['history', 'import', '--source', 'antigravity', '--file', file, '--mode', 'full', '--json'],
            { output, cwd, dbUrl: ':memory:' },
        );

        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lines.join('')) as { status: string; message: string };
        expect(parsed.status).toBe('error');
        expect(parsed.message).toContain('--dry-run');
        expect(parsed.message).toContain('--mode force-file');
    });

    test('import --mode full without --file still reaches the import path (0506 R2)', async () => {
        const cwd = makeTmpCwd();
        const emptyRoot = join(cwd, 'empty-history');
        mkdirSync(emptyRoot, { recursive: true });
        const { output, lines } = capturingOutput();

        // Source-root full write is the sanctioned reconciliation surface — must not regress.
        const exitCode = await main(['history', 'import', '--source', 'codex', '--root', emptyRoot, '--mode', 'full'], {
            output,
            cwd,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(lines.join('')).toContain('history import (fan-out)');
    });

    describe('pi importer provenance guard (0726 R1)', () => {
        // The host-resolved importer version decides the branch: the guard fires only when
        // the workspace imports a version below the safe floor. Reading it here keeps the
        // test honest across future ts-libs upgrades (service-level version injection
        // lives in packages/app/tests/services/history-service.test.ts).
        const require = createRequire(import.meta.url);
        let hostVersion = 'unknown';
        try {
            hostVersion = (require('@gobing-ai/ts-llm-jsonl-importer/package.json') as { version: string }).version;
        } catch {
            // unresolved package — treated as unknown, which the guard rejects
        }
        const hostSafe = (() => {
            const installed = parseImporterVersion(hostVersion);
            const minSafe = parseImporterVersion(MIN_SAFE_PI_BASH_IMPORTER_VERSION);
            if (installed === null || minSafe === null) return false;
            return (
                installed[0] > minSafe[0] ||
                (installed[0] === minSafe[0] &&
                    (installed[1] > minSafe[1] || (installed[1] === minSafe[1] && installed[2] >= minSafe[2])))
            );
        })();

        test('full pi import is refused below the safe importer floor with remedy (text)', async () => {
            const cwd = makeTmpCwd();
            const emptyRoot = join(cwd, 'empty-history');
            mkdirSync(emptyRoot, { recursive: true });
            const { output, lines } = capturingOutput();

            const exitCode = await main(
                ['history', 'import', '--source', 'pi', '--root', emptyRoot, '--mode', 'full'],
                {
                    output,
                    cwd,
                    dbUrl: ':memory:',
                },
            );

            if (hostSafe) {
                // Workspace imported a safe importer — the guard must not fire.
                expect(exitCode).toBe(0);
                expect(lines.join('')).toContain('history import (fan-out)');
                return;
            }
            expect(exitCode).toBe(1);
            const joined = lines.join('');
            expect(joined).toContain('unsafe-history-importer');
            expect(joined).toContain(hostVersion);
            expect(joined).toContain(MIN_SAFE_PI_BASH_IMPORTER_VERSION);
            expect(joined).toContain('96762d5');
            expect(joined).toContain('--dry-run');
        });

        test('full pi import refusal carries structured details under --json --json-envelope (0726 R1)', async () => {
            if (hostSafe) return; // refusal polarity already proven by the text test above
            const cwd = makeTmpCwd();
            const emptyRoot = join(cwd, 'empty-history');
            mkdirSync(emptyRoot, { recursive: true });
            const { output, lines } = capturingOutput();

            const exitCode = await main(
                [
                    'history',
                    'import',
                    '--source',
                    'pi',
                    '--root',
                    emptyRoot,
                    '--mode',
                    'full',
                    '--json',
                    '--json-envelope',
                ],
                { output, cwd, dbUrl: ':memory:' },
            );

            expect(exitCode).toBe(1);
            const parsed = JSON.parse(lines.join('')) as {
                ok: boolean;
                error?: {
                    code: string;
                    details?: { cliCode?: string; installedVersion?: string; minSafeVersion?: string };
                };
            };
            expect(parsed.ok).toBe(false);
            expect(parsed.error?.code).toBe('INTERNAL_ERROR');
            expect(parsed.error?.details?.cliCode).toBe('unsafe-history-importer');
            expect(parsed.error?.details?.installedVersion).toBe(hostVersion);
            expect(parsed.error?.details?.minSafeVersion).toBe(MIN_SAFE_PI_BASH_IMPORTER_VERSION);
        });
    });

    test('import --source missing is rejected with the source allowlist', async () => {
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'import', '--source', 'missing'], {
            output,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('Invalid history source');
    });

    test('import single source --json emits fan-out entries array (0470 fan-out contract)', async () => {
        const cwd = makeTmpCwd();
        const file = join(cwd, 'h.jsonl');
        writeFileSync(file, `${JSON.stringify({ id: 'm1', timestamp: '2026-05-30T00:00:00Z', content: 'x' })}\n`);
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'import', '--source', 'codex', '--file', file, '--json'], {
            output,
            cwd,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lines.join('')) as {
            entries: Array<{ source: string; status: string; messages: number }>;
            exitCode: number;
        };
        expect(Array.isArray(parsed.entries)).toBe(true);
        expect(parsed.entries[0]?.source).toBe('codex');
        expect(parsed.entries[0]?.messages).toBe(1);
    });

    test('import full mode --json entries carry the reconciliation summary; incremental does not (0505 R1)', async () => {
        const cwd = makeTmpCwd();
        const file = join(cwd, 'h.jsonl');
        writeFileSync(file, `${JSON.stringify({ id: 'm1', timestamp: '2026-05-30T00:00:00Z', content: 'x' })}\n`);
        const { output, lines } = capturingOutput();

        // 0506 R2: a single-file full WRITE is rejected pre-DB; the sanctioned preview path
        // is `--dry-run`, which still exercises the reconciliation summary (0505 R1 contract).
        const exitCode = await main(
            ['history', 'import', '--source', 'antigravity', '--file', file, '--mode', 'full', '--dry-run', '--json'],
            {
                output,
                cwd,
                dbUrl: ':memory:',
            },
        );

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lines.join('')) as {
            entries: Array<{ source: string; status: string; messages: number; reconciliation?: unknown }>;
        };
        const entry = parsed.entries[0];
        expect(entry?.source).toBe('antigravity');
        expect(entry?.messages).toBe(1);
        // Fresh in-memory DB: full mode previews zero stale rows, and the summary is additive.
        expect(entry?.reconciliation).toEqual({
            staleTargetRows: 0,
            staleLedgerRows: 0,
            staleCheckpointRows: 0,
        });

        // Incremental runs never carry the field.
        const inc = capturingOutput();
        const incExit = await main(
            ['history', 'import', '--source', 'antigravity', '--file', file, '--mode', 'incremental', '--json'],
            {
                output: inc.output,
                cwd,
                dbUrl: ':memory:',
            },
        );
        expect(incExit).toBe(0);
        const incParsed = JSON.parse(inc.lines.join('')) as {
            entries: Array<{ source: string; reconciliation?: unknown }>;
        };
        expect(incParsed.entries[0]?.reconciliation).toBeUndefined();
    });

    test('import single source plain text emits fan-out formatter', async () => {
        const cwd = makeTmpCwd();
        const file = join(cwd, 'h.jsonl');
        writeFileSync(file, `${JSON.stringify({ id: 'm1', timestamp: '2026-05-30T00:00:00Z', content: 'x' })}\n`);
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'import', '--source', 'codex', '--file', file], {
            output,
            cwd,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        const joined = lines.join('');
        expect(joined).toContain('history import (fan-out)');
        expect(joined).toContain('codex: ok');
        expect(joined).toContain('exit_code: 0');
    });

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
        const previous = process.env[HISTORY_REFRESH_CONTEXT_ENV];
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
        process.env[HISTORY_REFRESH_CONTEXT_ENV] = JSON.stringify({
            trigger: 'manual',
            triggerId: 'refresh-1',
            windowStart: 10,
            windowEnd: 20,
            importMode: 'full',
        });

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
            if (previous === undefined) delete process.env[HISTORY_REFRESH_CONTEXT_ENV];
            else process.env[HISTORY_REFRESH_CONTEXT_ENV] = previous;
            spy.mockRestore();
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('analyze subcommand formatted text output (non-json)', async () => {
        const cwd = makeTmpCwd();
        const { output, lines } = capturingOutput();
        try {
            const exitCode = await main(['history', 'analyze'], {
                output,
                cwd,
                dbUrl: ':memory:',
            });
            expect(exitCode).toBe(0);
            const joined = lines.join('');
            expect(joined).toContain('Total:');
            expect(joined).toContain('$0.00');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('import subcommand formats warnings in text output', async () => {
        const spy = spyOn(HistoryService.prototype, 'importAll').mockResolvedValueOnce({
            entries: [makeCoverageEntry({ source: 'claude' })],
            warnings: [{ code: 'WARN_TEST', source: 'claude', detail: 'test warning detail' }],
            exitCode: 0,
            attribution: {
                sessionsEvaluated: 0,
                linksCreated: 0,
                linksAlreadyPresent: 0,
                skippedEvidence: 0,
                ambiguousEvidence: 0,
            },
        });

        try {
            const { output, lines } = capturingOutput();
            const exitCode = await main(['history', 'import', '--source', 'claude'], {
                output,
                dbUrl: ':memory:',
            });
            expect(exitCode).toBe(0);
            const joined = lines.join('');
            expect(joined).toContain('warnings:');
            expect(joined).toContain('[WARN_TEST] claude: test warning detail');
        } finally {
            spy.mockRestore();
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

/** Read every system_events row newest-first from the workspace ledger. */
async function readSystemEvents(cwd: string): Promise<SystemEventRow[]> {
    const db = await createMigratedDbAdapter(cwd);
    try {
        return await new SystemEventDao(db).query({ limit: 500 });
    } finally {
        await db.close();
    }
}

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

// ─── Task 0564 R3: `history report` render-time narrowing (no database access) ───

function makeToolStat(name: string, calls: number) {
    return {
        toolName: name,
        calls,
        errors: 0,
        durationMsTotal: calls * 100,
        durationMsMean: 100,
        durationMsMax: 100,
        durationUnmeasured: 0,
        resultBytes: 0,
    };
}

function makeSessionStat(id: string, source = 'claude') {
    return {
        sessionId: id,
        source,
        startedAt: null,
        messages: 5,
        toolCalls: 2,
        tokens: 1_000,
        costUsd: 0.1,
        topTool: 'Bash',
        assistantDurationMs: 0,
        assistantDurationUnmeasured: 0,
    };
}

/** A DbAdapter spy whose every data-path method fails if the render path touches it. */
function noDbSpy(): DbAdapter {
    return {
        db: undefined as never,
        exec: () => {
            throw new Error('report must not exec SQL');
        },
        run: () => {
            throw new Error('report must not run SQL');
        },
        queryFirst: () => {
            throw new Error('report must not query the database');
        },
        queryAll: () => {
            throw new Error('report must not query the database');
        },
        batch: () => {
            throw new Error('report must not batch SQL');
        },
        close: () => undefined,
    };
}

describe('history report render-time narrowing (0564 R3)', () => {
    test('--task renders only that task rows with a banner naming filter and artifact', async () => {
        const cwd = makeTmpCwd();
        const artifact = makeArtifact({
            selector: { ...makeArtifact().selector, taskWbs: '0042' },
            bySession: [makeSessionStat('sess-task-a'), makeSessionStat('sess-task-b')],
            byTool: [makeToolStat('Bash', 3)],
        });
        const artifactPath = writeArtifactFile(cwd, 'task-a.json', artifact);
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'report', artifactPath, '--task', '0042'], {
            output,
            cwd,
            db: noDbSpy(),
        });

        expect(exitCode).toBe(0);
        const joined = lines.join('');
        // Banner names the applied filter AND the artifact id.
        expect(joined).toContain('Narrowed report — task 0042');
        expect(joined).toContain(artifactPath);
        // The artifact's rows are rendered.
        expect(joined).toContain('sess-task-a');
        expect(joined).toContain('sess-task-b');
        // No database connection is opened — the spy would have thrown.
    });

    test('--top re-slices leaderboards and never touches the database', async () => {
        const cwd = makeTmpCwd();
        const artifact = makeArtifact({
            byTool: [makeToolStat('t0', 5), makeToolStat('t1', 4), makeToolStat('t2', 3), makeToolStat('t3', 2)],
            bySession: [makeSessionStat('s0'), makeSessionStat('s1'), makeSessionStat('s2'), makeSessionStat('s3')],
        });
        const artifactPath = writeArtifactFile(cwd, 'top.json', artifact);
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'report', artifactPath, '--top', '2'], {
            output,
            cwd,
            db: noDbSpy(),
        });

        expect(exitCode).toBe(0);
        const joined = lines.join('');
        expect(joined).toContain('Narrowed report — top 2');
        // Re-sliced depth: top two rows survive, deeper rows are gone. Assert on
        // the body only — the banner/footer echo the artifact path, whose random
        // mkdtemp suffix can itself contain 's2'/'t2' (CI flake, 2026-09-06).
        const body = joined
            .split('\n')
            .filter((line) => !line.includes(artifactPath))
            .join('\n');
        expect(body).toContain('Session leaderboard (2):');
        expect(body).toContain('s0');
        expect(body).toContain('s1');
        expect(body).not.toContain('s2');
        expect(body).toContain('t0');
        expect(body).toContain('t1');
        expect(body).not.toContain('t2');
    });

    test('an unusable --top exits 1 instead of silently rendering the full artifact', async () => {
        // Coercing a bad value to `undefined` produced a FULL report with no banner
        // and no diagnostic — a typo (`--top l0`) was indistinguishable from a
        // deliberate unfiltered render, which 0564 R3 forbids.
        for (const bad of ['abc', '0', '-5', '2.5']) {
            const cwd = makeTmpCwd();
            const artifact = makeArtifact({
                byTool: [makeToolStat('t0', 5), makeToolStat('t1', 4)],
                bySession: [makeSessionStat('s0'), makeSessionStat('s1')],
            });
            const artifactPath = writeArtifactFile(cwd, 'bad-top.json', artifact);
            const { output, lines } = capturingOutput();

            const exitCode = await main(['history', 'report', artifactPath, '--top', bad], {
                output,
                cwd,
                db: noDbSpy(),
            });

            const joined = lines.join('');
            expect(exitCode, `--top ${bad}`).toBe(1);
            expect(joined, `--top ${bad}`).toContain('--top must be a positive integer');
            // The unfiltered report must not have been emitted as a consolation prize.
            expect(joined, `--top ${bad}`).not.toContain('Session leaderboard');
        }
    });

    test('--task on an artifact with no task dimension exits 1 naming artifact id and missing dimension', async () => {
        const cwd = makeTmpCwd();
        const artifact = makeArtifact(); // selector.taskWbs === null
        const artifactPath = writeArtifactFile(cwd, 'no-task.json', artifact);
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'report', artifactPath, '--task', '0042'], {
            output,
            cwd,
            db: noDbSpy(),
        });

        expect(exitCode).toBe(1);
        const joined = lines.join('');
        expect(joined).toContain(artifactPath); // artifact id named
        expect(joined).toContain('task'); // missing dimension named
        expect(joined).toContain('0042');
        // Never a silent unfiltered render.
        expect(joined).not.toContain('Total:');
    });

    test('--task for a different task than the artifact was analyzed with exits 1', async () => {
        const cwd = makeTmpCwd();
        const artifact = makeArtifact({
            selector: { ...makeArtifact().selector, taskWbs: '0556' },
            bySession: [makeSessionStat('sess-0556')],
        });
        const artifactPath = writeArtifactFile(cwd, 'other-task.json', artifact);
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'report', artifactPath, '--task', '0042'], {
            output,
            cwd,
            db: noDbSpy(),
        });

        expect(exitCode).toBe(1);
        const joined = lines.join('');
        expect(joined).toContain(artifactPath);
        expect(joined).toContain('0556');
        expect(joined).toContain('0042');
    });

    test('--task --json emits the narrowed artifact (narrowing applies before output)', async () => {
        const cwd = makeTmpCwd();
        const artifact = makeArtifact({
            selector: { ...makeArtifact().selector, taskWbs: '0042' },
            bySession: [makeSessionStat('sess-0042')],
        });
        const artifactPath = writeArtifactFile(cwd, 'task-json.json', artifact);
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'report', artifactPath, '--task', '0042', '--json'], {
            output,
            cwd,
            db: noDbSpy(),
        });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lines.join('')) as HistoryArtifact;
        expect(parsed.selector.taskWbs).toBe('0042');
        expect(parsed.bySession).toHaveLength(1);
    });
});
