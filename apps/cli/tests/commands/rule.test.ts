/**
 * Thin-wrapper integration tests for apps/cli/src/commands/rule.ts.
 * Behavioral tests for RuleService live in packages/app/tests/services/rule-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { runRuleCommand } from '../../src/commands/rule';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';
import { createCapturedOutput, createTempProject } from '../helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

async function writeRuleFile(cwd: string): Promise<void> {
    await mkdir(`${cwd}/.spur/rules/boundary`, { recursive: true });
    await Bun.write(
        `${cwd}/.spur/rules/boundary/sample.yaml`,
        [
            'rules:',
            '  - id: sample-rule',
            '    description: Sample rule',
            '    severity: error',
            '    enabled: true',
            '    evaluator:',
            '      type: path',
            '      config:',
            '        paths:',
            '          - package.json',
        ].join('\n'),
    );
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

    test('list subcommand prints rule files grouped by source layer', async () => {
        const cwd = await createTempProject();
        await mkdir(`${cwd}/.spur/rules`, { recursive: true });
        await Bun.write(`${cwd}/.spur/rules/recommended.yaml`, 'name: recommended\nextends:\n  - boundary\n');
        await writeRuleFile(cwd);
        const output = createCapturedOutput();
        const ctx = createCliContext({ cwd, output, env: { SPUR_GLOBAL_RULES_DIR: `${cwd}/empty-global-rules` } });

        const exitCode = await runRuleCommand('list', ctx, {}, []);

        expect(exitCode).toBe(0);
        expect(output.messages.at(-1)).toContain('Sources: local');
        expect(output.messages.at(-1)).toContain('Total files: 1');
        expect(output.messages.at(-1)).toContain('  boundary/');
        expect(output.messages.at(-1)).toContain('✓ boundary/sample.yaml (1 rule) [project layer]');
    });

    test('list subcommand prints env and global source labels', async () => {
        const cwd = await createTempProject();
        const envRoot = `${cwd}/env-rules`;
        const globalRoot = `${cwd}/global-rules`;
        await writeRuleFile(envRoot);
        await mkdir(`${globalRoot}/quality`, { recursive: true });
        await Bun.write(
            `${globalRoot}/quality/global.yaml`,
            [
                'rules:',
                '  - id: global-rule',
                '    description: Global rule',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - package.json',
            ].join('\n'),
        );
        const output = createCapturedOutput();
        const ctx = createCliContext({
            cwd,
            output,
            env: { SPUR_RULES_PATH: `${envRoot}/.spur/rules`, SPUR_GLOBAL_RULES_DIR: globalRoot },
        });

        await runRuleCommand('list', ctx, {}, []);

        expect(output.messages.at(-1)).toContain('✓ boundary/sample.yaml (1 rule) [env override]');
        expect(output.messages.at(-1)).toContain('✓ quality/global.yaml (1 rule) [user layer]');
    });

    test('list subcommand prints flat uncategorized files and invalid files', async () => {
        const cwd = await createTempProject();
        await mkdir(`${cwd}/.spur/rules`, { recursive: true });
        await Bun.write(
            `${cwd}/.spur/rules/sample.yaml`,
            [
                'rules:',
                '  - id: sample-rule',
                '    description: Sample rule',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - package.json',
            ].join('\n'),
        );
        await Bun.write(`${cwd}/.spur/rules/bad.yaml`, 'not: a-rule-file\n');
        const output = createCapturedOutput();
        const ctx = createCliContext({ cwd, output, env: { SPUR_GLOBAL_RULES_DIR: `${cwd}/empty-global-rules` } });

        await runRuleCommand('list', ctx, {}, []);

        expect(output.messages.at(-1)).toContain('Total files: 2');
        expect(output.messages.at(-1)).toContain('✓ sample.yaml (1 rule) [project layer]');
        expect(output.messages.at(-1)).toContain('❌ bad.yaml (invalid:');
    });

    test('list subcommand reports empty inventory', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const ctx = createCliContext({ cwd, output, env: { SPUR_GLOBAL_RULES_DIR: `${cwd}/empty-global-rules` } });

        const exitCode = await runRuleCommand('list', ctx, {}, []);

        expect(exitCode).toBe(0);
        expect(output.messages.at(-1)).toBe('No rules found.');
    });

    test('list subcommand with --preset keeps rule-level output', async () => {
        const cwd = await createTempProject();
        await mkdir(`${cwd}/.spur/rules`, { recursive: true });
        await Bun.write(`${cwd}/.spur/rules/recommended.yaml`, 'name: recommended\nextends:\n  - boundary\n');
        await writeRuleFile(cwd);
        const output = createCapturedOutput();
        const ctx = createCliContext({ cwd, output, env: { SPUR_GLOBAL_RULES_DIR: `${cwd}/empty-global-rules` } });

        const exitCode = await runRuleCommand('list', ctx, { preset: 'recommended' }, []);

        expect(exitCode).toBe(0);
        expect(output.messages.at(-1)).toContain(
            'sample-rule\tseverity=error\tstatus=enabled\tsource=preset:recommended',
        );
    });

    test('validate subcommand returns a number', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        // validate of a preset is fast (no repository scan) and exercises resolveSource.
        const exitCode = await runRuleCommand('validate', ctx, { preset: 'recommended', json: true }, []);
        expect(typeof exitCode).toBe('number');
    });

    test('validate subcommand accepts positional file source', async () => {
        const cwd = await createTempProject();
        const file = `${cwd}/rules.yaml`;
        await Bun.write(
            file,
            [
                'rules:',
                '  - id: sample-rule',
                '    description: Sample rule',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - package.json',
            ].join('\n'),
        );
        const ctx = createCliContext({ cwd, output: nullOutput() });

        const exitCode = await runRuleCommand('validate', ctx, {}, [file]);

        expect(exitCode).toBe(0);
    });

    test('run subcommand with an invalid --fail-on throws', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        // Exercises parseFailOn's guard without triggering a full repository evaluation.
        await expect(runRuleCommand('run', ctx, { 'fail-on': 'bogus' }, [])).rejects.toThrow('Invalid --fail-on');
    });

    test('run subcommand with bare --stop-on-first defaults to error', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        // Bare flag → boolean true → should default to 'error' internally.
        // We just verify it doesn't throw and returns a number (the flag is parsed).
        const code = await runRuleCommand('run', ctx, { 'stop-on-first': true }, []);
        expect(typeof code).toBe('number');
    });

    test('run subcommand with --stop-on-first warning parses valid severity', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const code = await runRuleCommand('run', ctx, { 'stop-on-first': 'warning' }, []);
        expect(typeof code).toBe('number');
    });

    test('run subcommand with invalid --stop-on-first throws', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        await expect(runRuleCommand('run', ctx, { 'stop-on-first': 'bogus' }, [])).rejects.toThrow(
            'Invalid --stop-on-first',
        );
    });

    test('run subcommand composes --stop-on-first with --fail-on', async () => {
        const cwd = await createTempProject();
        const file = `${cwd}/rules.yaml`;
        await Bun.write(
            file,
            [
                'rules:',
                '  - id: first-warning',
                '    description: stops traversal but does not fail verdict',
                '    severity: warning',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - missing-warning.txt',
                '  - id: second-error',
                '    description: would fail if traversal continued',
                '    severity: error',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - missing-error.txt',
            ].join('\n'),
        );
        const ctx = createCliContext({ cwd, output: nullOutput() });

        const code = await runRuleCommand('run', ctx, { file, 'stop-on-first': 'warning', 'fail-on': 'error' }, []);

        expect(code).toBe(0);
    });
});
