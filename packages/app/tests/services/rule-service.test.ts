import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type ConstraintRule, RuleEngine, type RuleEngineResult } from '@gobing-ai/ts-rule-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { Colorize, RuleServiceContext, RuleServiceOutput } from '../../src/services/rule-service';
import { RuleService } from '../../src/services/rule-service';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface CapturedOutput extends RuleServiceOutput {
    messages: string[];
    errors: string[];
}

function createCapturedOutput(): CapturedOutput {
    return {
        messages: [],
        errors: [],
        write(message: string): void {
            this.messages.push(message);
        },
        error(message: string): void {
            this.errors.push(message);
        },
    };
}

function nullOutput(): RuleServiceOutput {
    return { write: () => {}, error: () => {} };
}

async function createTempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-app-'));
    await Bun.write(join(dir, 'package.json'), `${JSON.stringify({ name: 'fixture', type: 'module' }, null, 2)}\n`);
    return dir;
}

function makeContext(
    cwd: string,
    output: RuleServiceOutput,
    env: Record<string, string | undefined> = {},
): RuleServiceContext {
    return { cwd, env, fs: createNodeFileSystem(), output };
}

function noColor(): Colorize {
    const id = (text: string) => text;
    return { enabled: false, dim: id, red: id, green: id, yellow: id, cyan: id };
}

function forceColor(): Colorize {
    const wrap = (open: string) => (text: string) => `${open}${text}\x1b[0m`;
    return {
        enabled: true,
        dim: wrap('\x1b[2m'),
        red: wrap('\x1b[31m'),
        green: wrap('\x1b[32m'),
        yellow: wrap('\x1b[33m'),
        cyan: wrap('\x1b[36m'),
    };
}

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

// ---------------------------------------------------------------------------
// evaluate()
// ---------------------------------------------------------------------------

describe('RuleService.evaluate()', () => {
    test('preset run works', async () => {
        const cwd = await createTempProject();
        const service = new RuleService(makeContext(cwd, nullOutput()));
        const result = await service.evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            json: false,
            verbose: false,
            color: noColor(),
        });
        expect(typeof result.exitCode).toBe('number');
    });

    test('file input with json output returns ruleCount=1', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = await writeRuleFile(cwd, 'rules.yaml', 'sample-rule');

        const result = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            file,
            json: true,
            verbose: false,
            color: noColor(),
        });

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({
            preset: 'recommended-pre-check',
            ruleCount: 1,
        });
    });

    test('distinguishes "passed" from "nothing evaluated" in human output', async () => {
        const cwd = await createTempProject();
        const globalRoot = join(cwd, 'global-rules');
        const env = { SPUR_GLOBAL_RULES_DIR: globalRoot };
        const output = createCapturedOutput();

        await mkdir(join(cwd, '.spur', 'rules'), { recursive: true });
        await writeFile(join(cwd, '.spur', 'rules', 'gate.yaml'), 'name: gate\nextends:\n  - quality\n');
        await writeRuleFile(globalRoot, 'quality/exists.yaml', 'package-exists');

        // 1. Rules ran and passed.
        const r1 = await new RuleService(makeContext(cwd, output, env)).evaluate({
            preset: 'gate',
            failOn: 'error',
            json: false,
            verbose: false,
            color: noColor(),
        });
        expect(r1.exitCode).toBe(0);
        expect(output.messages.at(-1)).toBe('All 1 rule passed — no violations found.');

        // 2. Selected rule absent from the preset.
        await new RuleService(makeContext(cwd, output, env)).evaluate({
            preset: 'gate',
            failOn: 'error',
            rule: 'nope',
            json: false,
            verbose: false,
            color: noColor(),
        });
        expect(output.messages.at(-1)).toContain('rule "nope" was not found in preset "gate"');

        // 3. Preset resolves to no rule files.
        await new RuleService(makeContext(cwd, output, env)).evaluate({
            preset: 'ghost',
            failOn: 'error',
            json: false,
            verbose: false,
            color: noColor(),
        });
        expect(output.messages.at(-1)).toContain('preset "ghost" resolved to no rule files');
    });

    test('verbose streams per-rule progress to stderr', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = await writeRuleFile(cwd, 'rules.yaml', 'package-exists');

        const result = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            file,
            json: false,
            verbose: true,
            color: noColor(),
        });

        expect(result.exitCode).toBe(0);
        const progress = output.errors.join('\n');
        expect(progress).toContain('Evaluating 1 rule');
        expect(progress).toContain('package-exists (path)');
        expect(progress).toContain('✓ passed');
        expect(output.messages.at(-1)).toContain('All 1 rule passed');
    });

    test('verbose marks failing rules with a count', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
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

        const result = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            file,
            json: false,
            verbose: true,
            color: noColor(),
        });

        expect(result.exitCode).toBe(1);
        const progress = output.errors.join('\n');
        expect(progress).toContain('✗ 1 error');
        expect(progress).toContain('Required path missing');
        expect(output.messages.at(-1)).toBe('1 error across 1 rule.');
    });

    test('verbose reports a misconfigured rule distinctly from a violation', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
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

        await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            file,
            json: false,
            verbose: true,
            color: noColor(),
        });

        const progress = output.errors.join('\n');
        expect(progress).toContain('⚠ misconfigured');
        expect(progress).not.toContain('✗ 1 error');
        expect(output.messages.at(-1)).toContain('1 misconfigured rule');
    });

    test('verbose colorizes progress when force color is set', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = await writeRuleFile(cwd, 'rules.yaml', 'package-exists');

        await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            file,
            json: false,
            verbose: true,
            color: forceColor(),
        });

        const progress = output.errors.join('\n');
        expect(progress).toContain('\x1b[32m✓ passed\x1b[0m');
        expect(progress).toContain('\x1b[2m');
    });

    test('resolves a local preset whose categories live in the global root', async () => {
        const cwd = await createTempProject();
        const globalRoot = join(cwd, 'global-rules');
        const output = createCapturedOutput();

        await mkdir(join(cwd, '.spur', 'rules'), { recursive: true });
        await writeFile(
            join(cwd, '.spur', 'rules', 'recommended-post-check.yaml'),
            'name: recommended-post-check\nextends:\n  - quality\n',
        );
        await writeRuleFile(globalRoot, 'quality/coverage.yaml', 'coverage-gate');

        const result = await new RuleService(makeContext(cwd, output, { SPUR_GLOBAL_RULES_DIR: globalRoot })).evaluate({
            preset: 'recommended-post-check',
            failOn: 'error',
            rule: 'coverage-gate',
            json: true,
            verbose: false,
            color: noColor(),
        });

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({
            preset: 'recommended-post-check',
            ruleCount: 1,
        });
    });

    test('stopOnFirst stops batch evaluation after first finding at threshold', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = join(cwd, '.spur', 'rules', 'multi.yaml');
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
            file,
            [
                'rules:',
                '  - id: first-fail',
                '    description: will fail',
                '    severity: error',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - does-not-exist.txt',
                '  - id: second-fail',
                '    description: would fail if traversal continued',
                '    severity: error',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - also-missing.txt',
            ].join('\n'),
        );

        const full = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            file,
            json: true,
            verbose: false,
            color: noColor(),
        });
        expect(full.findings.length).toBe(2);
        expect(full.ruleCount).toBe(2);

        const stopped = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            file,
            json: true,
            verbose: false,
            color: noColor(),
            stopOnFirst: 'error',
        });
        expect(stopped.findings.length).toBe(1);
        expect(stopped.findings[0]?.ruleId).toBe('first-fail');
        expect(stopped.exitCode).toBe(1);
    });

    test('stopOnFirst × failOn composition: stop on warning but fail only on error', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = join(cwd, '.spur', 'rules', 'warn.yaml');
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
            file,
            [
                'rules:',
                '  - id: warn-rule',
                '    description: warns',
                '    severity: warning',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - does-not-exist.txt',
            ].join('\n'),
        );

        const result = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            stopOnFirst: 'warning',
            file,
            json: true,
            verbose: false,
            color: noColor(),
        });
        expect(result.findings.length).toBe(1);
        expect(result.findings.some((f) => f.severity === 'warning')).toBe(true);
        expect(result.exitCode).toBe(0);
    });

    test('stopOnFirst verbose emits stop message', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = join(cwd, '.spur', 'rules', 'fail.yaml');
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
            file,
            [
                'rules:',
                '  - id: failing',
                '    description: fails',
                '    severity: error',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - does-not-exist.txt',
                '  - id: should-not-run',
                '    description: should not be reached',
                '    severity: error',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - also-missing.txt',
            ].join('\n'),
        );

        await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            stopOnFirst: 'error',
            file,
            json: false,
            verbose: true,
            color: noColor(),
        });

        const progress = output.errors.join('\n');
        expect(progress).toContain('Stopping: first error+ finding reached.');
        expect(progress).not.toContain('should-not-run');
    });

    test('verbose uses a single engine.evaluate call (not one per rule)', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = join(cwd, '.spur', 'rules', 'multi.yaml');
        const originalEvaluate = RuleEngine.prototype.evaluate;
        const evaluateRuleCounts: number[] = [];
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
            file,
            [
                'rules:',
                '  - id: rule-a',
                '    description: first rule',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - package.json',
                '  - id: rule-b',
                '    description: second rule',
                '    evaluator:',
                '      type: path',
                '      config:',
                '        paths:',
                '          - package.json',
            ].join('\n'),
        );

        RuleEngine.prototype.evaluate = async function (
            this: RuleEngine,
            rules: ConstraintRule[],
            workdir: string,
            stopOnFirst?: 'error' | 'warning' | 'info',
        ): Promise<RuleEngineResult> {
            evaluateRuleCounts.push(rules.length);
            return await originalEvaluate.call(this, rules, workdir, stopOnFirst);
        };

        try {
            const result = await new RuleService(makeContext(cwd, output)).evaluate({
                preset: 'recommended-pre-check',
                failOn: 'error',
                file,
                json: false,
                verbose: true,
                color: noColor(),
            });

            // Both rules should be evaluated in one batch, not one engine call per rule.
            expect(result.exitCode).toBe(0);
            expect(evaluateRuleCounts).toEqual([2]);
            const progress = output.errors.join('\n');
            expect(progress).toContain('rule-a (path)');
            expect(progress).toContain('rule-b (path)');
            // Each rule appears with its outcome line exactly once.
            expect(progress).toContain('✓ passed');
        } finally {
            RuleEngine.prototype.evaluate = originalEvaluate;
        }
    });

    test('verbose surfaces evaluator error distinctly from violation', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = join(cwd, '.spur', 'rules', 'bad.yaml');
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
            file,
            [
                'rules:',
                '  - id: bad-rule',
                '    description: misconfigured evaluator',
                '    evaluator:',
                '      type: forbidden-import',
            ].join('\n'),
        );

        await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            failOn: 'error',
            file,
            json: false,
            verbose: true,
            color: noColor(),
        });

        const progress = output.errors.join('\n');
        // Evaluator error should appear distinctly (R6).
        expect(progress).toContain('evaluator error in bad-rule');
        // Original misconfigured indicator still present.
        expect(progress).toContain('⚠ misconfigured');
    });
});

// ---------------------------------------------------------------------------
// evaluate() — fix-mode
// ---------------------------------------------------------------------------

describe('RuleService.evaluate() — --fix-mode', () => {
    /** Write a rule file with a regex evaluator that finds and can fix a pattern. */
    async function writeFixableRuleFile(cwd: string): Promise<string> {
        const file = join(cwd, '.spur', 'rules', 'fixable.yaml');
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
            file,
            [
                'rules:',
                '  - id: no-todo',
                '    description: No TODO comments',
                '    severity: warning',
                '    fix:',
                '      mode: auto',
                '      replacement: "DONE"',
                '    evaluator:',
                '      type: regex',
                '      config:',
                '        pattern: "TODO"',
                '        forbid: true',
                '        paths:',
                '          - "**/*.ts"',
            ].join('\n'),
        );
        return file;
    }

    test('fix-mode none (default) does not populate fixes', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await writeFile(join(cwd, 'example.ts'), '// TODO: fix this\n');
        const file = await writeFixableRuleFile(cwd);

        const result = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            file,
            failOn: 'error',
            json: true,
            verbose: false,
            color: noColor(),
        });

        // Default is fixMode='none' — fixes should be empty (byte-identical to pre-fix-mode behavior).
        expect(result.fixes).toEqual([]);
        expect(result.applied).toBeUndefined();
        const json = JSON.parse(output.messages.at(-1) ?? '{}');
        expect(json.fixes).toEqual([]);
    });

    test('fix-mode suggest populates fixes[] in JSON and writes nothing', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await writeFile(join(cwd, 'example.ts'), '// TODO: fix this\n');
        const file = await writeFixableRuleFile(cwd);

        const result = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            file,
            failOn: 'error',
            fixMode: 'suggest',
            json: true,
            verbose: false,
            color: noColor(),
        });

        // suggest: fixes collected but NOT applied.
        expect(result.fixes.length).toBeGreaterThan(0);
        expect(result.applied).toBeUndefined();
        const json = JSON.parse(output.messages.at(-1) ?? '{}');
        expect(json.fixes.length).toBeGreaterThan(0);
        expect(json).not.toHaveProperty('applied');

        // File should still contain the TODO — nothing was written.
        const { readFile } = await import('node:fs/promises');
        const content = await readFile(join(cwd, 'example.ts'), 'utf-8');
        expect(content).toContain('TODO');
    });

    test('fix-mode auto applies fixes and reports applied block', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await writeFile(join(cwd, 'example.ts'), '// TODO: fix this\n');
        const file = await writeFixableRuleFile(cwd);

        const result = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            file,
            failOn: 'error',
            fixMode: 'auto',
            json: true,
            verbose: false,
            color: noColor(),
        });

        // auto: fixes collected AND applied.
        expect(result.fixes.length).toBeGreaterThan(0);
        expect(result.applied).toBeDefined();
        expect(result.applied?.applied.length).toBeGreaterThan(0);
        const json = JSON.parse(output.messages.at(-1) ?? '{}');
        expect(json.applied).toBeDefined();
        expect(json.applied.applied.length).toBeGreaterThan(0);
    });

    test('fix-mode auto with dry-run previews diff without writing', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await writeFile(join(cwd, 'example.ts'), '// TODO: fix this\n');
        const file = await writeFixableRuleFile(cwd);

        const result = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            file,
            failOn: 'error',
            fixMode: 'auto',
            dryRun: true,
            json: true,
            verbose: false,
            color: noColor(),
        });

        // dry-run: applied block present with diff, but file unchanged.
        expect(result.applied).toBeDefined();
        expect(result.applied?.diff.length).toBeGreaterThan(0);

        const { readFile } = await import('node:fs/promises');
        const content = await readFile(join(cwd, 'example.ts'), 'utf-8');
        expect(content).toContain('TODO');
    });

    test('exit code is governed by findings, not fixes (R4)', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await writeFile(join(cwd, 'example.ts'), '// TODO: fix this\n');
        const file = await writeFixableRuleFile(cwd);

        // Rule severity is warning; --fail-on is error (default).
        // Findings exist but don't breach the threshold → exit 0 even though fixes were applied.
        const result = await new RuleService(makeContext(cwd, output)).evaluate({
            preset: 'recommended-pre-check',
            file,
            failOn: 'error',
            fixMode: 'auto',
            json: true,
            verbose: false,
            color: noColor(),
        });

        // Warning-level finding with --fail-on error → exit 0.
        expect(result.findings.length).toBeGreaterThan(0);
        expect(result.findings[0]?.severity).toBe('warning');
        expect(result.exitCode).toBe(0);
        // Fixes were applied but exit code stays 0 (threshold-based).
        expect(result.applied).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// validate()
// ---------------------------------------------------------------------------

describe('RuleService.validate()', () => {
    test('validates a rule file without evaluating it', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = await writeRuleFile(cwd, 'rules.yaml', 'sample-rule');

        const result = await new RuleService(makeContext(cwd, output)).validate({
            source: { kind: 'file', value: file },
            json: true,
        });

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({
            valid: true,
            ruleCount: 1,
            rules: ['sample-rule'],
        });
    });

    test('validates presets with human output', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await writeRuleFile(cwd, '.spur/rules/boundary/sample.yaml', 'boundary-sample');
        await writeFile(
            join(cwd, '.spur', 'rules', 'recommended-pre-check.yaml'),
            'name: recommended\nextends:\n  - boundary\n',
        );

        const result = await new RuleService(makeContext(cwd, output)).validate({
            source: { kind: 'preset', value: 'recommended-pre-check' },
            json: false,
        });

        expect(result.exitCode).toBe(0);
        expect(output.messages.at(-1)).toContain('valid preset: recommended-pre-check');
        expect(output.messages.at(-1)).toContain('boundary-sample');
    });

    test('reports a missing file as invalid with exitCode 1', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const missing = join(cwd, 'does-not-exist.yaml');

        const result = await new RuleService(makeContext(cwd, output)).validate({
            source: { kind: 'file', value: missing },
            json: true,
        });

        expect(result.exitCode).toBe(1);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({ valid: false, kind: 'file' });
        expect(output.messages.at(-1)).toContain('File not found');
    });

    test('reports a malformed rule file as invalid with exitCode 1', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const file = join(cwd, 'bad.yaml');
        await writeFile(file, 'not: a-valid-rule-file\n');

        const result = await new RuleService(makeContext(cwd, output)).validate({
            source: { kind: 'file', value: file },
            json: true,
        });

        expect(result.exitCode).toBe(1);
        expect(JSON.parse(output.messages.at(-1) ?? '{}').valid).toBe(false);
    });

    test('reports invalid file as human-readable text on stderr', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const missing = join(cwd, 'gone.yaml');

        const result = await new RuleService(makeContext(cwd, output)).validate({
            source: { kind: 'file', value: missing },
            json: false,
        });

        expect(result.exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('invalid file');
        expect(output.errors.at(-1)).toContain('File not found');
    });

    test('reports an unknown preset as invalid (not a silent empty pass)', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        const result = await new RuleService(makeContext(cwd, output, { SPUR_GLOBAL_RULES_DIR: cwd })).validate({
            source: { kind: 'preset', value: 'no-such-preset' },
            json: true,
        });

        expect(result.exitCode).toBe(1);
        const parsed = JSON.parse(output.messages.at(-1) ?? '{}');
        expect(parsed.valid).toBe(false);
        expect(parsed.errors[0]).toContain('not found');
    });
});

// ---------------------------------------------------------------------------
// list()
// ---------------------------------------------------------------------------

describe('RuleService.list()', () => {
    test('lists discovered rule files grouped by effective source layer', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const globalRoot = join(cwd, 'global-rules');
        await writeRuleFile(cwd, '.spur/rules/boundary/sample.yaml', 'boundary-sample');
        await writeRuleFile(globalRoot, 'boundary/sample.yaml', 'shadowed-global-sample');
        await writeRuleFile(globalRoot, 'quality/coverage.yaml', 'coverage-gate');
        await writeFile(
            join(cwd, '.spur', 'rules', 'recommended-pre-check.yaml'),
            'name: recommended\nextends:\n  - boundary\n',
        );

        const result = await new RuleService(makeContext(cwd, output, { SPUR_GLOBAL_RULES_DIR: globalRoot })).list();

        expect(result.mode).toBe('layered');
        expect(result.totalFiles).toBe(2);
        expect(result.ruleCount).toBe(2);
        expect(result.layers.map((layer) => layer.id)).toEqual(['local', 'global']);
        expect(result.categories).toMatchObject([
            {
                name: 'boundary',
                files: [{ path: 'boundary/sample.yaml', source: 'local', ruleIds: ['boundary-sample'] }],
            },
            {
                name: 'quality',
                files: [{ path: 'quality/coverage.yaml', source: 'global', ruleIds: ['coverage-gate'] }],
            },
        ]);
        expect(result.rules).toEqual([]);
    });

    test('returns empty result when no local rules exist', async () => {
        const cwd = await createTempProject();
        const result = await new RuleService(
            makeContext(cwd, nullOutput(), { SPUR_GLOBAL_RULES_DIR: join(cwd, 'none') }),
        ).list();
        expect(result.ruleCount).toBe(0);
        expect(result.rules).toEqual([]);
        expect(result.totalFiles).toBe(0);
        expect(result.categories).toEqual([]);
    });

    test('lists rules from a named preset', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await writeRuleFile(cwd, '.spur/rules/boundary/sample.yaml', 'boundary-sample');
        await writeFile(
            join(cwd, '.spur', 'rules', 'recommended-pre-check.yaml'),
            'name: recommended-pre-check\nextends:\n  - boundary\n',
        );

        const result = await new RuleService(makeContext(cwd, output)).list('recommended-pre-check');

        expect(result.preset).toBe('recommended-pre-check');
        expect(result.rules.some((r) => r.id === 'boundary-sample')).toBe(true);
        expect(result.rules.every((r) => r.file === 'preset:recommended-pre-check')).toBe(true);
    });
});
