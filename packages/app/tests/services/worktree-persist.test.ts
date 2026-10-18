import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInlineRunProjectDb, runStoragePaths } from '../../src';
import { runPersistOut } from '../../src/services/worktree-persist';

/**
 * D65 1242: `persist-out` is the WT-4 worktree-landing transport and outlives the deleted inline
 * driver. It is an application operation, so it RETURNS its output — the CLI writes it — instead of
 * touching the process streams (the `no-raw-stdout-stderr` boundary rule). These tests pin that
 * contract plus the fail-closed shape a bad source tree must produce.
 */
describe('runPersistOut — the worktree-landing transport (survivor of 1242)', () => {
    const streamWrites: string[] = [];
    const captureStreams = (): (() => void) => {
        const out = process.stdout.write.bind(process.stdout);
        const err = process.stderr.write.bind(process.stderr);
        process.stdout.write = ((chunk: unknown) => {
            streamWrites.push(String(chunk));
            return true;
        }) as typeof process.stdout.write;
        process.stderr.write = ((chunk: unknown) => {
            streamWrites.push(String(chunk));
            return true;
        }) as typeof process.stderr.write;
        return () => {
            process.stdout.write = out;
            process.stderr.write = err;
        };
    };

    test('a source tree that is not a run-owning tree fails closed with a JSON line, and writes no stream', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-persist-out-'));
        const restore = captureStreams();
        try {
            streamWrites.length = 0;
            const result = await runPersistOut({ from: join(dir, 'absent'), taskFiles: [] });
            expect(result.exitCode).toBe(1);
            expect(result.stdout).toHaveLength(1);
            const payload = JSON.parse(result.stdout[0] ?? '{}') as { ok?: boolean; error?: unknown };
            expect(payload.ok).toBe(false);
            expect(typeof payload.error).toBe('string');
            // The boundary rule: the operation computes bytes, it does not write them.
            expect(streamWrites).toEqual([]);
        } finally {
            restore();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a real worktree persists into the given invoking tree and reports ok:true', async () => {
        const from = mkdtempSync(join(tmpdir(), 'spur-persist-from-'));
        const to = mkdtempSync(join(tmpdir(), 'spur-persist-to-'));
        try {
            mkdirSync(join(from, '.spur', 'run'), { recursive: true });
            const db = await openInlineRunProjectDb(from);
            try {
                await db.adapter.run(
                    `INSERT INTO runs (id, workflow_name, mode, status, agent, external_key, started_at, completed_at,
                                       metadata_json, created_at, updated_at)
                     VALUES ('r1', 'wf', 'state-machine', 'done', NULL, NULL, '2026-10-17T00:00:00Z', NULL, '{}', 1, 1)`,
                );
            } finally {
                db.close();
            }
            const recordsDir = runStoragePaths(from).recordsDir;
            mkdirSync(recordsDir, { recursive: true });
            // The 0984 R5 / 1043 R1 green-run guarantee: a run row is only transferable with its
            // two-file record present, so a fixture must seed both halves.
            writeFileSync(join(recordsDir, 'r1.md'), '# run r1\n');
            writeFileSync(join(recordsDir, 'r1.state.json'), JSON.stringify({ runId: 'r1' }));

            const result = await runPersistOut({ from, taskFiles: [], to });
            expect(result.exitCode).toBe(0);
            const payload = JSON.parse(result.stdout[0] ?? '{}') as { ok?: boolean; persisted?: number };
            expect(payload.ok).toBe(true);
            expect(payload.persisted).toBe(1);
            // Second pass over the same target: every destination already exists, so the read-back
            // and byte-identical skip paths run (idempotent re-persist).
            const again = await runPersistOut({ from, taskFiles: [], to });
            expect(again.exitCode).toBe(0);
            expect(JSON.parse(again.stdout[0] ?? '{}')).toMatchObject({ ok: true, persisted: 0 });
            // The row landed in the INVOKING tree, not the source.
            expect(runStoragePaths(to).recordsDir).toContain(to);
        } finally {
            rmSync(from, { recursive: true, force: true });
            rmSync(to, { recursive: true, force: true });
        }
    });

    test('a terminal merged task file reconciles its receiving lifecycle row, best-effort', async () => {
        const from = mkdtempSync(join(tmpdir(), 'spur-persist-recon-from-'));
        const to = mkdtempSync(join(tmpdir(), 'spur-persist-recon-to-'));
        try {
            mkdirSync(join(from, '.spur', 'run'), { recursive: true });
            const db = await openInlineRunProjectDb(from);
            try {
                await db.adapter.run(
                    `INSERT INTO runs (id, workflow_name, mode, status, agent, external_key, started_at, completed_at,
                                       metadata_json, created_at, updated_at)
                     VALUES ('r2', 'wf', 'state-machine', 'done', NULL, NULL, '2026-10-17T00:00:00Z', NULL, '{}', 1, 1)`,
                );
            } finally {
                db.close();
            }
            const recordsDir = runStoragePaths(from).recordsDir;
            mkdirSync(recordsDir, { recursive: true });
            writeFileSync(join(recordsDir, 'r2.md'), '# run r2\n');
            writeFileSync(join(recordsDir, 'r2.state.json'), JSON.stringify({ runId: 'r2' }));
            // A terminal merged task file in the receiving tree: the pass must not fail on the
            // reconcile attempt, whether it reconciles or reports a skip.
            mkdirSync(join(to, 'docs', 'tasks5'), { recursive: true });
            writeFileSync(
                join(to, 'docs', 'tasks5', '9901_probe.md'),
                ['---', 'name: probe', 'status: done', '---', '', '## probe', ''].join('\n'),
            );

            const result = await runPersistOut({ from, taskFiles: ['docs/tasks5/9901_probe.md'], to });
            expect(result.exitCode).toBe(0);
            // A NAMED task file the receiving tree cannot read fails closed: the pass will not
            // silently drop the evidence that file would have carried.
            const missingTask = await runPersistOut({ from, taskFiles: ['docs/tasks5/9902_absent.md'], to });
            expect(missingTask.exitCode).toBe(1);
            expect(missingTask.stdout.join(' ')).toContain('9902');
            // The payload file lands in the INVOKING tree, next to the rows it describes.
            expect(existsSync(join(to, '.spur', 'run', 'persist-out.json'))).toBe(true);
        } finally {
            rmSync(from, { recursive: true, force: true });
            rmSync(to, { recursive: true, force: true });
        }
    });

    test('the result shape is the CLI contract: exitCode plus collected stdout/stderr lines', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-persist-out-shape-'));
        try {
            const result = await runPersistOut({ from: join(dir, 'absent'), taskFiles: [] });
            expect(Object.keys(result).sort()).toEqual(['exitCode', 'stderr', 'stdout']);
            expect(Array.isArray(result.stdout)).toBe(true);
            expect(Array.isArray(result.stderr)).toBe(true);
            // Lines are un-terminated: the CLI's writer owns the newline.
            for (const line of [...result.stdout, ...result.stderr]) expect(line.endsWith('\n')).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
