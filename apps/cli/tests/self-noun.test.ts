import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
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

/** A scaffolded-looking project dir so `spur self status` reports ok and init has a target. */
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

    // Task 1388: the legacy top-level spelling is gone, so this is no longer an alias-parity
    // check — each verb must work through `self` with its documented flags and exit code.
    for (const args of [
        ['status', '--json'],
        ['migrate', '--json'],
        ['serve', '--json'],
    ] satisfies string[][]) {
        test(`spur self ${args[0]} exits 0 and answers --json`, async () => {
            const cwd = await tempProject();
            const viaSelf = captureOutput();
            try {
                const exit = await main(['self', ...args], { cwd, output: viaSelf.output, dbUrl: ':memory:' });
                expect(exit).toBe(0);
                expect(viaSelf.messages.join('\n')).toContain('{');
            } finally {
                await rm(cwd, { recursive: true, force: true });
            }
        });
    }

    test('spur self init --json scaffolds the project', async () => {
        // Task 1388 removed `spur self init`; the self path is the only one, so the assertion is the
        // outcome (config written, exit 0) rather than an alias comparison.
        const cwd = await tempProject();
        const globalDir = await mkdtemp(join(tmpdir(), 'spur-self-glob-'));
        try {
            const viaSelf = captureOutput();
            const exit = await main(['self', 'init', '--json'], {
                cwd,
                env: { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: globalDir },
                output: viaSelf.output,
                dbUrl: ':memory:',
            });
            expect(exit).toBe(0);
            expect(viaSelf.messages.join('\n')).toContain('{');
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(globalDir, { recursive: true, force: true });
        }
    });
});
