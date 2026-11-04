/**
 * Thin-wrapper integration tests for apps/cli/src/commands/feature.ts.
 * Behavioral tests for FeatureService live in
 * packages/app/tests/services/feature-service.test.ts.
 *
 * These exercise the `spur feature` verb surface through the real `main()`
 * entry point: golden paths, the `--json` envelope, status/priority filters,
 * and exit codes 0/1/2 (design §7.2, §10).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    // Throwaway root outside the repo tree: a nested `.git/` inside the checkout is both dirt in
    // `git status` when cleanup is skipped and unwritable under a sandboxed run.
    cwd = mkdtempSync(join(tmpdir(), 'spur-feature-test-'));
    await mkdir(join(cwd, 'docs', 'features'), { recursive: true });
    // Real repos ignore `.spur/` — keeps recorded receipts out of the digest tree.
    writeFileSync(join(cwd, '.gitignore'), '.spur/\n');
    // Fixture commits HEAD first so `git read-tree HEAD` resolves for tree-digest paths.
    const init = Bun.spawnSync(
        [
            'sh',
            '-c',
            'git init -q && git config user.email t@t && git config user.name t && git add -A && git commit -q -m init',
        ],
        { cwd },
    );
    if (init.exitCode !== 0) throw new Error(`fixture git init failed: ${init.stderr.toString()}`);
}, 20000);

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

describe('spur feature CLI', () => {
    test('refresh regenerates INDEX.md and reports tasksUpdated (--json)', async () => {
        await main(['feature', 'create', 'Refreshable Group'], { cwd, output: createCapturedOutput() });
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'refresh', '--all', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.index_path).toMatch(/INDEX\.md$/);
        expect(typeof parsed.tasksUpdated).toBe('number');
        // INDEX.md exists with the tree header.
        const index = await Bun.file(`${cwd}/docs/features/INDEX.md`).text();
        expect(index).toContain('# Feature Index');
    });

    test('refresh prints a human summary (non-JSON)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'refresh', '--all'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain('INDEX.md regenerated');
    });

    test('bare refresh refuses to sweep without --feature/--all (R5a, 0625)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'refresh'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.join('')).toContain('--feature <id> or --all is required');
    });

    test('refresh rejects ambiguous --feature plus --all breadth (R5a, 0625)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'refresh', '--feature', 'A', '--all'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.join('')).toContain('--feature <id> and --all are mutually exclusive');
    });
});
