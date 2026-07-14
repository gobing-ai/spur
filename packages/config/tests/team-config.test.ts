import { describe, expect, test } from 'bun:test';
import {
    type AgentConfig,
    AgentConfigSchema,
    normalizeMember,
    resolveExecutor,
    spurConfigSchema,
    TeamConfigSchema,
    type TeamMemberConfig,
    TeamMemberConfigSchema,
} from '../src/index';

// ---- TeamMemberConfigSchema (R1) ----

describe('TeamMemberConfigSchema', () => {
    test('accepts a bare string shorthand', () => {
        expect(TeamMemberConfigSchema.safeParse('claude').success).toBe(true);
    });

    test('rejects an empty string shorthand', () => {
        expect(TeamMemberConfigSchema.safeParse('').success).toBe(false);
    });

    test('accepts the object form with executor + overrides', () => {
        expect(
            TeamMemberConfigSchema.safeParse({
                executor: 'omp-zai',
                purpose: 'reviewer',
                autostart: false,
            }).success,
        ).toBe(true);
    });

    test('rejects an object form missing executor', () => {
        expect(TeamMemberConfigSchema.safeParse({ purpose: 'reviewer' }).success).toBe(false);
    });
});

// ---- normalizeMember (R3 / AC1) ----

describe('normalizeMember', () => {
    test('expands a bare string to { executor } (AC1)', () => {
        expect(normalizeMember('claude')).toEqual({ executor: 'claude' });
    });

    test('returns a shallow copy of the object form (not the same reference)', () => {
        const member: TeamMemberConfig = { executor: 'omp-zai', purpose: 'reviewer' };
        const normalized = normalizeMember(member);
        expect(normalized).toEqual(member);
        expect(normalized).not.toBe(member);
    });
});

// ---- TeamConfigSchema shape (R2) ----

describe('TeamConfigSchema', () => {
    const validTeam = {
        name: 'Dev Ops 01',
        work_dir: '~/xprojects/spur-new',
        members: ['claude', { executor: 'omp-zai', purpose: 'reviewer' }, 'codex'],
    };

    test('accepts a well-formed team', () => {
        expect(TeamConfigSchema.safeParse(validTeam).success).toBe(true);
    });

    test('rejects an empty members roster (members >= 1)', () => {
        expect(TeamConfigSchema.safeParse({ ...validTeam, members: [] }).success).toBe(false);
    });

    test('rejects an empty name', () => {
        expect(TeamConfigSchema.safeParse({ ...validTeam, name: '' }).success).toBe(false);
    });

    test('rejects an empty work_dir', () => {
        expect(TeamConfigSchema.safeParse({ ...validTeam, work_dir: '' }).success).toBe(false);
    });
});

// ---- AgentConfigSchema team validation (R4 / AC1-AC3) ----

describe('AgentConfigSchema team validation', () => {
    test('AC1: parses a team with string + object members; string normalizes to { executor }', () => {
        const result = AgentConfigSchema.safeParse({
            team: {
                'devops-01': {
                    name: 'Dev Ops 01',
                    work_dir: '~/x',
                    members: ['claude', { executor: 'omp-zai', purpose: 'reviewer' }],
                },
            },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            const members = result.data.team?.['devops-01']?.members;
            expect(members?.[0]).toBe('claude');
            expect(normalizeMember(members?.[0] as TeamMemberConfig)).toEqual({ executor: 'claude' });
            expect(members?.[1]).toEqual({ executor: 'omp-zai', purpose: 'reviewer' });
        }
    });

    test('AC2: two members with the same localId → error path points at the duplicate', () => {
        const result = AgentConfigSchema.safeParse({
            team: {
                'devops-01': {
                    name: 'Dev Ops 01',
                    work_dir: '~/x',
                    members: [
                        { executor: 'claude', id: 'lead' },
                        { executor: 'codex', id: 'lead' },
                    ],
                },
            },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const dup = result.error.issues.find((i) => i.message.startsWith('Duplicate team member id'));
            expect(dup).toBeDefined();
            expect(dup?.path).toContain('team');
            expect(dup?.path).toContain('devops-01');
            expect(dup?.path).toContain('members');
        }
    });

    test('AC2: shorthand members collide on executor name', () => {
        const result = AgentConfigSchema.safeParse({
            team: {
                'devops-01': {
                    name: 'Dev Ops 01',
                    work_dir: '~/x',
                    members: ['claude', 'claude'],
                },
            },
        });
        expect(result.success).toBe(false);
    });

    test('AC3: an uppercase team key produces an invalid composed id → load error naming the part', () => {
        const result = AgentConfigSchema.safeParse({
            team: {
                Alpha: {
                    name: 'Alpha',
                    work_dir: '~/x',
                    members: ['claude'],
                },
            },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const issue = result.error.issues.find((i) => i.message.startsWith('Invalid composed agent id'));
            expect(issue).toBeDefined();
            expect(issue?.message).toContain('Alpha-claude');
            expect(issue?.message).toContain('Alpha');
            expect(issue?.message).toContain('claude');
        }
    });

    test('AC3: an over-length composed id (>64 chars) → load error', () => {
        const long = 'a'.repeat(70);
        const result = AgentConfigSchema.safeParse({
            team: {
                'devops-01': {
                    name: 'Dev Ops 01',
                    work_dir: '~/x',
                    members: [{ executor: long }],
                },
            },
        });
        expect(result.success).toBe(false);
    });

    test('a leading-digit team key is rejected (composed id must start [a-z])', () => {
        const result = AgentConfigSchema.safeParse({
            team: {
                '1team': {
                    name: '1team',
                    work_dir: '~/x',
                    members: ['claude'],
                },
            },
        });
        expect(result.success).toBe(false);
    });

    test('a valid lowercase composed id passes', () => {
        const result = AgentConfigSchema.safeParse({
            team: {
                'devops-01': {
                    name: 'Dev Ops 01',
                    work_dir: '~/x',
                    members: ['claude', { executor: 'codex', id: 'reviewer' }],
                },
            },
        });
        expect(result.success).toBe(true);
    });
});

// ---- resolveExecutor (R3 / AC5) ----

describe('resolveExecutor', () => {
    const config: AgentConfig = {
        executors: [
            { name: 'fast', agent: 'codex', model: 'gpt-5' },
            { name: 'zai', agent: 'omp', model: 'zai//glm-5.2' },
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
        const noModel: AgentConfig = { executors: [{ name: 'bare', agent: 'codex' }] };
        expect(resolveExecutor('bare', noModel)).toEqual({ agent: 'codex' });
    });

    test('handles an undefined agent config (raw fallback)', () => {
        expect(resolveExecutor('claude', undefined)).toEqual({ agent: 'claude' });
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
        expect(result.agent?.team).toBeUndefined();
        expect(result.agent?.default).toBe('codex');
        expect(result.agent?.executors?.[0]?.model).toBe('gpt-5');
    });

    test('an empty config still parses', () => {
        expect(spurConfigSchema.safeParse({}).success).toBe(true);
    });
});
