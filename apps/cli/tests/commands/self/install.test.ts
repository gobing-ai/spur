import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src';

/**
 * `spur self install` command surface in process (A93 1353 R1/R4): usage validation exits 2 before
 * any write, `--json`/`--json-envelope` keep one parseable document, and the text renderer names
 * every step. The subprocess E2E (`install.e2e.test.ts`) owns the real filesystem/installer
 * behaviour; this file pins the transport contract cheaply.
 */
async function fixture(): Promise<{ cwd: string; env: Record<string, string>; cleanup: () => Promise<void> }> {
    const root = await mkdtemp(join(tmpdir(), 'spur-install-cmd-'));
    const cwd = join(root, 'project');
    const global = join(root, 'global');
    await mkdir(cwd, { recursive: true });
    const env = {
        ...getEnvVars(),
        SPUR_GLOBAL_RULES_DIR: global,
        PATH: '/usr/bin:/bin',
    };
    return { cwd, env, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe('spur self install — usage', () => {
    test('an unknown --with value exits 2 with a usage error and writes nothing', async () => {
        const fx = await fixture();
        try {
            const messages: string[] = [];
            const code = await main(['self', 'install', '--with', 'nope', '--json'], {
                cwd: fx.cwd,
                env: fx.env,
                output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
            });
            expect(code).toBe(2);
            const payload = JSON.parse(messages.at(-1) ?? '{}') as { error: { code: string; message: string } };
            expect(payload.error.code).toBe('usage');
            expect(payload.error.message).toContain('zg, a2a, sp-plugin');
            await expect(
                readdir(join(fx.cwd)).then((entries) => entries.filter((e) => e === '.spur')),
            ).resolves.toEqual([]);
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur self install — output', () => {
    test('--json-envelope wraps the same report', async () => {
        const fx = await fixture();
        try {
            const messages: string[] = [];
            const code = await main(['self', 'install', '--json', '--json-envelope'], {
                cwd: fx.cwd,
                env: fx.env,
                output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
            });
            expect(code).toBe(0);
            const envelope = JSON.parse(messages.at(-1) ?? '{}') as {
                ok: boolean;
                data: { ok: boolean; changed: boolean; steps: unknown[] };
            };
            expect(envelope.data.ok).toBe(true);
            expect(envelope.data.steps).toHaveLength(5);
        } finally {
            await fx.cleanup();
        }
    });

    test('repeated --with values collapse to one step each', async () => {
        const fx = await fixture();
        try {
            const messages: string[] = [];
            const code = await main(['self', 'install', '--with', 'zg', '--with', 'zg', '--json'], {
                cwd: fx.cwd,
                env: fx.env,
                output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
            });
            const payload = JSON.parse(messages.at(-1) ?? '{}') as { steps: { name: string }[] };
            expect(payload.steps.filter((step) => step.name === 'zg')).toHaveLength(1);
            // No package manager on this PATH, so the selected step fails and the run exits 1.
            expect(code).toBe(1);
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur self install — text renderer', () => {
    test('names every step, the change summary and the verdict', async () => {
        const fx = await fixture();
        try {
            const messages: string[] = [];
            const code = await main(['self', 'install'], {
                cwd: fx.cwd,
                env: fx.env,
                output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
            });
            expect(code).toBe(0);
            const text = messages.join('\n');
            expect(text).toContain('rules\tcreated\trequired');
            expect(text).toContain('zg\tskipped');
            expect(text).toContain('changed');
            expect(text).toContain('ok');
        } finally {
            await fx.cleanup();
        }
    });

    test('a failed required step renders the failure verdict and exits 1', async () => {
        const fx = await fixture();
        const blocked = join(fx.cwd, 'blocked');
        try {
            await writeFile(blocked, 'not a directory');
            const messages: string[] = [];
            const code = await main(['self', 'install'], {
                cwd: fx.cwd,
                env: { ...fx.env, SPUR_GLOBAL_RULES_DIR: join(blocked, 'global') },
                output: { write: (m) => messages.push(m), error: (m) => messages.push(m) },
            });
            expect(code).toBe(1);
            const text = messages.join('\n');
            expect(text).toContain('failed');
            expect(text).not.toContain('\nok');
        } finally {
            await fx.cleanup();
        }
    });
});
