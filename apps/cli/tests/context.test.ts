import { describe, expect, test } from 'bun:test';
import { createCliContext } from '../src/context';
import type { CommandOutput } from '../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('context', () => {
    test('createCliContext returns CliContext with required fields', () => {
        const ctx = createCliContext({ output: nullOutput() });
        expect(ctx.cwd).toBeString();
        expect(ctx.env).toBeObject();
        expect(ctx.fs).toBeDefined();
        expect(ctx.output).toBeDefined();
        expect(typeof ctx.getDb).toBe('function');
    });

    test('hitlResponder under --json never prompts interactively (returns the configured default)', async () => {
        // With json=true the selection must yield the non-interactive default regardless of TTY,
        // so a confirm resolves to the default without reading stdin (no hang, no JSON corruption).
        const ctx = createCliContext({ output: nullOutput() });
        const responder = ctx.hitlResponder(true);
        const answer = await responder.respond({ kind: 'confirm', prompt: 'x', runId: 'r', node: 'n' });
        expect(answer.value).toBe('yes'); // DefaultHitlResponder's confirm default
    });
});
