import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src';
import { createCapturedOutput, createTempProject, createTempProjectStackNeutral } from '../helpers';

describe('CLI init/status', () => {
    test('initializes .spur and reports project status', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const dbUrl = join(cwd, '.spur', 'test.db');
        // Isolate the global rules seed from the developer's real ~/.config.
        const env = { ...process.env, SPUR_GLOBAL_RULES_DIR: await mkdtemp(join(tmpdir(), 'spur-glob-')) };

        expect(await main(['init', '--name', 'fixture'], { cwd, output, dbUrl, env })).toBe(0);
        expect(existsSync(join(cwd, '.spur', 'config.yaml'))).toBe(true);
        expect(output.messages.some((message) => message.includes('Initialized .spur/config.yaml'))).toBe(true);

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

describe('CLI status stack-neutral (task 0313)', () => {
    test('status ok=true when only .spur/config.yaml exists (no package.json)', async () => {
        const cwd = await createTempProjectStackNeutral();
        const output = createCapturedOutput();
        const dbUrl = join(cwd, '.spur', 'test.db');
        const env = { ...process.env, SPUR_GLOBAL_RULES_DIR: await mkdtemp(join(tmpdir(), 'spur-glob-')) };

        // No package.json — init should still succeed
        expect(await main(['init', '--name', 'blank-repo'], { cwd, output, dbUrl, env })).toBe(0);
        expect(existsSync(join(cwd, '.spur', 'config.yaml'))).toBe(true);
        expect(existsSync(join(cwd, 'package.json'))).toBe(false);

        // Status JSON: ok should be true (spurConfigExists), packageJson should be false
        expect(await main(['status', '--json'], { cwd, output, dbUrl, env })).toBe(0);
        const status = JSON.parse(output.messages.at(-1) ?? '{}') as {
            ok: boolean;
            packageJson: boolean;
            spurConfig: boolean;
        };
        expect(status.ok).toBe(true);
        expect(status.spurConfig).toBe(true);
        expect(status.packageJson).toBe(false);

        // Human output: Project ok, Package none
        expect(await main(['status'], { cwd, output, dbUrl, env })).toBe(0);
        const humanOutput = output.messages.at(-1) ?? '';
        expect(humanOutput).toContain('Project: ok');
        expect(humanOutput).toContain('Package: none');
    });

    test('status ok=false when .spur/config.yaml is missing', async () => {
        const cwd = await createTempProjectStackNeutral();
        const output = createCapturedOutput();
        const dbUrl = join(cwd, '.spur', 'test.db');
        const env = { ...process.env, SPUR_GLOBAL_RULES_DIR: await mkdtemp(join(tmpdir(), 'spur-glob-')) };

        // No init — no .spur/config.yaml
        const code = await main(['status', '--json'], { cwd, output, dbUrl, env });
        expect(code).toBe(1);
        const status = JSON.parse(output.messages.at(-1) ?? '{}') as { ok: boolean };
        expect(status.ok).toBe(false);
    });
});
