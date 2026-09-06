import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionResult, ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { ProofFingerprintActionRunner } from '../../../src/workflow/actions/proof-fingerprint';
import type { WorkflowObservabilityBus, WorkflowTripwireFiredEvent } from '../../../src/workflow/observability';

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

    // 0708 R4: proof-state invalidation emits the canonical bounded trip-wire
    // event at the proof boundary, correlated to the run/node/task.
    test('emits workflow.tripwire.fired (proof-invalidated) on expect mismatch', async () => {
        const emissions: Array<{ name: string; event: unknown }> = [];
        const bus = {
            emit(name: string, event: unknown) {
                emissions.push({ name, event });
            },
        } as unknown as WorkflowObservabilityBus;
        const wired = new ProofFingerprintActionRunner(fs, undefined, bus);

        const result = await wired.execute({ var: 'd', expect: `sha256:${'b'.repeat(64)}` }, ctx);
        expect(result.ok).toBeFalse();
        expect(emissions).toHaveLength(1);
        expect(emissions[0]?.name).toBe('workflow.tripwire.fired');
        const event = emissions[0]?.event as WorkflowTripwireFiredEvent;
        expect(event.policy.id).toBe('proof-invalidated');
        expect(event.response).toBe('fail');
        expect(event.node).toBe(ctx.stateOrNodeId);
        expect(event.observed).toContain('proof inputs changed');
        expect(event.nextDecision.length).toBeGreaterThan(0);

        // Healthy matched path must stay silent.
        const good = await wired.execute({ var: 'd' }, ctx);
        expect(good.ok).toBeTrue();
        expect(emissions).toHaveLength(1);
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

    // 0785 R1: a task with no feature is normal (empty-string stays omitted), but an explicitly
    // supplied spec that cannot be read must fail closed with a named error — a missing spec
    // can no longer silently degrade the proof to tree-only.
    test('supplied specs fail closed; empty-string stays omitted (0785 R1)', async () => {
        const missing = await runner.execute(
            { var: 'd', taskFile: 'nonexistent/task.md', featureFile: 'nonexistent/feature.md' },
            ctx,
        );
        expect(missing.ok).toBeFalse();
        expect(missing.error).toContain('taskFile does not exist');

        // Empty-string compatibility: the pipeline's no-feature case supplies ''.
        const empty = await runner.execute({ var: 'd', taskFile: '', featureFile: '' }, ctx);
        expect(empty.ok).toBeTrue();

        // Non-string option values are rejected by name before any digest.
        const badType = await runner.execute({ var: 'd', featureFile: 42 }, ctx);
        expect(badType.ok).toBeFalse();
        expect(badType.error).toContain('featureFile must be a string');
    });

    test('folds spec content into the digest, so a spec edit changes it', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'proof-fp-'));
        try {
            // The tree half needs a git repo; the spec itself is ignored there (folded explicitly).
            const { execSync } = require('node:child_process') as typeof import('node:child_process');
            const { writeFileSync } = require('node:fs') as typeof import('node:fs');
            writeFileSync(join(dir, '.gitignore'), 'task.md\n');
            execSync(
                'git init -q && git config user.email t@example.com && git config user.name t && git add -A && git commit -qm init',
                { cwd: dir },
            );
            const taskFile = join(dir, 'task.md');
            await writeFile(taskFile, '# 0001\n\n### Requirements\n- [ ] R1. original\n');
            const dirCtx: ActionRunContext = { ...ctx, workdir: dir };
            const before = await runner.execute({ var: 'd', taskFile: 'task.md' }, dirCtx);
            await writeFile(taskFile, '# 0001\n\n### Requirements\n- [ ] R1. edited\n');
            const after = await runner.execute({ var: 'd', taskFile: 'task.md' }, dirCtx);
            expect(digestFor(before, 'd')).not.toBe(digestFor(after, 'd'));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
