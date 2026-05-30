import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { main } from '../../src';
import { createCapturedOutput, createTempProject } from '../helpers';

describe('CLI workspace commands', () => {
    test('adds and lists workspace bindings', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const dbUrl = join(cwd, '.spur', 'test.db');

        expect(await main(['workspace', 'add', '--name', 'app', '--root', '.', '--json'], { cwd, output, dbUrl })).toBe(
            0,
        );
        const added = JSON.parse(output.messages.at(-1) ?? '{}') as { name: string; root: string };
        expect(added.name).toBe('app');
        expect(added.root).toBe(cwd);

        expect(await main(['workspace', 'list', '--json'], { cwd, output, dbUrl })).toBe(0);
        const listed = JSON.parse(output.messages.at(-1) ?? '{}') as { workspaces: Array<{ name: string }> };
        expect(listed.workspaces).toHaveLength(1);
        expect(listed.workspaces[0]?.name).toBe('app');

        expect(await main(['workspace', 'list'], { cwd, output, dbUrl })).toBe(0);
        expect(output.messages.at(-1)).toContain(`app\t${cwd}`);

        expect(await main(['workspace', 'remove'], { cwd, output, dbUrl })).toBe(1);
        expect(output.errors.at(-1)).toContain('Unknown workspace command');
    });
});
