import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 0824 (spec): execution pins for the registered `idea-handoff` twin. A seeded project runs
 * `idea-handoff.mjs` under bare `node`, and the twin's only behavior bridge is the committed
 * generated lib `../lib/idea-handoff.generated.mjs` — the same `runIdeaHandoffCli` the
 * monorepo branch executes (the bundle's own `import.meta.main` block is pinned off at build
 * time). These tests spawn the twin the way the workflow fallback does, mirroring the
 * bare-node twin pins of `history-anatomy-cache.test.ts` (0669).
 */

const TWIN = join(import.meta.dir, '../scripts/idea-handoff.mjs');
const GENERATED_LIB = join(import.meta.dir, '../lib/idea-handoff.generated.mjs');

test('0824: the twin fails closed without __runId/featureId — exact stderr, exit 1', () => {
    // Env stripped to PATH only: the mis-invocation guard lives in the shared
    // runIdeaHandoffCli, whose message idea-handoff-cli.test.ts pins verbatim — the twin
    // must surface the identical bytes and exit 1, never a silent skip.
    const proc = Bun.spawnSync(['node', TWIN], { env: { PATH: process.env.PATH ?? '' } });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toBe('idea-handoff: __runId and featureId env vars are required\n');
});

test('0824: a happy-path spawn runs the generated lib through the twin to exit 0', () => {
    expect(existsSync(GENERATED_LIB)).toBeTrue();
    const twinText = readFileSync(TWIN, 'utf8');
    // The computed-URL import of the generated lib is the twin's single bridge to the shared
    // implementation: no packages/ import (a seeded checkout has none) and no inline copy.
    expect(twinText).toContain('../lib/idea-handoff.generated.mjs');
    expect(twinText).not.toMatch(/packages\//);

    const cwd = mkdtempSync(join(tmpdir(), 'idea-handoff-twin-'));
    try {
        // Minimal finalization fixture: batch + creation result + order for one
        // dependency-free task. The stub spurBin serves exactly the two calls the writer
        // makes for this shape (feature refresh, task path) and exits 99 on anything else.
        // No ready-evidence sidecar, so finalization still succeeds (exit 0) and degrades
        // the recommendation to refineall — the documented no-evidence fallback.
        const runDir = join(cwd, '.spur/run');
        mkdirSync(runDir, { recursive: true });
        const taskDoc = join(cwd, 'task-doc.md');
        writeFileSync(taskDoc, '---\nfeature_id: I21\n---\n# 0801 — fixture task\n\n## Goal\n\ncovered.\n');
        writeFileSync(join(runDir, 'twin-idea-task-batch.json'), JSON.stringify([{ name: 'fixture task' }]));
        writeFileSync(join(runDir, 'twin-idea-batch-create-result.json'), JSON.stringify({ wbs: ['0801'] }));
        writeFileSync(join(runDir, 'twin-idea-task-order.json'), JSON.stringify([{ name: 'fixture task' }]));
        const stub = join(cwd, 'stub-spur');
        // The payload (task-doc) path is baked into the stub — spawned children inherit
        // process.env, not per-call env objects (same pattern as wrapup-steps.test.ts).
        writeFileSync(
            stub,
            [
                '#!/bin/sh',
                'case "$1 $2" in',
                '  "feature refresh") exit 0;;',
                `  "task path") printf '{"filePath":"${taskDoc}"}\\n'; exit 0;;`,
                'esac',
                'exit 99',
                '',
            ].join('\n'),
        );
        chmodSync(stub, 0o755);
        const proc = Bun.spawnSync(['node', TWIN], {
            cwd,
            env: { PATH: process.env.PATH ?? '', __runId: 'twin', featureId: 'I21', spurBin: stub },
        });
        expect(proc.exitCode).toBe(0);
        expect(proc.stderr.toString()).toBe('');
        expect(proc.stdout.toString()).toContain('idea-handoff: wrote');
        const report = readFileSync(join(runDir, 'twin-idea-handoff.md'), 'utf8');
        expect(report).toContain('# Idea pipeline handoff report');
        expect(report).toContain('Feature: I21');
        expect(report).toContain('/sp:dev-refineall --feature I21 --auto --depth ready');
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
