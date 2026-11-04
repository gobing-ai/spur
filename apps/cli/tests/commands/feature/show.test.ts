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
    test('show --json returns the feature with content', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Showable'], { cwd, output: cOut });
        const id = createdId(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'show', id, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.id).toBe(id);
        expect(parsed.content).toContain('## Goal');
    });

    test('show unknown ID exits 1', async () => {
        const exitCode = await main(['feature', 'show', 'ZZZZZ'], { cwd, output: createCapturedOutput() });
        expect(exitCode).toBe(1);
    });

    test('show alias `get` routes to the show handler (0534 R1)', async () => {
        // No create here: the suite runs at the A-Z top-level letter ceiling, so an
        // extra feature would exhaust allocation and break later move tests. Routing
        // is proven by the error contract matching `feature show` (the alias cannot
        // have its own handler).
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'get', 'ZZZZZ'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('not found');
    });

    test('show prints content (non-JSON)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Human Show'], { cwd, output: cOut });
        const id = createdId(cOut);
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'show', id], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('## Goal');
    });

    test('show non-existent feature returns error exit code', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'show', 'Z99'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('')).toContain('Feature Z99 not found');
    });
});
