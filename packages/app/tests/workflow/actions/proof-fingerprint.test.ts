import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionResult, ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { ProofFingerprintActionRunner } from '../../../src/workflow/actions/proof-fingerprint';

const fs = createNodeFileSystem();
const runner = new ProofFingerprintActionRunner(fs);
const ctx: ActionRunContext = {
    runId: 'proof-fingerprint-test',
    stateOrNodeId: 'test-node',
    vars: {},
    env: {},
    workdir: process.cwd(),
};

/** Narrow a declared `setVars` value to a string, failing loudly if the action did not set it. */
function digestFor(result: ActionResult, name: string): string {
    const value = result.setVars?.[name];
    if (typeof value !== 'string') throw new Error(`expected setVars["${name}"] to be a string`);
    return value;
}

/** Narrow the optional `data.matched` flag without asserting an unchecked shape. */
function matchedFlag(result: ActionResult): boolean | undefined {
    const value = result.data?.matched;
    return typeof value === 'boolean' ? value : undefined;
}

describe('proof.fingerprint action', () => {
    test('declares the built-in kind', () => {
        expect(runner.kind).toBe('proof.fingerprint');
    });

    test('captures the digest into the declared var', async () => {
        const result = await runner.execute({ var: 'proofDigest' }, ctx);
        expect(result.ok).toBeTrue();
        expect(digestFor(result, 'proofDigest')).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    test('is deterministic across calls on an unchanged tree', async () => {
        const a = await runner.execute({ var: 'd' }, ctx);
        const b = await runner.execute({ var: 'd' }, ctx);
        expect(digestFor(a, 'd')).toBe(digestFor(b, 'd'));
    });

    // The whole point of the wiring: a digest computed and never compared enforces nothing.
    test('fails naming BOTH digests when expect does not match', async () => {
        const result = await runner.execute({ var: 'd', expect: `sha256:${'a'.repeat(64)}` }, ctx);
        expect(result.ok).toBeFalse();
        expect(result.error).toContain('proof inputs changed after the verdict was established');
        expect(result.error).toContain('a'.repeat(64)); // the expected value
        expect(matchedFlag(result)).toBeFalse();
    });

    test('passes when expect matches the current digest', async () => {
        const first = await runner.execute({ var: 'd' }, ctx);
        const digest = digestFor(first, 'd');
        const second = await runner.execute({ var: 'd', expect: digest }, ctx);
        expect(second.ok).toBeTrue();
        expect(matchedFlag(second)).toBeTrue();
    });

    test('treats an absent or blank expect as capture-only', async () => {
        for (const expectValue of [undefined, '', '   ']) {
            const options: Record<string, unknown> = { var: 'd' };
            if (expectValue !== undefined) options.expect = expectValue;
            const result = await runner.execute(options, ctx);
            expect(result.ok).toBeTrue();
            expect(matchedFlag(result)).toBeUndefined();
        }
    });

    test('rejects a missing or malformed var name rather than guessing one', async () => {
        expect((await runner.execute({}, ctx)).ok).toBeFalse();
        expect((await runner.execute({ var: '' }, ctx)).ok).toBeFalse();
        const bad = await runner.execute({ var: '1nope' }, ctx);
        expect(bad.ok).toBeFalse();
        expect(bad.error).toContain('var name must match');
    });

    // A task with no feature is normal, and a missing spec must not manufacture a proof violation.
    test('skips unreadable task/feature specs instead of failing', async () => {
        const result = await runner.execute(
            { var: 'd', taskFile: '/nonexistent/task.md', featureFile: '/nonexistent/feature.md' },
            ctx,
        );
        expect(result.ok).toBeTrue();
    });

    test('folds spec content into the digest, so a spec edit changes it', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'proof-fp-'));
        try {
            const taskFile = join(dir, 'task.md');
            await writeFile(taskFile, '# 0001\n\n### Requirements\n- [ ] R1. original\n');
            const before = await runner.execute({ var: 'd', taskFile }, ctx);
            await writeFile(taskFile, '# 0001\n\n### Requirements\n- [ ] R1. edited\n');
            const after = await runner.execute({ var: 'd', taskFile }, ctx);
            expect(digestFor(before, 'd')).not.toBe(digestFor(after, 'd'));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
