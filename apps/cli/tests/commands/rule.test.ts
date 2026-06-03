/**
 * Thin-wrapper integration tests for apps/cli/src/commands/rule.ts.
 * Behavioral tests for RuleService live in packages/app/tests/services/rule-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { runRuleCommand } from '../../src/commands/rule';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('runRuleCommand dispatch', () => {
    test('unknown subcommand returns 1', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runRuleCommand('unknown-cmd', ctx, {}, []);
        expect(exitCode).toBe(1);
    });

    test('list subcommand returns a number', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runRuleCommand('list', ctx, {}, []);
        expect(typeof exitCode).toBe('number');
    });

    test('validate subcommand returns a number', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        // validate of a preset is fast (no repository scan) and exercises resolveSource.
        const exitCode = await runRuleCommand('validate', ctx, { preset: 'recommended', json: true }, []);
        expect(typeof exitCode).toBe('number');
    });

    test('run subcommand with an invalid --fail-on throws', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        // Exercises parseFailOn's guard without triggering a full repository evaluation.
        await expect(runRuleCommand('run', ctx, { 'fail-on': 'bogus' }, [])).rejects.toThrow('Invalid --fail-on');
    });
});
