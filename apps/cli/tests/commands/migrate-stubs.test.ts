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

    test('runs extracted rule, agent, and history commands while keeping workflow stubbed', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        expect(await main(['rule', 'run', '--json'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toMatchObject({ preset: 'recommended', ruleCount: 0 });

        expect(await main(['agent', 'list', '--json'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}')).toHaveProperty('agents');

        expect(await main(['agent', 'list'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(output.messages.at(-1)).toContain('claude');

        expect(await main(['agent', 'doctor', 'antigravity', '--json'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}').agents[0]).toMatchObject({ agent: 'antigravity', tier: 2 });

        expect(await main(['agent', 'doctor', 'antigravity'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(output.messages.at(-1)).toContain('antigravity');

        expect(await main(['agent', 'missing'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('Unknown agent command');

        expect(await main(['workflow'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('@gobing-ai/ts-dual-workflow-engine');

        expect(await main(['history'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('Usage: spur history import');

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
        expect(output.errors.at(-1)).toContain('Unknown rule command');

        expect(await main(['rule', 'run', '--fail-on', 'bad'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('Invalid --fail-on value');
    });
});
