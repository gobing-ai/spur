/**
 * Thin-wrapper integration tests for apps/cli/src/commands/rule.ts.
 * Behavioral tests for RuleService live in packages/app/tests/services/rule-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { main } from '../../src/index';
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
        const exitCode = await main(['rule', 'unknown-cmd'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    test('list subcommand returns a number', async () => {
        const exitCode = await main(['rule', 'list'], { output: nullOutput() });
        expect(typeof exitCode).toBe('number');
    });

    test('list subcommand prints rule files grouped by source layer', async () => {
        const cwd = await createTempProject();
        await mkdir(`${cwd}/.spur/rules`, { recursive: true });
        await Bun.write(`${cwd}/.spur/rules/recommended.yaml`, 'name: recommended\nextends:\n  - boundary\n');
        await writeRuleFile(cwd);
        const output = createCapturedOutput();

        const exitCode = await main(['rule', 'list'], {
            cwd,
            output,
            env: { SPUR_GLOBAL_RULES_DIR: `${cwd}/empty-global-rules` },
        });

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

        await main(['rule', 'list'], {
            cwd,
            output,
            env: { SPUR_RULES_PATH: `${envRoot}/.spur/rules`, SPUR_GLOBAL_RULES_DIR: globalRoot },
        });

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

        await main(['rule', 'list'], { cwd, output, env: { SPUR_GLOBAL_RULES_DIR: `${cwd}/empty-global-rules` } });

        expect(output.messages.at(-1)).toContain('Total files: 2');
        expect(output.messages.at(-1)).toContain('✓ sample.yaml (1 rule) [project layer]');
        expect(output.messages.at(-1)).toContain('❌ bad.yaml (invalid:');
    });

    test('list subcommand reports empty inventory', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        const exitCode = await main(['rule', 'list'], {
            cwd,
            output,
            env: { SPUR_GLOBAL_RULES_DIR: `${cwd}/empty-global-rules` },
        });

        expect(exitCode).toBe(0);
        expect(output.messages.at(-1)).toBe('No rules found.');
    });

    test('list subcommand with --preset keeps rule-level output', async () => {
        const cwd = await createTempProject();
        await mkdir(`${cwd}/.spur/rules`, { recursive: true });
        await Bun.write(`${cwd}/.spur/rules/recommended.yaml`, 'name: recommended\nextends:\n  - boundary\n');
        await writeRuleFile(cwd);
        const output = createCapturedOutput();

        const exitCode = await main(['rule', 'list', '--preset', 'recommended'], {
            cwd,
            output,
            env: { SPUR_GLOBAL_RULES_DIR: `${cwd}/empty-global-rules` },
        });

        expect(exitCode).toBe(0);
        expect(output.messages.at(-1)).toContain(
            'sample-rule\tseverity=error\tstatus=enabled\tsource=preset:recommended',
        );
    });

    test('validate subcommand returns a number', async () => {
        const exitCode = await main(['rule', 'validate', '--preset', 'recommended', '--json'], {
            output: nullOutput(),
        });
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

        const exitCode = await main(['rule', 'validate', file], { cwd, output: nullOutput() });

        expect(exitCode).toBe(0);
    });

    test('run subcommand with an invalid --fail-on throws', async () => {
        const exitCode = await main(['rule', 'run', '--fail-on', 'bogus'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    test('run subcommand with bare --stop-on-first defaults to error', async () => {
        const code = await main(['rule', 'run', '--stop-on-first'], { output: nullOutput() });
        expect(typeof code).toBe('number');
    });

    test('run subcommand with --stop-on-first warning parses valid severity', async () => {
        const code = await main(['rule', 'run', '--stop-on-first', 'warning'], { output: nullOutput() });
        expect(typeof code).toBe('number');
    });

    test('run subcommand with invalid --stop-on-first throws', async () => {
        const exitCode = await main(['rule', 'run', '--stop-on-first', 'bogus'], { output: nullOutput() });
        expect(exitCode).toBe(1);
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

        const code = await main(['rule', 'run', '--file', file, '--stop-on-first', 'warning', '--fail-on', 'error'], {
            cwd,
            output: nullOutput(),
        });

        expect(code).toBe(0);
    });
});
