import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveWorkflowFile } from '@gobing-ai/spur-app';
import { type BuilderConfig, getEnvVars, spurConfigSchema } from '@gobing-ai/spur-config';
import { bundledConfigRoot, parseConfigYaml } from '@gobing-ai/spur-config/loader';
import { TASK_VARIANTS } from '@gobing-ai/spur-domain';
import { renderBuilderBlock } from '../../src/commands/init';
import { SCAFFOLD_MANIFEST } from '../../src/config/scaffold-manifest';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';
import { createTempProject, createTempProjectStackNeutral, runCli } from '../helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

/** Build main() options with the global rules seed redirected to an isolated temp dir. */
async function isolatedOptions(cwd: string) {
    const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
    const env: Record<string, string | undefined> = { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: globalDir };
    return { options: { cwd, env, output: nullOutput(), dbUrl: ':memory:' as const }, globalDir };
}

/**
 * Run the real CLI's `init` against a fixture with an isolated global config root, then
 * parse the generated config through the load-time schema (1225 R5 — the file it writes
 * must load, not just look right).
 */
async function initAndParse(cwd: string, args: string[] = []): Promise<{ text: string; builder: BuilderConfig }> {
    const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
    const result = await runCli(['init', '--minimal', ...args], cwd, { SPUR_GLOBAL_RULES_DIR: globalDir });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const text = await readFile(join(cwd, '.spur', 'config.yaml'), 'utf8');
    const builder = spurConfigSchema.parse(parseConfigYaml(text)).builder;
    // `builder` always parses (schema default) — the cast only narrows the optional.
    return { text, builder: builder as BuilderConfig };
}

describe('init command', () => {
    test('scaffolds config, local rules, and task assets without workflow/template shadows', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        expect(existsSync(join(cwd, '.spur', 'config.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules', 'recommended-pre-check.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules', 'recommended-post-check.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'workflows'))).toBe(false);
        expect(existsSync(join(cwd, '.spur', 'templates'))).toBe(false);
        // Team-mode agent specs directory is tracked via .gitkeep.
        expect(existsSync(join(cwd, '.spur', 'agents', '.gitkeep'))).toBe(true);

        // Task templates under .spur/tasks/templates/
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'standard.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'feature-impl.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'issue.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'review.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'meta.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'tasks', 'templates', 'brainstorm.md'))).toBe(true);
        // Section matrix under .spur/tasks/
        expect(existsSync(join(cwd, '.spur', 'tasks', 'section-matrix.yaml'))).toBe(true);
    });

    test('seed copies the full rules tree but leaves bundled workflows unshadowed', async () => {
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
        expect(existsSync(join(cwd, '.spur', 'workflows'))).toBe(false);
    });

    test('a fresh project validates the bundled task pipeline without a local workflow directory', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);
        expect(existsSync(join(cwd, '.spur', 'workflows'))).toBe(false);

        const resolved = resolveWorkflowFile(cwd, '.spur/workflows/task-pipeline.yaml');
        expect(resolved.path).not.toBeNull();
        if (resolved.path !== null) expect(resolved.source).toBe('shared');

        const messages: string[] = [];
        const exitCode = await main(['workflow', 'validate', '.spur/workflows/task-pipeline.yaml', '--json'], {
            ...options,
            output: { write: (message: string) => messages.push(message), error: () => {} },
        });
        const parsed = JSON.parse(messages.at(-1) ?? '{}');
        expect(parsed.valid).toBe(true);
        expect(exitCode).toBe(0);
    });

    test('init no longer seeds assets with no .spur/ reader (0646)', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        // Dead natural-path duplicate of the manifest remap above — zero readers.
        expect(existsSync(join(cwd, '.spur', 'templates', 'task', 'standard.md'))).toBe(false);
        expect(existsSync(join(cwd, '.spur', 'templates'))).toBe(false);
        expect(existsSync(join(cwd, '.spur', 'workflows'))).toBe(false);
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

    test('seeds an explicit empty downstream Board module list and points at the guide (0992 R5)', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        const config = await readFile(join(cwd, '.spur', 'config.yaml'), 'utf8');
        // A fresh project opts in module by module: the declaration contract ships empty, never
        // pre-populated, so built-ins are all a new project renders until it declares its own.
        expect(config).toMatch(/^ {2}modules: \[\]$/m);
        expect(config).toContain('docs/design/downstream-board-modules.md');
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
        expect(existsSync(join(globalDir, 'workflows', 'wrapup-pipeline.yaml'))).toBe(true);
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

    test('re-init without --force converges; with --force overwrites', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);
        // A second plain init converges (task 0649 R1) instead of refusing — it
        // seeds nothing new and writes no config, but exits 0.
        expect(await main(['init'], options)).toBe(0);
        expect(await main(['init', '--force'], options)).toBe(0);
    });

    test('converge re-init leaves the existing config untouched', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);
        const configPath = join(cwd, '.spur', 'config.yaml');

        expect(await main(['init', '--name', 'original'], options)).toBe(0);
        const before = await Bun.file(configPath).text();

        // A converging re-run must NOT overwrite the project config (R2) — it writes
        // no config at all, whatever --name is passed.
        expect(await main(['init', '--name', 'clobbered'], options)).toBe(0);
        const after = await Bun.file(configPath).text();

        expect(after).toBe(before);
        expect(after).toContain('name: original');
    });

    test('--json reports created files and the global seed count', async () => {
        const cwd = await createTempProject();
        const messages: string[] = [];
        const options = {
            cwd,
            env: { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: await mkdtemp(join(tmpdir(), 'spur-glob-')) },
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

    test('converge re-init seeds a missing project asset (0649 R1)', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);
        // Remove a seeded rule file to simulate a partially-converged project.
        const rulesDir = join(cwd, '.spur', 'rules');
        const seeded = (await Bun.file(join(rulesDir, 'task.md')).exists()) ? join(rulesDir, 'task.md') : null;
        if (seeded === null) return; // no rules seeded in this fixture — skip gracefully
        await Bun.write(seeded, '');

        // A converging re-run seeds the missing asset and exits 0.
        expect(await main(['init'], options)).toBe(0);
        expect((await Bun.file(seeded).text()).length).toBeGreaterThan(0);
    });

    test('--adopt-global-config backs up the global config before rewriting it (0649 R3)', async () => {
        const cwd = await createTempProject();
        const { options, globalDir } = await isolatedOptions(cwd);
        const globalConfigPath = join(globalDir, 'config.yaml');

        expect(await main(['init'], options)).toBe(0);
        // Simulate an operator-owned pre-A4 global config.
        await Bun.write(globalConfigPath, 'name: my-machine\nworkflows: {}\n');

        expect(await main(['init', '--adopt-global-config'], options)).toBe(0);

        // A timestamped backup exists with the previous contents.
        const backups = (await Bun.$`ls ${globalDir}`.text()).split('\n').filter((p) => p.includes('config.yaml.bak-'));
        expect(backups.length).toBe(1);
        expect(await Bun.file(join(globalDir, backups[0] ?? '')).text()).toContain('name: my-machine');
        // The live global config is now the bundled default (no project-shaped name key).
        const after = await Bun.file(globalConfigPath).text();
        expect(after).toContain('workflows:');
    });

    test('a second adopt keeps the first backup (0649 R3)', async () => {
        const cwd = await createTempProject();
        const { options, globalDir } = await isolatedOptions(cwd);
        const globalConfigPath = join(globalDir, 'config.yaml');

        expect(await main(['init'], options)).toBe(0);
        await Bun.write(globalConfigPath, 'name: my-machine\n');

        expect(await main(['init', '--adopt-global-config'], options)).toBe(0);
        await Bun.write(globalConfigPath, 'name: my-machine\n');
        expect(await main(['init', '--adopt-global-config'], options)).toBe(0);

        const backups = (await Bun.$`ls ${globalDir}`.text()).split('\n').filter((p) => p.includes('config.yaml.bak-'));
        expect(backups.length).toBe(2);
    });

    test('a pre-A4 global config is reported with its offending keys (0649 R4)', async () => {
        const cwd = await createTempProject();
        const messages: string[] = [];
        const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
        const options = {
            cwd,
            env: { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: globalDir },
            output: { write: (m: string) => messages.push(m), error: () => {} },
            dbUrl: ':memory:' as const,
        };

        expect(await main(['init'], options)).toBe(0);
        // Pre-A4 global config carrying project-shaped keys.
        await Bun.write(join(globalDir, 'config.yaml'), 'name: my-machine\nbootstrap: {}\nrules: {}\n');

        // Detection reports even without the opt-in flag.
        expect(await main(['init', '--json'], options)).toBe(0);
        const result = JSON.parse(messages.at(-1) ?? '{}') as { misplacedGlobalKeys?: string[]; converged?: boolean };
        expect(result.converged).toBe(true);
        expect(result.misplacedGlobalKeys).toEqual(['name', 'bootstrap', 'rules']);
    });

    test('a correctly shaped global config produces no misplaced-key finding (0649 R4)', async () => {
        const cwd = await createTempProject();
        const messages: string[] = [];
        const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
        const options = {
            cwd,
            env: { ...getEnvVars(), SPUR_GLOBAL_RULES_DIR: globalDir },
            output: { write: (m: string) => messages.push(m), error: () => {} },
            dbUrl: ':memory:' as const,
        };

        expect(await main(['init'], options)).toBe(0);
        await Bun.write(join(globalDir, 'config.yaml'), 'agent:\n  default: coder\nworkflows: {}\n');

        expect(await main(['init', '--json'], options)).toBe(0);
        const result = JSON.parse(messages.at(-1) ?? '{}') as { misplacedGlobalKeys?: string[] };
        expect(result.misplacedGlobalKeys).toBeUndefined();
    });

    test('the shipped global default carries a top-level workflows key (0649 R5, 0819 R3)', async () => {
        const configRoot = bundledConfigRoot();
        expect(configRoot).not.toBeNull();
        const text = await readFile(join(configRoot as string, 'config.global.yaml'), 'utf8');
        // 0819 R3: the shared layer needs no config entry — the top-level key stays
        // (0649 R5) with an empty paths list; projects append registered extras.
        expect(text).toMatch(/^workflows:\n\s+paths: \[\]$/m);
        expect(text).not.toContain('bundled:');
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
        expect(await main(['task', 'create', '--skip-ready', 'probe-task', '--json'], options)).toBe(0);
        expect(existsSync(join(cwd, '.spur', 'tasks'))).toBe(true);
    });

    test('seeds builder preset bun from a bun lockfile (1225 R1)', async () => {
        for (const lock of ['bun.lock', 'bun.lockb']) {
            const cwd = await createTempProject();
            await Bun.write(join(cwd, lock), '');

            const { text, builder } = await initAndParse(cwd);

            expect(text).toContain('builder:\n  preset: bun');
            expect(builder).toEqual({ preset: 'bun', actions: {} });
        }
    });

    test('binds reserved Makefile targets as make actions (1225 R2)', async () => {
        const cwd = await createTempProject();
        await Bun.write(
            join(cwd, 'Makefile'),
            [
                'CC := cc',
                'build:',
                '\t@echo build',
                'test:',
                '\t@echo test',
                'lint-changed:',
                '\t@echo lint',
                'deploy: build',
                '\t@echo deploy',
                '',
            ].join('\n'),
        );

        const { text, builder } = await initAndParse(cwd);

        // Only reserved names that are targets, in reserved-vocabulary order — `CC := cc` is an
        // assignment and `deploy` is not a reserved action, so neither appears.
        expect(builder.preset).toBe('none');
        expect(builder.actions).toEqual({
            build: 'make build',
            test: 'make test',
            'lint-changed': 'make lint-changed',
        });
        expect(text).toContain('    build: make build');
        expect(text).not.toContain('deploy');
    });

    test('writes a commented actions skeleton when no stack is detected (1225 R3)', async () => {
        const cwd = await createTempProjectStackNeutral();
        await Bun.write(join(cwd, 'pyproject.toml'), '[project]\nname = "fixture"\n');

        const { text, builder } = await initAndParse(cwd);

        expect(builder).toEqual({ preset: 'none', actions: {} });
        expect(text).toContain('  # actions:');
        expect(text).toContain('  #   build: <command>');
        expect(text).toContain('  #   test-changed: <command>');
        // Commented out — nothing is bound.
        expect(text).not.toMatch(/^ {2}actions:/m);
    });

    test('re-init without --force keeps the config; --force re-detects the stack (1225 R4)', async () => {
        const cwd = await createTempProjectStackNeutral();
        await Bun.write(join(cwd, 'pyproject.toml'), '[project]\nname = "fixture"\n');
        const configPath = join(cwd, '.spur', 'config.yaml');

        const first = await initAndParse(cwd);
        expect(first.builder.preset).toBe('none');

        // A bun lockfile appears; a plain re-init converges and rewrites nothing.
        await Bun.write(join(cwd, 'bun.lock'), '');
        const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
        expect((await runCli(['init', '--minimal'], cwd, { SPUR_GLOBAL_RULES_DIR: globalDir })).code).toBe(0);
        expect(await readFile(configPath, 'utf8')).toBe(first.text);

        // --force regenerates it with the fresh detection.
        const forced = await initAndParse(cwd, ['--force']);
        expect(forced.text).toContain('builder:\n  preset: bun');
        expect(forced.builder.preset).toBe('bun');
    });
});

describe('JavaScript action onboarding (1303)', () => {
    // Failure cases: conflicting/unsupported manager evidence; malformed manifests/scripts;
    // aliases or script bodies copied into commands; lost Make/Bun precedence; executing
    // discovery candidates; silently assuming installed tools; rewriting custom config.
    const scripts = {
        build: 'touch discovery-ran',
        check: 'touch discovery-ran',
        'test-full': 'touch discovery-ran',
        'test:heavy': 'touch discovery-ran',
        'check; touch discovery-ran': 'touch discovery-ran',
        deploy: 'touch discovery-ran',
        lint: '',
        test: 42,
    };

    async function scaffold(manifest: string | null, locks: string[], makefile?: string) {
        const cwd = await createTempProjectStackNeutral();
        if (manifest !== null) await Bun.write(join(cwd, 'package.json'), manifest);
        for (const lock of locks) await Bun.write(join(cwd, lock), '');
        if (makefile !== undefined) await Bun.write(join(cwd, 'Makefile'), makefile);
        const { options } = await isolatedOptions(cwd);
        // PATH contains no tools: discovery must neither install nor execute a manager.
        options.env.PATH = cwd;
        expect(await main(['self', 'init', '--minimal'], options)).toBe(0);
        const text = await readFile(join(cwd, '.spur/config.yaml'), 'utf8');
        const builder = spurConfigSchema.parse(parseConfigYaml(text)).builder as BuilderConfig;
        expect(existsSync(join(cwd, 'discovery-ran'))).toBe(false);
        return { cwd, options, text, builder };
    }

    test.each([
        ['npm', ['package-lock.json'], undefined],
        ['npm', ['npm-shrinkwrap.json'], undefined],
        ['npm', ['package-lock.json', 'npm-shrinkwrap.json'], 'npm@10.0.0'],
        ['pnpm', ['pnpm-lock.yaml'], undefined],
        ['pnpm', [], 'pnpm@9.0.0'],
        ['npm', [], 'npm@10.0.0'],
    ] as const)('proposes only exact declared scripts for %s (%j, %s)', async (manager, locks, packageManager) => {
        const { text, builder, cwd, options } = await scaffold(JSON.stringify({ scripts, packageManager }), [...locks]);
        expect(builder).toEqual({
            preset: 'none',
            actions: {
                build: `${manager} run build`,
                'test-full': `${manager} run test-full`,
                check: `${manager} run check`,
            },
        });
        expect(text).toContain('# source: package.json scripts.build');
        expect(text).toContain(`# ${manager} is not available on PATH`);
        expect(text).toContain('#   test: <command>');
        expect(text).toContain('no matching declared target or script');
        expect(text).not.toContain('touch discovery-ran');
        expect(text).not.toContain('test:heavy');

        // Inspect the generated binding through the existing transport and real config loader.
        const globalDir = options.env.SPUR_GLOBAL_RULES_DIR;
        const list = await runCli(['--no-logo', 'self', 'exec', '--list', '--json'], cwd, {
            SPUR_GLOBAL_RULES_DIR: globalDir,
        });
        expect(list.code).toBe(0);
        expect(list.json).toContainEqual({
            name: 'build',
            reserved: true,
            source: 'config',
            command: `${manager} run build`,
        });
        const preview = await runCli(['--no-logo', 'self', 'exec', 'build', '--dry-run', '--json'], cwd, {
            SPUR_GLOBAL_RULES_DIR: globalDir,
        });
        expect(preview.code).toBe(0);
        expect(preview.json).toEqual([{ name: 'build', command: `${manager} run build` }]);
        expect(existsSync(join(cwd, 'discovery-ran'))).toBe(false);
    });

    test.each([
        ['npm', ['package-lock.json']],
        ['pnpm', ['pnpm-lock.yaml']],
        ['conflicting managers', ['package-lock.json', 'pnpm-lock.yaml']],
    ] as const)('keeps rule defaults out of unbound proposals for %s', async (_manager, locks) => {
        const { cwd, options, text } = await scaffold(JSON.stringify({ scripts }), [...locks]);
        const list = await runCli(['--no-logo', 'self', 'exec', '--list', '--json'], cwd, {
            SPUR_GLOBAL_RULES_DIR: options.env.SPUR_GLOBAL_RULES_DIR,
        });
        expect(list.code).toBe(0);
        for (const [name, preset] of [
            ['rules-pre', 'recommended-pre-check'],
            ['rules-post', 'recommended-post-check'],
        ]) {
            expect(list.json).toContainEqual({
                name,
                reserved: true,
                source: 'default',
                command: `spur rule run --preset ${preset} --fail-on warning --no-logo`,
            });
            expect(text).not.toContain(`#   ${name}: <command>`);
        }
        expect(text).toContain('#   test: <command>');
    });

    test.each([
        [JSON.stringify({ scripts }), ['package-lock.json', 'pnpm-lock.yaml'], 'conflicting package manager evidence'],
        [
            JSON.stringify({ scripts, packageManager: 'npm@10' }),
            ['pnpm-lock.yaml'],
            'conflicting package manager evidence',
        ],
        [
            JSON.stringify({ scripts, packageManager: 'pnpm@9' }),
            ['package-lock.json'],
            'conflicting package manager evidence',
        ],
        [JSON.stringify({ scripts }), ['package-lock.json', 'yarn.lock'], 'conflicting package manager evidence'],
        [JSON.stringify({ scripts, packageManager: 'yarn@4' }), [], 'unsupported packageManager'],
        [JSON.stringify({ scripts, packageManager: 'npm@10; touch discovery-ran' }), [], 'invalid packageManager'],
        [JSON.stringify({ scripts, packageManager: 42 }), ['package-lock.json'], 'invalid packageManager'],
        [JSON.stringify({ scripts }), [], 'no unambiguous npm or pnpm evidence'],
        ['{invalid', ['package-lock.json'], 'invalid package.json'],
        ['null', ['package-lock.json'], 'invalid package.json'],
        ['[]', ['package-lock.json'], 'invalid package.json'],
        [null, ['package-lock.json'], 'no package.json'],
    ] as const)('keeps ambiguous or malformed input unbound: %s %j', async (manifest, locks, diagnostic) => {
        const { text, builder } = await scaffold(manifest, [...locks]);
        expect(builder).toEqual({ preset: 'none', actions: {} });
        expect(text).toContain(diagnostic);
        expect(text).toContain('#   build: <command>');
    });

    test.each([{}, { scripts: null }, { scripts: [] }, { scripts: 'check' }, { scripts: { check: false } }])(
        'does not infer commands from missing or invalid scripts: %j',
        async (manifest) => {
            const { builder } = await scaffold(JSON.stringify(manifest), ['package-lock.json']);
            expect(builder.actions).toEqual({});
        },
    );

    test('Make targets override matching scripts and leave remaining scripts available', async () => {
        const { builder, text } = await scaffold(
            JSON.stringify({ scripts }),
            ['pnpm-lock.yaml'],
            'build:\n\ttouch discovery-ran\n',
        );
        expect(builder.actions).toEqual({
            build: 'make build',
            'test-full': 'pnpm run test-full',
            check: 'pnpm run check',
        });
        expect(text).toContain('# source: Makefile target build');
    });

    test('Make targets survive conflicting JS evidence; Bun retains its established preset precedence', async () => {
        const manifest = JSON.stringify({ scripts, packageManager: 'pnpm@9' });
        const make = await scaffold(manifest, ['package-lock.json'], 'build:\n\ttouch discovery-ran\n');
        expect(make.builder.actions).toEqual({ build: 'make build' });
        const bun = await scaffold(manifest, ['bun.lock', 'package-lock.json'], 'build:\n');
        expect(bun.builder).toEqual({ preset: 'bun', actions: {} });
    });

    test('re-init preserves every byte of custom actions even when discovery evidence conflicts', async () => {
        const { cwd, options } = await scaffold(JSON.stringify({ scripts }), ['package-lock.json']);
        const custom =
            '# user comment\nbuilder:\n  preset: none\n  actions:\n    check: custom-check\n    ci: [check]\n';
        await Bun.write(join(cwd, '.spur/config.yaml'), custom);
        await Bun.write(join(cwd, 'pnpm-lock.yaml'), '');
        expect(await main(['self', 'init', '--minimal'], options)).toBe(0);
        expect(await readFile(join(cwd, '.spur/config.yaml'), 'utf8')).toBe(custom);
    });

    test('available manager discovery uses PATH lookup only and preserves fixed command names', () => {
        // The pure renderer supports availability evidence without invoking a manager.
        const text = renderBuilderBlock({
            bunLock: false,
            makefile: null,
            packageJson: JSON.stringify({ scripts: { check: ':' } }),
            lockfiles: ['package-lock.json'],
            availableManagers: { npm: true, pnpm: false },
        }).join('\n');
        expect(text).toContain('check: npm run check');
        expect(text).not.toContain('not available on PATH');
    });
});

describe('language and package-root onboarding (1304)', () => {
    // Failure cases: inferred Python commands; missing native tools; Make overrides lost;
    // ambiguous package roots silently selected; recursive/outside discovery; shell/YAML
    // injection through a child name; child commands running in the repository root;
    // discovery executing tools; re-init replacing an operator's explicit actions.
    async function scaffold(files: Record<string, string>, tools = ['cargo', 'go', 'make', 'bun']) {
        const cwd = await createTempProjectStackNeutral();
        const bin = await mkdtemp(join(tmpdir(), 'spur-tools-'));
        for (const tool of tools) {
            const path = join(bin, tool);
            await Bun.write(path, '#!/bin/sh\nprintf "%s:%s:%s\\n" "$0" "$PWD" "$*" >> tool-ran\n');
            await chmod(path, 0o755);
        }
        for (const [path, content] of Object.entries(files)) await Bun.write(join(cwd, path), content);
        const { options } = await isolatedOptions(cwd);
        options.env.PATH = bin;
        expect(await main(['self', 'init', '--minimal'], options)).toBe(0);
        const text = await readFile(join(cwd, '.spur/config.yaml'), 'utf8');
        const builder = spurConfigSchema.parse(parseConfigYaml(text)).builder as BuilderConfig;
        expect(existsSync(join(cwd, 'tool-ran'))).toBe(false);
        return { cwd, bin, options, text, builder };
    }

    test('Cargo uses the selected manifest defaults and a check/test composite', async () => {
        const { text, builder } = await scaffold({
            'Cargo.toml': '[workspace]\nmembers = ["chosen", "other"]\ndefault-members = ["chosen"]\n',
            'chosen/Cargo.toml': '[package]\nname = "chosen"\nversion = "0.1.0"\n',
            'other/Cargo.toml': '[package]\nname = "other"\nversion = "0.1.0"\n',
        });
        expect(builder).toEqual({
            preset: 'none',
            actions: {
                build: 'cargo build',
                typecheck: 'cargo check',
                test: 'cargo test',
                check: ['typecheck', 'test'],
            },
        });
        expect(text).toContain('working directory: .');
        expect(text).toContain('cargo is available on PATH');
        expect(text).toContain('source: Cargo.toml');
        expect(text).not.toContain('--workspace');
    });

    test('Go compiles and tests ./... without inventing lint or typecheck', async () => {
        const { builder, text } = await scaffold({ 'go.mod': 'module example.com/fixture\ngo 1.22\n' });
        expect(builder.actions).toEqual({ build: 'go build ./...', test: 'go test ./...', check: ['build', 'test'] });
        expect(text).toContain('go is available on PATH');
        expect(text).toContain('#   lint: <command>');
        expect(text).toContain('#   typecheck: <command>');
    });

    test.each(['Cargo.toml', 'go.mod'])('missing native tool stays unbound for %s', async (manifest) => {
        const { builder, text } = await scaffold({ [manifest]: '' }, []);
        expect(builder.actions).toEqual({});
        expect(text).toContain('not available on PATH');
        expect(text).toContain('remain unbound');
    });

    test('Python project.scripts are not shell actions; only matching Make targets bind', async () => {
        const python = '[project.scripts]\ncheck = "fixture:main"\ntest = "pytest:main"\n';
        const bare = await scaffold({ 'pyproject.toml': python });
        expect(bare.builder.actions).toEqual({});
        expect(bare.text).toContain('Python commands require explicit bindings');
        const make = await scaffold({ 'pyproject.toml': python, Makefile: 'check:\n\t@echo explicit\ntest:\n' });
        expect(make.builder.actions).toEqual({ test: 'make test', check: 'make check' });
        expect(make.text).toContain('make is available on PATH');
    });

    test('Make wins each matching native action, including explicit check', async () => {
        const { builder } = await scaffold({ 'Cargo.toml': '', Makefile: 'build:\ncheck:\n' });
        expect(builder.actions).toEqual({
            build: 'make build',
            typecheck: 'cargo check',
            test: 'cargo test',
            check: 'make check',
        });
        const absent = await scaffold({ 'go.mod': '', Makefile: 'test:\n' }, []);
        expect(absent.builder.actions).toEqual({ test: 'make test' });
        expect(absent.text).toContain('make is not available on PATH');
    });

    test('conflicting native manifests keep only explicit Make actions', async () => {
        const { builder, text } = await scaffold({ 'Cargo.toml': '', 'go.mod': '', Makefile: 'check:\n' });
        expect(builder.actions).toEqual({ check: 'make check' });
        expect(text).toContain('conflicting language manifests');
    });

    test('a root manifest wins even when it declares no commands', async () => {
        const { builder, text } = await scaffold({ 'pyproject.toml': '', 'child/go.mod': '' });
        expect(builder.actions).toEqual({});
        expect(text).toContain('working directory: .');
    });

    test.each([
        [
            'Cargo.toml',
            { build: 'cargo build', typecheck: 'cargo check', test: 'cargo test', check: ['typecheck', 'test'] },
        ],
        ['go.mod', { build: 'go build ./...', test: 'go test ./...', check: ['build', 'test'] }],
        ['Makefile', { check: 'make check' }],
        ['pyproject.toml', {}],
    ])('selects a single immediate child with %s', async (manifest, actions) => {
        const { builder, text, cwd } = await scaffold({
            [`child/${manifest}`]: manifest === 'Makefile' ? 'check:\n' : '',
        });
        const expected = Object.fromEntries(
            Object.entries(actions).map(([name, command]) => [
                name,
                typeof command === 'string' ? `cd ./child && ${command}` : command,
            ]),
        );
        expect(builder.actions).toEqual(expected);
        expect(text).toContain('working directory: child');
        expect(existsSync(join(cwd, 'child/tool-ran'))).toBe(false);
    });

    test.each(['pnpm', 'bun'])('selected child JavaScript uses declared %s commands only', async (manager) => {
        const { builder } = await scaffold({
            'child/package.json': JSON.stringify({ packageManager: `${manager}@1.0.0`, scripts: { check: ':' } }),
            ...(manager === 'bun' ? { 'child/bun.lock': '' } : {}),
        });
        expect(builder).toEqual({ preset: 'none', actions: { check: `cd ./child && ${manager} run check` } });
    });

    test('multiple mixed roots list sorted paths and propose no actions', async () => {
        const { builder, text } = await scaffold({
            'rust/Cargo.toml': '',
            'go/go.mod': '',
            'python/pyproject.toml': '',
        });
        expect(builder.actions).toEqual({});
        expect(text).toContain('multiple candidate roots: go, python, rust');
        expect(text).toContain('remain unbound');
    });

    test('does not recurse or select hidden, dependency, vendor or outside symlink roots', async () => {
        const cwd = await createTempProjectStackNeutral();
        const outside = await createTempProjectStackNeutral();
        await Bun.write(join(outside, 'go.mod'), '');
        await symlink(outside, join(cwd, 'linked'));
        for (const directory of ['packages/deep', '.hidden', 'node_modules', 'vendors', 'vendor']) {
            await Bun.write(join(cwd, directory, 'go.mod'), '');
        }
        await mkdir(join(cwd, 'empty'));
        await Bun.write(join(cwd, 'README.md'), 'ordinary file');
        const { options } = await isolatedOptions(cwd);
        expect(await main(['self', 'init', '--minimal'], options)).toBe(0);
        const text = await readFile(join(cwd, '.spur/config.yaml'), 'utf8');
        expect((spurConfigSchema.parse(parseConfigYaml(text)).builder as BuilderConfig).actions).toEqual({});
        expect(text).not.toContain('working directory: linked');
    });

    test('selected child execution ignores a competing CDPATH directory', async () => {
        // Failure: cd child selects CDPATH/child and successfully executes the wrong project's code.
        const { cwd, bin, options } = await scaffold({ 'child/Makefile': 'check:\n' }, ['make']);
        const alternate = await mkdtemp(join(tmpdir(), 'spur-cdpath-'));
        await mkdir(join(alternate, 'child'));
        const env = {
            PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
            CDPATH: alternate,
            SPUR_GLOBAL_RULES_DIR: options.env.SPUR_GLOBAL_RULES_DIR,
        };
        const preview = await runCli(['--no-logo', 'self', 'exec', 'check', '--dry-run', '--json'], cwd, env);
        expect(preview.code).toBe(0);
        const executed = await runCli(['--no-logo', 'self', 'exec', 'check', '--json'], cwd, env);
        expect(executed.code).toBe(0);
        expect(existsSync(join(alternate, 'child/tool-ran'))).toBe(false);
        expect(await readFile(join(cwd, 'child/tool-ran'), 'utf8')).toContain('/child:check');
        expect(preview.json).toEqual([{ name: 'check', command: 'cd ./child && make check' }]);
    });

    test('four-action public journey quotes a child path and executes only inside it', async () => {
        const child = "-child's: $(touch injected)";
        const { cwd, bin, options, builder, text } = await scaffold({ [`${child}/go.mod`]: '' }, ['go']);
        const prefix = "cd './-child'\\''s: $(touch injected)' && ";
        expect(builder.actions.build).toBe(`${prefix}go build ./...`);
        const env = {
            PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
            SPUR_GLOBAL_RULES_DIR: options.env.SPUR_GLOBAL_RULES_DIR,
        };
        // Action 1 was self init; inspect, preview and accept/run are actions 2–4.
        const list = await runCli(['--no-logo', 'self', 'exec', '--list', '--json'], cwd, env);
        expect(list.code).toBe(0);
        expect(list.json).toContainEqual({ name: 'check', reserved: true, source: 'config', steps: ['build', 'test'] });
        const preview = await runCli(['--no-logo', 'self', 'exec', 'check', '--dry-run', '--json'], cwd, env);
        expect(preview.code).toBe(0);
        expect(preview.json).toEqual([
            { name: 'build', command: `${prefix}go build ./...` },
            { name: 'test', command: `${prefix}go test ./...` },
        ]);
        expect(existsSync(join(cwd, child, 'tool-ran'))).toBe(false);
        const executed = await runCli(['--no-logo', 'self', 'exec', 'check', '--json'], cwd, env);
        expect(executed.code).toBe(0);
        const receipt = await readFile(join(cwd, child, 'tool-ran'), 'utf8');
        expect(receipt).toContain(`${child}:build ./...`);
        expect(receipt).toContain(`${child}:test ./...`);
        expect(existsSync(join(cwd, 'tool-ran'))).toBe(false);
        expect(existsSync(join(cwd, 'injected'))).toBe(false);
        // New detection inputs never overwrite existing operator bindings on re-init.
        const custom = '# operator config\nbuilder:\n  preset: none\n  actions:\n    check: explicit-command\n';
        await Bun.write(join(cwd, '.spur/config.yaml'), custom);
        await Bun.write(join(cwd, 'Cargo.toml'), '');
        expect(await main(['self', 'init', '--minimal'], options)).toBe(0);
        expect(await readFile(join(cwd, '.spur/config.yaml'), 'utf8')).toBe(custom);
        expect(text).toContain('working directory:');
    });
});
