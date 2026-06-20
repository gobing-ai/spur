import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../src';
import { createCapturedOutput, createTempProject } from '../helpers';

describe('CLI migrate and extracted domains', () => {
    test('applies regenerated CLI migrations', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const dbUrl = join(cwd, '.spur', 'test.db');

        expect(await main(['migrate', '--json'], { cwd, output, dbUrl })).toBe(0);
        const result = JSON.parse(output.messages.at(-1) ?? '{}') as { ok: boolean; applied: number };
        expect(result.ok).toBe(true);
        expect(result.applied).toBe(0);
    });

    test('runs extracted rule, agent, history, and workflow commands', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        // Isolate from the user's global rules so the empty-project run is hermetic
        // (an explicit SPUR_GLOBAL_RULES_DIR also suppresses the bundled fallback).
        // A run that resolves zero rules now fails loud: a constraint gate that
        // silently checks nothing would be the worst failure mode, so exit is 1.
        const isolatedEnv = { SPUR_GLOBAL_RULES_DIR: cwd };
        expect(await main(['rule', 'run', '--json'], { cwd, output, dbUrl: ':memory:', env: isolatedEnv })).toBe(1);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({
            preset: 'recommended-pre-check',
            ruleCount: 0,
        });

        expect(await main(['agent', 'list', '--json'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toHaveProperty('agents');

        expect(await main(['agent', 'list'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(output.messages.at(-1)).toContain('claude');

        expect(await main(['agent', 'doctor', 'antigravity', '--json'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(JSON.parse(output.messages.at(-1) ?? '{}').agents[0]).toMatchObject({
            agent: 'antigravity-cli',
            tier: 1,
        });

        expect(await main(['agent', 'doctor', 'antigravity'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.messages.at(-1)).toContain('antigravity');

        expect(await main(['agent', 'missing'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toMatch(/unknown command/);

        expect(await main(['history'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        // Commander shows help on stderr when a required subcommand is missing.
        expect(output.errors.join('\\n')).toContain('import');
        const historyFile = join(cwd, 'history.jsonl');
        await writeFile(
            historyFile,
            `${JSON.stringify({ id: 'msg-1', timestamp: '2026-05-30T00:00:00.000Z', content: 'hello' })}\n`,
        );
        expect(
            await main(['history', 'import', '--source', 'codex', '--file', historyFile, '--json'], {
                cwd,
                output,
                dbUrl: ':memory:',
            }),
        ).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({
            source: 'codex',
            importedRecords: 1,
            scannedFiles: 1,
        });

        const plainHistoryFile = join(cwd, 'plain-history.jsonl');
        await writeFile(
            plainHistoryFile,
            `${JSON.stringify({ id: 'msg-2', timestamp: '2026-05-30T00:00:00.000Z', content: 'plain' })}\n`,
        );
        expect(
            await main(['history', 'import', '--source', 'codex', '--file', plainHistoryFile], {
                cwd,
                output,
                dbUrl: ':memory:',
            }),
        ).toBe(0);
        expect(output.messages.at(-1)).toContain('history import codex');

        expect(await main(['history', 'import', '--source', 'missing'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('Invalid history source');

        expect(
            await main(['history', 'import', '--source', 'codex', '--mode', 'bad'], {
                cwd,
                output,
                dbUrl: ':memory:',
            }),
        ).toBe(1);
        expect(output.errors.at(-1)).toContain('Invalid history import mode');

        expect(await main(['workflow'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('spur workflow');

        const workflowFile = join(cwd, 'workflow.yaml');
        await writeFile(
            workflowFile,
            [
                'name: cli-workflow',
                'initialState: start',
                'terminalStates: [done]',
                'states:',
                '  - id: start',
                '    onEnter:',
                '      - kind: note',
                '        options:',
                '          message: hello',
                '  - id: done',
                'transitions:',
                '  - from: start',
                '    to: done',
            ].join('\n'),
        );
        expect(await main(['workflow', 'validate', workflowFile, '--json'], { cwd, output, dbUrl: ':memory:' })).toBe(
            0,
        );
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({ ok: true });

        const workflowDb = join(cwd, '.spur', 'workflow.db');
        expect(
            await main(['workflow', 'run', workflowFile, '--run-id', 'cli-run', '--json'], {
                cwd,
                output,
                dbUrl: workflowDb,
            }),
        ).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({
            runId: 'cli-run',
            workflowName: 'cli-workflow',
            status: 'done',
        });

        expect(await main(['workflow', 'trace', '--json'], { cwd, output, dbUrl: workflowDb })).toBe(0);
        const traceResult = JSON.parse(output.messages.at(-1) ?? '{}');
        expect(traceResult.entries).toHaveLength(1);
    });

    test('runs history analyze with --json and text output', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const dbUrl = join(cwd, '.spur', 'analyze-test.db');

        // Import test data first so analyze has rows to query.
        const historyFile = join(cwd, 'analyze-test.jsonl');
        await writeFile(
            historyFile,
            `${JSON.stringify({ id: 'a1', timestamp: '2026-05-30T00:00:00.000Z', content: 'hello world', model: 'claude-sonnet-4-20250514', usage: { input_tokens: 100, output_tokens: 50 } })}\n`,
        );
        await main(['history', 'import', '--source', 'claude', '--file', historyFile], { cwd, output, dbUrl });

        // JSON output
        expect(await main(['history', 'analyze', '--json'], { cwd, output, dbUrl })).toBe(0);
        const jsonResult = JSON.parse(output.messages.at(-1) ?? '{}') as {
            totals: { costUsd: number; records: number };
        };
        expect(jsonResult.totals.records).toBeGreaterThanOrEqual(1);
        expect(jsonResult.totals.costUsd).toBeGreaterThan(0);

        // Text output
        output.messages.length = 0;
        expect(await main(['history', 'analyze'], { cwd, output, dbUrl })).toBe(0);
        expect(output.messages.at(-1)).toContain('Total:');
        expect(output.messages.at(-1)).toContain('By source:');

        // Commander shows help when no subcommand is given
        output.errors.length = 0;
        output.messages.length = 0;
        expect(await main(['history'], { cwd, output, dbUrl })).toBe(1);
        expect(output.errors.join('\\n')).toContain('import');
    });

    test('runs rule command file mode and error branches', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const rulesDir = join(cwd, '.spur', 'rules');
        await mkdir(rulesDir, { recursive: true });
        const ruleFile = join(rulesDir, 'imports.yaml');
        await writeFile(
            ruleFile,
            [
                'rules:',
                '  - id: no-old-spur',
                '    description: No old imports',
                '    evaluator:',
                '      type: forbidden-import',
                '      config:',
                '        patterns: ["@spur/"]',
                '    include: ["src"]',
            ].join('\n'),
        );
        await mkdir(join(cwd, 'src'), { recursive: true });
        await writeFile(join(cwd, 'src', 'index.ts'), "import { x } from '@spur/core';\n");

        expect(
            await main(['rule', 'run', '--file', ruleFile, '--fail-on', 'warning'], { cwd, output, dbUrl: ':memory:' }),
        ).toBe(1);
        expect(output.messages.at(-1)).toContain('ERROR no-old-spur');

        expect(
            await main(['rule', 'run', '--file', ruleFile, '--rule', 'no-old-spur', '--json'], {
                cwd,
                output,
                dbUrl: ':memory:',
            }),
        ).toBe(1);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({ ruleCount: 1 });

        expect(await main(['rule', 'bad'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toMatch(/unknown command/);

        expect(await main(['rule', 'run', '--fail-on', 'bad'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('Invalid --fail-on value');
    });
});
