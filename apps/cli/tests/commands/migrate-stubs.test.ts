import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { main } from '../../src';
import { createCapturedOutput, createTempProject } from '../helpers';

describe('CLI migrate and domain stubs', () => {
    test('applies regenerated CLI migrations', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const dbUrl = join(cwd, '.spur', 'test.db');

        expect(await main(['migrate', '--json'], { cwd, output, dbUrl })).toBe(0);
        const result = JSON.parse(output.messages.at(-1) ?? '{}') as { ok: boolean; applied: number };
        expect(result.ok).toBe(true);
        expect(result.applied).toBe(0);
    });

    test('keeps domain commands as descriptive stubs', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        expect(await main(['rule'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('@gobing-ai/ts-rule-engine');

        expect(await main(['workflow'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('@gobing-ai/ts-dual-workflow-engine');

        expect(await main(['agent'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('@gobing-ai/ts-ai-runner');

        expect(await main(['history'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('@gobing-ai/ts-llm-jsonl-importer');
    });
});
