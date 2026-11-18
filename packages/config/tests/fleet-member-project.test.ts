import { describe, expect, test } from 'bun:test';
import { AgentFleetSchema, FleetMemberSchema } from '../src';

/**
 * 1395 R1: a member names a LOCAL project instead of a card URL. The pair is the address; the
 * declaration must therefore be exactly as strict as the `a2a` form it replaces — one target, never
 * two, and a credential variable so the dispatch can authenticate.
 */
describe('1395 R1: project-addressed fleet member', () => {
    test('accepts project + member with authEnv and needs no executor', () => {
        const member = FleetMemberSchema.parse({
            id: 'tslibs',
            project: 'ts-libs',
            member: 'coder',
            authEnv: 'TSLIBS_A2A_TOKEN',
        });
        expect(member.project).toBe('ts-libs');
        expect(member.member).toBe('coder');
        expect(member.a2a).toBeUndefined();
        expect(AgentFleetSchema.parse({ members: [member] }).members[0]?.project).toBe('ts-libs');
    });

    test('project conflicts with a2a — one target, not two', () => {
        expect(() =>
            AgentFleetSchema.parse({
                members: [{ id: 'm', project: 'ts-libs', member: 'coder', a2a: './card.json', authEnv: 'T' }],
            }),
        ).toThrow(/project.*a2a|a2a.*project/);
    });

    test('project conflicts with a local executor', () => {
        expect(() =>
            AgentFleetSchema.parse({
                members: [{ id: 'm', project: 'ts-libs', member: 'coder', executor: 'codex', authEnv: 'T' }],
            }),
        ).toThrow(/project.*executor|executor.*project/);
    });

    test('project requires authEnv and a member id', () => {
        expect(() => AgentFleetSchema.parse({ members: [{ id: 'm', project: 'ts-libs', member: 'coder' }] })).toThrow(
            /authEnv/,
        );
        expect(() => AgentFleetSchema.parse({ members: [{ id: 'm', project: 'ts-libs', authEnv: 'T' }] })).toThrow(
            /member/,
        );
    });

    test('a member id alone is still not an address', () => {
        expect(() => AgentFleetSchema.parse({ members: [{ id: 'm', member: 'coder', authEnv: 'T' }] })).toThrow(
            /role.*executor.*a2a|role.*executor.*project/,
        );
    });
});
