import { describe, expect, test } from 'bun:test';
import {
    AgentConfigSchema,
    ExecutorDisabledError,
    legacyMemberLocalId,
    normalizeExecutorAvailability,
    tasksConfigSchema,
} from '../src/index';

/**
 * Coverage for the member-identity and availability branches 1333 leans on: the frozen
 * legacy id derivation (the migration check's only reader), the disabled-executor error and
 * the absent-availability shape, plus the `tasks.severity` unknown-code rejection.
 */
describe('legacyMemberLocalId (frozen pre-1075 order)', () => {
    test('an explicit id wins; otherwise executor outranks role in the FROZEN order', () => {
        expect(legacyMemberLocalId({ id: 'pinned' }, [{ id: 'pinned' }], 0)).toBe('pinned');
        const roster = [{ role: 'coder' as const, executor: 'writer' }, { role: 'coder' as const }];
        expect(legacyMemberLocalId(roster[0] as never, roster as never, 0)).toBe('writer');
        expect(legacyMemberLocalId(roster[1] as never, roster as never, 1)).toBe('coder-1');
    });

    test('repeated executors and roles get a positional suffix', () => {
        const roster = [{ executor: 'writer' }, { executor: 'writer' }, { role: 'reviewer' as const }];
        expect(legacyMemberLocalId(roster[1] as never, roster as never, 1)).toBe('writer-2');
        expect(legacyMemberLocalId(roster[2] as never, roster as never, 2)).toBe('reviewer-1');
    });

    test('a member with neither id, executor nor role derives an empty id', () => {
        expect(legacyMemberLocalId({}, [{}], 0)).toBe('');
    });
});

describe('executor availability and disabled error', () => {
    test('absent `disabled` means enabled with no owner', () => {
        expect(normalizeExecutorAvailability(undefined).disabled).toBe(false);
        expect(normalizeExecutorAvailability(null as never).disabled).toBe(false);
    });

    test('the disabled error names the profile and the enabling fix', () => {
        const error = new ExecutorDisabledError('codex-fast');
        expect(error.name).toBe('ExecutorDisabledError');
        expect(error.message).toContain('agent.executors.codex-fast.disabled');
    });
});

test('an unknown tasks.severity finding code is rejected, naming the code', () => {
    expect(AgentConfigSchema.safeParse({}).success).toBe(true);
    const severity = tasksConfigSchema.safeParse({ severity: { 'not-a-code': 'warning' } });
    expect(severity.success).toBe(false);
    expect(severity.error?.issues[0]?.message).toContain('Unknown finding code "not-a-code"');
});
