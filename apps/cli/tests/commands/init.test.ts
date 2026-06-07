import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';
import { createTempProject } from '../helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

/** Build main() options with the global rules seed redirected to an isolated temp dir. */
async function isolatedOptions(cwd: string) {
    const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
    const env = { ...process.env, SPUR_GLOBAL_RULES_DIR: globalDir };
    return { options: { cwd, env, output: nullOutput(), dbUrl: ':memory:' as const }, globalDir };
}

describe('init command', () => {
    test('scaffolds config, local rules, and an example workflow', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        expect(existsSync(join(cwd, '.spur', 'config.json'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules', 'recommended-pre-check.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules', 'recommended-post-check.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'workflows', 'basic.yaml'))).toBe(true);
        // Team-mode agent specs directory is tracked via .gitkeep.
        expect(existsSync(join(cwd, '.spur', 'agents', '.gitkeep'))).toBe(true);
    });

    test('seeds the global rules directory from the bundled presets', async () => {
        const cwd = await createTempProject();
        const { options, globalDir } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        // Bundled categories land in the isolated global root so any project's
        // `rule run --preset recommended-pre-check` resolves a real ruleset afterwards.
        expect(existsSync(join(globalDir, 'recommended.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'quality', 'tsdoc-exports.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'quality', 'coverage-gate.yaml'))).toBe(true);
    });

    test('--minimal skips local rules and workflow scaffold', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init', '--minimal'], options)).toBe(0);

        expect(existsSync(join(cwd, '.spur', 'config.json'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules'))).toBe(false);
        expect(existsSync(join(cwd, '.spur', 'workflows'))).toBe(false);
        // The agents directory is core team-mode infra, created even in --minimal mode.
        expect(existsSync(join(cwd, '.spur', 'agents', '.gitkeep'))).toBe(true);
    });

    test('re-init without --force is blocked, with --force overwrites', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);
        // A second plain init must refuse rather than silently clobber the config.
        expect(await main(['init'], options)).toBe(1);
        expect(await main(['init', '--force'], options)).toBe(0);
    });

    test('--json reports created files and the global seed count', async () => {
        const cwd = await createTempProject();
        const messages: string[] = [];
        const options = {
            cwd,
            env: { ...process.env, SPUR_GLOBAL_RULES_DIR: await mkdtemp(join(tmpdir(), 'spur-glob-')) },
            output: { write: (m: string) => messages.push(m), error: () => {} },
            dbUrl: ':memory:' as const,
        };

        expect(await main(['init', '--json', '--name', 'fixture'], options)).toBe(0);
        const result = JSON.parse(messages.at(-1) ?? '{}') as {
            ok: boolean;
            project: string;
            created: string[];
            globalRulesSeeded: number;
        };
        expect(result.ok).toBe(true);
        expect(result.project).toBe('fixture');
        expect(result.created.length).toBeGreaterThan(0);
        expect(result.globalRulesSeeded).toBeGreaterThan(0);
    });
});
