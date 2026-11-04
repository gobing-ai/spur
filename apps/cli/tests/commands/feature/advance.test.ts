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
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    test('advance walks the forward lifecycle path to a reachable target', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Me'], { cwd, output: cOut });
        const id = createdId(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'active', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed).toEqual({
            id,
            status: 'active',
            hops: [{ from: 'backlog', to: 'active' }],
        });
    });

    test('advance prints a human trail for a successful hop', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Human'], { cwd, output: cOut });
        const id = createdId(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'active'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain(`${id}: advanced to active`);
        expect(lastMessage(output)).toContain('backlog → active');
    });

    test('advance is idempotent when the feature already has the target status', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Idempotent'], { cwd, output: cOut });
        const id = createdId(cOut);
        await main(['feature', 'update', id, 'active'], { cwd, output: createCapturedOutput() });

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'active', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(JSON.parse(lastMessage(output))).toEqual({ id, status: 'active', hops: [] });
    });

    test('advance prints human no-op when already at the target status', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Noop Human'], { cwd, output: cOut });
        const id = createdId(cOut);
        await main(['feature', 'update', id, 'active'], { cwd, output: createCapturedOutput() });

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'active'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toBe(`${id}: already at active; no advance needed`);
    });

    test('advance unknown feature exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', 'ZZZZZ', '--json'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('Feature ZZZZZ not found');
    });

    test('advance exits 1 when the target is not reachable along the forward path', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Unreachable'], { cwd, output: cOut });
        const id = createdId(cOut);
        // Reach `blocked` through the legal path (backlog → active → blocked) —
        // `--field status` is rejected so the lifecycle guard cannot be bypassed.
        await main(['feature', 'update', id, 'active'], { cwd, output: createCapturedOutput() });
        await main(['feature', 'update', id, 'blocked'], { cwd, output: createCapturedOutput() });

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'done'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain(`cannot reach 'done' from 'blocked'`);
    });

    test('advance exits 1 when a guarded hop is denied', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Guarded'], { cwd, output: cOut });
        const id = createdId(cOut);
        await main(['feature', 'update', id, 'active'], { cwd, output: createCapturedOutput() });

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'verifying'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('Lifecycle transition denied');
    });

    test('advance on a deprecated feature exits 1 with the un-deprecate hint (human)', async () => {
        // A private features folder keeps this from consuming the shared corpus's scarce
        // top-level letters (a full-suite run already exhausts A–Z).
        const root = mkdtempSync(join(tmpdir(), 'spur-advance-dep-'));
        const featuresDir = join(root, 'features');
        try {
            const cOut = createCapturedOutput();
            await main(['feature', 'create', 'Advance Deprecated', '--folder', featuresDir], {
                cwd: root,
                output: cOut,
            });
            const id = createdId(cOut);
            await main(['feature', 'update', id, 'deprecated', '--folder', featuresDir], {
                cwd: root,
                output: createCapturedOutput(),
            });

            const output = createCapturedOutput();
            const exitCode = await main(['feature', 'advance', id, '--folder', featuresDir], { cwd: root, output });
            expect(exitCode).toBe(1);
            expect(output.errors.at(-1)).toContain(`un-deprecate first: spur feature update ${id} active`);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('advance on a deprecated feature emits GUARD_DENIED under --json-envelope and makes no transition', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-advance-dep-json-'));
        const featuresDir = join(root, 'features');
        try {
            const cOut = createCapturedOutput();
            await main(['feature', 'create', 'Advance Deprecated Json', '--folder', featuresDir], {
                cwd: root,
                output: cOut,
            });
            const id = createdId(cOut);
            await main(['feature', 'update', id, 'deprecated', '--folder', featuresDir], {
                cwd: root,
                output: createCapturedOutput(),
            });

            const output = createCapturedOutput();
            const exitCode = await main(
                ['feature', 'advance', id, '--json', '--json-envelope', '--folder', featuresDir],
                {
                    cwd: root,
                    output,
                },
            );
            expect(exitCode).toBe(1);
            const envelope = JSON.parse(lastMessage(output));
            expect(envelope.error.code).toBe('GUARD_DENIED');
            expect(envelope.error.message).toContain(`${id} is deprecated`);
            // No transition: the feature is still deprecated and its History has no new line.
            const featureFile = readdirSync(featuresDir).find((f) => f.startsWith(`${id}_`));
            const after = readFileSync(join(featuresDir, featureFile ?? ''), 'utf8');
            expect(after).toContain('status: deprecated');
            expect(after).not.toContain('deprecated → done');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('advance non-existent feature throws error', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', 'Z99'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('')).toContain('Feature Z99 not found');
    });
});

describe('spur feature advance branch coverage (per-verb split)', () => {
    test('advance walks past one hop and stops at the next denied guard (backlog → verifying)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Multi Hop'], { cwd, output: cOut });
        const id = createdId(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'verifying'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('Lifecycle transition denied');
    });

    test('advance from verifying runs the done-boundary feature check and refuses on failure', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-advance-verifying-'));
        const featuresDir = join(root, 'features');
        try {
            const cOut = createCapturedOutput();
            await main(['feature', 'create', 'Advance Verifying', '--folder', featuresDir], {
                cwd: root,
                output: cOut,
            });
            const id = createdId(cOut);
            // Fixture: a bare feature placed at `verifying` lacks the sections the done boundary requires.
            const file = join(featuresDir, readdirSync(featuresDir).find((f) => f.startsWith(`${id}_`)) ?? '');
            writeFileSync(file, readFileSync(file, 'utf8').replace(/^status: backlog$/m, 'status: verifying'));

            const output = createCapturedOutput();
            const exitCode = await main(['feature', 'advance', id, '--to', 'done', '--folder', featuresDir], {
                cwd: root,
                output,
            });
            expect(exitCode).toBe(1);
            expect(output.errors.at(-1)).toContain(`Feature ${id} check failed before advance`);
            expect(readFileSync(file, 'utf8')).toMatch(/^status: verifying$/m);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
