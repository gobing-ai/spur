import { describe, expect, test } from 'bun:test';
import {
    type AgentConfig,
    AgentConfigSchema,
    memberLocalId,
    type NormalizedTeamMember,
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

    test('accepts a role-only object form (0543 R1 — executor optional)', () => {
        expect(TeamMemberConfigSchema.safeParse({ role: 'coder' }).success).toBe(true);
        expect(TeamMemberConfigSchema.safeParse({ role: 'reviewer', purpose: 'review pass' }).success).toBe(true);
    });

    test('rejects an unknown role, naming the offending value and the accepted set (0543 R5)', () => {
        const result = TeamMemberConfigSchema.safeParse({ role: 'lead', executor: 'claude' });
        expect(result.success).toBe(false);
        if (!result.success) {
            // Union parses nest variant errors in the message tree; the surfaced
            // message is what a config-load failure prints to the operator.
            expect(result.error.message).toContain('lead');
            for (const accepted of ['scribe', 'coder', 'reviewer', 'planner']) {
                expect(result.error.message).toContain(accepted);
            }
        }
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

// ---- memberLocalId (0543 R3) ----
// `id` wins, then `executor`; a role-only member derives `<role>-<n>` where n
// is its 1-based declaration-order index among role-only members sharing the
// role (0543 Design — "derive from the role plus an index"). Purpose is
// annotation, not identity — it never enters the derivation.

describe('memberLocalId (0543 R3)', () => {
    const roster: NormalizedTeamMember[] = [
        { executor: 'claude' },
        { id: 'explicit', role: 'coder' },
        { role: 'coder' },
        { role: 'coder', purpose: 'second pass' },
        { role: 'reviewer' },
        { role: 'reviewer' },
    ];

    test('explicit id wins over executor and role', () => {
        expect(memberLocalId(roster[1] as NormalizedTeamMember, roster, 1)).toBe('explicit');
    });

    test('executor wins for an executor-declared member', () => {
        expect(memberLocalId(roster[0] as NormalizedTeamMember, roster, 0)).toBe('claude');
    });

    test('a role-only member derives <role>-<n>, n = 1-based occurrence', () => {
        expect(memberLocalId(roster[2] as NormalizedTeamMember, roster, 2)).toBe('coder-1');
        expect(memberLocalId(roster[3] as NormalizedTeamMember, roster, 3)).toBe('coder-2');
        expect(memberLocalId(roster[4] as NormalizedTeamMember, roster, 4)).toBe('reviewer-1');
        expect(memberLocalId(roster[5] as NormalizedTeamMember, roster, 5)).toBe('reviewer-2');
    });

    test('indices count only role-only members of the same role', () => {
        // The explicit-id member at index 1 does not occupy a coder index slot.
        expect(memberLocalId(roster[3] as NormalizedTeamMember, roster, 3)).toBe('coder-2');
    });

    test('purpose does not affect the derived id (annotation, not identity)', () => {
        const withPurpose: NormalizedTeamMember = { role: 'coder', purpose: 'second pass' };
        const plain: NormalizedTeamMember = { role: 'coder' };
        expect(memberLocalId(withPurpose, [plain, withPurpose], 1)).toBe('coder-2');
        expect(memberLocalId(plain, [plain, withPurpose], 1)).toBe('coder-2');
    });

    test('a member declaring neither role nor executor yields "" (R4 rejects it)', () => {
        expect(memberLocalId({ purpose: 'ghost' }, [{ purpose: 'ghost' }], 0)).toBe('');
    });

    test('0685 R4: first executor-declared occurrence keeps the bare name (byte-compatible)', () => {
        expect(memberLocalId(roster[0] as NormalizedTeamMember, roster, 0)).toBe('claude');
    });

    test('0685 R4: duplicate executors disambiguate deterministically -2, -3, …', () => {
        const dupes: NormalizedTeamMember[] = [{ executor: 'omp' }, { executor: 'omp' }, { executor: 'omp' }];
        expect(memberLocalId(dupes[0] as NormalizedTeamMember, dupes, 0)).toBe('omp');
        expect(memberLocalId(dupes[1] as NormalizedTeamMember, dupes, 1)).toBe('omp-2');
        expect(memberLocalId(dupes[2] as NormalizedTeamMember, dupes, 2)).toBe('omp-3');
    });

    test('0685 R4: suffix counting skips explicit-id and role-only members', () => {
        const mixed: NormalizedTeamMember[] = [
            { executor: 'omp' },
            { id: 'noise', executor: 'other' },
            { role: 'coder' },
            { executor: 'omp' },
        ];
        expect(memberLocalId(mixed[3] as NormalizedTeamMember, mixed, 3)).toBe('omp-2');
    });

    test('0685 R4: a suffix never collides with another executor base', () => {
        const mixed: NormalizedTeamMember[] = [{ executor: 'omp' }, { executor: 'omp' }, { executor: 'omp-2' }];
        expect(mixed.map((member, index) => memberLocalId(member, mixed, index))).toEqual(['omp', 'omp-2', 'omp-2-2']);
    });

    test('0685 R4: appending a colliding executor leaves existing ids unchanged', () => {
        const original: NormalizedTeamMember[] = [{ executor: 'omp' }, { executor: 'omp' }];
        const before = original.map((member, index) => memberLocalId(member, original, index));
        const appended = [...original, { executor: 'omp-2' }];
        expect(appended.slice(0, 2).map((member, index) => memberLocalId(member, appended, index))).toEqual(before);
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

    test('0685 R4: duplicate shorthand members no longer collide — they compose unique ids', () => {
        // R4 replaced the hard-fail for derived (executor-composed) collisions
        // with deterministic -2/-3 suffixing; the composed ids stay unique and
        // stable. Only EXPLICIT id collisions remain load errors.
        const result = AgentConfigSchema.safeParse({
            team: {
                'devops-01': {
                    name: 'Dev Ops 01',
                    work_dir: '~/x',
                    members: ['claude', 'claude'],
                },
            },
        });
        expect(result.success).toBe(true);
    });

    test('0685 R4: a duplicate suffix colliding with another executor name still composes unique ids', () => {
        const result = AgentConfigSchema.safeParse({
            team: {
                demo: {
                    name: 'Demo',
                    work_dir: '~/x',
                    members: ['omp', 'omp', 'omp-2'],
                },
            },
        });
        expect(result.success).toBe(true);
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
                    // `reviewer` is a role id — rejected since 0537 R4, so use a
                    // member id outside the role vocabulary.
                    members: ['claude', { executor: 'codex', id: 'auditor' }],
                },
            },
        });
        expect(result.success).toBe(true);
    });

    test('composed ids that collide ACROSS teams (hyphenated key overlap) → error', () => {
        // team `web-01` + member `claude`  → web-01-claude
        // team `web`    + member `01-claude` → web-01-claude  (same composed id)
        const result = AgentConfigSchema.safeParse({
            team: {
                'web-01': { name: 'A', work_dir: '~/x', members: ['claude'] },
                web: { name: 'B', work_dir: '~/x', members: [{ executor: 'codex', id: '01-claude' }] },
            },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const issue = result.error.issues.find((i) => i.message.includes('collides across teams'));
            expect(issue).toBeDefined();
            expect(issue?.message).toContain('web-01-claude');
        }
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

// ---- Selector namespace collision guard (0537 R4) ----
// `--agent` accepts role names, executor names, and spec ids in one flag; the
// guard proves the three namespaces pairwise disjoint at config load.

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

    test('rejects a team member id equal to a role name, naming both', () => {
        const result = AgentConfigSchema.safeParse({
            team: {
                alpha: {
                    name: 'Alpha',
                    work_dir: '~/x',
                    members: [{ executor: 'claude', id: 'planner' }],
                },
            },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const issue = result.error.issues.find((i) => i.message.includes('collides with the role selector'));
            expect(issue).toBeDefined();
            expect(issue?.message).toContain('planner');
        }
    });

    test('rejects a team member id equal to an executor name, naming both', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [{ name: 'codex-sol', agent: 'codex' }],
            team: {
                alpha: {
                    name: 'Alpha',
                    work_dir: '~/x',
                    members: [{ executor: 'claude', id: 'codex-sol' }],
                },
            },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const issue = result.error.issues.find((i) => i.message.includes('collides with executor name'));
            expect(issue).toBeDefined();
            expect(issue?.message).toContain('codex-sol');
        }
    });

    test('rejects a composed spec id equal to an executor name, naming both', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [{ name: 'codex-sol', agent: 'codex' }],
            team: {
                codex: {
                    name: 'Codex',
                    work_dir: '~/x',
                    members: [{ executor: 'claude', id: 'sol' }],
                },
            },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const issue = result.error.issues.find((i) => i.message.includes('collides with executor name'));
            expect(issue).toBeDefined();
            expect(issue?.message).toContain('codex-sol');
        }
    });

    test('accepts a disjoint config: roles, executors, and spec ids all distinct', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [{ name: 'codex-sol', agent: 'codex', model: 'gpt-5.6-sol', tier: 'capable-3' }],
            team: {
                alpha: {
                    name: 'Alpha',
                    work_dir: '~/x',
                    members: [{ executor: 'codex-sol' }, { executor: 'claude', id: 'lead' }],
                },
            },
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
        expect(result.agent?.team).toBeUndefined();
        expect(result.agent?.default).toBe('codex');
        expect(result.agent?.executors?.[0]?.model).toBe('gpt-5');
    });

    test('an empty config still parses', () => {
        expect(spurConfigSchema.safeParse({}).success).toBe(true);
    });
});

// ---- Role is the primary axis (0543 R4) ----
// A member must declare at least one of role or executor; the bare-string
// shorthand always carries `executor`, so only the object arm can trip R4.

describe('AgentConfigSchema role-or-executor requirement (0543 R4)', () => {
    const team = (members: unknown[]) => ({
        team: {
            alpha: {
                name: 'Alpha',
                work_dir: '~/x',
                members,
            },
        },
    });

    test('a member declaring neither role nor executor fails, naming team id, position, and the rule', () => {
        const result = AgentConfigSchema.safeParse(team([{ purpose: 'ghost' }, { executor: 'claude' }]));
        expect(result.success).toBe(false);
        if (!result.success) {
            const issue = result.error.issues.find((i) => i.message.includes('neither role nor executor'));
            expect(issue).toBeDefined();
            expect(issue?.message).toContain('alpha');
            expect(issue?.message).toContain('index 0');
            expect(issue?.message).toContain('at least one of role or executor is required');
            expect(issue?.path).toEqual(['team', 'alpha', 'members', 0]);
        }
    });

    test('a role-only member is accepted and derives a distinct composed id', () => {
        const result = AgentConfigSchema.safeParse(team([{ role: 'coder' }, { role: 'coder' }]));
        expect(result.success).toBe(true);
    });

    test('a purpose-only member is rejected even though the role field is optional', () => {
        const result = AgentConfigSchema.safeParse(team([{ purpose: 'not a role' }]));
        expect(result.success).toBe(false);
    });

    test('an unknown role fails AgentConfigSchema load naming the value and the accepted set', () => {
        const result = AgentConfigSchema.safeParse(team([{ role: 'lead', executor: 'claude' }]));
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.message).toContain('lead');
            expect(result.error.message).toContain('scribe');
            expect(result.error.message).toContain('planner');
        }
    });

    test('the bare-string shorthand still means executor and never trips R4', () => {
        const result = AgentConfigSchema.safeParse(team(['claude']));
        expect(result.success).toBe(true);
    });
});
