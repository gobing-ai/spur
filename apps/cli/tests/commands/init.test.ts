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

        expect(existsSync(join(cwd, '.spur', 'config.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules', 'recommended-pre-check.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules', 'recommended-post-check.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'config', 'workflows', 'basic.yaml'))).toBe(true);
        // Team-mode agent specs directory is tracked via .gitkeep.
        expect(existsSync(join(cwd, '.spur', 'agents', '.gitkeep'))).toBe(true);

        // Templates are copied under .spur/config/templates/
        expect(existsSync(join(cwd, '.spur', 'config', 'templates', 'task', 'standard.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'config', 'templates', 'task', 'feature-impl.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'config', 'templates', 'task', 'issue.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'config', 'templates', 'task', 'review.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'config', 'templates', 'task', 'meta.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'config', 'templates', 'feature', 'default.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'config', 'templates', 'bdd', 'gherkin.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'config', 'templates', 'bdd', 'checklist.md'))).toBe(true);
        // Section matrix under .spur/config/tasks/
        expect(existsSync(join(cwd, '.spur', 'config', 'tasks', 'section-matrix.yaml'))).toBe(true);
        // Lifecycle + pipeline workflows under .spur/config/workflows/
        expect(existsSync(join(cwd, '.spur', 'config', 'workflows', 'task-lifecycle.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'config', 'workflows', 'feature-lifecycle.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'config', 'workflows', 'task-pipeline.yaml'))).toBe(true);
    });

    test('seeds the global rules directory from the bundled presets', async () => {
        const cwd = await createTempProject();
        const { options, globalDir } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        // Bundled ts-rule-engine categories land in the isolated global root so any
        // project's `rule run --preset recommended-pre-check` resolves a real ruleset.
        expect(existsSync(join(globalDir, 'example.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'quality', 'tsdoc-exports.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'quality', 'coverage-gate.yaml'))).toBe(true);
        // Bundled config assets (from seedGlobalConfig) also land here.
        expect(existsSync(join(globalDir, 'rules', 'recommended-pre-check.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'rules', 'recommended-post-check.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'workflows', 'basic.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'workflows', 'task-lifecycle.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'workflows', 'feature-lifecycle.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'workflows', 'task-pipeline.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'tasks', 'section-matrix.yaml'))).toBe(true);
        // The bundled example is seeded under its canonical name, never verbatim:
        // a fresh install gets a working ~/.config/spur/config.yaml automatically.
        expect(existsSync(join(globalDir, 'config.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'config.example.yaml'))).toBe(false);
    });

    test('--minimal skips local rules and workflow scaffold', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init', '--minimal'], options)).toBe(0);

        expect(existsSync(join(cwd, '.spur', 'config.yaml'))).toBe(true);
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

    test('refused re-init leaves the existing config untouched', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);
        const configPath = join(cwd, '.spur', 'config.yaml');

        expect(await main(['init', '--name', 'original'], options)).toBe(0);
        const before = await Bun.file(configPath).text();

        // The guard must halt the whole scaffold — not just set exit 1 and then
        // overwrite the config it just refused to clobber (regression guard).
        expect(await main(['init', '--name', 'clobbered'], options)).toBe(1);
        const after = await Bun.file(configPath).text();

        expect(after).toBe(before);
        expect(after).toContain('name: original');
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
