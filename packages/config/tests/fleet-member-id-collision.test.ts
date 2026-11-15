import { describe, expect, test } from 'bun:test';
import { AgentConfigSchema } from '../src/index';

/**
 * 1333 R1 (ADR-148): `--agent <member>` resolves a fleet member id BEFORE role,
 * executor and reserved-selector names, so an id claiming one of those namespaces
 * silently shadows it. Reject at config load, naming both sides.
 */
function parseIssue(memberId: string, extra: string[] = []) {
    const result = AgentConfigSchema.safeParse({
        ...(extra.length > 0 ? { executors: [{ name: 'codex-fast', agent: 'codex' }] } : {}),
        fleet: { members: [{ id: memberId, executor: 'codex' }] },
    });
    return result.success ? null : (result.error.issues[0]?.message ?? null);
}

describe('fleet member id namespace (1333 R1)', () => {
    test('an id equal to a role name is allowed — the member rung wins, design §3.1', () => {
        expect(parseIssue('coder')).toBeNull();
    });

    test('an id colliding with a DIFFERENT configured executor names both', () => {
        const message = parseIssue('codex-fast', ['executors']);
        expect(message).toContain('Fleet member id "codex-fast"');
        expect(message).toContain('executor');
    });

    test('an id naming the executor it runs is allowed (same target either way)', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [{ name: 'writer', agent: 'codex' }],
            fleet: { members: [{ id: 'writer', executor: 'writer' }] },
        });
        expect(result.success).toBe(true);
    });

    test('an id colliding with a reserved --agent selector is rejected', () => {
        expect(parseIssue('auto')).toContain('reserved --agent selector');
        expect(parseIssue('inline')).toContain('reserved --agent selector');
    });

    test('a non-colliding member id parses', () => {
        expect(parseIssue('coder-2')).toBeNull();
    });
});
