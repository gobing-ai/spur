import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runRuleCommand } from '../../src/commands/rule';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';
import { createCapturedOutput, createTempProject } from '../helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('rule command', () => {
    test('unknown subcommand returns error', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runRuleCommand('unknown-cmd', ctx, {}, ['.']);
        expect(exitCode).toBe(1);
    });

    test('rule run with preset works', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runRuleCommand('run', ctx, { preset: 'recommended' }, ['.']);
        // May pass or fail depending on findings, but should not throw
        expect(typeof exitCode).toBe('number');
    });

    test('rule run supports file input and json output', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = await writeRuleFile(cwd, 'rules.yaml', 'sample-rule');

        const exitCode = await runRuleCommand('run', createCliContext({ cwd, output }), { file, json: true }, []);

        expect(exitCode).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({ preset: 'recommended', ruleCount: 1 });
    });

    test('rule validate validates a rule file without evaluating it', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = await writeRuleFile(cwd, 'rules.yaml', 'sample-rule');

        const exitCode = await runRuleCommand('validate', createCliContext({ cwd, output }), { json: true }, [file]);

        expect(exitCode).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({
            valid: true,
            ruleCount: 1,
            rules: ['sample-rule'],
        });
    });

    test('rule validate validates presets with human output', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await writeRuleFile(cwd, '.spur/rules/boundary/sample.yaml', 'boundary-sample');
        await writeFile(join(cwd, '.spur', 'rules', 'recommended.yaml'), 'name: recommended\nextends:\n  - boundary\n');

        const exitCode = await runRuleCommand(
            'validate',
            createCliContext({ cwd, output }),
            { preset: 'recommended' },
            [],
        );

        expect(exitCode).toBe(0);
        expect(output.messages.at(-1)).toContain('valid preset: recommended');
        expect(output.messages.at(-1)).toContain('boundary-sample');
    });

    test('rule list lists discovered local rules', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await writeRuleFile(cwd, '.spur/rules/boundary/sample.yaml', 'boundary-sample');
        await writeFile(join(cwd, '.spur', 'rules', 'recommended.yaml'), 'name: recommended\nextends:\n  - boundary\n');

        const exitCode = await runRuleCommand('list', createCliContext({ cwd, output }), { json: true }, []);

        expect(exitCode).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({
            ruleCount: 1,
            rules: [{ id: 'boundary-sample', file: 'boundary/sample.yaml', severity: 'error', enabled: true }],
        });
    });

    test('rule list supports empty and preset human output', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const context = createCliContext({ cwd, output });

        expect(await runRuleCommand('list', context, {}, [])).toBe(0);
        expect(output.messages.at(-1)).toBe('No rules found.');

        await writeRuleFile(cwd, '.spur/rules/boundary/sample.yaml', 'boundary-sample');
        await writeFile(join(cwd, '.spur', 'rules', 'recommended.yaml'), 'name: recommended\nextends:\n  - boundary\n');

        expect(await runRuleCommand('list', context, { preset: 'recommended' }, [])).toBe(0);
        expect(output.messages.at(-1)).toContain('boundary-sample');
        expect(output.messages.at(-1)).toContain('preset:recommended');
    });
});

async function writeRuleFile(cwd: string, relativePath: string, ruleId: string): Promise<string> {
    const file = join(cwd, relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
        file,
        [
            'rules:',
            `  - id: ${ruleId}`,
            '    description: Sample rule',
            '    evaluator:',
            '      type: path',
            '      config:',
            '        paths:',
            '          - package.json',
        ].join('\n'),
    );
    return file;
}
