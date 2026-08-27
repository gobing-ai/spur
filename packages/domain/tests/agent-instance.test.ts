import { describe, expect, test } from 'bun:test';

import { AGENT_INSTANCES_DDL_DRAFT, specRole } from '../src/index';

/**
 * 0685 R2: specRole is the structural Layer-1 role accessor the domain can
 * offer without importing @gobing-ai/ts-ai-runner — its null-folding behavior
 * is what byRole filtering and --role vocabulary rely on.
 */
describe('specRole', () => {
    test('returns the configured role when it is a non-empty string', () => {
        expect(specRole({ config: { role: 'reviewer' } })).toBe('reviewer');
    });

    test('folds every non-role shape to null', () => {
        expect(specRole({ config: {} })).toBeNull();
        expect(specRole({ config: { role: '' } })).toBeNull();
        expect(specRole({ config: { role: 42 } })).toBeNull();
        expect(specRole(null)).toBeNull();
        expect(specRole(undefined)).toBeNull();
    });

    test('exposes the reserved (unregistered) migration id', () => {
        expect(AGENT_INSTANCES_DDL_DRAFT).toBe('0026_spur_cli_agent_instances');
    });
});
