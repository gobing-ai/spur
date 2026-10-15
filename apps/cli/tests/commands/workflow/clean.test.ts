/**
 * Thin-wrapper integration tests for `spur workflow clean` (apps/cli/src/commands/workflow/clean.ts).
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _resetAgentServiceShimsForTest } from '@gobing-ai/spur-app';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { main } from '../../../src/index';
import { createCapturedOutput, createTempProject } from '../../helpers';

/** `fs/promises.exists` is Bun-only and absent from the @types/node shipped with @types/bun 1.4.x. */
const exists = (path: string): Promise<boolean> =>
    access(path).then(
        () => true,
        () => false,
    );

// Warn-once shim markers (bare-binary, legacy executor) are process-global; bun
// batches test files per worker process — never inherit another file's state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

describe('workflow command (main)', () => {
    // 0948 R6: an EXISTING but empty legacy `.log` used to fall into the same branch as an
    // absent record, so the operator was told to look for a `--no-log` flag that was never
    // passed. The empty case must name the real condition.

    test('clean subcommand reports no stale runs on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs older than 30m.');
        // Dual-scope housekeeping: the log-reclamation scope also ran.
        expect(output.messages).toContain('No retained run logs older than 30d.');
    });
    test('clean --dry-run works on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--dry-run'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs older than 30m.');
    });
    test('clean --json works on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--json'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        expect(parsed).toHaveProperty('cleaned');
        expect(Array.isArray(parsed.cleaned)).toBe(true);
        // Dual-scope JSON: log reclamation rides along under `logs`.
        expect(parsed.logs).toHaveProperty('reclaimed');
        expect(Array.isArray(parsed.logs.reclaimed)).toBe(true);
    });
    test('clean preserves expired logs and returns failure when evidence migration fails', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const oldLog = join(runDir, 'wf_old.log');
        await writeFile(oldLog, 'keep until migration succeeds');
        const oldMtime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        await utimes(oldLog, oldMtime, oldMtime);
        const evDir = join(cwd, '.spur', 'memory', 'evidence');
        await mkdir(evDir, { recursive: true });
        await writeFile(join(evDir, '1025-verdict.json'), 'invalid durable json');
        await writeFile(join(runDir, '1025-verdict.json'), '{"wbs":"1025","verdict":"PASS"}');

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--json'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
        const result = JSON.parse(output.messages[0] ?? '{}');
        expect(result.migration.failures).toHaveLength(1);
        expect(result.migration.failures[0].remedy).toBe('repair the durable file by hand');
        expect(result.logs.reclaimed).toEqual([]);
        expect(await exists(oldLog)).toBe(true);

        // Log-only housekeeping must not inspect or migrate unrelated evidence.
        const logsOutput = createCapturedOutput();
        expect(
            await main(['workflow', 'clean', '--logs', '--json'], {
                output: logsOutput,
                cwd,
                dbUrl: ':memory:',
            }),
        ).toBe(0);
        expect(JSON.parse(logsOutput.messages[0] ?? '{}').migration.failures).toEqual([]);
        expect(await exists(oldLog)).toBe(false);
    });
    test('clean finalizes stale runs when evidence migration fails but skips log/checkpoint reclamation (F5/AC1/AC2)', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: dbPath });
        const oldTime = Date.now() - 3600 * 1000;
        await db.run(
            'INSERT INTO runs (id, status, started_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            ['stale-run-f5', 'running', oldTime, '{}', oldTime, oldTime],
        );
        db.close();

        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const evDir = join(cwd, '.spur', 'memory', 'evidence');
        await mkdir(evDir, { recursive: true });
        await writeFile(join(evDir, '1025-verdict.json'), 'invalid durable json');
        await writeFile(join(runDir, '1025-verdict.json'), '{"wbs":"1025","verdict":"PASS"}');

        // Human output test
        const outputHuman = createCapturedOutput();
        const exitHuman = await main(['workflow', 'clean'], { output: outputHuman, cwd, dbUrl: dbPath });
        expect(exitHuman).toBe(1);
        expect(
            outputHuman.errors.some(
                (e) => e.includes('Migration failed') && e.includes('repair the durable file by hand'),
            ),
        ).toBe(true);
        expect(
            outputHuman.messages.some((m) => m.includes('Finalized 1 stale run(s)') && m.includes('stale-run-f5')),
        ).toBe(true);

        // JSON output test
        const outputJson = createCapturedOutput();
        const exitJson = await main(['workflow', 'clean', '--json'], { output: outputJson, cwd, dbUrl: dbPath });
        expect(exitJson).toBe(1);
        const result = JSON.parse(outputJson.messages[0] ?? '{}');
        expect(result.migration.failures).toHaveLength(1);
        expect(result.migration.failures[0].remedy).toBe('repair the durable file by hand');
        expect(result.cleaned).toHaveLength(0); // already finalized on previous run
        expect(result.logs.reclaimed).toEqual([]);
        expect(result.checkpoints.reclaimed).toEqual([]);
        expect(result.scratch.reclaimed).toEqual([]);

        await rm(cwd, { recursive: true, force: true });
    });
    test('clean reclaims expired .spur/run scratch; --logs leaves scratch alone', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(join(runDir, 'old-scratch'), { recursive: true });
        const oldFile = join(runDir, 'old-scratch', 'note.txt');
        await writeFile(oldFile, 'x');
        const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
        await utimes(oldFile, old, old);

        const logsOutput = createCapturedOutput();
        expect(
            await main(['workflow', 'clean', '--logs', '--json'], { output: logsOutput, cwd, dbUrl: ':memory:' }),
        ).toBe(0);
        expect(JSON.parse(logsOutput.messages[0] ?? '{}').scratch).toBeUndefined();
        expect(await exists(oldFile)).toBe(true);

        const output = createCapturedOutput();
        expect(await main(['workflow', 'clean', '--json'], { output, cwd, dbUrl: ':memory:' })).toBe(0);
        const result = JSON.parse(output.messages[0] ?? '{}');
        expect(result.scratch.reclaimed.map((e: { name: string }) => e.name)).toEqual(['old-scratch']);
        expect(await exists(join(runDir, 'old-scratch'))).toBe(false);
        await rm(cwd, { recursive: true, force: true });
    });
    test('clean rejects invalid --older-than', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--older-than', 'abc'], {
            output,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('Invalid --older-than'))).toBe(true);
    });
    test('clean --logs scopes to log reclamation and skips stale-run finalization', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const oldLog = join(runDir, 'wf_old.log');
        const freshLog = join(runDir, 'wf_fresh.log');
        const oldMd = join(runDir, 'wf_old.md');
        const oldState = join(runDir, 'wf_old.state.json');
        await writeFile(oldLog, 'old');
        await writeFile(freshLog, 'fresh');
        await writeFile(oldMd, 'old record');
        await writeFile(oldState, '{"status":"done"}');
        const oldMtime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        await utimes(oldLog, oldMtime, oldMtime);
        await utimes(oldMd, oldMtime, oldMtime);
        await utimes(oldState, oldMtime, oldMtime);

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--logs'], { output, cwd, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        // Only the log scope ran — no stale-run line at all.
        expect(output.messages.some((m) => m.includes('stale run'))).toBe(false);
        expect(output.messages.some((m) => m.includes('Reclaimed 1 retained run log(s) (>30d):'))).toBe(true);
        expect(await exists(oldLog)).toBe(false);
        expect(await exists(freshLog)).toBe(true);
        // 0925 AC3: the pair is out of cleanup scope until a retention policy exists.
        expect(await exists(oldMd)).toBe(true);
        expect(await exists(oldState)).toBe(true);
    });
    test('clean --logs --dry-run lists old logs without deleting', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const oldLog = join(runDir, 'wf_old.log');
        const oldMd = join(runDir, 'wf_old.md');
        const oldState = join(runDir, 'wf_old.state.json');
        await writeFile(oldLog, 'old');
        await writeFile(oldMd, 'old record');
        await writeFile(oldState, '{"status":"done"}');
        const oldMtime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        await utimes(oldLog, oldMtime, oldMtime);
        await utimes(oldMd, oldMtime, oldMtime);
        await utimes(oldState, oldMtime, oldMtime);

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--logs', '--dry-run'], {
            output,
            cwd,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('Would reclaim 1 retained run log(s) (>30d):'))).toBe(true);
        expect(await exists(oldLog)).toBe(true); // dry-run unlinked nothing
        // 0925 AC3: only the eligible .log is reported — the pair stays out.
        expect(await exists(oldMd)).toBe(true);
        expect(await exists(oldState)).toBe(true);
    });
    test('clean without --logs runs both scopes in one invocation', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const oldLog = join(runDir, 'wf_old.log');
        await writeFile(oldLog, 'old');
        const oldMtime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        await utimes(oldLog, oldMtime, oldMtime);

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean'], { output, cwd, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs older than 30m.'); // stale scope ran
        expect(output.messages.some((m) => m.includes('Reclaimed 1 retained run log(s) (>30d):'))).toBe(true); // log scope ran
        expect(await exists(oldLog)).toBe(false);
    });
    test('clean honors workflows.logRetentionDays from .spur/config.yaml', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const log = join(runDir, 'wf_mid.log');
        await writeFile(log, 'mid');
        // 10 days old: within the default 30d, past a 7d override.
        const mtime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        await utimes(log, mtime, mtime);
        await writeFile(join(cwd, '.spur', 'config.yaml'), 'workflows:\n  logRetentionDays: 7\n');

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--logs'], { output, cwd, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('Reclaimed 1 retained run log(s) (>7d):'))).toBe(true);
        expect(await exists(log)).toBe(false);
    });
    test('clean --force reports no stale runs on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--force'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        // --force sets minutes=0, so the message has no age qualifier
        expect(output.messages).toContain('No stale runs.');
    });
    test('clean --force --dry-run works on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--force', '--dry-run'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs.');
    });
    test('clean --force --json works on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--force', '--json'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        expect(parsed).toHaveProperty('cleaned');
        expect(parsed.olderThanMinutes).toBe(0);
    });
    test('clean --force overrides --older-than', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        // --force overrides --older-than: minutes=0 regardless
        const exitCode = await main(['workflow', 'clean', '--force', '--older-than', '999'], {
            output,
            cwd,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        // Uses --force message (no age qualifier), not "older than 999m"
        expect(output.messages).toContain('No stale runs.');
    });
    test('clean finalizes stale non-terminal runs and lists them in human output', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: dbPath });
        const now = Date.now();
        // Insert a non-terminal run that listStaleRuns will match.
        await db.run(
            'INSERT INTO runs (id, status, started_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            ['stale-run-1', 'running', now, '{}', now, now],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean'], { output, cwd, dbUrl: dbPath });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('Finalized 1 stale run(s)'))).toBe(true);
        expect(output.messages.some((m) => m.includes('stale-run-1'))).toBe(true);
        await rm(cwd, { recursive: true, force: true });
    });
});
