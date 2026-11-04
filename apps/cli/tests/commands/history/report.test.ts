/**
 * Thin-wrapper integration tests for apps/cli/src/commands/history.ts.
 * Behavioral tests for HistoryService live in packages/app/tests/services/history-service.test.ts.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DbAdapter, HISTORY_ARTIFACT_SCHEMA_VERSION, type HistoryArtifact } from '@gobing-ai/spur-domain';
import { main } from '../../../src';
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

describe('history command', () => {
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
});

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

describe('history CLI usage-error coverage (0813 R3)', () => {
    test('report surfaces read failures through the catch path (text)', async () => {
        const cwd = makeTmpCwd();
        const { output, lines } = capturingOutput();
        const exitCode = await main(['history', 'report', join(cwd, 'missing.json')], { output, cwd });
        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('spur history report failed:');
    });
});
