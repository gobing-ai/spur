/**
 * Thin-wrapper integration tests for apps/cli/src/commands/rule.ts.
 * Behavioral tests for RuleService live in packages/app/tests/services/rule-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import type { RuleEvalRunRow, RuleRunRow } from '@gobing-ai/spur-app';
import { formatTraceDetail, formatTraceList } from '../../src/commands/rule';
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
        await Bun.write(`${cwd}/.spur/rules/recommended-pre-check.yaml`, 'name: recommended\nextends:\n  - boundary\n');
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
        await Bun.write(
            `${cwd}/.spur/rules/recommended-pre-check.yaml`,
            'name: recommended-pre-check\nextends:\n  - boundary\n',
        );
        await writeRuleFile(cwd);
        const output = createCapturedOutput();

        const exitCode = await main(['rule', 'list', '--preset', 'recommended-pre-check'], {
            cwd,
            output,
            env: { SPUR_GLOBAL_RULES_DIR: `${cwd}/empty-global-rules` },
        });

        expect(exitCode).toBe(0);
        expect(output.messages.at(-1)).toContain(
            'sample-rule\tseverity=error\tstatus=enabled\tsource=preset:recommended-pre-check',
        );
    });

    test('validate subcommand returns a number', async () => {
        const exitCode = await main(['rule', 'validate', '--preset', 'recommended-pre-check', '--json'], {
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

    test('trace subcommand lists empty runs (fresh DB)', async () => {
        const lines: string[] = [];
        const exitCode = await main(['rule', 'trace'], {
            output: { write: (m) => lines.push(m), error: () => {} },
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        expect(lines[0]).toBe('No rule runs found.');
    });

    test('trace subcommand prints empty list (json, fresh DB)', async () => {
        const lines: string[] = [];
        const exitCode = await main(['rule', 'trace', '--json'], {
            output: { write: (m) => lines.push(m), error: () => {} },
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        const output = JSON.parse(lines.join(''));
        expect(output.runs).toEqual([]);
    });

    test('trace subcommand rejects non-positive --last', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['rule', 'trace', '--last', '0'], { output, dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toBe('--last must be a positive integer');
    });

    test('trace subcommand rejects non-numeric --last', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['rule', 'trace', '--last', 'abc'], { output, dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toBe('--last must be a positive integer');
    });

    test('trace subcommand rejects malformed --since', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['rule', 'trace', '--since', 'not-a-date'], { output, dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toBe('--since must be a valid ISO date');
    });

    test('trace subcommand with unknown run id exits 1 with clear error', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['rule', 'trace', 'rule_does-not-exist'], { output, dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toBe('Run not found');
    });

    test('trace subcommand rejects invalid --status', async () => {
        const exitCode = await main(['rule', 'trace', '--status', 'bogus'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    test('trace subcommand accepts valid --status done', async () => {
        const exitCode = await main(['rule', 'trace', '--status', 'done'], { output: nullOutput() });
        expect(exitCode).toBe(0);
    });
});

describe('rule trace end-to-end', () => {
    test('rule run persists a run that trace lists and details', async () => {
        const cwd = await createTempProject();
        const dbUrl = `${cwd}/trace-test.db`;
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

        const runExit = await main(['rule', 'run', '--file', file], { cwd, output: nullOutput(), dbUrl });
        expect(runExit).toBe(0);

        const listOutput = createCapturedOutput();
        const listExit = await main(['rule', 'trace', '--json'], { cwd, output: listOutput, dbUrl });
        expect(listExit).toBe(0);
        const { runs } = JSON.parse(listOutput.messages.join('')) as { runs: RuleRunRow[] };
        expect(runs).toHaveLength(1);
        expect(runs[0]?.status).toBe('done');
        expect(runs[0]?.rule_count).toBe(1);
        expect(runs[0]?.source_kind).toBe('file');

        const runId = runs[0]?.id ?? '';
        const detailOutput = createCapturedOutput();
        const detailExit = await main(['rule', 'trace', runId, '--json'], { cwd, output: detailOutput, dbUrl });
        expect(detailExit).toBe(0);
        const detail = JSON.parse(detailOutput.messages.join('')) as {
            run: RuleRunRow;
            evaluations: RuleEvalRunRow[];
        };
        expect(detail.run.id).toBe(runId);
        expect(detail.evaluations).toHaveLength(1);
        expect(detail.evaluations[0]?.rule_id).toBe('sample-rule');
        expect(detail.evaluations[0]?.status).toBe('done');

        const plainOutput = createCapturedOutput();
        const plainExit = await main(['rule', 'trace', runId], { cwd, output: plainOutput, dbUrl });
        expect(plainExit).toBe(0);
        expect(plainOutput.messages.at(-1)).toContain('sample-rule');
    });
});

describe('formatTraceList', () => {
    test('renders header and rows', () => {
        const runs: RuleRunRow[] = [
            {
                id: 'rule-abc123-def',
                preset: 'recommended-pre-check',
                status: 'done',
                source_kind: 'preset',
                source_value: null,
                rule_count: 12,
                finding_count: 0,
                fix_count: 0,
                applied_fix_count: 0,
                fail_on: 'error',
                stop_on_first: null,
                fix_mode: 'none',
                dry_run: 0,
                started_at: '2026-06-11T20:00:00Z',
                completed_at: null,
                duration_ms: null,
                metadata_json: '{}',
            },
        ];
        const output = formatTraceList(runs);
        expect(output).toContain('RUN ID');
        expect(output).toContain('rule-abc123');
        expect(output).toContain('recommended-pre-check');
        expect(output).toContain('done');
    });

    test('renders preset as dash when null', () => {
        const runs: RuleRunRow[] = [
            {
                id: 'r1',
                preset: null,
                status: 'done',
                source_kind: 'preset',
                source_value: null,
                rule_count: 1,
                finding_count: 0,
                fix_count: 0,
                applied_fix_count: 0,
                fail_on: 'error',
                stop_on_first: null,
                fix_mode: 'none',
                dry_run: 0,
                started_at: '2026-01-01T00:00:00Z',
                completed_at: null,
                duration_ms: null,
                metadata_json: '{}',
            },
        ];
        const output = formatTraceList(runs);
        expect(output).toContain('\t-\t');
    });
});

describe('formatTraceDetail', () => {
    test('renders run summary and eval rows', () => {
        const run: RuleRunRow = {
            id: 'rule-def456',
            preset: 'recommended-pre-check',
            status: 'done',
            source_kind: 'preset',
            source_value: null,
            rule_count: 12,
            finding_count: 3,
            fix_count: 1,
            applied_fix_count: 0,
            fail_on: 'error',
            stop_on_first: null,
            fix_mode: 'suggest',
            dry_run: 0,
            duration_ms: 1420,
            started_at: '2026-01-01T00:00:00Z',
            completed_at: null,
            metadata_json: '{}',
        };
        const evaluations: RuleEvalRunRow[] = [
            {
                id: 'e1',
                run_id: 'rule-def456',
                rule_id: 'no-hardcoded-secrets',
                severity: 'error',
                evaluator: 'rg',
                status: 'done',
                finding_count: 0,
                fix_count: 0,
                duration_ms: 85,
                error: null,
                findings_json: null,
                fixes_json: null,
                started_at: '2026-01-01T00:00:00Z',
                completed_at: null,
            },
            {
                id: 'e2',
                run_id: 'rule-def456',
                rule_id: 'no-biome-suppressions',
                severity: 'error',
                evaluator: 'rg',
                status: 'done',
                finding_count: 2,
                fix_count: 0,
                duration_ms: 34,
                error: null,
                findings_json: null,
                fixes_json: null,
                started_at: '2026-01-01T00:00:00Z',
                completed_at: null,
            },
            {
                id: 'e3',
                run_id: 'rule-def456',
                rule_id: 'no-npm-pnpm-yarn-scripts',
                severity: 'error',
                evaluator: 'rg',
                status: 'done',
                finding_count: 0,
                fix_count: 0,
                duration_ms: 19,
                error: null,
                findings_json: null,
                fixes_json: null,
                started_at: '2026-01-01T00:00:00Z',
                completed_at: null,
            },
        ];
        const output = formatTraceDetail({ run, evaluations });
        expect(output).toContain('rule-def456');
        expect(output).toContain('recommended-pre-check');
        expect(output).toContain('1.42s');
        expect(output).toContain('no-hardcoded-secrets');
        expect(output).toContain('no-biome-suppressions');
        expect(output).toContain('  2 findings');
    });

    test('renders error for failed eval rows', () => {
        const run: RuleRunRow = {
            id: 'r1',
            preset: null,
            status: 'done',
            source_kind: 'preset',
            source_value: null,
            rule_count: 1,
            finding_count: 1,
            fix_count: 0,
            applied_fix_count: 0,
            fail_on: 'error',
            stop_on_first: null,
            fix_mode: 'none',
            dry_run: 0,
            duration_ms: 100,
            started_at: '2026-01-01T00:00:00Z',
            completed_at: null,
            metadata_json: '{}',
        };
        const evaluations: RuleEvalRunRow[] = [
            {
                id: 'e1',
                run_id: 'r1',
                rule_id: 'crashy',
                severity: 'error',
                evaluator: 'rg',
                status: 'failed',
                finding_count: 1,
                fix_count: 0,
                duration_ms: 5,
                error: 'boom',
                findings_json: null,
                fixes_json: null,
                started_at: '2026-01-01T00:00:00Z',
                completed_at: null,
            },
        ];
        const output = formatTraceDetail({ run, evaluations });
        expect(output).toContain('✗');
        expect(output).toContain('boom');
    });
});
