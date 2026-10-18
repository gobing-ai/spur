/**
 * feature-lifecycle `verifying` entry, end to end (task 1246, feature D66, ADR-142).
 *
 * The nested `feature-verification` workflow is gone. What replaces it is pinned here against the
 * real CLI on throwaway project roots:
 *   R1 — entering `verifying` runs `$spurBin feature verify $featureId --no-logo` directly, so the
 *        hop opens NO `feature-verification` run row;
 *   R2 — the verb without `--run-id` opens its OWN run row (workflow `feature-lifecycle`, no
 *        external key), records the receipt against it, and finalizes it `done` once the pass
 *        completes — PASS or FAIL;
 *   R3 — a PASS receipt names `feature-lifecycle` as its verifier, so the strict done check
 *        accepts it and verifying→done is allowed.
 * A FAIL pass is a recorded outcome, not an entry failure: the feature lands in `verifying` with a
 * FAIL receipt and the done edge denies it (the refine-frozen exit contract — `spur feature verify`
 * exits 0 after any completed pass).
 *
 * The configured verification command is the literal PATH `spur self exec check-feature`, so each
 * fixture prepends a stub `spur` that decides the pass. `$spurBin` is PATH-independent
 * (`<runtime> <entry>`, resolve-spur-bin.ts), so the stub can never shadow the lifecycle's own
 * invocations — only the verification command itself.
 */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const CLI_ENTRY = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
const FEATURE_ID = 'F1';
const FIXTURE_TIMEOUT_MS = 60_000;

/** One spawned CLI invocation against a throwaway project root, with the pass stub on PATH. */
async function runCli(root: string, args: string[]): Promise<{ status: number; output: string }> {
    const env = getEnvVars();
    const proc = Bun.spawn([process.execPath, CLI_ENTRY, ...args], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...env,
            PATH: `${join(root, 'stub-bin')}:${env.PATH ?? ''}`,
            // Never read or lock the operator's global registry from a test.
            SPUR_PROJECTS_FILE: join(root, 'projects.json'),
            SPUR_SLASH_COMMANDS_FILE: join(root, 'slash_commands.json'),
            // R2 regression pin: a hop driven from inside another workflow run inherits that run's
            // `__runId`, the env fallback behind the verb's `--run-id`. The onEnter must unset it
            // and open its OWN row — binding to this id would record against a run that is not
            // this project's (here: not in its DB at all, so artifact registration fails closed).
            __runId: 'run_outerpipeline0000000000',
        },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { status: exitCode ?? -1, output: `${stdout}${stderr}` };
}

/**
 * Assert a spawned CLI call succeeded, carrying its output into the failure message.
 *
 * A bare `expect(status).toBe(0)` reports only `Expected: 0 / Received: 1` and throws the child's
 * own diagnosis away — for a transition whose onEnter spawns a second CLI, that is the whole
 * failure. Keep the reason attached.
 */
function expectCliOk(result: { status: number; output: string }): void {
    if (result.status !== 0) throw new Error(`spur exited ${result.status}:\n${result.output}`);
}

const featureBody = (): string =>
    [
        '---',
        'schema_version: 1',
        `id: "${FEATURE_ID}"`,
        'name: "Verifying entry fixture"',
        'status: active',
        'priority: P0',
        'created_at: 2026-10-17T00:00:00.000Z',
        'updated_at: 2026-10-17T00:00:00.000Z',
        '---',
        '',
        `# ${FEATURE_ID}: Verifying entry fixture`,
        '',
        '## Goal',
        '',
        'Drive the feature-lifecycle verifying entry.',
        '',
        '## Scope',
        '',
        'In: fixture',
        'Out: nothing',
        '',
        '## Acceptance Criteria',
        '',
        '- [ ] fixture item',
        '',
        '## Tasks',
        '',
        '| WBS | Task | Status |',
        '| --- | ---- | ------ |',
        '| 9001 | done task | done |',
        '',
        '## Notes',
        '',
        'Fixture.',
    ].join('\n');

const taskBody = (): string =>
    [
        '---',
        'schema_version: 1',
        'wbs: "9001"',
        'name: "Task 9001"',
        'status: done',
        `feature_id: "${FEATURE_ID}"`,
        'created_at: 2026-10-17T00:00:00.000Z',
        'updated_at: 2026-10-17T00:00:00.000Z',
        '---',
        '',
        '# 9001: Task 9001',
        '',
        '### Solution',
        '',
        'Done.',
    ].join('\n');

/** Build a throwaway project whose `spur self exec check-feature` resolves to a stub of `exit`. */
function makeProject(label: string, passExit: 0 | 1): string {
    const root = mkdtempSync(join(tmpdir(), `spur-1246-${label}-`));
    mkdirSync(join(root, 'docs', 'features'), { recursive: true });
    mkdirSync(join(root, 'docs', 'tasks'), { recursive: true });
    mkdirSync(join(root, 'stub-bin'), { recursive: true });
    // Receipts, run rows and the DB land in `.spur/`; keeping it ignored keeps the checked-input
    // digest stable across the pass (the same reason the 0872 fixture ignores it).
    writeFileSync(join(root, '.gitignore'), '.spur/\nstub-bin/\nprojects.json\nslash_commands.json\n');
    writeFileSync(join(root, 'docs', 'features', `${FEATURE_ID}_probe.md`), featureBody());
    writeFileSync(join(root, 'docs', 'tasks', '9001_done.md'), taskBody());
    const stub = join(root, 'stub-bin', 'spur');
    writeFileSync(stub, `#!/bin/sh\nexit ${passExit}\n`);
    chmodSync(stub, 0o755);
    // A silently failed fixture commit leaves the project without HEAD, which the pass's
    // git-tree digest capture then reports as an opaque `feature verify` exit 1 — fail here instead.
    const git = (args: string): void => {
        const result = Bun.spawnSync(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', ...args.split(' ')], {
            cwd: root,
        });
        if (result.exitCode !== 0) throw new Error(`fixture git ${args} failed: ${result.stderr.toString()}`);
    };
    git('init -q');
    git('add -A');
    git('commit -qm init');
    return root;
}

const featureStatus = (root: string): string =>
    /^status:\s*(\S+)/m.exec(readFileSync(join(root, 'docs', 'features', `${FEATURE_ID}_probe.md`), 'utf8'))?.[1] ?? '';

interface Receipt {
    runId: string;
    status: string;
    verifier: { name: string; layer: string; definitionDigest: string };
    verificationCmd: string;
}

const readReceipt = (root: string): Receipt =>
    JSON.parse(
        readFileSync(join(root, '.spur', 'memory', 'evidence', `${FEATURE_ID}-feature-verification.json`), 'utf8'),
    ) as Receipt;

interface RunRow {
    id: string;
    workflow_name: string | null;
    status: string;
    external_key: string | null;
}

/** Every persisted run row, read without migrating or mutating the fixture's DB. */
function runRows(root: string): RunRow[] {
    const db = new Database(join(root, '.spur', 'spur.db'), { readonly: true });
    try {
        return db.query('SELECT id, workflow_name, status, external_key FROM runs').all() as RunRow[];
    } finally {
        db.close();
    }
}

const withProject = async (label: string, passExit: 0 | 1, body: (root: string) => Promise<void>): Promise<void> => {
    const root = makeProject(label, passExit);
    try {
        await body(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
};

describe('feature-lifecycle verifying entry owns the verification pass (1246)', () => {
    test.concurrent(
        'AC1/AC2: entering verifying records a PASS receipt on its own done feature-lifecycle run',
        async () => {
            await withProject('pass', 0, async (root) => {
                const enter = await runCli(root, ['feature', 'update', FEATURE_ID, 'verifying', '--json']);
                expectCliOk(enter);
                expect(featureStatus(root)).toBe('verifying');

                // R1: the hop ran the verb directly — no nested workflow, so no such run row.
                const rows = runRows(root);
                expect(rows.filter((row) => row.workflow_name === 'feature-verification')).toEqual([]);

                const receipt = readReceipt(root);
                expect(receipt.status).toBe('PASS');
                // R3: the verifier identity is the feature-lifecycle definition.
                expect(receipt.verifier.name).toBe('feature-lifecycle');
                expect(receipt.verificationCmd).toBe('spur self exec check-feature');

                // R2: the pass opened and finalized its OWN row — `feature-lifecycle`, terminal
                // done, and no external key (the lifecycle's own `feature:F1` row is a different row).
                const passRow = rows.find((row) => row.id === receipt.runId);
                expect(passRow?.workflow_name).toBe('feature-lifecycle');
                expect(passRow?.status).toBe('done');
                expect(passRow?.external_key).toBeNull();
                expect(rows.filter((row) => row.external_key === `feature:${FEATURE_ID}`)).toHaveLength(1);

                // AC2: the PASS receipt satisfies the strict done check, so the done edge opens.
                const complete = await runCli(root, ['feature', 'update', FEATURE_ID, 'done', '--json']);
                expectCliOk(complete);
                expect(featureStatus(root)).toBe('done');
            });
        },
        FIXTURE_TIMEOUT_MS,
    );

    test.concurrent(
        'R2: a FAIL pass still completes its run row; the feature stays in verifying and done is denied',
        async () => {
            await withProject('fail', 1, async (root) => {
                // The exit contract is unchanged: a completed pass exits 0 even when it FAILs, so
                // entering verifying succeeds and the FAIL is a recorded outcome.
                const enter = await runCli(root, ['feature', 'update', FEATURE_ID, 'verifying', '--json']);
                expectCliOk(enter);
                expect(featureStatus(root)).toBe('verifying');

                const receipt = readReceipt(root);
                expect(receipt.status).toBe('FAIL');
                const passRow = runRows(root).find((row) => row.id === receipt.runId);
                expect(passRow?.workflow_name).toBe('feature-lifecycle');
                expect(passRow?.status).toBe('done');

                const complete = await runCli(root, ['feature', 'update', FEATURE_ID, 'done', '--json']);
                expect(complete.status).not.toBe(0);
                expect(complete.output).toContain('FAIL');
                expect(featureStatus(root)).toBe('verifying');
            });
        },
        FIXTURE_TIMEOUT_MS,
    );
});
