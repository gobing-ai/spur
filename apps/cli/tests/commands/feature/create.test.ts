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

/** The feature ID from the `feature create` confirmation line. */
function createdId(output: CapturedOutput): string {
    const msg = output.messages.find((m) => m.startsWith('Created feature'));
    if (msg === undefined) throw new Error(`no "Created feature" line in: ${output.messages.join(' | ')}`);
    const id = msg.replace('Created feature ', '').split(':')[0]?.trim();
    if (!id) throw new Error(`could not parse id from: ${msg}`);
    return id;
}

describe('spur feature CLI', () => {
    test('create allocates a top-level letter ID and exits 0', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'First Feature'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(createdId(output)).toMatch(/^[A-Z]$/);
    });

    test('create --json returns the write-result envelope', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'JSON Feature', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.kind).toBe('feature');
        expect(parsed.ref.id).toMatch(/^[A-Z][1-9]*$/);
        expect(parsed.eventName).toBe('feature.created');
    });

    test('create --parent allocates a child digit', async () => {
        const pOut = createCapturedOutput();
        await main(['feature', 'create', 'Parent For Child'], { cwd, output: pOut });
        const parentId = createdId(pOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'A Child', '--parent', parentId], { cwd, output });
        expect(exitCode).toBe(0);
        expect(createdId(output)).toMatch(new RegExp(`^${parentId}[1-9]$`));
    });

    test('create prints a human confirmation line (non-JSON)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'Human Output'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toMatch(/^Created feature [A-Z][1-9]*: /);
    });
});
