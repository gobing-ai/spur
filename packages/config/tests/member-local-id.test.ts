import { describe, expect, test } from 'bun:test';
import {
    type AgentConfig,
    AgentConfigSchema,
    type MemberIdentity,
    memberLocalId,
    resolveExecutor,
    spurConfigSchema,
} from '../src/index';

// ---- memberLocalId (0543 R3) ----
// `id` wins, then `executor`; a role-only member derives `<role>-<n>` where n
// is its 1-based declaration-order index among role-only members sharing the
// role (0543 Design — "derive from the role plus an index"). Purpose is
// annotation, not identity — it never enters the derivation.
//
// 0857: the input is `MemberIdentity` (the project fleet declaration's fields);
// the derivation itself is frozen — these cases pin it byte-for-byte.

describe('memberLocalId (0543 R3)', () => {
    const roster: MemberIdentity[] = [
        { executor: 'claude' },
        { id: 'explicit', role: 'coder' },
        { role: 'coder' },
        { role: 'coder' },
        { role: 'reviewer' },
        { role: 'reviewer' },
    ];

    test('explicit id wins over executor and role', () => {
        expect(memberLocalId(roster[1] as MemberIdentity, roster, 1)).toBe('explicit');
    });

    test('executor wins for an executor-declared member', () => {
        expect(memberLocalId(roster[0] as MemberIdentity, roster, 0)).toBe('claude');
    });

    test('a role-only member derives <role>-<n>, n = 1-based occurrence', () => {
        expect(memberLocalId(roster[2] as MemberIdentity, roster, 2)).toBe('coder-1');
        expect(memberLocalId(roster[3] as MemberIdentity, roster, 3)).toBe('coder-2');
        expect(memberLocalId(roster[4] as MemberIdentity, roster, 4)).toBe('reviewer-1');
        expect(memberLocalId(roster[5] as MemberIdentity, roster, 5)).toBe('reviewer-2');
    });

    test('indices count only role-only members of the same role', () => {
        // The explicit-id member at index 1 does not occupy a coder index slot.
        expect(memberLocalId(roster[3] as MemberIdentity, roster, 3)).toBe('coder-2');
    });

    test('a member declaring neither role nor executor yields "" (validation rejects it)', () => {
        expect(memberLocalId({}, [{}], 0)).toBe('');
    });

    test('0685 R4: first executor-declared occurrence keeps the bare name (byte-compatible)', () => {
        expect(memberLocalId(roster[0] as MemberIdentity, roster, 0)).toBe('claude');
    });

    test('0685 R4: duplicate executors disambiguate deterministically -2, -3, …', () => {
        const dupes: MemberIdentity[] = [{ executor: 'omp' }, { executor: 'omp' }, { executor: 'omp' }];
        expect(memberLocalId(dupes[0] as MemberIdentity, dupes, 0)).toBe('omp');
        expect(memberLocalId(dupes[1] as MemberIdentity, dupes, 1)).toBe('omp-2');
        expect(memberLocalId(dupes[2] as MemberIdentity, dupes, 2)).toBe('omp-3');
    });

    test('0685 R4: suffix counting skips explicit-id and role-only members', () => {
        const mixed: MemberIdentity[] = [
            { executor: 'omp' },
            { id: 'noise', executor: 'other' },
            { role: 'coder' },
            { executor: 'omp' },
        ];
        expect(memberLocalId(mixed[3] as MemberIdentity, mixed, 3)).toBe('omp-2');
    });

    test('0685 R4: a suffix never collides with another executor base', () => {
        const mixed: MemberIdentity[] = [{ executor: 'omp' }, { executor: 'omp' }, { executor: 'omp-2' }];
        expect(mixed.map((member, index) => memberLocalId(member, mixed, index))).toEqual(['omp', 'omp-2', 'omp-2-2']);
    });

    test('0685 R4: appending a colliding executor leaves existing ids unchanged', () => {
        const original: MemberIdentity[] = [{ executor: 'omp' }, { executor: 'omp' }];
        const before = original.map((member, index) => memberLocalId(member, original, index));
        const appended = [...original, { executor: 'omp-2' }];
        expect(appended.slice(0, 2).map((member, index) => memberLocalId(member, appended, index))).toEqual(before);
    });
});

// ---- resolveExecutor (R3 / AC5) ----

describe('resolveExecutor', () => {
    const config: AgentConfig = {
        executors: [
            { name: 'fast', agent: 'codex', model: 'gpt-5', disabled: false },
            { name: 'zai', agent: 'omp', model: 'zai//glm-5.2', disabled: false },
        ],
    };
    const isCanonical = (n: string) => ['claude', 'codex', 'omp'].includes(n);

    test('AC5: returns the executor entry when the name matches', () => {
        expect(resolveExecutor('fast', config)).toEqual({ agent: 'codex', model: 'gpt-5' });
    });

    test('AC5: falls back to { agent } for a raw canonical agent type', () => {
        expect(resolveExecutor('claude', config)).toEqual({ agent: 'claude' });
    });

    test('AC5: an unknown-and-non-agent ref errors when the predicate is provided', () => {
        expect(() => resolveExecutor('nope', config, { isCanonicalAgent: isCanonical })).toThrow(
            /Unknown executor or agent reference/,
        );
    });

    test('without a predicate, an unknown name falls back to { agent } (caller validates)', () => {
        expect(resolveExecutor('nope', config)).toEqual({ agent: 'nope' });
    });

    test('returns { agent } with no model when the executor has no model', () => {
        const noModel: AgentConfig = { executors: [{ name: 'bare', agent: 'codex', disabled: false }] };
        expect(resolveExecutor('bare', noModel)).toEqual({ agent: 'codex' });
    });

    test('handles an undefined agent config (raw fallback)', () => {
        expect(resolveExecutor('claude', undefined)).toEqual({ agent: 'claude' });
    });
});

// ---- Selector namespace collision guard (0537 R4) ----
// `--agent` accepts role names, executor names, and spec ids in one flag; the
// guard proves the namespaces pairwise disjoint at config load. The spec-id half
// (team member ids) retired with `agent.team` (0857) — the fleet declaration's
// instance ids derive from `memberLocalId` and are checked at materialization.

describe('AgentConfigSchema selector namespace collision guard (0537 R4)', () => {
    test('rejects an executor named after a role, naming both', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [{ name: 'coder', agent: 'codex' }],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const issue = result.error.issues.find((i) => i.message.includes('collides with the role selector'));
            expect(issue).toBeDefined();
            expect(issue?.message).toContain('coder');
            expect(issue?.path).toContain('executors');
        }
    });

    test('accepts a disjoint executor set', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [{ name: 'codex-sol', agent: 'codex', model: 'gpt-5.6-sol', tier: 'capable-3' }],
        });
        expect(result.success).toBe(true);
    });
});

// ---- Backward-compat (R7 / AC6) ----

describe('backward-compat (no agent.team)', () => {
    test('AC6: a config with no team block parses unchanged; executors untouched', () => {
        const withoutTeam = {
            version: '1',
            name: 'x',
            agent: {
                default: 'codex',
                executors: [{ name: 'fast', agent: 'codex', model: 'gpt-5' }],
            },
        };
        const result = spurConfigSchema.parse(withoutTeam);
        expect(result.agent?.default).toBe('codex');
        expect(result.agent?.executors?.[0]?.model).toBe('gpt-5');
    });

    test('0857: a leftover agent.team block is not part of the agent schema (the loader guard rejects it first)', () => {
        // Zod strips unknown keys; the loud failure lives in the loader guard, so
        // this asserts only that no team-shaped surface remains on the parsed type.
        const result = spurConfigSchema.safeParse({ agent: { team: { name: 'x' } } });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.agent).not.toHaveProperty('team');
        }
    });

    test('an empty config still parses', () => {
        expect(spurConfigSchema.safeParse({}).success).toBe(true);
    });
});
