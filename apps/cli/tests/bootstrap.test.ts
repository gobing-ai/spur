import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import { CLI_CONFIG } from '../src/config';
import { main } from '../src/index';
import type { CommandOutput } from '../src/output';
import { createTempProject } from './helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

/** Wrap a real adapter so `close()` records that it ran while still closing for real. */
async function spyDb(): Promise<{ db: DbAdapter; closed: () => boolean }> {
    const real = await createMigratedDb({ url: ':memory:' });
    let wasClosed = false;
    const db: DbAdapter = new Proxy(real, {
        get(target, prop, receiver) {
            if (prop === 'close') {
                return async () => {
                    wasClosed = true;
                    return target.close();
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });
    return { db, closed: () => wasClosed };
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
        const env = { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: globalDir };

        // Root --help still takes the full boot (PR-L made only --version boot-free) and exits 0
        // through Commander's exitOverride.
        const code = await main(['--help'], { cwd, env, output: nullOutput(), dbUrl: ':memory:' });
        expect(code).toBe(0);
    });

    test('no-config path handles missing .spur/config.yaml', async () => {
        const cwd = await createTempProject();
        // No .spur/config.yaml — exercises the else path.
        const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
        const env = { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: globalDir };

        const code = await main(['--help'], { cwd, env, output: nullOutput(), dbUrl: ':memory:' });
        expect(code).toBe(0);
    });

    // ADR-018 regression guard: ts-infra 0.3.6+ no longer closes a caller-injected
    // services.db, so main() must close its own adapter in BOTH bootstrap branches.
    // A leak here would silently exhaust SQLite handles over a long-running session.
    test('closes the injected DB adapter on shutdown — runNodeApplication path', async () => {
        const cwd = await createTempProject();
        const configPath = join(cwd, '.spur', 'config.yaml');
        await Bun.write(
            configPath,
            'version: "1"\nname: test\nbootstrap:\n  logging:\n    enabled: false\n  telemetry:\n    enabled: false\n  database:\n    enabled: false\n  scheduler:\n    enabled: false\n',
        );
        const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
        const env = { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: globalDir };
        const { db, closed } = await spyDb();

        const code = await main(['--help'], { cwd, env, output: nullOutput(), db });

        expect(code).toBe(0);
        expect(closed()).toBe(true);
    });

    test('closes the injected DB adapter on shutdown — no-config path', async () => {
        const cwd = await createTempProject();
        const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
        const env = { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: globalDir };
        const { db, closed } = await spyDb();

        const code = await main(['--help'], { cwd, env, output: nullOutput(), db });

        expect(code).toBe(0);
        expect(closed()).toBe(true);
    });
});

describe('boot-free --version (PR-L lazy CLI loading)', () => {
    test('prints the version without opening a database or reading config', async () => {
        const cwd = await createTempProject();
        // A broken project config would fail the full boot; --version must not read it.
        await Bun.write(join(cwd, '.spur', 'config.yaml'), 'version: [unterminated\n');
        const { db, closed } = await spyDb();
        const lines: string[] = [];
        const output: CommandOutput = { write: (m) => lines.push(m), error: (m) => lines.push(m) };

        for (const flag of ['--version', '-V']) {
            expect(await main([flag], { cwd, env: getEnvVars(), output, db })).toBe(0);
            expect(await main(['--no-logo', flag], { cwd, env: getEnvVars(), output, db })).toBe(0);
        }

        expect(lines.map((l) => l.trim())).toEqual([
            CLI_CONFIG.binaryVersion,
            CLI_CONFIG.binaryVersion,
            CLI_CONFIG.binaryVersion,
            CLI_CONFIG.binaryVersion,
        ]);
        expect(closed()).toBe(false);
        expect(existsSync(join(cwd, '.spur', 'spur.db'))).toBe(false);
        await db.close();
    });
});
