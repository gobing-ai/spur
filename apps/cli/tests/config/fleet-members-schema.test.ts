import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateJsonSchema } from '@gobing-ai/ts-runtime';

// The loader checks the merged config against this hand-written schema as well as Zod, so a member
// shape Zod accepts but the schema lacks fails every command (1395's `project:` peer did exactly that).
const SCHEMA_PATH = join(import.meta.dir, '../../schemas/spur-config.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Parameters<typeof validateJsonSchema>[1];

const withMembers = (members: unknown): Record<string, unknown> => ({ agent: { fleet: { enabled: false, members } } });

describe('agent.fleet.members JSON Schema admits the Zod member shapes (1395 R1)', () => {
    test('accepts a project-addressed outbound peer', () => {
        const violations = validateJsonSchema(
            withMembers([
                { role: 'coder', executor: 'claude' },
                { id: 'tslibs-coder', project: 'ts-libs', member: 'coder-1', authEnv: 'TSLIBS_A2A_TOKEN' },
            ]),
            schema,
        );
        expect(violations).toEqual([]);
    });

    test('rejects a project peer without the target member id', () => {
        expect(validateJsonSchema(withMembers([{ id: 'x', project: 'ts-libs' }]), schema).length).toBeGreaterThan(0);
    });

    test('rejects a project peer without authEnv', () => {
        const violations = validateJsonSchema(
            withMembers([{ id: 'x', project: 'ts-libs', member: 'coder-1' }]),
            schema,
        );
        expect(violations.length).toBeGreaterThan(0);
    });

    // project/a2a/executor exclusions are `not` clauses: IDE-only, since this validator ignores `not`.
    // Zod enforces them at load (packages/config FleetMemberEntrySchema).

    test('still rejects a member with no role, executor, a2a or project', () => {
        expect(validateJsonSchema(withMembers([{ id: 'nothing' }]), schema).length).toBeGreaterThan(0);
    });
});
