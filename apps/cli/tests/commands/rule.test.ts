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

    test('rule run distinguishes "passed" from "nothing evaluated" in human output', async () => {
        const cwd = await createTempProject();
        const globalRoot = join(cwd, 'global-rules');
        const env = { SPUR_GLOBAL_RULES_DIR: globalRoot };
        const output = createCapturedOutput();
        // A passing rule (package.json exists) reached through a local preset + global category.
        await mkdir(join(cwd, '.spur', 'rules'), { recursive: true });
        await writeFile(join(cwd, '.spur', 'rules', 'gate.yaml'), 'name: gate\nextends:\n  - quality\n');
        await writeRuleFile(globalRoot, 'quality/exists.yaml', 'package-exists');

        // 1. Rules ran and passed.
        expect(await runRuleCommand('run', createCliContext({ cwd, output, env }), { preset: 'gate' }, [])).toBe(0);
        expect(output.messages.at(-1)).toBe('All 1 rule passed — no violations found.');

        // 2. Selected rule absent from the preset.
        await runRuleCommand('run', createCliContext({ cwd, output, env }), { preset: 'gate', rule: 'nope' }, []);
        expect(output.messages.at(-1)).toContain('rule "nope" was not found in preset "gate"');

        // 3. Preset resolves to no rule files.
        await runRuleCommand('run', createCliContext({ cwd, output, env }), { preset: 'ghost' }, []);
        expect(output.messages.at(-1)).toContain('preset "ghost" resolved to no rule files');
    });

    test('rule run --verbose streams per-rule progress to stderr', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = await writeRuleFile(cwd, 'rules.yaml', 'package-exists');

        const context = createCliContext({ cwd, output, env: { NO_COLOR: '1' } });
        const exitCode = await runRuleCommand('run', context, { file, verbose: true }, []);

        expect(exitCode).toBe(0);
        // Progress (rule id + evaluator type + outcome) goes to stderr, not stdout.
        const progress = output.errors.join('\n');
        expect(progress).toContain('Evaluating 1 rule');
        expect(progress).toContain('package-exists (path)');
        expect(progress).toContain('✓ passed');
        // stdout still carries the final human result.
        expect(output.messages.at(-1)).toContain('All 1 rule passed');
    });

    test('rule run --verbose marks failing rules with a count', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        // path rule requiring a missing file → one error finding.
        const file = join(cwd, '.spur', 'rules', 'missing.yaml');
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
            file,
            [
                'rules:',
                '  - id: needs-missing',
                '    description: requires a missing path',
                '    severity: error',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - does-not-exist.txt',
            ].join('\n'),
        );

        const exitCode = await runRuleCommand(
            'run',
            createCliContext({ cwd, output, env: { NO_COLOR: '1' } }),
            { file, 'fail-on': 'error', verbose: true },
            [],
        );

        expect(exitCode).toBe(1);
        const progress = output.errors.join('\n');
        expect(progress).toContain('✗ 1 error');
        // Finding detail is streamed inline under its rule, not in a trailing block.
        expect(progress).toContain('Required path missing');
        // stdout carries only the summary line.
        expect(output.messages.at(-1)).toBe('1 error across 1 rule.');
    });

    test('rule run --verbose reports a misconfigured rule distinctly from a violation', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        // forbidden-import with no patterns/forbidden → evaluator throws (config error).
        const file = join(cwd, '.spur', 'rules', 'bad.yaml');
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
            file,
            [
                'rules:',
                '  - id: bad-import-rule',
                '    description: misconfigured',
                '    evaluator:',
                '      type: forbidden-import',
            ].join('\n'),
        );

        await runRuleCommand(
            'run',
            createCliContext({ cwd, output, env: { NO_COLOR: '1' } }),
            { file, 'fail-on': 'error', verbose: true },
            [],
        );

        const progress = output.errors.join('\n');
        expect(progress).toContain('⚠ misconfigured');
        expect(progress).not.toContain('✗ 1 error');
        expect(output.messages.at(-1)).toContain('1 misconfigured rule');
    });

    test('rule run --verbose colorizes progress when FORCE_COLOR is set', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = await writeRuleFile(cwd, 'rules.yaml', 'package-exists');

        const context = createCliContext({ cwd, output, env: { FORCE_COLOR: '1' } });
        await runRuleCommand('run', context, { file, verbose: true }, []);

        const progress = output.errors.join('\n');
        expect(progress).toContain('\x1b[32m✓ passed\x1b[0m'); // green pass
        expect(progress).toContain('\x1b[2m'); // dim prefix/counter
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

    test('rule run resolves a local preset whose categories live in the global root', async () => {
        const cwd = await createTempProject();
        const globalRoot = join(cwd, 'global-rules');
        const output = createCapturedOutput();
        // Preset lives locally and extends a category that exists ONLY globally.
        await mkdir(join(cwd, '.spur', 'rules'), { recursive: true });
        await writeFile(
            join(cwd, '.spur', 'rules', 'recommended-post-check.yaml'),
            'name: recommended-post-check\nextends:\n  - quality\n',
        );
        await writeRuleFile(globalRoot, 'quality/coverage.yaml', 'coverage-gate');

        const context = createCliContext({ cwd, output, env: { SPUR_GLOBAL_RULES_DIR: globalRoot } });
        const exitCode = await runRuleCommand(
            'run',
            context,
            { preset: 'recommended-post-check', rule: 'coverage-gate', json: true },
            [],
        );

        expect(exitCode).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({
            preset: 'recommended-post-check',
            ruleCount: 1,
        });
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
