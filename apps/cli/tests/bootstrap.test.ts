import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/index';
import type { CommandOutput } from '../src/output';
import { createTempProject } from './helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('bootstrap (runNodeApplication path)', () => {
    test('exercises runNodeApplication bootstrap when .spur/config.yaml exists', async () => {
        const cwd = await createTempProject();
        // Create a minimal .spur/config.yaml so configFile is resolved.
        const configDir = join(cwd, '.spur');
        const configPath = join(configDir, 'config.yaml');
        await Bun.write(
            configPath,
            'version: "1"\nname: test\nbootstrap:\n  logging:\n    enabled: false\n  telemetry:\n    enabled: false\n  database:\n    enabled: false\n  scheduler:\n    enabled: false\n',
        );
        // Also need the global rules dir.
        const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
        const env = { ...process.env, SPUR_GLOBAL_RULES_DIR: globalDir };

        const code = await main(['--version'], { cwd, env, output: nullOutput(), dbUrl: ':memory:' });
        // --version uses Commander's exitOverride → throws with exitCode 0
        expect(code).toBe(0);
    });

    test('no-config path handles missing .spur/config.yaml', async () => {
        const cwd = await createTempProject();
        // No .spur/config.yaml — exercises the else path.
        const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
        const env = { ...process.env, SPUR_GLOBAL_RULES_DIR: globalDir };

        const code = await main(['--version'], { cwd, env, output: nullOutput(), dbUrl: ':memory:' });
        expect(code).toBe(0);
    });
});
