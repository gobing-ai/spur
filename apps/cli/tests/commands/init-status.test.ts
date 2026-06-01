import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../src';
import { createCapturedOutput, createTempProject } from '../helpers';

describe('CLI init/status', () => {
    test('initializes .spur and reports project status', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const dbUrl = join(cwd, '.spur', 'test.db');

        expect(await main(['init', '--name', 'fixture'], { cwd, output, dbUrl })).toBe(0);
        expect(existsSync(join(cwd, '.spur', 'config.json'))).toBe(true);
        expect(output.messages.at(-1)).toContain('Initialized .spur/config.json');

        expect(await main(['status', '--json'], { cwd, output, dbUrl })).toBe(0);
        const status = JSON.parse(output.messages.at(-1) ?? '{}') as {
            ok: boolean;
            spurConfig: boolean;
        };
        expect(status.ok).toBe(true);
        expect(status.spurConfig).toBe(true);

        expect(await main(['status'], { cwd, output, dbUrl })).toBe(0);
        expect(output.messages.at(-1)).toContain('Project: ok');
        expect(output.messages.at(-1)).not.toContain('Workspaces:');
    });
});
