/**
 * Thin-wrapper integration tests for apps/cli/src/commands/history.ts.
 * Behavioral tests for HistoryService live in packages/app/tests/services/history-service.test.ts.
 */

import { describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    HistoryService,
    MIN_SAFE_PI_BASH_IMPORTER_VERSION,
    parseImporterVersion,
    UnsafeHistoryImporterError,
} from '@gobing-ai/spur-app';
import type { CoverageEntry } from '@gobing-ai/spur-domain';
import { main } from '../../../src';
import type { CommandOutput } from '../../../src/output';

function capturingOutput(): { output: CommandOutput; lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        output: { write: (s: string) => lines.push(s), error: (s: string) => lines.push(s) },
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

function makeTmpCwd(): string {
    return mkdtempSync(join(tmpdir(), 'spur-hist-'));
}

/** Split stdout (result) from stderr (diagnostics) so scope lines can be pinned to the right stream. */
function capturingStreams(): { output: CommandOutput; stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return { stdout, stderr, output: { write: (s) => stdout.push(s), error: (s) => stderr.push(s) } };
}

describe('history command', () => {
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
        // Split streams: since 1144 the diagnostic scope line goes to stderr, so the JSON
        // payload is stdout-only (this test pins that payload, not the merged text).
        const { output, stdout } = capturingStreams();

        const exitCode = await main(['history', 'import', '--source', 'codex', '--file', file, '--json'], {
            output,
            cwd,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(stdout.join('')) as {
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
        const { output, stdout } = capturingStreams();

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
        const parsed = JSON.parse(stdout.join('')) as {
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
        const inc = capturingStreams();
        const incExit = await main(
            ['history', 'import', '--source', 'antigravity', '--file', file, '--mode', 'incremental', '--json'],
            {
                output: inc.output,
                cwd,
                dbUrl: ':memory:',
            },
        );
        expect(incExit).toBe(0);
        const incParsed = JSON.parse(inc.stdout.join('')) as {
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
});

describe('history CLI usage-error coverage (0813 R3)', () => {
    test('import --file with --source all is rejected before service construction (text)', async () => {
        const { output, lines } = capturingOutput();
        const exitCode = await main(['history', 'import', '--file', '/tmp/whatever.jsonl', '--source', 'all'], {
            output,
        });
        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('--file requires a single --source');
    });

    test('import --file with --source all is rejected (enveloped json)', async () => {
        const { output, lines } = capturingOutput();
        const exitCode = await main(
            ['history', 'import', '--file', '/tmp/whatever.jsonl', '--source', 'all', '--json', '--json-envelope'],
            { output },
        );
        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lines.join('')) as { ok: boolean; error?: { details?: { cliCode?: string } } };
        expect(parsed.ok).toBe(false);
        expect(parsed.error?.details?.cliCode).toBe('usage');
    });

    test('import rejects malformed --source-timeout before import (text)', async () => {
        const cwd = makeTmpCwd();
        const emptyRoot = join(cwd, 'empty-history');
        mkdirSync(emptyRoot, { recursive: true });
        const { output, lines } = capturingOutput();
        const exitCode = await main(
            ['history', 'import', '--source', 'pi', '--root', emptyRoot, '--source-timeout', 'abc'],
            { output, cwd, dbUrl: ':memory:' },
        );
        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('spur history import:');
    });

    test('import rejects malformed --source-timeout (enveloped json)', async () => {
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
                '--source-timeout',
                '-5',
                '--json',
                '--json-envelope',
            ],
            { output, cwd, dbUrl: ':memory:' },
        );
        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lines.join('')) as { ok: boolean; error?: { details?: { cliCode?: string } } };
        expect(parsed.ok).toBe(false);
        expect(parsed.error?.details?.cliCode).toBe('usage');
    });
});

describe('history import scope and budget remedy (task 1144)', () => {
    const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

    const jsonl = (id: string, content: string): string =>
        `${JSON.stringify({ id, timestamp: '2026-05-30T00:00:00Z', content })}\n`;

    /** Three JSONL files (two nested) plus a non-JSONL file outside the estimate. */

    function scopeFixture(): { cwd: string; root: string; bytes: number } {
        const cwd = makeTmpCwd();
        const root = join(cwd, 'codex-history');
        mkdirSync(join(root, 'nested'), { recursive: true });
        const bodyA = jsonl('a', 'a');
        const bodyB = jsonl('b', 'bb');
        const bodyC = jsonl('c', 'ccc');
        writeFileSync(join(root, 'a.jsonl'), bodyA);
        writeFileSync(join(root, 'nested', 'b.jsonl'), bodyB);
        writeFileSync(join(root, 'nested', 'c.jsonl'), bodyC);
        writeFileSync(join(root, 'notes.txt'), 'not counted');
        return { cwd, root, bytes: Buffer.byteLength(bodyA) + Buffer.byteLength(bodyB) + Buffer.byteLength(bodyC) };
    }

    test('1144 R1/AC1 — import --root reports the scope on stderr before any result, and text output stays on stdout', async () => {
        const { cwd, root, bytes } = scopeFixture();
        const { output, stdout, stderr } = capturingStreams();

        const exitCode = await main(
            ['history', 'import', '--source', 'codex', '--root', root, '--mode', 'incremental'],
            {
                output,
                cwd,
                dbUrl: ':memory:',
            },
        );

        expect(exitCode).toBe(0);
        expect(stderr).toEqual([
            `history import: codex scope ≈ 3 files, ${mb(bytes)} MB (mode incremental, budget 600000)`,
        ]);
        expect(stdout.join('')).toContain('history import (fan-out)');
    });

    test('1144 R1/AC1 — with --json the coverage entry carries scope and no scope line reaches stdout', async () => {
        const { cwd, root, bytes } = scopeFixture();
        const { output, stdout, stderr } = capturingStreams();

        const exitCode = await main(
            ['history', 'import', '--source', 'codex', '--root', root, '--mode', 'incremental', '--json'],
            { output, cwd, dbUrl: ':memory:' },
        );

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(stdout.join('')) as {
            entries: Array<{ source: string; scope?: { files: number; bytes: number } }>;
        };
        expect(parsed.entries[0]?.scope).toEqual({ files: 3, bytes });
        expect(stdout.join('')).not.toContain('scope ≈');
        expect(stderr.join('')).toContain('scope ≈');
    });

    test('1144 R2/AC2 — a source-timeout abort names the remedy and keeps exit code 1', async () => {
        const cwd = makeTmpCwd();
        const root = join(cwd, 'empty-history');
        mkdirSync(root, { recursive: true });
        const spy = spyOn(HistoryService.prototype, 'import').mockImplementation(() => new Promise<never>(() => {}));
        try {
            const { output, stderr } = capturingStreams();
            const exitCode = await main(
                ['history', 'import', '--source', 'antigravity', '--root', root, '--source-timeout', '20'],
                { output, cwd, dbUrl: ':memory:' },
            );
            expect(exitCode).toBe(1);
            const text = stderr.join('');
            expect(text).toContain("source 'antigravity' exceeded its 20ms budget");
            expect(text).toContain(
                '; for one session use --source antigravity --file <path>; narrow with --root <dir>; ' +
                    'for a deliberate full replay pass --source-timeout none',
            );
        } finally {
            spy.mockRestore();
        }
    });

    test('1144 R3/AC3 — import --help names --file for one session and the per-source budget risk', async () => {
        const { output, stdout } = capturingStreams();

        const exitCode = await main(['history', 'import', '--help'], { output, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const help = stdout.join('').replace(/\s+/g, ' ');
        expect(help).toContain(
            "For one session's evidence, use `--file`; a full replay can exceed the per-source budget.",
        );
    });
});

describe('history import error branches (per-verb split)', () => {
    test('malformed --capability-origin is a usage error before service construction (text)', async () => {
        const { output, lines } = capturingOutput();
        const exitCode = await main(['history', 'import', '--source', 'pi', '--capability-origin', 'bad'], {
            output,
            cwd: makeTmpCwd(),
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('spur history import: --capability-origin expects');
    });

    test('malformed --capability-origin is a usage error (enveloped json)', async () => {
        const { output, lines } = capturingOutput();
        const exitCode = await main(
            ['history', 'import', '--source', 'pi', '--capability-origin', 'a:b', '--json', '--json-envelope'],
            { output, cwd: makeTmpCwd(), dbUrl: ':memory:' },
        );
        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lines.join('')) as { ok: boolean; error?: { details?: { cliCode?: string } } };
        expect(parsed.ok).toBe(false);
        expect(parsed.error?.details?.cliCode).toBe('usage');
    });

    // The host-version provenance tests above only take the refusal branch on an unsafe host
    // importer; injecting the error makes the CLI mapping deterministic on every host.
    test('UnsafeHistoryImporterError maps to exit 1 with code and versions (text)', async () => {
        const spy = spyOn(HistoryService.prototype, 'importAll').mockRejectedValueOnce(
            new UnsafeHistoryImporterError('importer drops bash commands', '0.0.1'),
        );
        try {
            const { output, lines } = capturingOutput();
            const exitCode = await main(['history', 'import', '--source', 'pi', '--mode', 'full'], {
                output,
                cwd: makeTmpCwd(),
                dbUrl: ':memory:',
            });
            expect(exitCode).toBe(1);
            expect(lines.join('')).toContain(
                'spur history import: unsafe-history-importer: importer drops bash commands',
            );
        } finally {
            spy.mockRestore();
        }
    });

    test('UnsafeHistoryImporterError carries structured details (enveloped json)', async () => {
        const spy = spyOn(HistoryService.prototype, 'importAll').mockRejectedValueOnce(
            new UnsafeHistoryImporterError('importer drops bash commands', '0.0.1'),
        );
        try {
            const { output, lines } = capturingOutput();
            const exitCode = await main(
                ['history', 'import', '--source', 'pi', '--mode', 'full', '--json', '--json-envelope'],
                { output, cwd: makeTmpCwd(), dbUrl: ':memory:' },
            );
            expect(exitCode).toBe(1);
            const parsed = JSON.parse(lines.join('')) as {
                error?: { details?: { cliCode?: string; installedVersion?: string; minSafeVersion?: string } };
            };
            expect(parsed.error?.details).toEqual({
                cliCode: 'unsafe-history-importer',
                installedVersion: '0.0.1',
                minSafeVersion: MIN_SAFE_PI_BASH_IMPORTER_VERSION,
            });
        } finally {
            spy.mockRestore();
        }
    });

    test('any other import failure is rethrown, not mapped to the provenance refusal', async () => {
        const spy = spyOn(HistoryService.prototype, 'importAll').mockRejectedValueOnce(new Error('disk on fire'));
        try {
            const { output, lines } = capturingOutput();
            const exitCode = await main(['history', 'import', '--source', 'pi'], {
                output,
                cwd: makeTmpCwd(),
                dbUrl: ':memory:',
            });
            expect(exitCode).not.toBe(0);
            expect(lines.join('')).not.toContain('unsafe-history-importer');
        } finally {
            spy.mockRestore();
        }
    });
});
