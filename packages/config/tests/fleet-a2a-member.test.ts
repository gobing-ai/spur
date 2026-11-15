import { describe, expect, test } from 'bun:test';
import { AgentFleetSchema, FleetMemberSchema } from '../src';

describe('1334 R1: A2A fleet member declaration', () => {
    test('an A2A member needs no local executor and keeps only the credential variable NAME', () => {
        const member = FleetMemberSchema.parse({
            id: 'remote',
            a2a: 'https://a2a.example.test',
            authEnv: 'REMOTE_TOKEN',
        });
        expect(member.a2a).toBe('https://a2a.example.test');
        expect(member.authEnv).toBe('REMOTE_TOKEN');
        expect(AgentFleetSchema.parse({ members: [member] }).members[0]?.a2a).toBe('https://a2a.example.test');
    });

    test('a2a and executor are mutually exclusive', () => {
        expect(() =>
            AgentFleetSchema.parse({ members: [{ id: 'remote', a2a: './card.json', executor: 'codex' }] }),
        ).toThrow(/a2a.*executor|executor.*a2a/);
    });

    test('a member still needs one of role, executor or a2a', () => {
        expect(() => AgentFleetSchema.parse({ members: [{ id: 'empty' }] })).toThrow(
            /role.*executor.*a2a|a2a.*role.*executor/,
        );
    });

    test('authEnv is a variable name, never a credential value or inline assignment', () => {
        for (const authEnv of ['token=value', 'Bearer abc', '1TOKEN', '']) {
            expect(() => FleetMemberSchema.parse({ a2a: './card.json', authEnv })).toThrow();
        }
    });
});
