import { describe, expect, test } from 'bun:test';
import { resolveAgentRoles } from '../../src/services/agent-roles';

describe('resolveAgentRoles', () => {
    // ---- Layer-1 role resolution (task 0572): code defaults + agent.roles merge ----

    test('resolveAgentRoles without config returns DEFAULT_AGENT_ROLES wholesale (0572 R1)', () => {
        const roles = resolveAgentRoles();
        expect([...roles.keys()].sort()).toEqual(['coder', 'planner', 'reviewer', 'scribe']);
        expect(roles.get('scribe')).toEqual({ tier: 'cheap', stages: ['changelog'] });
        expect(roles.get('reviewer')).toEqual({ tier: 'capable-1', stages: ['verify', 'review', 'dogfood'] });
    });

    test('resolveAgentRoles merges agent.roles per-field: override wins, omitted fields keep defaults (0572 R2)', () => {
        const roles = resolveAgentRoles({
            roles: { reviewer: { tier: 'capable-2' }, coder: { stages: ['implement'] } },
        });
        // Re-tier without restating stages → stages stay default, tier overridden.
        expect(roles.get('reviewer')).toEqual({ tier: 'capable-2', stages: ['verify', 'review', 'dogfood'] });
        // Re-stage without restating tier → tier stays default, stages overridden.
        expect(roles.get('coder')).toEqual({ tier: 'standard', stages: ['implement'] });
        // A role absent from the override map uses the default wholesale.
        expect(roles.get('scribe')).toEqual({ tier: 'cheap', stages: ['changelog'] });
        expect(roles.get('planner')).toEqual({ tier: 'capable-2', stages: ['plan', 'refine', 'brainstorm'] });
    });

    test('resolveAgentRoles rejects an unknown override stage id, naming role and id (0572 R10)', () => {
        expect(() => resolveAgentRoles({ roles: { coder: { stages: ['implment'] } } })).toThrow(
            /agent\.roles\.coder\.stages.*implment/,
        );
    });

    test('resolveAgentRoles rejects an empty override stages array from a non-schema caller (0572 R10)', () => {
        expect(() => resolveAgentRoles({ roles: { reviewer: { stages: [] } } })).toThrow(
            /agent\.roles\.reviewer\.stages.*empty stages array/,
        );
    });

    test('resolveAgentRoles rejects a re-tier below the folded-stage floor (roles R4 / 0572 R10)', () => {
        // coder folds implement (min_tier standard) — cheap would start the run below the floor.
        expect(() => resolveAgentRoles({ roles: { coder: { tier: 'cheap' } } })).toThrow(
            /agent\.roles\.coder.*'cheap'.*implement/,
        );
    });

    test('resolveAgentRoles rejects a re-stage that raises the floor above the kept default tier (0572 R10)', () => {
        // scribe keeps tier cheap; folding verify/review (min_tier capable-1) breaks the floor.
        expect(() => resolveAgentRoles({ roles: { scribe: { stages: ['verify', 'review'] } } })).toThrow(
            /agent\.roles\.scribe.*'cheap'/,
        );
    });
});
