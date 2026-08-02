import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    AgentConfigSchema,
    DEFAULT_FEATURES_DIR,
    DEFAULT_TASKS_DIR,
    RedactionConfigSchema,
    RulesConfigSchema,
    spurConfigSchema,
    WorkflowsConfigSchema,
} from '../src/index';
import {
    invalidateSpurConfig,
    loadSpurConfig,
    loadStructuredSpurConfig,
    type PlanningFolders,
    resolveConfigFile,
    resolvePlanningFolders,
    type TaskFoldersConfig,
} from '../src/loader';

let tmpCwd: string;
let originalSkipGlobalConfig: string | undefined;

beforeEach(async () => {
    originalSkipGlobalConfig = process.env.SPUR_SKIP_GLOBAL_CONFIG;
    process.env.SPUR_SKIP_GLOBAL_CONFIG = 'true';
    tmpCwd = await mkdtemp(join(tmpdir(), 'spur-cfg-'));
});

afterEach(async () => {
    await rm(tmpCwd, { recursive: true, force: true });
    if (originalSkipGlobalConfig === undefined) {
        delete process.env.SPUR_SKIP_GLOBAL_CONFIG;
    } else {
        process.env.SPUR_SKIP_GLOBAL_CONFIG = originalSkipGlobalConfig;
    }
});

const CONFIG_YAML = `version: "1"
name: test-project
agent:
  default: codex
  executors:
    - name: fast
      agent: codex
      model: gpt-5
rules:
  paths:
    - .spur/rules/recommended-pre-check.yaml
workflows:
  paths:
    - .spur/workflows/
redaction:
  enabled: true
tasks:
  folders:
    docs/tasks:
      baseCounter: 0
      label: Core
    docs/tasks2:
      baseCounter: 100
      label: Phase 2
  active: docs/tasks2
features:
  dir: docs/features
`;

async function writeConfig(cwd: string, content: string): Promise<void> {
    await mkdir(join(cwd, '.spur'), { recursive: true });
    await writeFile(join(cwd, '.spur', 'config.yaml'), content);
}

// ---- Merged schema ----

describe('spurConfigSchema (merged)', () => {
    test('parses a full config covering all sections', () => {
        const result = spurConfigSchema.safeParse({
            version: '1',
            name: 'x',
            agent: { default: 'codex' },
            rules: { paths: ['.spur/rules/x.yaml'] },
            workflows: { paths: ['.spur/workflows/'] },
            redaction: { enabled: true },
            tasks: { active: 'docs/tasks', folders: {} },
            features: { dir: 'docs/features' },
        });
        expect(result.success).toBe(true);
    });

    test('applies defaults for a fully-empty config (partial-config tolerance)', () => {
        const result = spurConfigSchema.parse({});
        expect(result.version).toBeUndefined();
        expect(result.agent).toBeUndefined();
        expect(result.tasks).toBeUndefined();
        expect(result.features).toBeUndefined();
    });

    test('tasks sub-schema defaults active to DEFAULT_TASKS_DIR when present but empty', () => {
        const result = spurConfigSchema.parse({ tasks: {} });
        expect(result.tasks?.active).toBe(DEFAULT_TASKS_DIR);
        expect(result.tasks?.folders).toEqual({});
    });

    test('features sub-schema defaults dir to DEFAULT_FEATURES_DIR', () => {
        const result = spurConfigSchema.parse({ features: {} });
        expect(result.features?.dir).toBe(DEFAULT_FEATURES_DIR);
    });
});

// ---- App-section schemas (moved from cli/config/schema) ----

describe('app-section schemas', () => {
    test('AgentConfigSchema rejects duplicate executor names', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [
                { name: 'dup', agent: 'codex' },
                { name: 'dup', agent: 'claude' },
            ],
        });
        expect(result.success).toBe(false);
    });

    test('AgentConfigSchema accepts unique executor names', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [
                { name: 'fast', agent: 'codex', model: 'gpt-5' },
                { name: 'slow', agent: 'claude' },
            ],
        });
        expect(result.success).toBe(true);
    });

    test('AgentConfigSchema rejects an executor named "inline" (task 0413 R4)', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [{ name: 'inline', agent: 'pi' }],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some((i) => i.message.includes('reserved') && i.message.includes('inline')),
            ).toBe(true);
            expect(result.error.issues.some((i) => i.path.join('.') === 'executors.0.name')).toBe(true);
        }
    });

    test('AgentConfigSchema rejects an executor named "auto" (task 0413 R4)', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [{ name: 'auto', agent: 'claude' }],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message.includes('reserved') && i.message.includes('auto'))).toBe(
                true,
            );
        }
    });

    test('executor tier accepts capable-1/2/3 and normalizes legacy bare capable (0343)', () => {
        const result = AgentConfigSchema.parse({
            executors: [
                { name: 'a', agent: 'claude', tier: 'capable-3' },
                { name: 'b', agent: 'omp', tier: 'capable' },
                { name: 'c', agent: 'pi', tier: 'capable-1' },
            ],
        });
        expect(result.executors?.map((e) => e.tier)).toEqual(['capable-3', 'capable-1', 'capable-1']);
    });

    test('executor tier rejects unknown values', () => {
        const result = AgentConfigSchema.safeParse({
            executors: [{ name: 'a', agent: 'claude', tier: 'capable-9' }],
        });
        expect(result.success).toBe(false);
    });

    test('RulesConfigSchema accepts a paths array', () => {
        expect(RulesConfigSchema.safeParse({ paths: ['a'] }).success).toBe(true);
    });

    test('WorkflowsConfigSchema accepts a paths array', () => {
        expect(WorkflowsConfigSchema.safeParse({ paths: ['a'] }).success).toBe(true);
    });

    test('RedactionConfigSchema accepts enabled boolean', () => {
        expect(RedactionConfigSchema.safeParse({ enabled: true }).success).toBe(true);
    });
});

// ---- loadSpurConfig ----

describe('loadSpurConfig', () => {
    test('returns schema defaults when the config file is absent', async () => {
        const config = await loadSpurConfig(tmpCwd);
        expect(config.tasks).toBeUndefined();
        expect(config.features).toBeUndefined();
        expect(config.agent).toBeUndefined();
    });

    test('loads and validates a full config via zod path (default in test)', async () => {
        await writeConfig(tmpCwd, CONFIG_YAML);
        const config = await loadSpurConfig(tmpCwd);
        expect(config.name).toBe('test-project');
        expect(config.agent?.default).toBe('codex');
        expect(config.agent?.executors?.[0]?.model).toBe('gpt-5');
        expect(config.redaction?.enabled).toBe(true);
        expect(config.tasks?.active).toBe('docs/tasks2');
        expect(config.tasks?.folders['docs/tasks']?.label).toBe('Core');
        expect(config.features?.dir).toBe('docs/features');
    });

    test('handles an empty config file gracefully', async () => {
        await writeConfig(tmpCwd, '');
        const config = await loadSpurConfig(tmpCwd);
        expect(config.version).toBeUndefined();
    });

    test('throws on invalid YAML structure that fails zod', async () => {
        await writeConfig(tmpCwd, 'tasks:\n  active: 12345\n  folders: "not-a-map"');
        await expect(loadSpurConfig(tmpCwd)).rejects.toThrow();
    });

    test('resolves package $schema refs from the workspace schema on disk', async () => {
        await writeConfig(
            tmpCwd,
            '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"\nversion: "1"\nname: schema-ref\n',
        );
        const config = await loadSpurConfig(tmpCwd, { validateJsonSchema: true });
        expect(config.name).toBe('schema-ref');
    });
});

// ---- resolveConfigFile ----

describe('resolveConfigFile', () => {
    test('returns the project config path when it exists', async () => {
        await writeConfig(tmpCwd, 'name: x\n');
        const result = resolveConfigFile(tmpCwd);
        expect(result).toBe(join(tmpCwd, '.spur', 'config.yaml'));
    });

    test('returns undefined when project config is missing and global is skipped', () => {
        const orig = process.env.SPUR_SKIP_GLOBAL_CONFIG;
        process.env.SPUR_SKIP_GLOBAL_CONFIG = 'true';
        const result = resolveConfigFile(tmpCwd);
        process.env.SPUR_SKIP_GLOBAL_CONFIG = orig;
        expect(result).toBeUndefined();
    });
});

// ---- resolvePlanningFolders ----

const DEFAULT_FOLDERS: TaskFoldersConfig = {
    active_folder: DEFAULT_TASKS_DIR,
    folders: { [DEFAULT_TASKS_DIR]: { base_counter: 0 } },
};

describe('resolvePlanningFolders', () => {
    test('returns defaults when config is absent', async () => {
        const fs = createNodeFileSystem(tmpCwd);
        const result = await resolvePlanningFolders(fs);
        const expected: PlanningFolders = {
            tasksDir: DEFAULT_TASKS_DIR,
            featuresDir: DEFAULT_FEATURES_DIR,
            foldersConfig: DEFAULT_FOLDERS,
        };
        expect(result).toEqual(expected);
    });

    test('derives folders from a full config', async () => {
        await writeConfig(tmpCwd, CONFIG_YAML);
        const fs = createNodeFileSystem(tmpCwd);
        const result = await resolvePlanningFolders(fs);
        expect(result.tasksDir).toBe('docs/tasks2');
        expect(result.featuresDir).toBe('docs/features');
        expect(result.foldersConfig.active_folder).toBe('docs/tasks2');
        expect(result.foldersConfig.folders['docs/tasks']).toEqual({ base_counter: 0, label: 'Core' });
        expect(result.foldersConfig.folders['docs/tasks2']).toEqual({ base_counter: 100, label: 'Phase 2' });
    });

    test('falls back to defaults when the config is malformed', async () => {
        await writeConfig(tmpCwd, 'tasks: [invalid, yaml, structure]');
        const fs = createNodeFileSystem(tmpCwd);
        const result = await resolvePlanningFolders(fs);
        expect(result.tasksDir).toBe(DEFAULT_TASKS_DIR);
        expect(result.foldersConfig).toEqual(DEFAULT_FOLDERS);
    });

    test('uses features default dir when features block is absent but tasks is present', async () => {
        await writeConfig(tmpCwd, 'tasks:\n  active: docs/tasks\n  folders:\n    docs/tasks:\n      baseCounter: 5\n');
        const fs = createNodeFileSystem(tmpCwd);
        const result = await resolvePlanningFolders(fs);
        expect(result.featuresDir).toBe(DEFAULT_FEATURES_DIR);
        expect(result.tasksDir).toBe('docs/tasks');
        expect(result.foldersConfig.folders['docs/tasks']).toEqual({ base_counter: 5 });
    });
});
// ---- resolveConfigFile: global fallback ----

describe('resolveConfigFile global fallback', () => {
    test('falls back to the global config path when project config is missing', async () => {
        // GLOBAL_CONFIG_FILE is bound at module load from homedir(), which reads $HOME.
        // Run in a subprocess with HOME pointed at a temp dir so the constant binds to a
        // path we fully control — hermetic, no touching the operator's real ~/.config.
        const fakeHome = await mkdtemp(join(tmpdir(), 'spur-home-'));
        const globalDir = join(fakeHome, '.config', 'spur');
        const globalPath = join(globalDir, 'config.yaml');
        await mkdir(globalDir, { recursive: true });
        await writeFile(globalPath, 'name: global\n');

        const projectDir = await mkdtemp(join(tmpdir(), 'spur-proj-')); // no .spur/config.yaml

        // Anchor the loader path to this test file's directory, not process.cwd():
        // the aggregate `bun run test` runs from the repo root, where a cwd-relative
        // `src/loader.ts` would not resolve. `import.meta.dir` is stable regardless.
        const loaderPath = join(import.meta.dir, '..', 'src', 'loader.ts');
        const script = `
            import { resolveConfigFile } from '${loaderPath}';
            const path = resolveConfigFile('${projectDir}');
            process.stdout.write(path ?? 'undefined');
        `;
        const proc = Bun.spawn(['bun', '-e', script], {
            // tests/setup.ts sets SPUR_SKIP_GLOBAL_CONFIG='true' globally to keep the
            // suite off the operator's real ~/.config. This test exercises the global
            // fallback on purpose, so clear that flag for the hermetic subprocess
            // (HOME is already redirected to a temp dir).
            env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, SPUR_SKIP_GLOBAL_CONFIG: '' },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const out = await new Response(proc.stdout).text();
        const code = await proc.exited;
        await rm(fakeHome, { recursive: true, force: true });
        await rm(projectDir, { recursive: true, force: true });
        expect(code).toBe(0);
        expect(out).toBe(globalPath);
    });

    test('loadSpurConfig uses the same global fallback as resolveConfigFile', async () => {
        const fakeHome = await mkdtemp(join(tmpdir(), 'spur-home-'));
        const globalDir = join(fakeHome, '.config', 'spur');
        await mkdir(globalDir, { recursive: true });
        await writeFile(join(globalDir, 'config.yaml'), 'name: global-loaded\n');

        const projectDir = await mkdtemp(join(tmpdir(), 'spur-proj-'));
        const loaderPath = join(import.meta.dir, '..', 'src', 'loader.ts');
        const script = `
            import { loadSpurConfig } from '${loaderPath}';
            const config = await loadSpurConfig('${projectDir}', { validateJsonSchema: false });
            process.stdout.write(config.name ?? 'undefined');
        `;
        const proc = Bun.spawn(['bun', '-e', script], {
            env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, SPUR_SKIP_GLOBAL_CONFIG: '' },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const out = await new Response(proc.stdout).text();
        const code = await proc.exited;
        await rm(fakeHome, { recursive: true, force: true });
        await rm(projectDir, { recursive: true, force: true });
        expect(code).toBe(0);
        expect(out).toBe('global-loaded');
    });
});

// ---- loadSpurConfig: JSON Schema validation path (production) ----

describe('loadSpurConfig JSON Schema path', () => {
    test('skips JSON Schema validation when config has no $schema (zod-only)', async () => {
        // No $schema → ts-runtime returns the parsed YAML without schema fetch/validate.
        // Covers the validateJsonSchema=true branch where $schema is absent.
        await writeConfig(
            tmpCwd,
            'name: no-schema\ntasks:\n  active: docs/tasks\n  folders:\n    docs/tasks:\n      baseCounter: 1\n',
        );
        const config = await loadSpurConfig(tmpCwd, { validateJsonSchema: true });
        expect(config.name).toBe('no-schema');
        expect(config.tasks?.active).toBe('docs/tasks');
    });

    test('validates against a local $schema file when validateJsonSchema is true', async () => {
        // Place a local schema file next to .spur/ and point $schema at it.
        const schemaPath = join(tmpCwd, 'schema.json');
        const { writeFile: wf } = await import('node:fs/promises');
        await wf(
            schemaPath,
            JSON.stringify({
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'object',
                properties: { name: { type: 'string' } },
            }),
        );
        await writeConfig(tmpCwd, `$schema: "../schema.json"\nname: with-schema\n`);
        const config = await loadSpurConfig(tmpCwd, { validateJsonSchema: true });
        expect(config.name).toBe('with-schema');
    });

    test('throws StructuredConfigSchemaError when $schema points at a missing file', async () => {
        await writeConfig(tmpCwd, `$schema: "./missing.json"\nname: bad\n`);
        await expect(loadSpurConfig(tmpCwd, { validateJsonSchema: true })).rejects.toThrow();
    });

    test('embedded schema is served when manifest specifier matches (bun --compile path)', async () => {
        // Cover makeEmbeddedReader: provide embeddedSchemas + manifestSpecifier so the
        // sentinel-prefixed path resolves from the map instead of disk.
        const embeddedSchemas = new Map([
            [
                'schemas/spur-config.json',
                JSON.stringify({
                    $schema: 'https://json-schema.org/draft/2020-12/schema',
                    type: 'object',
                    properties: { name: { type: 'string' } },
                }),
            ],
        ]);
        await writeConfig(tmpCwd, `$schema: "@gobing-ai/spur/schemas/spur-config.json"\nname: embedded\n`);
        const config = await loadSpurConfig(tmpCwd, {
            validateJsonSchema: true,
            embeddedSchemas,
            schemaManifestSpecifier: '@gobing-ai/spur/package.json',
        });
        expect(config.name).toBe('embedded');
    });

    test('throws when an embedded schema ref is registered but the subpath is missing', async () => {
        // makeEmbeddedReader error branch: sentinel path hit but no schema registered for subpath.
        const embeddedSchemas = new Map<string, string>(); // empty — any subpath lookup fails
        await writeConfig(tmpCwd, `$schema: "@gobing-ai/spur/schemas/never.json"\nname: missing\n`);
        await expect(
            loadSpurConfig(tmpCwd, {
                validateJsonSchema: true,
                embeddedSchemas,
                schemaManifestSpecifier: '@gobing-ai/spur/package.json',
            }),
        ).rejects.toThrow(/No embedded schema registered/);
    });
});

// ---- resolvePlanningFolders: features-only / no-tasks branch ----

describe('resolvePlanningFolders no-tasks branch', () => {
    test('returns default tasks config but honored features dir when tasks block is absent', async () => {
        // Covers the `!parsed.tasks` branch (loader.ts ~L255): config has features but no tasks.
        await writeConfig(tmpCwd, 'features:\n  dir: docs/my-features\n');
        const fs = createNodeFileSystem(tmpCwd);
        const result = await resolvePlanningFolders(fs);
        expect(result.tasksDir).toBe(DEFAULT_TASKS_DIR);
        expect(result.featuresDir).toBe('docs/my-features');
        expect(result.foldersConfig.active_folder).toBe(DEFAULT_TASKS_DIR);
        expect(result.foldersConfig.folders[DEFAULT_TASKS_DIR]).toEqual({ base_counter: 0 });
    });

    test('caches the parsed planning folders for the same FileSystem instance', async () => {
        await writeConfig(tmpCwd, CONFIG_YAML);
        const baseFs = createNodeFileSystem(tmpCwd);
        let readCount = 0;
        const fs = new Proxy(baseFs, {
            get(target, prop, receiver) {
                if (prop === 'readFile') {
                    return async (path: string) => {
                        readCount += 1;
                        return target.readFile(path);
                    };
                }
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });

        const first = await resolvePlanningFolders(fs);
        const second = await resolvePlanningFolders(fs);

        expect(first).toEqual(second);
        expect(readCount).toBe(1);
    });
});

// ---- CF-safety: core entry must not pull yaml or node:fs ----

describe('core CF-safety', () => {
    test('the core module does not export loader-only symbols', async () => {
        // Cast to a record — TS knows these symbols don't exist on the core type;
        // the runtime check proves the CF-safe boundary holds (no accidental re-export).
        const core = (await import('../src/index')) as Record<string, unknown>;
        expect(core.loadSpurConfig).toBeUndefined();
        expect(core.resolveConfigFile).toBeUndefined();
        expect(core.resolvePlanningFolders).toBeUndefined();
        expect(core.bundledConfigRoot).toBeUndefined();
        expect(core.renderTemplate).toBeUndefined();
    });

    test('the loader subpath exports all node-only symbols', async () => {
        const loader = await import('../src/loader');
        expect(typeof loader.loadSpurConfig).toBe('function');
        expect(typeof loader.resolveConfigFile).toBe('function');
        expect(typeof loader.resolvePlanningFolders).toBe('function');
        expect(typeof loader.bundledConfigRoot).toBe('function');
        expect(typeof loader.renderTemplate).toBe('function');
    });
});

// ---- loadStructuredSpurConfig: the low-level structured-config loader ----

describe('loadStructuredSpurConfig', () => {
    test('parses YAML and returns the raw object in test mode (no JSON Schema validation)', async () => {
        // Covers the validateJsonSchema=false branch (loader.ts ~L225-229): no $schema,
        // no validation — just parseYaml over the file contents.
        const cfgPath = join(tmpCwd, 'section-matrix.yaml');
        await writeFile(cfgPath, 'version: "1"\nsections:\n  - a\n  - b\n');
        const data = await loadStructuredSpurConfig(cfgPath);
        expect(data).toEqual({ version: '1', sections: ['a', 'b'] });
    });

    test('returns an empty object for an empty file in test mode', async () => {
        // Covers the `parseYaml(text) ?? {}` null-coalesce fallback (loader.ts ~L229).
        const cfgPath = join(tmpCwd, 'empty.yaml');
        await writeFile(cfgPath, '');
        const data = await loadStructuredSpurConfig(cfgPath);
        expect(data).toEqual({});
    });

    test('validates against a local $schema when validateJsonSchema is true', async () => {
        // Covers the validateJsonSchema=true branch (loader.ts ~L231-244): the same path
        // loadSpurConfig takes, but for an arbitrary structured-config file. task.ts uses
        // this to load section-matrix.yaml against @gobing-ai/spur/schemas/*.
        const schemaPath = join(tmpCwd, 'matrix-schema.json');
        await writeFile(
            schemaPath,
            JSON.stringify({
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'object',
                properties: { sections: { type: 'array' } },
            }),
        );
        const cfgPath = join(tmpCwd, 'section-matrix.yaml');
        await writeFile(cfgPath, `$schema: "./matrix-schema.json"\nsections: [a, b]\n`);
        const data = await loadStructuredSpurConfig(cfgPath, { validateJsonSchema: true });
        expect(data.sections).toEqual(['a', 'b']);
    });

    test('embedded schema is served when manifest specifier matches (bun --compile path)', async () => {
        // Covers the embeddedSchemas + resolveFn + fileSystem branch in loadStructuredSpurConfig
        // — the exact path task.ts:592/603 take in the compiled binary.
        const embeddedSchemas = new Map([
            [
                'schemas/section-matrix.json',
                JSON.stringify({
                    $schema: 'https://json-schema.org/draft/2020-12/schema',
                    type: 'object',
                    properties: { sections: { type: 'array' } },
                }),
            ],
        ]);
        const cfgPath = join(tmpCwd, 'section-matrix.yaml');
        await writeFile(cfgPath, `$schema: "@gobing-ai/spur/schemas/section-matrix.json"\nsections: [a]\n`);
        const data = await loadStructuredSpurConfig(cfgPath, {
            validateJsonSchema: true,
            embeddedSchemas,
            schemaManifestSpecifier: '@gobing-ai/spur/package.json',
        });
        expect(data.sections).toEqual(['a']);
    });

    test('throws when embedded schema subpath is not registered', async () => {
        // Covers makeEmbeddedReader error branch when invoked via loadStructuredSpurConfig.
        const embeddedSchemas = new Map<string, string>();
        const cfgPath = join(tmpCwd, 'section-matrix.yaml');
        await writeFile(cfgPath, `$schema: "@gobing-ai/spur/schemas/never.json"\nsections: [a]\n`);
        await expect(
            loadStructuredSpurConfig(cfgPath, {
                validateJsonSchema: true,
                embeddedSchemas,
                schemaManifestSpecifier: '@gobing-ai/spur/package.json',
            }),
        ).rejects.toThrow(/No embedded schema registered/);
    });

    test('throws on a non-existent file', async () => {
        // createNodeFileSystem().readFile throws on a missing path — surfaces as a FS error,
        // not a silent empty result.
        await expect(loadStructuredSpurConfig(join(tmpCwd, 'nope.yaml'))).rejects.toThrow();
    });
});

// ---- Cache invalidation (mtime-based + explicit) ----

describe('spurConfigCache invalidation', () => {
    test('picks up config file edits via mtime-based cache key', async () => {
        await writeConfig(tmpCwd, CONFIG_YAML);
        const first = await loadSpurConfig(tmpCwd);
        expect(first.name).toBe('test-project');

        // Rewrite the config with a different name and bump mtime forward
        const configPath = join(tmpCwd, '.spur', 'config.yaml');
        const updated = CONFIG_YAML.replace('name: test-project', 'name: updated-project');
        await writeFile(configPath, updated);
        const now = new Date();
        // Advance mtime by 2s so the cache key changes
        await utimes(configPath, now, new Date(now.getTime() + 2000));
        const second = await loadSpurConfig(tmpCwd);
        expect(second.name).toBe('updated-project');
    });

    test('invalidateSpurConfig() clears the entire cache', async () => {
        await writeConfig(tmpCwd, CONFIG_YAML);
        const first = await loadSpurConfig(tmpCwd);
        expect(first.name).toBe('test-project');

        invalidateSpurConfig();
        // After clearing, a re-load must hit the filesystem again
        const updated = CONFIG_YAML.replace('name: test-project', 'name: after-clear');
        await writeConfig(tmpCwd, updated);
        const second = await loadSpurConfig(tmpCwd);
        expect(second.name).toBe('after-clear');
    });
});

// ---- agent.team tilde expansion (R5 / AC4) ----

describe('agent.team tilde expansion', () => {
    test('AC4: work_dir "~/x" resolves to an absolute path under home', async () => {
        await writeConfig(
            tmpCwd,
            'version: "1"\nname: t\nagent:\n  team:\n    devops-01:\n      name: "Dev Ops 01"\n      work_dir: "~/x"\n      members:\n        - claude\n        - executor: omp-zai\n          workspace: "~/y"\n          purpose: reviewer\n',
        );
        const config = await loadSpurConfig(tmpCwd);
        const team = config.agent?.team?.['devops-01'];
        expect(team?.work_dir).toBe(join(homedir(), 'x'));
        // bare-string member is untouched (no workspace to expand)
        expect(team?.members[0]).toBe('claude');
        // object member's workspace is expanded
        const member1 = team?.members[1];
        expect(typeof member1).toBe('object');
        if (typeof member1 === 'object') {
            expect(member1.workspace).toBe(join(homedir(), 'y'));
            expect(member1.purpose).toBe('reviewer');
        }
    });

    test('a non-tilde work_dir is left unchanged', async () => {
        await writeConfig(
            tmpCwd,
            'version: "1"\nname: t\nagent:\n  team:\n    devops-01:\n      name: "Dev Ops 01"\n      work_dir: "/abs/path"\n      members:\n        - claude\n',
        );
        const config = await loadSpurConfig(tmpCwd);
        expect(config.agent?.team?.['devops-01']?.work_dir).toBe('/abs/path');
    });
});

// ---- agent.team backward-compat at the loader (R7 / AC6) ----

describe('agent.team backward-compat', () => {
    test('AC6: a config with no agent.team block loads exactly as today', async () => {
        await writeConfig(tmpCwd, CONFIG_YAML);
        const config = await loadSpurConfig(tmpCwd);
        expect(config.agent?.team).toBeUndefined();
        expect(config.agent?.default).toBe('codex');
        expect(config.agent?.executors?.[0]?.model).toBe('gpt-5');
        expect(config.tasks?.active).toBe('docs/tasks2');
    });
});

// ---- agent.team JSON schema round-trip (R6 / AC7) ----

describe('agent.team JSON schema round-trip', () => {
    // The runtime SSOT is the zod; this is the editor/CI aid that must stay in sync.
    const schemaPath = join(import.meta.dir, '..', '..', '..', 'apps', 'cli', 'schemas', 'spur-config.schema.json');

    test('AC7: a valid team config is accepted by both zod and the JSON schema', async () => {
        await writeConfig(
            tmpCwd,
            `version: "1"\nname: t\n$schema: "${schemaPath}"\nagent:\n  team:\n    devops-01:\n      name: "Dev Ops 01"\n      work_dir: "~/x"\n      members:\n        - claude\n        - executor: omp-zai\n          purpose: reviewer\n`,
        );
        const viaJsonSchema = await loadSpurConfig(tmpCwd, { validateJsonSchema: true });
        expect(viaJsonSchema.agent?.team?.['devops-01']?.members?.length).toBe(2);
        const viaZod = await loadSpurConfig(tmpCwd, { validateJsonSchema: false });
        expect(viaZod.agent?.team?.['devops-01']?.members?.length).toBe(2);
    });

    test('AC7: an empty members roster is rejected by both', async () => {
        await writeConfig(
            tmpCwd,
            `version: "1"\nname: t\n$schema: "${schemaPath}"\nagent:\n  team:\n    devops-01:\n      name: "Dev Ops 01"\n      work_dir: "~/x"\n      members: []\n`,
        );
        await expect(loadSpurConfig(tmpCwd, { validateJsonSchema: true })).rejects.toThrow();
        await expect(loadSpurConfig(tmpCwd, { validateJsonSchema: false })).rejects.toThrow();
    });

    test('AC7: a member object missing executor is rejected by both', async () => {
        await writeConfig(
            tmpCwd,
            `version: "1"\nname: t\n$schema: "${schemaPath}"\nagent:\n  team:\n    devops-01:\n      name: "Dev Ops 01"\n      work_dir: "~/x"\n      members:\n        - purpose: reviewer\n`,
        );
        await expect(loadSpurConfig(tmpCwd, { validateJsonSchema: true })).rejects.toThrow();
        await expect(loadSpurConfig(tmpCwd, { validateJsonSchema: false })).rejects.toThrow();
    });
});
