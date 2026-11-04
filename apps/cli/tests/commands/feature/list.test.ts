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
    // Seed one feature: list/sync assertions need a non-empty corpus (was implicit via create tests pre-split).
    await main(['feature', 'create', 'Seed Feature'], { cwd, output: createCapturedOutput() });
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
    test('list --json returns features sorted by ID with status/priority', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'list', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(0);
        const ids = parsed.map((f: { id: string }) => f.id);
        expect([...ids]).toEqual([...ids].sort());
    });

    test('list --status validates against the feature vocabulary', async () => {
        // Seed rather than `create` so this case does not consume a top-level letter ID
        // (the suite already allocates most of A–Z).
        writeFileSync(
            join(cwd, 'docs/features/Z9_status-filter-active.md'),
            [
                '---',
                'schema_version: 1',
                'id: Z9',
                'name: "Status Filter Active"',
                'status: active',
                'priority: P2',
                '---',
                '',
                '# Z9: Status Filter Active',
                '',
            ].join('\n'),
        );

        const activeOut = createCapturedOutput();
        const activeCode = await main(['feature', 'list', '--status', 'active', '--json'], {
            cwd,
            output: activeOut,
        });
        expect(activeCode).toBe(0);
        const rows = JSON.parse(lastMessage(activeOut));
        expect(rows.length).toBeGreaterThan(0);
        for (const f of rows) {
            expect(f.status).toBe('active');
        }

        const todoOut = createCapturedOutput();
        const todoCode = await main(['feature', 'list', '--status', 'todo', '--json'], { cwd, output: todoOut });
        expect(todoCode).toBe(1);
        const combined = `${todoOut.errors.join('\n')}\n${todoOut.messages.join('\n')}`;
        expect(combined).toContain('Unknown feature status');
        expect(combined).toContain('"todo"');
        expect(todoOut.messages.join('').trim()).not.toBe('[]');
    });

    test('list --priority filters by priority', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'list', '--priority', 'P0', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        for (const f of parsed) {
            expect(f.priority).toBe('P0');
        }
    });

    test('list prints human rows (non-JSON)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'list'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.length).toBeGreaterThan(0);
    });
});
