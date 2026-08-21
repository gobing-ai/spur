import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/index';
import type { CommandOutput } from '../src/output';

/**
 * `spur self` hosts the four self-management verbs (init/migrate/serve/status) while the legacy
 * top-level nouns remain hidden aliases over the same builders (task 0616). These tests assert the
 * alias equivalence — same flags, output, and exit codes on both paths — and the help-listing
 * visibility — `self` listed, legacy nouns absent from `spur --help`.
 */
function captureOutput(): { output: CommandOutput; messages: string[]; errors: string[] } {
    const messages: string[] = [];
    const errors: string[] = [];
    return { output: { write: (m) => messages.push(m), error: (m) => errors.push(m) }, messages, errors };
}

/** A scaffolded-looking project dir so `spur status` reports ok and init has a target. */
async function tempProject(): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-self-'));
    await mkdir(join(cwd, '.spur'), { recursive: true });
    await writeFile(join(cwd, '.spur', 'config.yaml'), 'project: test\n');
    return cwd;
}

const LEGACY_SELF_NOUNS = ['init', 'migrate', 'serve', 'status'] as const;

describe('self noun (task 0616)', () => {
    test('lists self but hides the four legacy standalone nouns from top-level help', async () => {
        const cwd = await tempProject();
        const { output, messages } = captureOutput();
        try {
            expect(await main(['help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
            const help = messages.join('\n');
            expect(help).toContain('self');
            for (const noun of LEGACY_SELF_NOUNS) {
                expect(help).not.toContain(`spur ${noun}`);
            }
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('self --help lists the four self-management verbs', async () => {
        const cwd = await tempProject();
        const { output, messages } = captureOutput();
        try {
            expect(await main(['self', '--help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
            const help = messages.join('\n');
            for (const noun of LEGACY_SELF_NOUNS) {
                expect(help).toContain(noun);
            }
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    for (const args of [
        ['status', '--json'],
        ['migrate', '--json'],
        ['serve', '--json'],
    ] satisfies string[][]) {
        test(`spur self ${args[0]} behaves identically to spur ${args[0]} (flags, output, exit code)`, async () => {
            const cwd = await tempProject();
            const legacy = captureOutput();
            const viaSelf = captureOutput();
            try {
                const legacyExit = await main(args, { cwd, output: legacy.output, dbUrl: ':memory:' });
                const selfExit = await main(['self', ...args], { cwd, output: viaSelf.output, dbUrl: ':memory:' });
                expect(selfExit).toBe(legacyExit);
                expect(viaSelf.messages).toEqual(legacy.messages);
                expect(viaSelf.errors).toEqual(legacy.errors);
            } finally {
                await rm(cwd, { recursive: true, force: true });
            }
        });
    }

    test('spur self init --json equals spur init --json modulo the working directory', async () => {
        // Each path scaffolds its own temp project; the two outputs must be identical once the
        // differing absolute working-directory paths are normalized out.
        const legacyCwd = await tempProject();
        const selfCwd = await tempProject();
        const legacyGlobal = await mkdtemp(join(tmpdir(), 'spur-self-glob-l-'));
        const selfGlobal = await mkdtemp(join(tmpdir(), 'spur-self-glob-s-'));
        try {
            const legacy = captureOutput();
            const viaSelf = captureOutput();
            const isolatedEnv = (globalDir: string) => ({ ...process.env, SPUR_GLOBAL_RULES_DIR: globalDir });

            const legacyExit = await main(['init', '--json'], {
                cwd: legacyCwd,
                env: isolatedEnv(legacyGlobal),
                output: legacy.output,
                dbUrl: ':memory:',
            });
            const selfExit = await main(['self', 'init', '--json'], {
                cwd: selfCwd,
                env: isolatedEnv(selfGlobal),
                output: viaSelf.output,
                dbUrl: ':memory:',
            });

            expect(selfExit).toBe(legacyExit);
            const normalize = (msg: string) => msg.replaceAll(legacyCwd, 'CWD').replaceAll(selfCwd, 'CWD');
            expect(viaSelf.messages.map(normalize)).toEqual(legacy.messages.map(normalize));
            expect(viaSelf.errors).toEqual(legacy.errors);
        } finally {
            await rm(legacyCwd, { recursive: true, force: true });
            await rm(selfCwd, { recursive: true, force: true });
            await rm(legacyGlobal, { recursive: true, force: true });
            await rm(selfGlobal, { recursive: true, force: true });
        }
    });
});
