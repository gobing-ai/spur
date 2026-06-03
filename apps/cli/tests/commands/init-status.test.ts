import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src';
import { createCapturedOutput, createTempProject } from '../helpers';

describe('CLI init/status', () => {
    test('initializes .spur and reports project status', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const dbUrl = join(cwd, '.spur', 'test.db');
        // Isolate the global rules seed from the developer's real ~/.config.
        const env = { ...process.env, SPUR_GLOBAL_RULES_DIR: await mkdtemp(join(tmpdir(), 'spur-glob-')) };

        expect(await main(['init', '--name', 'fixture'], { cwd, output, dbUrl, env })).toBe(0);
        expect(existsSync(join(cwd, '.spur', 'config.json'))).toBe(true);
        expect(output.messages.some((message) => message.includes('Initialized .spur/config.json'))).toBe(true);

        expect(await main(['status', '--json'], { cwd, output, dbUrl, env })).toBe(0);
        const status = JSON.parse(output.messages.at(-1) ?? '{}') as {
            ok: boolean;
            spurConfig: boolean;
        };
        expect(status.ok).toBe(true);
        expect(status.spurConfig).toBe(true);

        expect(await main(['status'], { cwd, output, dbUrl, env })).toBe(0);
        expect(output.messages.at(-1)).toContain('Project: ok');
        expect(output.messages.at(-1)).not.toContain('Workspaces:');
    });
});
