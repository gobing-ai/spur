/**
 * wrapup-pipeline end to end (task 1249, feature D66, ADR-142) — the D66 proof for the wrap-up
 * consolidation, run against the real CLI on throwaway project roots.
 *
 * 1249 made the pipeline stop writing feature status and gate the task list once. The three
 * model-free paths through that change are pinned here, by run artifacts rather than by log text:
 *   - an empty `tasks` list terminates at `skipped` without touching the corpus;
 *   - a resolvable list under `mode: fast` reaches the terminal state with its resolve and metrics
 *     status files PASS and the gated list persisted once as `<runId>-wrapup-tasks.json`;
 *   - an unresolvable WBS fails the single gate (`terminalReason: failed-check`) instead of
 *     half-running the wrap and leaving the feature mid-transition.
 * No path asserts a feature-status write, which is the removal 1249 is: the fixture's feature stays
 * `active` across every run.
 *
 * `env -u SPUR_WORKFLOW_RUN_ACTIVE`: `spur workflow run` refuses to start inside an active run
 * (nested-run guard, 0610 R4), and these tests are themselves often driven from one.
 */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const CLI_ENTRY = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
const WORKFLOW = join(REPO_ROOT, 'config', 'workflows', 'wrapup-pipeline.yaml');
const FEATURE_ID = 'F1';
const FIXTURE_TIMEOUT_MS = 120_000;

interface RunResult {
    status: number;
    output: string;
}

/** One spawned CLI invocation against a throwaway project root, outside any active workflow run. */
async function runCli(root: string, args: string[]): Promise<RunResult> {
    const env = { ...getEnvVars() };
    // The guard reads presence, not value, so the key has to be absent rather than empty.
    delete env.SPUR_WORKFLOW_RUN_ACTIVE;
    delete env.__runId;
    const proc = Bun.spawn([process.execPath, CLI_ENTRY, ...args], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...env,
            // Never read or lock the operator's global registry from a test.
            SPUR_PROJECTS_FILE: join(root, 'projects.json'),
            SPUR_SLASH_COMMANDS_FILE: join(root, 'slash_commands.json'),
        },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { status: exitCode ?? -1, output: `${stdout}${stderr}` };
}

/** Run the bundled wrap-up definition with the given vars, returning its run row and artifacts. */
async function runWrapup(root: string, vars: Record<string, unknown>): Promise<RunResult> {
    return runCli(root, [
        'workflow',
        'run',
        WORKFLOW,
        '--vars',
        JSON.stringify({ spurBin: `${process.execPath} ${CLI_ENTRY}`, ...vars }),
        '--no-logo',
        '--json',
    ]);
}

const featureBody = (): string =>
    [
        '---',
        'schema_version: 1',
        `id: "${FEATURE_ID}"`,
        'name: "Wrapup fixture"',
        'status: active',
        'priority: P0',
        'created_at: 2026-10-18T00:00:00.000Z',
        'updated_at: 2026-10-18T00:00:00.000Z',
        '---',
        '',
        `# ${FEATURE_ID}: Wrapup fixture`,
        '',
        '## Goal',
        '',
        'Drive the wrap-up pipeline.',
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
        'created_at: 2026-10-18T00:00:00.000Z',
        'updated_at: 2026-10-18T00:00:00.000Z',
        '---',
        '',
        '# 9001: Task 9001',
        '',
        '### Solution',
        '',
        'Done.',
    ].join('\n');

function makeProject(label: string): string {
    const root = mkdtempSync(join(tmpdir(), `spur-1249-${label}-`));
    mkdirSync(join(root, 'docs', 'features'), { recursive: true });
    mkdirSync(join(root, 'docs', 'tasks'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), '.spur/\nprojects.json\nslash_commands.json\n');
    writeFileSync(join(root, 'docs', 'features', `${FEATURE_ID}_probe.md`), featureBody());
    writeFileSync(join(root, 'docs', 'tasks', '9001_done.md'), taskBody());
    // A silently failed fixture commit leaves the project without HEAD, which the wrap's git-facing
    // steps then report as an opaque exit 1 — fail here instead, where the cause is visible.
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

interface RunRow {
    id: string;
    workflow_name: string | null;
    status: string;
    current_state: string | null;
}

/**
 * Every persisted run row with its FSM cursor, read without migrating or mutating the fixture's DB.
 * The cursor lives in `workflow_states` (an append-only snapshot per transition — the last row
 * is the terminal state), not on the run row.
 */
function runRows(root: string): RunRow[] {
    const db = new Database(join(root, '.spur', 'spur.db'), { readonly: true });
    try {
        return db
            .query(
                'SELECT r.id, r.workflow_name, r.status, ' +
                    '(SELECT ws.state FROM workflow_states ws WHERE ws.run_id = r.id ORDER BY ws.rowid DESC LIMIT 1) AS current_state ' +
                    'FROM runs r',
            )
            .all() as RunRow[];
    } finally {
        db.close();
    }
}

/** The single wrap-up run row this fixture produced. */
function wrapupRow(root: string): RunRow {
    const rows = runRows(root).filter((row) => row.workflow_name === 'wrapup-pipeline');
    expect(rows, 'exactly one wrapup-pipeline run row').toHaveLength(1);
    return rows[0] as RunRow;
}

const runArtifact = (root: string, runId: string, name: string): string | null => {
    const path = join(root, '.spur', 'run', `${runId}-${name}`);
    return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
};

const featureStatus = (root: string): string =>
    /^status:\s*(\S+)/m.exec(readFileSync(join(root, 'docs', 'features', `${FEATURE_ID}_probe.md`), 'utf8'))?.[1] ?? '';

const withProject = async (label: string, body: (root: string) => Promise<void>): Promise<void> => {
    const root = makeProject(label);
    try {
        await body(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
};

describe('wrapup-pipeline end to end (1249)', () => {
    test.concurrent(
        'an empty task list terminates at skipped without touching the corpus',
        async () => {
            await withProject('empty', async (root) => {
                const result = await runWrapup(root, { tasks: '[]' });
                expect(result.status, result.output).toBe(0);

                const row = wrapupRow(root);
                expect(row.status).toBe('done');
                expect(row.current_state).toBe('skipped');
                // The removal 1249 is: no feature transition on any path.
                expect(featureStatus(root)).toBe('active');
            });
        },
        FIXTURE_TIMEOUT_MS,
    );

    test.concurrent(
        'a resolvable list reaches the terminal state with its gate persisted once',
        async () => {
            await withProject('fast', async (root) => {
                const result = await runWrapup(root, { tasks: '["9001"]', mode: 'fast' });
                expect(result.status, result.output).toBe(0);

                const row = wrapupRow(root);
                expect(row.status).toBe('done');
                // The single gate ran and passed; the list it resolved is persisted exactly once.
                expect(runArtifact(root, row.id, 'wrapup-resolve.status')).toBe('PASS');
                expect(runArtifact(root, row.id, 'wrapup-metrics.status')).toBe('PASS');
                expect(JSON.parse(runArtifact(root, row.id, 'wrapup-tasks.json') ?? 'null')).toEqual(['9001']);
                expect(featureStatus(root)).toBe('active');
            });
        },
        FIXTURE_TIMEOUT_MS,
    );

    test.concurrent(
        'an unresolvable WBS fails the one gate instead of half-running the wrap',
        async () => {
            await withProject('unresolvable', async (root) => {
                const result = await runWrapup(root, { tasks: '["abc"]' });
                expect(result.status).not.toBe(0);

                const row = wrapupRow(root);
                expect(row.status).toBe('failed');
                expect(row.current_state).toBe('failed');
                expect(runArtifact(root, row.id, 'wrapup-resolve.status')).toBe('FAIL');
                // Failing the gate must not leave the feature mid-transition — 1249's whole point.
                expect(featureStatus(root)).toBe('active');
            });
        },
        FIXTURE_TIMEOUT_MS,
    );
});
