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
    test('move --dry-run reports the old→new map without writing (--json)', async () => {
        // Build an isolated source (with a child) + a target group.
        const aOut = createCapturedOutput();
        await main(['feature', 'create', 'MV Source'], { cwd, output: aOut });
        const sourceId = createdId(aOut);
        await main(['feature', 'create', 'MV Sub', '--parent', sourceId], { cwd, output: createCapturedOutput() });
        const tOut = createCapturedOutput();
        await main(['feature', 'create', 'MV Target'], { cwd, output: tOut });
        const targetId = createdId(tOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'move', sourceId, '--parent', targetId, '--dry-run', '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.dryRun).toBe(true);
        expect(parsed.movedCount).toBeGreaterThanOrEqual(2); // source + its child
        expect(parsed.mapping[sourceId]).toMatch(new RegExp(`^${targetId}[1-9]$`));
    });

    test('move applies the cascade and prints a human summary (non-JSON)', async () => {
        const aOut = createCapturedOutput();
        await main(['feature', 'create', 'MV2 Source'], { cwd, output: aOut });
        const sourceId = createdId(aOut);
        await main(['feature', 'create', 'MV2 Sub', '--parent', sourceId], { cwd, output: createCapturedOutput() });
        const tOut = createCapturedOutput();
        await main(['feature', 'create', 'MV2 Target'], { cwd, output: tOut });
        const targetId = createdId(tOut);

        // Dry-run first (human output branch), then apply (human output branch).
        const dryOut = createCapturedOutput();
        expect(
            await main(['feature', 'move', sourceId, '--parent', targetId, '--dry-run'], { cwd, output: dryOut }),
        ).toBe(0);
        expect(dryOut.messages.join('')).toContain('Dry run');
        expect(dryOut.messages.join('')).toContain(`${sourceId} →`);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'move', sourceId, '--parent', targetId], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toMatch(/Moved \d+ feature\(s\)/);
        // The source file no longer exists under its old ID.
        const list = createCapturedOutput();
        await main(['feature', 'list', '--json'], { cwd, output: list });
        const ids = JSON.parse(lastMessage(list)).map((f: { id: string }) => f.id);
        expect(ids).not.toContain(sourceId);
    });

    test('move into own subtree exits 1', async () => {
        const aOut = createCapturedOutput();
        await main(['feature', 'create', 'MV3 Source'], { cwd, output: aOut });
        const sourceId = createdId(aOut);
        const childOut = createCapturedOutput();
        await main(['feature', 'create', 'MV3 Sub', '--parent', sourceId], { cwd, output: childOut });
        const childId = createdId(childOut);
        const exitCode = await main(['feature', 'move', sourceId, '--parent', childId], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(1);
    });
});
