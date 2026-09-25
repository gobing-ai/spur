import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildReceipt,
    type CheckReceipt,
    type CheckReceiptRow,
    lightScope,
    main,
    planLightChecks,
    RECEIPT_SCHEMA_VERSION,
    readReceiptStatus,
    runLightGate,
    runQualityGate,
    runShellCommand,
} from '../scripts/quality-gate';

/** Injected `exists` predicate over a fixed path set — keeps the scope helpers pure. */
function existsFrom(paths: Iterable<string>): (p: string) => boolean {
    const set = new Set(paths);
    return (p) => set.has(p);
}

function receipt(rows: Partial<CheckReceipt> = {}): CheckReceipt {
    const row: CheckReceiptRow = {
        id: 'test',
        cmd: 'bun run spur-check',
        status: 'PASS',
        durationMs: 12,
        logPath: '.spur/run/x-test-gate.log',
    };
    return {
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        wbs: '0939',
        runId: 'pipeline-0939',
        tier: 'full',
        inputDigest: 'digest-1',
        checks: [row],
        status: 'PASS',
        completedAt: '2026-09-25T00:00:00.000Z',
        ...rows,
    };
}

function writeReceipt(dir: string, receiptJson: unknown): string {
    const path = join(dir, '.spur/run/0939-check-receipt.json');
    mkdirSync(join(dir, '.spur/run'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(receiptJson, null, 2)}\n`);
    return path;
}

function silenceStdout<T>(run: () => T): T {
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true;
    try {
        return run();
    } finally {
        process.stdout.write = originalWrite;
    }
}

/** Capture stdout around `run` — the action result `data` surface for the 0940 markers. */
function captureStdout<T>(run: () => T): { out: string; value: T } {
    let out = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: unknown): boolean => {
        out += String(chunk);
        return true;
    };
    try {
        const value = run();
        return { out, value };
    } finally {
        process.stdout.write = originalWrite;
    }
}

// ─── buildReceipt (0939 plan 1) ───

describe('buildReceipt', () => {
    test('stamps check-receipt/v1 and derives the overall status from the rows', () => {
        const pass = buildReceipt({
            wbs: '0939',
            runId: 'run-1',
            tier: 'full',
            inputDigest: 'd1',
            checks: [
                { id: 'lint', cmd: 'bun run lint', status: 'PASS', durationMs: 1, logPath: 'l' },
                { id: 'test', cmd: 'bun test', status: 'PASS', durationMs: 2, logPath: 'l' },
            ],
            completedAt: '2026-09-25T00:00:00.000Z',
        });
        expect(pass.schemaVersion).toBe('check-receipt/v1');
        expect(pass.status).toBe('PASS');
        expect(pass.checks).toHaveLength(2);

        const fail = buildReceipt({
            wbs: '0939',
            runId: 'run-1',
            tier: 'light',
            inputDigest: 'd1',
            checks: [{ id: 'test:pkg', cmd: 'bun test', status: 'FAIL', durationMs: 3, logPath: 'l' }],
            completedAt: '2026-09-25T00:00:00.000Z',
        });
        expect(fail.status).toBe('FAIL');
    });

    test('no rows is a PASS receipt (nothing changed to check)', () => {
        const empty = buildReceipt({
            wbs: '0939',
            runId: 'r',
            tier: 'light',
            inputDigest: '',
            checks: [],
            completedAt: '2026-09-25T00:00:00.000Z',
        });
        expect(empty.status).toBe('PASS');
        expect(empty.checks).toEqual([]);
    });
});

// ─── readReceiptStatus (0939 R3: missing | failed | stale | light-only) ───

describe('readReceiptStatus', () => {
    test('missing: absent file, corrupt JSON, or foreign schema version', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-receipt-missing-'));
        try {
            expect(readReceiptStatus(join(dir, 'absent.json'), 'd1')).toEqual({ reuse: false, reason: 'missing' });
            const corrupt = join(dir, 'corrupt.json');
            writeFileSync(corrupt, '{not json');
            expect(readReceiptStatus(corrupt, 'd1')).toEqual({ reuse: false, reason: 'missing' });
            const foreign = writeReceipt(dir, { ...receipt(), schemaVersion: 'check-receipt/v2' });
            expect(readReceiptStatus(foreign, 'd1')).toEqual({ reuse: false, reason: 'missing' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('failed: a FAIL receipt is not reusable even at the same digest', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-receipt-failed-'));
        try {
            const path = writeReceipt(dir, receipt({ status: 'FAIL' }));
            expect(readReceiptStatus(path, 'digest-1')).toEqual({ reuse: false, reason: 'failed' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('stale: digest mismatch (including an empty current digest) beats tier checks', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-receipt-stale-'));
        try {
            const path = writeReceipt(dir, receipt());
            expect(readReceiptStatus(path, 'digest-2')).toEqual({ reuse: false, reason: 'stale' });
            expect(readReceiptStatus(path, '')).toEqual({ reuse: false, reason: 'stale' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('light-only: a PASS light receipt at the same digest is never reusable', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-receipt-light-'));
        try {
            const path = writeReceipt(dir, receipt({ tier: 'light', inputDigest: 'digest-1' }));
            expect(readReceiptStatus(path, 'digest-1')).toEqual({ reuse: false, reason: 'light-only' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('reuse: PASS + tier full + matching digest', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-receipt-reuse-'));
        try {
            const path = writeReceipt(dir, receipt());
            expect(readReceiptStatus(path, 'digest-1')).toEqual({ reuse: true, reason: 'ok' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ─── lightScope + planLightChecks (0939 R1: src→test filename mapping) ───

describe('lightScope', () => {
    const repoPaths = [
        'apps/cli/package.json',
        'packages/app/package.json',
        'packages/domain/package.json',
        'packages/domain/tests/dao/run-dao.test.ts',
        'packages/app/tests/workflow/terminal-reason.test.ts',
    ];

    test('touched workspaces only, src→tests mapping hit and miss, changed test files include themselves', () => {
        const scope = lightScope(
            [
                'apps/cli/src/index.ts',
                'packages/domain/src/dao/run-dao.ts',
                'packages/domain/src/index.ts',
                'packages/app/tests/workflow/terminal-reason.test.ts',
                'README.md',
                'plugins/sp/scripts/quality-gate.ts',
            ],
            existsFrom(repoPaths),
        );
        expect(scope.workspaces).toEqual(['apps/cli', 'packages/app', 'packages/domain']);
        expect(scope.tests).toEqual([
            'packages/app/tests/workflow/terminal-reason.test.ts',
            'packages/domain/tests/dao/run-dao.test.ts',
        ]);
        expect(scope.files).toHaveLength(6);
    });

    test('no changed files → empty scope', () => {
        expect(lightScope([], existsFrom(repoPaths))).toEqual({ files: [], workspaces: [], tests: [] });
    });
});

describe('planLightChecks', () => {
    test('frozen ids and workspace-relative test commands, in run order', () => {
        const scope: ReturnType<typeof lightScope> = {
            files: ['apps/cli/src/a.ts', 'packages/domain/src/b.ts'],
            workspaces: ['apps/cli', 'packages/domain'],
            tests: ['apps/cli/tests/a.test.ts', 'packages/domain/tests/b.test.ts'],
        };
        const plans = planLightChecks(scope, (ws) => ws === 'packages/domain');
        expect(plans.map((p) => p.id)).toEqual([
            'format-lint:changed',
            'typecheck:packages/domain',
            'test:apps/cli',
            'test:packages/domain',
        ]);
        expect(plans[0]).toEqual({
            id: 'format-lint:changed',
            cmd: 'bunx biome check apps/cli/src/a.ts packages/domain/src/b.ts',
        });
        expect(plans[1]).toEqual({ id: 'typecheck:packages/domain', cmd: 'cd packages/domain && bun run typecheck' });
        // Every test command cd's into its workspace; paths are workspace-relative.
        expect(plans[2]).toEqual({ id: 'test:apps/cli', cmd: 'cd apps/cli && bun test tests/a.test.ts' });
        expect(plans[3]).toEqual({ id: 'test:packages/domain', cmd: 'cd packages/domain && bun test tests/b.test.ts' });
    });

    test('no files and no tests → no rows even with workspaces touched', () => {
        const plans = planLightChecks({ files: [], workspaces: ['packages/domain'], tests: [] }, () => true);
        expect(plans.map((p) => p.id)).toEqual(['typecheck:packages/domain']);
    });
});

// ─── CLI dispatch (0939 plan 4): usage errors stay exit 2 ───

describe('main dispatch', () => {
    test('unknown mode and missing wbs exit 2 before any check runs', () => {
        const originalError = process.stderr.write;
        process.stderr.write = () => true;
        try {
            expect(main(['nope'], { wbs: 'x' })).toBe(2);
            expect(main(['light'], { wbs: '' })).toBe(2);
            expect(main(['status'], { wbs: '' })).toBe(2);
        } finally {
            process.stderr.write = originalError;
        }
    });
});

// ─── light mode end-to-end (0939 plan 3): temp git repo fixture ───

describe('runLightGate (temp git repo)', () => {
    function gitRepoFixture(): { dir: string; cleanup: () => void } {
        const dir = mkdtempSync(join(tmpdir(), 'spur-light-fixture-'));
        const git = (args: string): void => {
            const result = runShellCommand(`git ${args}`, dir);
            if (result.code !== 0) throw new Error(`fixture git ${args} failed: ${result.output}`);
        };
        git('init -q -b main');
        git('config user.email fixture@spur.dev');
        git('config user.name fixture');
        // Mirror the repo: the light log/receipt and the repo-root node_modules link are not
        // changed scope.
        writeFileSync(join(dir, '.gitignore'), 'node_modules\n.spur/\n');
        mkdirSync(join(dir, 'pkg-a/src'), { recursive: true });
        mkdirSync(join(dir, 'pkg-a/tests'), { recursive: true });
        // Pin the formatter so the fixture verdict does not depend on bunx biome defaults.
        writeFileSync(
            join(dir, 'biome.json'),
            JSON.stringify({
                formatter: { indentStyle: 'space', indentWidth: 4, lineWidth: 120 },
                javascript: { formatter: { quoteStyle: 'single' } },
            }),
        );
        writeFileSync(
            join(dir, 'pkg-a/package.json'),
            `${JSON.stringify({ name: 'pkg-a', scripts: { typecheck: 'echo typed-ok' } }, null, 4)}\n`,
        );
        writeFileSync(join(dir, 'pkg-a/src/m.ts'), 'export const one = 1;\n');
        writeFileSync(
            join(dir, 'pkg-a/tests/m.test.ts'),
            "import { expect, test } from 'bun:test';\nimport { one } from '../src/m';\n\ntest('one', () => {\n    expect(one).toBe(1);\n});\n",
        );
        git('add .');
        git('commit -qm init');
        // One tracked edit + one untracked file after the baseline commit.
        writeFileSync(join(dir, 'pkg-a/src/m.ts'), "export const one = 1;\nexport const label = 'one';\n");
        writeFileSync(join(dir, 'pkg-a/src/extra.ts'), 'export const extra = true;\n');
        return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
    }

    function light(dir: string, digest: string, testBody: string) {
        writeFileSync(join(dir, 'pkg-a/tests/m.test.ts'), testBody);
        return silenceStdout(() => runLightGate({ wbs: '0939t', proofDigest: digest }, { cwd: dir }));
    }

    const PASSING_TEST =
        "import { expect, test } from 'bun:test';\nimport { one } from '../src/m';\n\ntest('one', () => {\n    expect(one).toBe(1);\n});\n";
    const FAILING_TEST = PASSING_TEST.replace('toBe(1)', 'toBe(2)');

    test('runs changed scope, writes a tier-light receipt, and never reports reuse', () => {
        const { dir, cleanup } = gitRepoFixture();
        try {
            // Resolve bunx biome against the repo's pinned binary; the fixture has no node_modules.
            runShellCommand(`ln -s ${process.cwd()}/node_modules ${dir}/node_modules`, undefined);
            const result = light(dir, 'digest-A', PASSING_TEST);
            expect(result.status).toBe('PASS');
            expect(result.scope.files.sort()).toEqual(['pkg-a/src/extra.ts', 'pkg-a/src/m.ts']);
            expect(result.scope.workspaces).toEqual(['pkg-a']);
            expect(result.scope.tests).toEqual(['pkg-a/tests/m.test.ts']);
            expect(result.checks.map((c) => c.id)).toEqual(['format-lint:changed', 'typecheck:pkg-a', 'test:pkg-a']);
            for (const row of result.checks) {
                expect(row.status).toBe('PASS');
                expect(row.durationMs).toBeGreaterThanOrEqual(0);
                expect(row.logPath).toBe('.spur/run/0939t-light-gate.log');
            }
            const stored = JSON.parse(
                readFileSync(join(dir, '.spur/run/0939t-check-receipt.json'), 'utf8'),
            ) as CheckReceipt;
            expect(stored.schemaVersion).toBe('check-receipt/v1');
            expect(stored.tier).toBe('light');
            expect(stored.inputDigest).toBe('digest-A');
            expect(stored.runId).toBe('pipeline-0939t');
            expect(stored.status).toBe('PASS');
            expect(readReceiptStatus(join(dir, '.spur/run/0939t-check-receipt.json'), 'digest-A')).toEqual({
                reuse: false,
                reason: 'light-only',
            });
        } finally {
            cleanup();
        }
    });

    test('accumulates: PASS rows at the same digest are skipped, not re-run (AC1)', () => {
        const { dir, cleanup } = gitRepoFixture();
        try {
            runShellCommand(`ln -s ${process.cwd()}/node_modules ${dir}/node_modules`, undefined);
            const first = light(dir, 'digest-A', PASSING_TEST);
            const second = light(dir, 'digest-A', PASSING_TEST);
            expect(second.checks).toEqual(first.checks); // prior rows reused verbatim (durations unchanged)
            const log = readFileSync(join(dir, '.spur/run/0939t-light-gate.log'), 'utf8');
            expect(log).toContain('skipped (PASS at the same input digest)');
        } finally {
            cleanup();
        }
    });

    test('a digest change re-runs and can flip the receipt to FAIL; soft exit stays 0-shaped', () => {
        const { dir, cleanup } = gitRepoFixture();
        try {
            runShellCommand(`ln -s ${process.cwd()}/node_modules ${dir}/node_modules`, undefined);
            light(dir, 'digest-A', PASSING_TEST);
            const rerun = light(dir, 'digest-B', FAILING_TEST);
            expect(rerun.status).toBe('FAIL');
            const byId = new Map(rerun.checks.map((c) => [c.id, c]));
            expect(byId.get('test:pkg-a')?.status).toBe('FAIL');
            expect(byId.get('typecheck:pkg-a')?.status).toBe('PASS');
            expect(byId.get('format-lint:changed')?.status).toBe('PASS');
        } finally {
            cleanup();
        }
    });

    test('preserves a full-tier receipt at the same digest — light never demotes boundary evidence (P3#1)', () => {
        const { dir, cleanup } = gitRepoFixture();
        try {
            runShellCommand(`ln -s ${process.cwd()}/node_modules ${dir}/node_modules`, undefined);
            const full: CheckReceipt = {
                schemaVersion: RECEIPT_SCHEMA_VERSION,
                wbs: '0939t',
                runId: 'run-full',
                tier: 'full',
                inputDigest: 'digest-A',
                checks: [
                    {
                        id: 'test',
                        cmd: 'bun run test',
                        status: 'PASS',
                        durationMs: 1200,
                        logPath: '.spur/run/0939t-test-gate.log',
                    },
                ],
                status: 'PASS',
                completedAt: '2026-09-25T00:00:00.000Z',
            };
            mkdirSync(join(dir, '.spur/run'), { recursive: true });
            writeFileSync(join(dir, '.spur/run/0939t-check-receipt.json'), `${JSON.stringify(full, null, 2)}\n`);
            const result = light(dir, 'digest-A', PASSING_TEST);
            expect(result.status).toBe('PASS');
            const stored = JSON.parse(
                readFileSync(join(dir, '.spur/run/0939t-check-receipt.json'), 'utf8'),
            ) as CheckReceipt;
            expect(stored).toEqual(full);
            expect(readReceiptStatus(join(dir, '.spur/run/0939t-check-receipt.json'), 'digest-A')).toEqual({
                reuse: true,
                reason: 'ok',
            });
            // Light still ran its rows into the log and recorded why no light receipt was written.
            const log = readFileSync(join(dir, '.spur/run/0939t-light-gate.log'), 'utf8');
            expect(log).toContain('full-tier receipt at the same input digest is preserved');
            expect(log).toContain('--- light format-lint:changed:');
        } finally {
            cleanup();
        }
    });

    test('accumulation reuse emits check.reused in the light log and on stdout (0940 R3)', () => {
        const { dir, cleanup } = gitRepoFixture();
        try {
            runShellCommand(`ln -s ${process.cwd()}/node_modules ${dir}/node_modules`, undefined);
            light(dir, 'digest-A', PASSING_TEST);
            const { out } = captureStdout(() => runLightGate({ wbs: '0939t', proofDigest: 'digest-A' }, { cwd: dir }));
            expect(out).toContain('check.reused');
            const log = readFileSync(join(dir, '.spur/run/0939t-light-gate.log'), 'utf8');
            expect(log).toContain('check.reused');
            expect(log).toContain('skipped (PASS at the same input digest)');
        } finally {
            cleanup();
        }
    });
});

// ─── recheck no-progress skip (0940 R2) + status reuse marker (0940 R3) ───

describe('recheck no-progress skip (0940 R2)', () => {
    test('a FAIL full receipt at the same digest skips probe and full gate, writes FAIL, and leaves the attempt counter alone', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0940-skip-'));
        try {
            writeReceipt(dir, receipt({ status: 'FAIL' }));
            writeFileSync(join(dir, '.spur/run/0939-test-fix-attempt'), '1\n');
            const { out, value } = captureStdout(() =>
                runQualityGate(
                    'recheck',
                    {
                        wbs: '0939',
                        proofDigest: 'digest-1',
                        gateProbeCmd: 'echo probe-ran',
                        qualityGateCmd: 'echo full-ran',
                    },
                    { cwd: dir },
                ),
            );
            // Same FAIL path a red full gate uses: status file written, verdict in the result.
            expect(readFileSync(join(dir, '.spur/run/0939-test-gate.status'), 'utf8')).toBe('FAIL\n');
            expect(value.status).toBe('FAIL');
            expect(value.attempts).toBe(0);
            const log = readFileSync(join(dir, '.spur/run/0939-test-gate.log'), 'utf8');
            expect(log).toContain('check.skipped-no-progress');
            expect(log).not.toContain('probe-ran');
            expect(log).not.toContain('full-ran');
            expect(out).toContain('check.skipped-no-progress');
            // The attempt counter is pipeline-owned (the test-fix hop increments it); the skip
            // neither resets nor increments it, so the existing cap still bounds the loop.
            expect(readFileSync(join(dir, '.spur/run/0939-test-fix-attempt'), 'utf8')).toBe('1\n');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a FAIL receipt at a different digest runs the normal probe-then-full recheck', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0940-stale-'));
        try {
            writeReceipt(dir, receipt({ status: 'FAIL' }));
            const { out, value } = captureStdout(() =>
                runQualityGate(
                    'recheck',
                    {
                        wbs: '0939',
                        proofDigest: 'digest-2',
                        gateProbeCmd: 'echo probe-ran',
                        qualityGateCmd: 'echo full-ran; exit 1',
                    },
                    { cwd: dir },
                ),
            );
            expect(value.status).toBe('FAIL');
            expect(value.attempts).toBe(1);
            const log = readFileSync(join(dir, '.spur/run/0939-test-gate.log'), 'utf8');
            expect(log).toContain('probe-ran');
            expect(log).toContain('full-ran');
            expect(log).not.toContain('check.skipped-no-progress');
            expect(out).not.toContain('check.skipped-no-progress');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a PASS receipt never skips the recheck — only a FAIL receipt does', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0940-pass-'));
        try {
            writeReceipt(dir, receipt());
            const { value } = captureStdout(() =>
                runQualityGate(
                    'recheck',
                    {
                        wbs: '0939',
                        proofDigest: 'digest-1',
                        gateProbeCmd: 'exit 0',
                        qualityGateCmd: 'echo full-ran; exit 0',
                    },
                    { cwd: dir },
                ),
            );
            expect(value.status).toBe('PASS');
            const log = readFileSync(join(dir, '.spur/run/0939-test-gate.log'), 'utf8');
            expect(log).toContain('full-ran');
            expect(log).not.toContain('check.skipped-no-progress');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a light-tier FAIL receipt at the same digest never triggers the skip (anti-pattern)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0940-light-'));
        try {
            writeReceipt(dir, receipt({ tier: 'light', status: 'FAIL' }));
            const { value } = captureStdout(() =>
                runQualityGate(
                    'recheck',
                    {
                        wbs: '0939',
                        proofDigest: 'digest-1',
                        gateProbeCmd: 'exit 0',
                        qualityGateCmd: 'echo full-ran; exit 1',
                    },
                    { cwd: dir },
                ),
            );
            expect(value.status).toBe('FAIL');
            expect(value.attempts).toBe(1);
            const log = readFileSync(join(dir, '.spur/run/0939-test-gate.log'), 'utf8');
            expect(log).toContain('full-ran');
            expect(log).not.toContain('check.skipped-no-progress');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('status reuse marker (0940 R3)', () => {
    test('status reuse emits check.reused on stdout and appends it to the gate log', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0940-status-reuse-'));
        try {
            writeReceipt(dir, receipt());
            const { out } = captureStdout(() =>
                main(['status'], { wbs: '0939', proofDigest: 'digest-1' }, { cwd: dir }),
            );
            expect(out).toContain('check.reused');
            const lines = out.trimEnd().split('\n');
            expect(JSON.parse(lines[lines.length - 1] ?? '')).toEqual({ reuse: true, reason: 'ok' });
            const gateLog = readFileSync(join(dir, '.spur/run/0939-test-gate.log'), 'utf8');
            expect(gateLog).toContain('check.reused');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a non-reusable status verdict emits no marker and writes no gate log', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0940-status-miss-'));
        try {
            const { out } = captureStdout(() =>
                main(['status'], { wbs: '0939', proofDigest: 'digest-1' }, { cwd: dir }),
            );
            expect(out.trimEnd().endsWith('{"reuse":false,"reason":"missing"}')).toBe(true);
            expect(existsSync(join(dir, '.spur/run/0939-test-gate.log'))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
