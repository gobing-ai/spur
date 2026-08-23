import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import { TASK_VARIANTS } from '@gobing-ai/spur-domain';
import { SCAFFOLD_MANIFEST } from '../../src/config/scaffold-manifest';
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
        expect(existsSync(join(cwd, '.spur', 'workflows', 'basic.yaml'))).toBe(true);
        // Team-mode agent specs directory is tracked via .gitkeep.
        expect(existsSync(join(cwd, '.spur', 'agents', '.gitkeep'))).toBe(true);

        // Task templates under .spur/templates/task/
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'standard.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'feature-impl.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'issue.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'review.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'meta.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'brainstorm.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'templates', 'feature', 'default.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'templates', 'bdd', 'gherkin.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'templates', 'bdd', 'checklist.md'))).toBe(true);
        // Section matrix under .spur/tasks/
        expect(existsSync(join(cwd, '.spur', 'tasks', 'section-matrix.yaml'))).toBe(true);
        // Lifecycle + pipeline workflows under .spur/workflows/
        expect(existsSync(join(cwd, '.spur', 'workflows', 'task-lifecycle.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'workflows', 'feature-lifecycle.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'workflows', 'task-pipeline.yaml'))).toBe(true);
    });

    test('seed copies the full rules/workflows tree into .spur/, not just manifest presets', async () => {
        // Monorepo convenience: .spur/{rules,workflows,…} may symlink into the repo-root
        // SSOT tree. End-user projects must get real copies of the kept trees, not only
        // SCAFFOLD_MANIFEST presets. What is deliberately NOT copied: the sibling test.
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        // Nested rule categories (full tree). Rules stay per-project by operator
        // ruling — they resolve against project folder structure (A4).
        expect(existsSync(join(cwd, '.spur', 'rules', 'typescript', 'no-debugger.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules', 'boundary', 'dao-boundary.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules', 'quality', 'coverage-gate.yaml'))).toBe(true);
        // The remapped manifest path is the LIVE template copy — loadTemplateBodies
        // reads .spur/tasks/templates/, so this one is load-bearing.
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'standard.md'))).toBe(true);
        // Extra workflows beyond the original curated subset
        expect(existsSync(join(cwd, '.spur', 'workflows', 'docs-pipeline.yaml'))).toBe(true);
    });

    test('init no longer seeds assets with no .spur/ reader (0646)', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        // Dead natural-path duplicate of the manifest remap above — zero readers.
        expect(existsSync(join(cwd, '.spur', 'templates', 'task', 'standard.md'))).toBe(false);
        // Placeholder tree with no reader at all.
        expect(existsSync(join(cwd, '.spur', 'plugins', '.gitkeep'))).toBe(false);
        // Monorepo dev baselines — read from repo-root config/, never from .spur/.
        expect(existsSync(join(cwd, '.spur', 'corpus-baseline.json'))).toBe(false);
        expect(existsSync(join(cwd, '.spur', 'plugin-scripts.json'))).toBe(false);
        // The shipped global default belongs in ~/.config/spur/, not a project.
        expect(existsSync(join(cwd, '.spur', 'config.global.yaml'))).toBe(false);
    });

    test('init writes the 1.2 config version label (0646)', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        const config = await readFile(join(cwd, '.spur', 'config.yaml'), 'utf8');
        expect(config).toContain('version: "1.2"');
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
        expect(existsSync(join(globalDir, 'config.global.yaml'))).toBe(false);
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
    test('SCAFFOLD_MANIFEST ships exactly one task template per TASK_VARIANTS entry', () => {
        // SSOT alignment invariant (task 0188): every variant the planning layer
        // recognizes must resolve to a scaffolded template, and the manifest must
        // not drift into shipping templates for variants the schema no longer lists.
        const taskTargets = new Set(
            SCAFFOLD_MANIFEST.filter((e) => e.target.startsWith('tasks/templates/')).map((e) =>
                e.target.slice('tasks/templates/'.length, -'.md'.length),
            ),
        );
        expect([...taskTargets].sort()).toEqual([...TASK_VARIANTS].sort());
    });

    test('every SCAFFOLD_MANIFEST task template resolves to a bundled source file', async () => {
        // A manifest entry whose `source` is missing from the bundled config tree
        // would silently drop a template from the fresh project. Catch it here.
        const configRoot = bundledConfigRoot();
        expect(configRoot, 'bundled config root must resolve in test env').not.toBeNull();
        for (const entry of SCAFFOLD_MANIFEST.filter((e) => e.target.startsWith('tasks/templates/'))) {
            const sourcePath = join(configRoot as string, entry.source);
            expect(existsSync(sourcePath), `missing source: ${entry.source}`).toBe(true);
        }
    });

    test('freshly scaffolded tree supports task creation with the standard template', async () => {
        // Functional probe mirroring /sp:spur-init Phase 1.5: the scaffold must be
        // immediately usable, not just present on disk.
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);
        // task create reads the scaffolded template + section-matrix; failure here
        // means the scaffold is internally inconsistent.
        expect(await main(['task', 'create', 'probe-task', '--json'], options)).toBe(0);
        expect(existsSync(join(cwd, '.spur', 'tasks'))).toBe(true);
    });
});
