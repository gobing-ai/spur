/**
 * Task 0797: setExecutorAvailability — exact-entry mutation, structured
 * no-ops for missing targets, per-path locking + atomic commit + cache
 * invalidation. Byte-level assertions use temporary files only.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { parse as parseYaml } from 'yaml';
import { ExecutorUpdateError, loadSpurConfig, setExecutorAvailability } from '../src/loader';

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'executor-update-'));
    mkdirSync(join(root, '.spur'));
    setEnvVar('SPUR_SKIP_GLOBAL_CONFIG', 'true'); // deterministic layering
});

afterEach(() => {
    removeEnvVar('SPUR_SKIP_GLOBAL_CONFIG');
    chmodSync(root, 0o700);
});

const PROJECT_YAML = [
    '# project layer',
    'planning:',
    '  tasks_folder: tasks4',
    'agent:',
    '  executors:',
    '    - name: alpha',
    '      agent: omp',
    '      model: gpt-5',
    '    - name: alphabet',
    '      agent: claude',
    '      model: claude-4',
    '      disabled: true',
    '    # trailing comment',
    '    - name: beta',
    '      agent: gemini',
    '      model: gemini-3',
    '',
].join('\n');

function writeProject(yaml: string): string {
    const path = join(root, '.spur', 'config.yaml');
    writeFileSync(path, yaml);
    return path;
}

async function expectInvalidConfig(run: () => Promise<unknown>): Promise<void> {
    try {
        await run();
        expect.unreachable();
    } catch (error) {
        expect(error).toBeInstanceOf(ExecutorUpdateError);
        expect((error as ExecutorUpdateError).code).toBe('INVALID_CONFIG');
    }
}

describe('setExecutorAvailability project writes (0797)', () => {
    test('R1: mutates only the exact entry — alpha does not touch alphabet', async () => {
        const path = writeProject(PROJECT_YAML);
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: false,
        });
        expect(result).toEqual({ status: 'updated' });
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<Record<string, unknown>> };
        };
        expect(parsed.agent.executors.map((e) => e.disabled)).toEqual([false, true, undefined]);
        expect(parsed.agent.executors.map((e) => e.model)).toEqual(['gpt-5', 'claude-4', 'gemini-3']);
    });

    test('R1: matching is case-sensitive and prefix-free', async () => {
        const path = writeProject(PROJECT_YAML);
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'ALPHA',
            disabled: false,
        });
        expect(result).toEqual({ status: 'unchanged', reason: 'missing-executor' });
        expect(readFileSync(path, 'utf8')).toBe(PROJECT_YAML);
    });

    test('R1: an already-matching explicit value is a byte-stable no-op', async () => {
        const path = writeProject(PROJECT_YAML);
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alphabet',
            disabled: true,
        });
        expect(result).toEqual({ status: 'unchanged', reason: 'already-set' });
        expect(readFileSync(path, 'utf8')).toBe(PROJECT_YAML);
    });

    test('R1: a valid name-only project fragment is updated in place', async () => {
        const path = writeProject('agent:\n  executors:\n    - name: alpha\n');
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: false,
        });
        expect(result).toEqual({ status: 'updated' });
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<Record<string, unknown>> };
        };
        expect(parsed.agent.executors).toEqual([{ name: 'alpha', disabled: false }]);
    });

    test('R1: comments, unrelated values and file mode survive', async () => {
        const path = writeProject(PROJECT_YAML);
        chmodSync(path, 0o640);
        const before = readFileSync(path, 'utf8');
        await setExecutorAvailability({ layer: 'project', projectRoot: root, executor: 'alpha', disabled: false });
        const text = readFileSync(path, 'utf8');
        expect(text).toContain('# project layer');
        expect(text).toContain('# trailing comment');
        expect(text).toContain('tasks_folder: tasks4');
        // Unchanged bytes outside the mutated entry: everything up to alpha's body.
        expect(text.startsWith(before.slice(0, before.indexOf('- name: alpha')))).toBe(true);
        expect(statSync(path).mode & 0o777).toBe(0o640);
    });

    test('R2: missing file is a structured no-op that creates nothing', async () => {
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: false,
        });
        expect(result).toEqual({ status: 'unchanged', reason: 'missing-file' });
        expect(existsSync(join(root, '.spur', 'config.yaml'))).toBe(false);
    });

    test('R2: missing executors section is a no-op', async () => {
        const path = writeProject('planning:\n  tasks_folder: tasks4\n');
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: false,
        });
        expect(result).toEqual({ status: 'unchanged', reason: 'missing-executors' });
        expect(readFileSync(path, 'utf8')).toBe('planning:\n  tasks_folder: tasks4\n');
    });

    test('R2: missing executor leaves the file byte-identical', async () => {
        const path = writeProject(PROJECT_YAML);
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'gamma',
            disabled: false,
        });
        expect(result).toEqual({ status: 'unchanged', reason: 'missing-executor' });
        expect(readFileSync(path, 'utf8')).toBe(PROJECT_YAML);
    });

    test('R2: malformed YAML rejects INVALID_CONFIG and preserves contents', async () => {
        const path = writeProject('agent:\n  executors: [unclosed\n');
        await expectInvalidConfig(() =>
            setExecutorAvailability({ layer: 'project', projectRoot: root, executor: 'alpha', disabled: false }),
        );
        expect(readFileSync(path, 'utf8')).toBe('agent:\n  executors: [unclosed\n');
    });

    test('R2: duplicate executor names reject as ambiguous', async () => {
        const path = writeProject('agent:\n  executors:\n    - name: alpha\n    - name: alpha\n');
        await expectInvalidConfig(() =>
            setExecutorAvailability({ layer: 'project', projectRoot: root, executor: 'alpha', disabled: false }),
        );
        expect(readFileSync(path, 'utf8')).not.toContain('disabled');
        expect(existsSync(`${path}.lock`)).toBe(false);
    });

    test('R2: alias entries reject rather than rewrite speculatively', async () => {
        const path = writeProject('defaults: &d\n  name: alpha\nagent:\n  executors:\n    - *d\n');
        await expectInvalidConfig(() =>
            setExecutorAvailability({ layer: 'project', projectRoot: root, executor: 'alpha', disabled: false }),
        );
        expect(readFileSync(path, 'utf8')).toContain('&d');
    });

    test('R2: symlinked project config rejects INVALID_CONFIG', async () => {
        const outside = join(root, 'outside.yaml');
        writeFileSync(outside, 'agent:\n  executors:\n    - name: alpha\n');
        const linkRoot = mkdtempSync(join(tmpdir(), 'executor-update-link-'));
        mkdirSync(join(linkRoot, '.spur'));
        symlinkSync(outside, join(linkRoot, '.spur', 'config.yaml'));
        try {
            await expectInvalidConfig(() =>
                setExecutorAvailability({
                    layer: 'project',
                    projectRoot: linkRoot,
                    executor: 'alpha',
                    disabled: false,
                }),
            );
            expect(readFileSync(outside, 'utf8')).not.toContain('disabled');
        } finally {
            chmodSync(linkRoot, 0o700);
        }
    });

    test('R2: invalid arguments reject before any filesystem work', async () => {
        await expectInvalidConfig(() =>
            setExecutorAvailability({ layer: 'project', projectRoot: root, executor: '', disabled: false }),
        );
        await expectInvalidConfig(() =>
            setExecutorAvailability({
                layer: 'project',
                projectRoot: root,
                executor: 'alpha',
                disabled: 'false' as unknown as boolean,
            }),
        );
        expect(existsSync(join(root, '.spur', 'config.yaml'))).toBe(false);
    });

    test('R3: concurrent updater calls serialize — both edits survive', async () => {
        const path = writeProject(PROJECT_YAML);
        const results = await Promise.all([
            setExecutorAvailability({ layer: 'project', projectRoot: root, executor: 'alpha', disabled: false }),
            setExecutorAvailability({ layer: 'project', projectRoot: root, executor: 'beta', disabled: true }),
        ]);
        expect(results).toEqual([{ status: 'updated' }, { status: 'updated' }]);
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<Record<string, unknown>> };
        };
        expect(parsed.agent.executors.map((e) => e.disabled)).toEqual([false, true, true]);
        expect(existsSync(`${path}.lock`)).toBe(false);
    });

    test('R3: a live lock owner is never reclaimed — exhaustion rejects', async () => {
        const path = writeProject(PROJECT_YAML);
        writeFileSync(`${path}.lock`, String(process.pid)); // kill(pid, 0) succeeds for our own pid
        try {
            await expect(
                setExecutorAvailability({ layer: 'project', projectRoot: root, executor: 'alpha', disabled: false }),
            ).rejects.toThrow(/held by a live process/);
            expect(readFileSync(path, 'utf8')).toBe(PROJECT_YAML); // untouched while the lock is held
        } finally {
            unlinkSync(`${path}.lock`);
        }
    });

    test('R3: a dead lock owner is reclaimed', async () => {
        const path = writeProject(PROJECT_YAML);
        writeFileSync(`${path}.lock`, '999999999'); // pid that cannot exist
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: false,
        });
        expect(result).toEqual({ status: 'updated' });
        expect(readFileSync(path, 'utf8')).toContain('disabled: false');
    });

    test('R3: atomic commit failure preserves the original file', async () => {
        const path = writeProject(PROJECT_YAML);
        const spurDir = join(root, '.spur');
        chmodSync(spurDir, 0o500); // read-only config dir: temp write must fail
        try {
            try {
                await setExecutorAvailability({
                    layer: 'project',
                    projectRoot: root,
                    executor: 'alpha',
                    disabled: false,
                });
                expect.unreachable();
            } catch (error) {
                expect(error).toBeInstanceOf(ExecutorUpdateError);
                expect(['CONFIG_WRITE_FAILED', 'CONFIG_CONFLICT']).toContain((error as ExecutorUpdateError).code);
            }
            expect(readFileSync(path, 'utf8')).toBe(PROJECT_YAML);
        } finally {
            chmodSync(spurDir, 0o700);
        }
    });

    test('R3: success invalidates the loader cache — next load sees the new value', async () => {
        const path = writeProject(PROJECT_YAML);
        const before = await loadSpurConfig(root);
        expect(before.agent?.executors?.find((e) => e.name === 'alpha')?.disabled).toBe(false);
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'beta',
            disabled: false,
        });
        expect(result).toEqual({ status: 'updated' });
        const after = await loadSpurConfig(root);
        expect(after.agent?.executors?.find((e) => e.name === 'beta')?.disabled).toBe(false);
        expect(existsSync(`${path}.lock`)).toBe(false);
    });
});

describe('setExecutorAvailability ownership object (0890 R2)', () => {
    const QUOTA_DISABLE = {
        owner: 'quota' as const,
        since: '2026-02-14T09:30:00.000Z',
        reason: 'agent.quota.exhausted alpha',
    };

    test('writes the object form with owner, since and reason', async () => {
        const path = writeProject(PROJECT_YAML);
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: QUOTA_DISABLE,
        });
        expect(result).toEqual({ status: 'updated' });
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<Record<string, unknown>> };
        };
        expect(parsed.agent.executors.find((e) => e.name === 'alpha')?.disabled).toEqual(QUOTA_DISABLE);
        // Unrelated entries untouched.
        expect(parsed.agent.executors.find((e) => e.name === 'alphabet')?.disabled).toBe(true);
    });

    test('an identical object already present is a byte-stable no-op (replay)', async () => {
        const path = writeProject(PROJECT_YAML);
        await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: QUOTA_DISABLE,
        });
        const afterWrite = readFileSync(path, 'utf8');
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: { ...QUOTA_DISABLE },
        });
        expect(result).toEqual({ status: 'unchanged', reason: 'already-set' });
        expect(readFileSync(path, 'utf8')).toBe(afterWrite);
    });

    test('a different owner or since rewrites the object', async () => {
        const path = writeProject(PROJECT_YAML);
        await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: QUOTA_DISABLE,
        });
        const result = await setExecutorAvailability({
            layer: 'project' as const,
            projectRoot: root,
            executor: 'alpha',
            disabled: {
                owner: 'probe',
                since: '2026-02-14T10:00:00.000Z',
                reason: 'health-probe failure',
            },
        });
        expect(result).toEqual({ status: 'updated' });
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<Record<string, unknown>> };
        };
        expect(parsed.agent.executors.find((e) => e.name === 'alpha')?.disabled).toEqual({
            owner: 'probe',
            since: '2026-02-14T10:00:00.000Z',
            reason: 'health-probe failure',
        });
    });

    test('recovery to false overwrites an object-form disable', async () => {
        const path = writeProject(PROJECT_YAML);
        await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: QUOTA_DISABLE,
        });
        const result = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: false,
        });
        expect(result).toEqual({ status: 'updated' });
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<Record<string, unknown>> };
        };
        expect(parsed.agent.executors.find((e) => e.name === 'alpha')?.disabled).toBe(false);
    });

    test('rejects operator ownership, bad timestamps and empty reasons with INVALID_CONFIG', async () => {
        writeProject(PROJECT_YAML);
        await expectInvalidConfig(() =>
            setExecutorAvailability({
                layer: 'project',
                projectRoot: root,
                executor: 'alpha',
                disabled: { ...QUOTA_DISABLE, owner: 'operator' as 'quota' },
            }),
        );
        await expectInvalidConfig(() =>
            setExecutorAvailability({
                layer: 'project',
                projectRoot: root,
                executor: 'alpha',
                disabled: { ...QUOTA_DISABLE, since: 'yesterday' },
            }),
        );
        await expectInvalidConfig(() =>
            setExecutorAvailability({
                layer: 'project',
                projectRoot: root,
                executor: 'alpha',
                disabled: { ...QUOTA_DISABLE, since: '2026-02-14 09:30:00' },
            }),
        );
        await expectInvalidConfig(() =>
            setExecutorAvailability({
                layer: 'project',
                projectRoot: root,
                executor: 'alpha',
                disabled: { ...QUOTA_DISABLE, reason: '' },
            }),
        );
    });
});

// ---- 0891: global-layer availability writer ----

const GLOBAL_YAML = [
    '# global layer',
    'agent:',
    '  executors:',
    '    - name: alpha',
    '      agent: omp',
    '      # global-only executor — no project fragment anywhere',
    '    - name: gem',
    '      agent: gemini',
    '      model: gemini-3',
    '',
].join('\n');

/** In-process: the skip env keeps the global layer absent (loader seams). */
describe('setExecutorAvailability layer selection — global suppressed (0891 R1)', () => {
    test("layer 'global' with a project-declared executor writes the project fragment", async () => {
        const path = writeProject(PROJECT_YAML);
        const result = await setExecutorAvailability({
            layer: 'global',
            projectRoot: root,
            executor: 'alpha',
            disabled: { owner: 'quota', since: '2026-02-01T10:00:00.000Z', reason: 'agent.quota.exhausted alpha' },
        });
        expect(result).toEqual({ status: 'updated' });
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<Record<string, unknown>> };
        };
        expect(parsed.agent.executors.find((entry) => entry.name === 'alpha')?.disabled).toEqual({
            owner: 'quota',
            since: '2026-02-01T10:00:00.000Z',
            reason: 'agent.quota.exhausted alpha',
        });
    });

    test("layer 'global' for an undeclared executor is a structured no-op (nothing created)", async () => {
        writeProject(PROJECT_YAML);
        const result = await setExecutorAvailability({
            layer: 'global',
            projectRoot: root,
            executor: 'ghost',
            disabled: false,
        });
        expect(result).toEqual({ status: 'unchanged', reason: 'missing-executor' });
    });

    test("layer 'project' writes the exact project entry (0797 parity)", async () => {
        const path = writeProject(PROJECT_YAML);
        const viaProjectLayer = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: true,
        });
        const direct = await setExecutorAvailability({
            layer: 'project',
            projectRoot: root,
            executor: 'alpha',
            disabled: false,
        });
        expect(viaProjectLayer).toEqual({ status: 'updated' });
        expect(direct).toEqual({ status: 'updated' });
        const parsed = parseYaml(readFileSync(path, 'utf8')) as {
            agent: { executors: Array<{ name: string; disabled?: unknown }> };
        };
        expect(parsed.agent.executors.find((entry) => entry.name === 'alpha')?.disabled).toBe(false);
    });
});

/**
 * Real global-layer writes need `homedir()` to resolve to a temp directory, and
 * the loader computes the global path at module load — so these run in a bun
 * subprocess with HOME/USERPROFILE pointed at a fake home (same pattern as
 * loader-layers.test.ts).
 */
describe('setExecutorAvailability global writes (0891 R2/R3, subprocess fake HOME)', () => {
    function runInFakeHome(scriptBody: string, home = root): Promise<string> {
        const loaderPath = join(import.meta.dir, '..', 'src', 'loader.ts');
        const script = `
            import { loadSpurConfig, setExecutorAvailability } from '${loaderPath}';
            ${scriptBody}
        `;
        const proc = Bun.spawn(['bun', '-e', script], {
            env: { ...getEnvVars(), HOME: home, USERPROFILE: home, SPUR_SKIP_GLOBAL_CONFIG: '' },
            cwd: root,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        return (async () => {
            const stdout = await new Response(proc.stdout).text();
            const code = await proc.exited;
            if (code !== 0) throw new Error(`subprocess failed (${code}): ${await new Response(proc.stderr).text()}`);
            return stdout;
        })();
    }

    function fakeHomeTree(): { home: string; globalPath: string; projectDir: string } {
        const home = mkdtempSync(join(tmpdir(), 'executor-update-home-'));
        const globalPath = join(home, '.config', 'spur', 'config.yaml');
        mkdirSync(join(globalPath, '..'), { recursive: true });
        writeFileSync(globalPath, GLOBAL_YAML);
        const projectDir = mkdtempSync(join(tmpdir(), 'executor-update-proj-'));
        mkdirSync(join(projectDir, '.spur'));
        writeFileSync(join(projectDir, '.spur', 'config.yaml'), PROJECT_YAML);
        return { home, globalPath, projectDir };
    }

    test('global-only executor is persisted in the global config; project file byte-identical', async () => {
        const tree = fakeHomeTree();
        try {
            const projectBefore = readFileSync(join(tree.projectDir, '.spur', 'config.yaml'));
            const out = await runInFakeHome(
                `
                const result = await setExecutorAvailability({
                    layer: 'global',
                    projectRoot: '${tree.projectDir}',
                    executor: 'gem',
                    disabled: { owner: 'quota', since: '2026-02-01T10:00:00.000Z', reason: 'agent.quota.exhausted gem' },
                });
                console.log(JSON.stringify(result));
            `,
                tree.home,
            );
            expect(JSON.parse(out.trim())).toEqual({ status: 'updated' });
            const parsed = parseYaml(readFileSync(tree.globalPath, 'utf8')) as {
                agent: { executors: Array<Record<string, unknown>> };
            };
            expect(parsed.agent.executors.find((entry) => entry.name === 'gem')?.disabled).toEqual({
                owner: 'quota',
                since: '2026-02-01T10:00:00.000Z',
                reason: 'agent.quota.exhausted gem',
            });
            // The global document model survives comments (yaml doc mutation, not reserialization).
            expect(readFileSync(tree.globalPath, 'utf8')).toContain('# global-only executor');
            // R2: the untouched project layer is byte-identical.
            expect(readFileSync(join(tree.projectDir, '.spur', 'config.yaml')).equals(projectBefore)).toBe(true);
            // Atomic commit: no temp leftover beside the global file.
            const tmpLeftovers = readdirSync(join(tree.globalPath, '..')).filter((name) => name.includes('.tmp-'));
            expect(tmpLeftovers).toEqual([]);
        } finally {
            rmSync(tree.home, { recursive: true, force: true });
            rmSync(tree.projectDir, { recursive: true, force: true });
        }
    });

    test('a project fragment wins over a global-only request when both layers declare the name', async () => {
        const tree = fakeHomeTree();
        try {
            const globalBefore = readFileSync(tree.globalPath);
            const out = await runInFakeHome(
                `
                const result = await setExecutorAvailability({
                    layer: 'global',
                    projectRoot: '${tree.projectDir}',
                    executor: 'alpha',
                    disabled: true,
                });
                console.log(JSON.stringify(result));
            `,
                tree.home,
            );
            expect(JSON.parse(out.trim())).toEqual({ status: 'updated' });
            const project = parseYaml(readFileSync(join(tree.projectDir, '.spur', 'config.yaml'), 'utf8')) as {
                agent: { executors: Array<{ name: string; disabled?: unknown }> };
            };
            expect(project.agent.executors.find((entry) => entry.name === 'alpha')?.disabled).toBe(true);
            // Global file untouched — the write landed in the declaring project layer.
            expect(readFileSync(tree.globalPath).equals(globalBefore)).toBe(true);
        } finally {
            rmSync(tree.home, { recursive: true, force: true });
            rmSync(tree.projectDir, { recursive: true, force: true });
        }
    });

    test('global write preserves file mode and the loader sees the change without restart (R3)', async () => {
        const tree = fakeHomeTree();
        try {
            chmodSync(tree.globalPath, 0o600);
            const out = await runInFakeHome(
                `
                // Prime the loader cache with the pre-write effective config.
                await loadSpurConfig('${tree.projectDir}');
                const before = (await loadSpurConfig('${tree.projectDir}')).agent?.executors?.find((e) => e.name === 'gem')?.disabled ?? null;
                const result = await setExecutorAvailability({
                    layer: 'global',
                    projectRoot: '${tree.projectDir}',
                    executor: 'gem',
                    disabled: { owner: 'quota', since: '2026-02-01T12:00:00.000Z', reason: 'agent.quota.exhausted gem' },
                });
                const after = (await loadSpurConfig('${tree.projectDir}')).agent?.executors?.find((e) => e.name === 'gem')?.disabled ?? null;
                console.log(JSON.stringify({ result, before, after, mode: (await import('node:fs')).statSync('${tree.globalPath}').mode & 0o777 }));
            `,
                tree.home,
            );
            const parsed = JSON.parse(out.trim()) as { result: unknown; before: unknown; after: unknown; mode: number };
            expect(parsed.result).toEqual({ status: 'updated' });
            expect(parsed.before).toBe(false); // schema default for the absent flag
            expect(parsed.after).toEqual({
                owner: 'quota',
                since: '2026-02-01T12:00:00.000Z',
                reason: 'agent.quota.exhausted gem',
            }); // cache invalidation fired — no restart
            expect(parsed.mode).toBe(0o600); // mode preserved through the atomic rename
        } finally {
            rmSync(tree.home, { recursive: true, force: true });
            rmSync(tree.projectDir, { recursive: true, force: true });
        }
    });
});
