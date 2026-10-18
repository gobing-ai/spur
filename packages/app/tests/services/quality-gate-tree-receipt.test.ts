/**
 * D65 1234 — the check receipt is keyed by the gate's OWN git tree hash (design
 * `docs/design/workflow-execution-foundation.md` §4.8, ADR-140).
 *
 * Failure modes, each pinned here before the implementation moved:
 *   - a dirty tree between the PASS receipt and its reuse (the receipt must not certify it);
 *   - a receipt written by another wbs at this wbs's path;
 *   - a capture that cannot run (not a git repository) — reuse refused, nothing written;
 *   - the corpus carve-out: `docs/tasks*` / `docs/features*` edits keep the key, any other
 *     tracked or untracked change moves it.
 *
 * The fixtures are real git repositories: the tree capture is the subject, so stubbing it
 * would prove nothing.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type CheckReceipt,
    captureGateGitTree,
    type GitTreeCapture,
    qualityGateMain,
    RECEIPT_SCHEMA_VERSION,
    readReceiptStatus,
    resolveReceiptReuse,
    runLightGate,
    runQualityGate,
} from '../../src/services/quality-gate';

const WBS = '1999';

test('an engine gate receipt keeps its workflow identity; an explicit identity still wins', () => {
    const { dir, cleanup } = gitRepo();
    try {
        gate('run', dir, { __runId: 'engine-run' });
        expect(storedReceipt(dir).runId).toBe('engine-run');
        writeFileSync(join(dir, 'src/app.ts'), 'export const one = 2;\n');
        gate('run', dir, { __runId: 'engine-run', runId: 'explicit-run' });
        expect(storedReceipt(dir).runId).toBe('explicit-run');
    } finally {
        cleanup();
    }
});

function git(dir: string, ...args: string[]): void {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

/** Tracked git repo with one code file and one file in each corpus carve-out. */
function gitRepo(): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'spur-1234-tree-'));
    writeFileSync(join(dir, '.gitignore'), '.spur/\n');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/app.ts'), 'export const one = 1;\n');
    mkdirSync(join(dir, 'docs/tasks5'), { recursive: true });
    writeFileSync(join(dir, 'docs/tasks5/1999-tree-receipt.md'), '# 1999\n\n## Requirements\n');
    mkdirSync(join(dir, 'docs/features'), { recursive: true });
    writeFileSync(join(dir, 'docs/features/D65_foundation.md'), '# D65\n');
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@example.com');
    git(dir, 'config', 'user.name', 't');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function treeOf(dir: string): string {
    const capture = captureGateGitTree(dir);
    if (!capture.ok) throw new Error(`tree capture failed: ${capture.error}`);
    return capture.tree;
}

function receiptPath(dir: string): string {
    return join(dir, '.spur', 'run', `${WBS}-check-receipt.json`);
}

function storedReceipt(dir: string): CheckReceipt {
    return JSON.parse(readFileSync(receiptPath(dir), 'utf8')) as CheckReceipt;
}

/** Run one gate mode in-process, keeping the gate's stdout lines out of the reporter stream. */
function gate(mode: 'run' | 'recheck', dir: string, extra: Record<string, string> = {}, options = {}) {
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true;
    try {
        return runQualityGate(
            mode,
            { wbs: WBS, qualityGateCmd: 'exit 0', gateProbeCmd: 'exit 0', ...extra },
            { cwd: dir, ...options },
        );
    } finally {
        process.stdout.write = originalWrite;
    }
}

function writeFullPassReceipt(dir: string, overrides: Partial<CheckReceipt> = {}): string {
    mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
    const path = receiptPath(dir);
    writeFileSync(
        path,
        `${JSON.stringify(
            {
                schemaVersion: RECEIPT_SCHEMA_VERSION,
                wbs: WBS,
                runId: `pipeline-${WBS}`,
                tier: 'full',
                inputDigest: treeOf(dir),
                checks: [
                    {
                        id: 'test',
                        cmd: 'spur self exec check',
                        status: 'PASS',
                        durationMs: 12,
                        logPath: `.spur/run/${WBS}-test-gate.log`,
                    },
                ],
                status: 'PASS',
                completedAt: '2026-10-17T00:00:00.000Z',
                ...overrides,
            },
            null,
            2,
        )}\n`,
    );
    return path;
}

describe('captureGateGitTree', () => {
    test('hashes the tracked tree with the task/feature corpus carved out', () => {
        const { dir, cleanup } = gitRepo();
        try {
            const base = treeOf(dir);
            expect(base).toMatch(/^[0-9a-f]{40}$/);

            // The corpus carve-out: neither a task nor a feature edit moves the key.
            writeFileSync(join(dir, 'docs/tasks5/1999-tree-receipt.md'), '# 1999\n\n## Requirements\n\n- R9. filed\n');
            writeFileSync(join(dir, 'docs/features/D65_foundation.md'), '# D65\n\nmore\n');
            expect(treeOf(dir)).toBe(base);

            // Any other tracked change does.
            writeFileSync(join(dir, 'src/app.ts'), 'export const one = 2;\n');
            const moved = treeOf(dir);
            expect(moved).not.toBe(base);

            // An untracked non-corpus file is part of the certified set (1135 R5).
            writeFileSync(join(dir, 'src/extra.ts'), 'export const extra = true;\n');
            expect(treeOf(dir)).not.toBe(moved);
        } finally {
            cleanup();
        }
    });

    test('fails closed outside a git repository — never an empty-string sentinel', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1234-nogit-'));
        try {
            const capture = captureGateGitTree(dir);
            expect(capture.ok).toBe(false);
            if (!capture.ok) expect(capture.error).toContain('read-tree');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('receipt reuse identity (AC2)', () => {
    test('run keys the receipt by the computed tree, and an unchanged tree reuses it', () => {
        const { dir, cleanup } = gitRepo();
        const sentinel = join(dir, '.spur', 'run', 'gate-ran');
        try {
            const first = gate('run', dir);
            expect(first.status).toBe('PASS');
            const receipt = storedReceipt(dir);
            expect(receipt.inputDigest).toBe(treeOf(dir));
            expect(receipt.inputDigest).toMatch(/^[0-9a-f]{40}$/);

            // Second entry at the same tree: the receipt is reused, the command never runs.
            const second = gate('run', dir, { qualityGateCmd: `touch "${sentinel}"; exit 0` });
            expect(second.status).toBe('PASS');
            expect(second.attempts).toBe(0);
            expect(existsSync(sentinel)).toBe(false);
            expect(readFileSync(join(dir, '.spur', 'run', `${WBS}-test-gate.log`), 'utf8')).toContain(
                `check.reused — full-tier PASS receipt at git tree ${treeOf(dir)}; gate skipped`,
            );
            expect(readFileSync(receiptPath(dir), 'utf8')).toBe(`${JSON.stringify(receipt, null, 2)}\n`);
        } finally {
            cleanup();
        }
    });

    test('a dirty tree between the PASS receipt and its reuse invalidates it', () => {
        const { dir, cleanup } = gitRepo();
        const sentinel = join(dir, '.spur', 'run', 'gate-ran');
        try {
            gate('run', dir);
            const passTree = storedReceipt(dir).inputDigest;

            writeFileSync(join(dir, 'src/app.ts'), 'export const one = 3;\n');
            const dirty = gate('run', dir, { qualityGateCmd: `touch "${sentinel}"; exit 0` });
            expect(dirty.status).toBe('PASS');
            expect(dirty.attempts).toBe(1);
            expect(existsSync(sentinel)).toBe(true);
            const log = readFileSync(join(dir, '.spur', 'run', `${WBS}-test-gate.log`), 'utf8');
            expect(log).not.toContain('check.reused');
            expect(storedReceipt(dir).inputDigest).not.toBe(passTree);
            expect(storedReceipt(dir).inputDigest).toBe(treeOf(dir));
        } finally {
            cleanup();
        }
    });

    test('a corpus-only edit keeps the receipt reusable (docs/tasks* and docs/features*)', () => {
        const { dir, cleanup } = gitRepo();
        const sentinel = join(dir, '.spur', 'run', 'gate-ran');
        try {
            gate('run', dir);
            const before = readFileSync(receiptPath(dir), 'utf8');

            writeFileSync(join(dir, 'docs/tasks5/1999-tree-receipt.md'), '# 1999\n\n## Testing\n\nrows\n');
            writeFileSync(join(dir, 'docs/features/D65_foundation.md'), '# D65\n\nstatus: wip\n');

            const again = gate('run', dir, { qualityGateCmd: `touch "${sentinel}"; exit 0` });
            expect(again.status).toBe('PASS');
            expect(again.attempts).toBe(0);
            expect(existsSync(sentinel)).toBe(false);
            expect(readFileSync(join(dir, '.spur', 'run', `${WBS}-test-gate.log`), 'utf8')).toContain('check.reused');
            // Reuse never rewrites the receipt it matched.
            expect(readFileSync(receiptPath(dir), 'utf8')).toBe(before);
        } finally {
            cleanup();
        }
    });

    test('a receipt written by another wbs is refused even at the right tree', () => {
        const { dir, cleanup } = gitRepo();
        const sentinel = join(dir, '.spur', 'run', 'gate-ran');
        try {
            writeFullPassReceipt(dir, { wbs: '1998' });
            expect(resolveReceiptReuse(receiptPath(dir), WBS, { ok: true, tree: treeOf(dir) })).toEqual({
                reuse: false,
                receiptStatus: { reuse: false, reason: 'stale' },
                refusal: 'receipt belongs to 1998, not 1999',
            });
            // The same receipt read without an owner expectation is reusable — the wbs check is
            // what refuses it, not the digest.
            expect(readReceiptStatus(receiptPath(dir), treeOf(dir), '1998')).toEqual({ reuse: true, reason: 'ok' });

            const result = gate('run', dir, { qualityGateCmd: `touch "${sentinel}"; exit 0` });
            expect(result.attempts).toBe(1);
            expect(existsSync(sentinel)).toBe(true);
            expect(readFileSync(join(dir, '.spur', 'run', `${WBS}-test-gate.log`), 'utf8')).toContain(
                'check.reuse-refused — receipt belongs to 1998, not 1999',
            );
            expect(storedReceipt(dir).wbs).toBe(WBS);
        } finally {
            cleanup();
        }
    });

    test('a capture that cannot run refuses reuse, runs the gate, and writes no receipt', () => {
        const { dir, cleanup } = gitRepo();
        const sentinel = join(dir, '.spur', 'run', 'gate-ran');
        const noTree = (): GitTreeCapture => ({ ok: false, error: 'not a git repository' });
        try {
            writeFullPassReceipt(dir);
            const result = gate(
                'run',
                dir,
                { qualityGateCmd: `touch "${sentinel}"; exit 0` },
                {
                    captureGitTree: noTree,
                },
            );
            expect(result.status).toBe('PASS');
            expect(existsSync(sentinel)).toBe(true);
            expect(result.receiptFile).toBeUndefined();
            const log = readFileSync(join(dir, '.spur', 'run', `${WBS}-test-gate.log`), 'utf8');
            expect(log).toContain('check.reuse-refused — git tree capture failed: not a git repository');
            expect(log).toContain('check-receipt: not written — git tree capture failed (not a git repository)');
        } finally {
            cleanup();
        }
    });

    test('status mode reports reuse only against the tree it computed itself', () => {
        const { dir, cleanup } = gitRepo();
        try {
            writeFullPassReceipt(dir);
            const lines: string[] = [];
            const originalWrite = process.stdout.write;
            process.stdout.write = (chunk: unknown): boolean => {
                lines.push(String(chunk));
                return true;
            };
            try {
                expect(qualityGateMain(['status'], { wbs: WBS }, { cwd: dir })).toBe(0);
                writeFileSync(join(dir, 'src/app.ts'), 'export const one = 4;\n');
                expect(qualityGateMain(['status'], { wbs: WBS }, { cwd: dir })).toBe(0);
            } finally {
                process.stdout.write = originalWrite;
            }
            const verdicts = lines
                .join('')
                .trimEnd()
                .split('\n')
                .filter((line) => line.startsWith('{"reuse"'));
            expect(verdicts).toEqual(['{"reuse":true,"reason":"ok"}', '{"reuse":false,"reason":"stale"}']);
        } finally {
            cleanup();
        }
    });
});

describe('light tier receipt identity', () => {
    test('a light receipt is keyed by the same tree the full tier computes', () => {
        const { dir, cleanup } = gitRepo();
        try {
            const originalWrite = process.stdout.write;
            process.stdout.write = () => true;
            try {
                // A clean tree has no changed scope: the light tier plans zero checks, so the
                // receipt is written from the capture alone (no project command runs).
                runLightGate({ wbs: WBS }, { cwd: dir });
            } finally {
                process.stdout.write = originalWrite;
            }
            const receipt = storedReceipt(dir);
            expect(receipt.tier).toBe('light');
            expect(receipt.inputDigest).toBe(treeOf(dir));
            // A light receipt is never full-tier evidence.
            expect(readReceiptStatus(receiptPath(dir), treeOf(dir), WBS)).toEqual({
                reuse: false,
                reason: 'light-only',
            });
        } finally {
            cleanup();
        }
    });
});

describe('the gate no longer reads a caller-supplied digest', () => {
    test('an env proofDigest of another value has no effect on reuse', () => {
        const { dir, cleanup } = gitRepo();
        const sentinel = join(dir, '.spur', 'run', 'gate-ran');
        try {
            gate('run', dir);
            const before = readFileSync(receiptPath(dir), 'utf8');
            // A stale caller value (the retired `proofDigest` env) must not refuse reuse…
            const reused = gate('run', dir, {
                proofDigest: 'legacy-digest',
                qualityGateCmd: `touch "${sentinel}"; exit 0`,
            });
            expect(reused.attempts).toBe(0);
            expect(existsSync(sentinel)).toBe(false);
            // …and must not be able to fabricate one either.
            writeFileSync(join(dir, 'src/app.ts'), 'export const one = 5;\n');
            const moved = gate('run', dir, {
                proofDigest: storedReceipt(dir).inputDigest,
                qualityGateCmd: `touch "${sentinel}"; exit 0`,
            });
            expect(moved.attempts).toBe(1);
            expect(existsSync(sentinel)).toBe(true);
            expect(readFileSync(receiptPath(dir), 'utf8')).not.toBe(before);
        } finally {
            cleanup();
        }
    });
});
