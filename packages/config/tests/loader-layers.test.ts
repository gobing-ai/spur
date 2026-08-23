import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StructuredConfigSchemaError } from '@gobing-ai/ts-runtime';
import {
    enrichSchemaViolationError,
    loadSpurConfig,
    mergeSpurConfigLayers,
    parseMergedWithProvenance,
    resolveConfigLayers,
} from '../src/loader';

/**
 * Layered-config tests (task 0640). In-process runs are project-layer-only by default
 * (tests/setup.ts sets SPUR_SKIP_GLOBAL_CONFIG='true'), so every two-layer scenario runs
 * in a hermetic subprocess with HOME pointed at a temp dir — the pattern established by
 * the `resolveConfigFile global fallback` suite in loader.test.ts.
 */

interface LayerDirs {
    fakeHome: string;
    globalPath: string;
    projectDir: string;
}

async function makeLayerDirs(globalYaml?: string, projectYaml?: string): Promise<LayerDirs> {
    const fakeHome = await mkdtemp(join(tmpdir(), 'spur-home-'));
    const globalPath = join(fakeHome, '.config', 'spur', 'config.yaml');
    const projectDir = await mkdtemp(join(tmpdir(), 'spur-proj-'));
    if (globalYaml !== undefined) {
        await mkdir(join(fakeHome, '.config', 'spur'), { recursive: true });
        await writeFile(globalPath, globalYaml);
    }
    if (projectYaml !== undefined) {
        await mkdir(join(projectDir, '.spur'), { recursive: true });
        await writeFile(join(projectDir, '.spur', 'config.yaml'), projectYaml);
    }
    return { fakeHome, globalPath, projectDir };
}

const dirsToClean: LayerDirs[] = [];

async function runLoaderScript(
    dirs: LayerDirs,
    scriptBody: string,
    envOverrides: Record<string, string> = {},
): Promise<string> {
    const loaderPath = join(import.meta.dir, '..', 'src', 'loader.ts');
    const script = `
        import { loadSpurConfig, resolveConfigLayers, invalidateSpurConfig } from '${loaderPath}';
        ${scriptBody}
    `;
    const proc = Bun.spawn(['bun', '-e', script], {
        env: {
            ...process.env,
            HOME: dirs.fakeHome,
            USERPROFILE: dirs.fakeHome,
            SPUR_SKIP_GLOBAL_CONFIG: '',
            ...envOverrides,
        },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) {
        throw new Error(`subprocess failed (${code}): ${await new Response(proc.stderr).text()}`);
    }
    return stdout;
}

let originalSkipGlobalConfig: string | undefined;

beforeEach(() => {
    // Hermetic regardless of preload: root tests/setup.ts sets this too, but standalone
    // runs from packages/config skip the preload and would leak the operator's real
    // ~/.config/spur/config.yaml into every in-process assertion.
    originalSkipGlobalConfig = process.env.SPUR_SKIP_GLOBAL_CONFIG;
    process.env.SPUR_SKIP_GLOBAL_CONFIG = 'true';
});

afterEach(async () => {
    if (originalSkipGlobalConfig === undefined) {
        delete process.env.SPUR_SKIP_GLOBAL_CONFIG;
    } else {
        process.env.SPUR_SKIP_GLOBAL_CONFIG = originalSkipGlobalConfig;
    }

    while (dirsToClean.length > 0) {
        const dirs = dirsToClean.pop();
        if (dirs === undefined) break;
        await rm(dirs.fakeHome, { recursive: true, force: true });
        await rm(dirs.projectDir, { recursive: true, force: true });
    }
});

describe('resolveConfigLayers', () => {
    test('project layer resolves and global stays undefined under the skip env', async () => {
        const dirs = await makeLayerDirs('name: g\n', 'name: p\n');
        dirsToClean.push(dirs);
        const layers = resolveConfigLayers(dirs.projectDir);
        expect(layers.project).toBe(join(dirs.projectDir, '.spur', 'config.yaml'));
        // In-process SPUR_SKIP_GLOBAL_CONFIG='true' (tests/setup.ts): global must be absent.
        expect(layers.global).toBeUndefined();
    });

    test('both layers present in a hermetic subprocess', async () => {
        const dirs = await makeLayerDirs('name: g\n', 'name: p\n');
        dirsToClean.push(dirs);
        const out = await runLoaderScript(
            dirs,
            `const layers = resolveConfigLayers('${dirs.projectDir}');
             process.stdout.write(JSON.stringify(layers));`,
        );
        const layers = JSON.parse(out) as { global?: string; project?: string };
        expect(layers.global).toBe(dirs.globalPath);
        expect(layers.project).toBe(join(dirs.projectDir, '.spur', 'config.yaml'));
    });
});

describe('loadSpurConfig layering', () => {
    test('executor fragment merge: fields compose across layers (R1/R2)', async () => {
        const dirs = await makeLayerDirs(
            ['agent:', '  executors:', '    - name: omp', '      agent: omp', '      tier: standard'].join('\n'),
            ['agent:', '  executors:', '    - name: omp', '      model: volc/glm-5.2'].join('\n'),
        );
        dirsToClean.push(dirs);
        const out = await runLoaderScript(
            dirs,
            `const config = await loadSpurConfig('${dirs.projectDir}', { validateJsonSchema: false });
             const exec = config.agent?.executors?.[0];
             process.stdout.write(JSON.stringify({ agent: exec?.agent, tier: exec?.tier, model: exec?.model }));`,
        );
        expect(JSON.parse(out)).toEqual({ agent: 'omp', tier: 'standard', model: 'volc/glm-5.2' });
    });

    test('merged config passes JSON Schema validation that fragments would fail (R2/R3)', async () => {
        const dirs = await makeLayerDirs(
            [
                '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
                'agent:',
                '  executors:',
                '    - name: omp',
            ].join('\n'),
            [
                '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
                'agent:',
                '  executors:',
                '    - name: omp',
                '      agent: omp',
            ].join('\n'),
        );
        dirsToClean.push(dirs);
        const out = await runLoaderScript(
            dirs,
            `const config = await loadSpurConfig('${dirs.projectDir}', { validateJsonSchema: true });
             process.stdout.write(config.agent?.executors?.[0]?.agent ?? 'undefined');`,
        );
        expect(out).toBe('omp');
    });

    test('missing executor agent names the executor and its layer (R7)', async () => {
        // Neither layer supplies `agent` for the matched executor "ghost".
        const dirs = await makeLayerDirs(
            ['agent:', '  executors:', '    - name: ghost'].join('\n'),
            ['agent:', '  executors:', '    - name: ghost', '      model: m'].join('\n'),
        );
        dirsToClean.push(dirs);
        const out = await runLoaderScript(
            dirs,
            `try {
                 await loadSpurConfig('${dirs.projectDir}', { validateJsonSchema: false });
                 process.stdout.write('NO-ERROR');
             } catch (error) {
                 process.stdout.write((error as Error).message);
             }`,
        );
        expect(out).toContain('executor "ghost"');
        expect(out).toContain('missing in both layers');
    });

    test('JSON Schema violation on merged config is enriched with layer provenance (R7)', async () => {
        const dirs = await makeLayerDirs(
            [
                '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
                'agent:',
                '  executors:',
                '    - name: broken',
            ].join('\n'),
            'name: p\n',
        );
        dirsToClean.push(dirs);
        const out = await runLoaderScript(
            dirs,
            `try {
                 await loadSpurConfig('${dirs.projectDir}', { validateJsonSchema: true });
                 process.stdout.write('NO-ERROR');
             } catch (error) {
                 process.stdout.write((error as Error).message);
             }`,
        );
        expect(out).toContain('broken');
        expect(out).toContain('global layer');
    });

    test('editing the global layer invalidates the cache (R4)', async () => {
        const dirs = await makeLayerDirs('name: before\n', 'tasks:\n  severity: {}');
        dirsToClean.push(dirs);
        const out = await runLoaderScript(
            dirs,
            `const first = await loadSpurConfig('${dirs.projectDir}', { validateJsonSchema: false });
             const { writeFile } = await import('node:fs/promises');
             const { utimesSync } = await import('node:fs');
             await writeFile('${dirs.globalPath}', 'name: after\\n');
             utimesSync('${dirs.globalPath}', new Date(), new Date(Date.now() + 5000));
             const second = await loadSpurConfig('${dirs.projectDir}', { validateJsonSchema: false });
             process.stdout.write(JSON.stringify({ first: first.name, second: second.name }));`,
        );
        expect(JSON.parse(out)).toEqual({ first: 'before', second: 'after' });
    });

    test('SPUR_SKIP_GLOBAL_CONFIG=true loads the project layer only (R5)', async () => {
        const dirs = await makeLayerDirs(
            ['agent:', '  executors:', '    - name: omp', '      agent: omp'].join('\n'),
            'name: p\n',
        );
        dirsToClean.push(dirs);
        const out = await runLoaderScript(
            dirs,
            `const config = await loadSpurConfig('${dirs.projectDir}', { validateJsonSchema: false });
             process.stdout.write(JSON.stringify({ name: config.name, executors: config.agent?.executors?.length ?? 0 }));`,
            { SPUR_SKIP_GLOBAL_CONFIG: 'true' },
        );
        expect(JSON.parse(out)).toEqual({ name: 'p', executors: 0 });
    });

    test('rules.paths concatenates with duplicate removal (0639 deferred default)', async () => {
        const dirs = await makeLayerDirs(
            ['rules:', '  paths:', '    - rules-a', '    - rules-b'].join('\n'),
            ['rules:', '  paths:', '    - rules-b', '    - rules-c'].join('\n'),
        );
        dirsToClean.push(dirs);
        const out = await runLoaderScript(
            dirs,
            `const config = await loadSpurConfig('${dirs.projectDir}', { validateJsonSchema: false });
             process.stdout.write(JSON.stringify(config.rules?.paths));`,
        );
        expect(JSON.parse(out)).toEqual(['rules-a', 'rules-b', 'rules-c']);
    });

    test('team members merge by normalized id; stages arrays replace (0639 table)', async () => {
        const dirs = await makeLayerDirs(
            [
                'agent:',
                '  team:',
                '    squad:',
                '      name: Squad',
                "      work_dir: '~/work'",
                '      members:',
                '        - executor: codex',
                '          role: reviewer',
                '  roles:',
                '    coder:',
                '      tier: standard',
                '      stages: [implement]',
            ].join('\n'),
            [
                'agent:',
                '  team:',
                '    squad:',
                '      name: Squad',
                "      work_dir: '~/work'",
                '      members:',
                '        - id: codex',
                '          model: volc/glm-5.2',
                '  roles:',
                '    coder:',
                '      stages: [review]',
            ].join('\n'),
        );
        dirsToClean.push(dirs);
        const out = await runLoaderScript(
            dirs,
            `const config = await loadSpurConfig('${dirs.projectDir}', { validateJsonSchema: false });
             const member = config.agent?.team?.squad?.members[0];
             process.stdout.write(JSON.stringify({
                 member: typeof member === 'object' ? { role: member.role, model: member.model } : member,
                 stages: config.agent?.roles?.coder?.stages,
             }));`,
        );
        expect(JSON.parse(out)).toEqual({
            member: { role: 'reviewer', model: 'volc/glm-5.2' },
            stages: ['review'],
        });
    });

    test('version is label-only: 1, 1.1, and 1.2 all parse (R6 zod side)', async () => {
        for (const version of ['1', '1.1', '1.2']) {
            const dirs = await makeLayerDirs(undefined, `version: '${version}'\n`);
            dirsToClean.push(dirs);
            const config = await loadSpurConfig(dirs.projectDir, { validateJsonSchema: false });
            expect(config.version).toBe(version);
        }
    });

    test('project-only behavior is unchanged: no global file in play', async () => {
        const dirs = await makeLayerDirs(undefined, 'name: solo\n');
        dirsToClean.push(dirs);
        const config = await loadSpurConfig(dirs.projectDir, { validateJsonSchema: false });
        expect(config.name).toBe('solo');
        const layers = resolveConfigLayers(dirs.projectDir);
        expect(layers.global).toBeUndefined();
        expect(layers.project).toBeDefined();
    });
});

describe('layer merge machinery (in-process unit coverage)', () => {
    test('executors merge by name; new entries append', () => {
        const merged = mergeSpurConfigLayers(
            { agent: { executors: [{ name: 'omp', agent: 'omp', tier: 'standard' }] } },
            {
                agent: {
                    executors: [
                        { name: 'omp', model: 'm' },
                        { name: 'new', agent: 'n' },
                    ],
                },
            },
        );
        const executors = (merged.agent as { executors: Record<string, unknown>[] }).executors;
        expect(executors).toHaveLength(2);
        expect(executors[0]).toEqual({ name: 'omp', agent: 'omp', tier: 'standard', model: 'm' });
        expect(executors[1]).toEqual({ name: 'new', agent: 'n' });
    });

    test('members merge by id ?? executor; bare strings replace/append wholesale', () => {
        const merged = mergeSpurConfigLayers(
            {
                agent: {
                    team: {
                        squad: {
                            name: 'S',
                            work_dir: '~',
                            members: [{ executor: 'codex', role: 'reviewer' }, 'legacy'],
                        },
                    },
                },
            },
            {
                agent: {
                    team: { squad: { name: 'S', work_dir: '~', members: [{ id: 'codex', model: 'm' }, 'plain'] } },
                },
            },
        );
        const members = (merged.agent as { team: { squad: { members: unknown[] } } }).team.squad.members;
        expect(members).toHaveLength(3);
        expect(members[0]).toEqual({ executor: 'codex', role: 'reviewer', id: 'codex', model: 'm' });
        expect(members[1]).toBe('legacy');
        expect(members[2]).toBe('plain');
    });

    test('concat paths dedup; other arrays replace', () => {
        const merged = mergeSpurConfigLayers(
            { rules: { paths: ['a', 'b'] }, agent: { roles: { coder: { stages: ['implement'] } } } },
            { rules: { paths: ['b', 'c'] }, agent: { roles: { coder: { stages: ['review'] } } } },
        );
        expect((merged.rules as { paths: string[] }).paths).toEqual(['a', 'b', 'c']);
        const roles = (merged.agent as { roles: { coder: { stages: string[] } } }).roles;
        expect(roles.coder.stages).toEqual(['review']);
    });

    test('parseMergedWithProvenance enriches zod failures with both-layer provenance', () => {
        const globalRaw = { agent: { executors: [{ name: 'ghost' }] } };
        const projectRaw = { agent: { executors: [{ name: 'ghost' }] } };
        const merged = mergeSpurConfigLayers(globalRaw, projectRaw);
        try {
            parseMergedWithProvenance(merged, globalRaw, projectRaw, { global: '/g.yaml', project: '/p.yaml' });
            expect.unreachable();
        } catch (error) {
            const message = (error as Error).message;
            expect(message).toContain('executor "ghost"');
            expect(message).toContain('missing in both layers');
            expect(message).toContain('/g.yaml');
            expect(message).toContain('/p.yaml');
        }
    });

    test('parseMergedWithProvenance passes a valid merged config', () => {
        const config = parseMergedWithProvenance({}, {}, {}, {});
        expect(config.name).toBeUndefined();
    });

    test('enrichSchemaViolationError names the layer behind a schema violation', () => {
        const globalRaw = { agent: { executors: [{ name: 'broken' }] } };
        const error = new StructuredConfigSchemaError('boom', [
            { path: 'agent.executors[0].agent', message: "must have required property 'agent'" },
        ]);
        const enriched = enrichSchemaViolationError(
            error,
            mergeSpurConfigLayers(globalRaw, {}),
            globalRaw,
            {},
            {
                global: '/g.yaml',
                project: undefined,
            },
        );
        expect(enriched.message).toContain('broken');
        expect(enriched.message).toContain('global layer');
        expect(enriched.message).toContain('/g.yaml');
    });
});
