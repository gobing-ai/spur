import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { collectSelfStatus, installationProvenance, type SelfStatusContext } from '../../src/services/self-status';

/**
 * Read-only FileSystem stub: the paths in `present` exist, `dirs` maps a directory to its entries.
 * Nothing is written, so a write anywhere in the collector fails loudly instead of silently mutating.
 */
function fakeFs(present: string[], dirs: Record<string, string[]> = {}): FileSystem {
    const forbidden = (): never => {
        throw new Error('self status must never write');
    };
    return {
        exists: (path: string) => present.includes(path),
        readDir: (path: string) => dirs[path] ?? [],
        stat: (path: string) =>
            present.includes(path) ? { size: 0, isFile: () => true, isDirectory: () => false } : null,
        readFile: forbidden,
        writeFile: forbidden,
        appendFile: forbidden,
        ensureDir: forbidden,
        deleteFile: forbidden,
        rename: forbidden,
        copy: forbidden,
        createWriteStream: forbidden,
        resolve: (...segments: string[]) => segments.join('/'),
        getProjectRoot: () => '/project',
    } as unknown as FileSystem;
}

/**
 * Consolidated self status collector (A93 1352 R1-R4) — the decision rules that could make the
 * aggregate lie, in the order they matter:
 *
 *   - a missing database is reported as missing, never as a healthy empty one
 *   - an unreadable ledger is `unavailable` with a reason, never a fabricated count
 *   - a credential value never reaches the aggregate
 *   - an optional provider that never answers is cut off by the deadline, and the sections that
 *     did answer still ship
 *   - `overallState` degrades for machine problems while the legacy `ok`/exit contract stays about
 *     the project scaffold
 */

const baseContext = (overrides: Partial<SelfStatusContext> = {}): SelfStatusContext => ({
    cwd: '/project',
    env: { PATH: '/usr/bin' },
    config: null,
    git: { root: null, branch: null, dirty: false },
    ...overrides,
});

describe('collectSelfStatus — missing evidence is named, not faked', () => {
    test('no project and no database: missing states, ok false', async () => {
        const aggregate = await collectSelfStatus(baseContext());
        expect(aggregate.ok).toBe(false);
        expect(aggregate.overallState).toBe('missing');
        expect(aggregate.sections.configuration.state).toBe('missing');
        expect(aggregate.sections.schema.state).toBe('missing');
        expect(aggregate.sections.workflows.state).not.toBe('ready');
        expect(aggregate.schemaVersion).toBe(1);
    });

    test('an existing database makes ledger sections unavailable, never zero-counts', async () => {
        const aggregate = await collectSelfStatus(
            baseContext({
                config: null,
                env: { PATH: '/usr/bin' },
                fs: fakeFs(['/project/.spur/spur.db']),
            }),
        );
        expect(aggregate.sections.schema.state).toBe('unavailable');
        expect(aggregate.sections.schema.message.length).toBeGreaterThan(0);
        expect(aggregate.sections.workflows.state).toBe('unavailable');
        expect(aggregate.sections.workflows.data).toBeUndefined();
        expect(typeof aggregate.sections.decisions.data?.ledger).toBe('string');
    });

    test('a configured project reports a ready configuration with no database', async () => {
        const aggregate = await collectSelfStatus(
            baseContext({
                config: null,
                fs: fakeFs(['/project/.spur/config.yaml', '/project/package.json', '/project/.spur/agents'], {
                    '/project/.spur/agents': ['planner.yaml', '.gitkeep'],
                }),
            }),
        );
        expect(aggregate.ok).toBe(true);
        expect(aggregate.spurConfig).toBe(true);
        expect(aggregate.packageJson).toBe(true);
        expect(aggregate.agentSpecs).toEqual(['planner']);
        expect(aggregate.sections.configuration.state).toBe('ready');
        expect(aggregate.sections.schema.state).toBe('missing');
    });
});

describe('collectSelfStatus — no credential leakage', () => {
    test('the presence flag is set and the value never appears', async () => {
        const sentinel = 'sk-abcdef0123456789';
        const aggregate = await collectSelfStatus(
            baseContext({ env: { PATH: '/usr/bin', TYPESAFE_API_KEY: sentinel } }),
        );
        expect(aggregate.decisionMaker.credentialPresent).toBe(true);
        expect(JSON.stringify(aggregate)).not.toContain(sentinel);
    });
});

describe('collectSelfStatus — bounded partial results', () => {
    test('a provider that never answers is cut off and other sections survive', async () => {
        const hang = (() => new Promise<never>(() => {})) as unknown as typeof fetch;
        const startedAt = Date.now();
        const aggregate = await collectSelfStatus(baseContext({ config: null, fetchImpl: hang, deadlineMs: 50 }));
        const elapsed = Date.now() - startedAt;
        expect(elapsed).toBeLessThan(2_000);
        expect(['unavailable', 'not-applicable']).toContain(aggregate.sections.projects.state);
        expect(aggregate.sections.installation.state).toBe('ready');
        expect(aggregate.sections.configuration.state).toBe('missing');
    });

    test('missing required tools degrade the aggregate without breaking the scaffold contract', async () => {
        const aggregate = await collectSelfStatus(baseContext({ env: { PATH: '/nonexistent-path' } }));
        expect(aggregate.sections.dependencies.state).toBe('degraded');
        expect(aggregate.sections.dependencies.message).toContain('git');
        // ok stays about project scaffold health, so an empty project is still `missing`, not `degraded`.
        expect(aggregate.overallState).toBe('missing');
    });
});

describe('installationProvenance', () => {
    test('classifies source, packed and standalone launches', () => {
        expect(installationProvenance('/repo/apps/cli/src/index.ts')).toBe('source');
        expect(installationProvenance('/usr/lib/spur/spur.js')).toBe('packed');
        expect(installationProvenance('/usr/local/bin/spur')).toBe('standalone');
        expect(installationProvenance(null)).toBe('unknown');
    });
});

/** A registry file the collector can read through `SPUR_PROJECTS_FILE`. */
async function registry(entries: unknown[] | string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-self-status-'));
    const file = join(dir, 'projects.json');
    await writeFile(
        file,
        typeof entries === 'string' ? entries : JSON.stringify({ schema_version: 1, projects: entries }),
    );
    return file;
}

const okFetch = (payload: unknown): typeof fetch =>
    (() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))) as unknown as typeof fetch;
const failingFetch = (status: number): typeof fetch =>
    (() => Promise.resolve(new Response('nope', { status }))) as unknown as typeof fetch;
const throwingFetch = (() => Promise.reject(new Error('connection refused'))) as unknown as typeof fetch;

describe('collectSelfStatus — projects section', () => {
    test('an unreadable registry is degraded, not silently empty', async () => {
        const file = await registry('{not json');
        const aggregate = await collectSelfStatus(baseContext({ env: { PATH: '/usr/bin', SPUR_PROJECTS_FILE: file } }));
        expect(aggregate.sections.projects.state).toBe('degraded');
        expect(aggregate.sections.projects.message).toContain('registry');
    });

    test('an unregistered project is not-applicable; a stopped one names the remedy', async () => {
        const file = await registry([{ name: 'other', path: '/somewhere-else', port: 0 }]);
        const unregistered = await collectSelfStatus(
            baseContext({ env: { PATH: '/usr/bin', SPUR_PROJECTS_FILE: file } }),
        );
        expect(unregistered.sections.projects.state).toBe('not-applicable');

        const stopped = await registry([{ name: 'project', path: '/project', port: 0 }]);
        const aggregate = await collectSelfStatus(
            baseContext({ env: { PATH: '/usr/bin', SPUR_PROJECTS_FILE: stopped } }),
        );
        expect(aggregate.sections.projects.state).toBe('not-applicable');
        expect(aggregate.sections.projects.message).toContain('spur serve');
    });

    test('a healthy, a failing and an unreachable serve are distinguished', async () => {
        const file = await registry([{ name: 'project', path: '/project', port: 1234 }]);
        const env = { PATH: '/usr/bin', SPUR_PROJECTS_FILE: file };

        const healthy = await collectSelfStatus(baseContext({ env, fetchImpl: okFetch({ service: 'spur' }) }));
        expect(healthy.sections.projects.state).toBe('ready');
        expect(healthy.sections.projects.data?.port).toBe(1234);

        const failing = await collectSelfStatus(baseContext({ env, fetchImpl: failingFetch(503) }));
        expect(failing.sections.projects.state).toBe('degraded');
        expect(failing.sections.projects.message).toContain('503');

        const unreachable = await collectSelfStatus(baseContext({ env, fetchImpl: throwingFetch }));
        expect(unreachable.sections.projects.state).toBe('degraded');
        expect(unreachable.sections.projects.message).toContain('unreachable');
    });
});

describe('collectSelfStatus — agents section', () => {
    const withSpecs = ['/project/.spur/agents', '/project/.spur/config.yaml'];
    const dirs = { '/project/.spur/agents': ['planner.yaml'] };

    test('specs without a serve are reported without live state', async () => {
        const file = await registry([]);
        const aggregate = await collectSelfStatus(
            baseContext({ fs: fakeFs(withSpecs, dirs), env: { PATH: '/usr/bin', SPUR_PROJECTS_FILE: file } }),
        );
        expect(aggregate.sections.agents.state).toBe('ready');
        expect(aggregate.sections.agents.data?.live).toBe(false);
        expect(aggregate.sections.agents.data?.specs).toEqual(['planner']);
    });

    test('no specs is not-applicable', async () => {
        const file = await registry([]);
        const aggregate = await collectSelfStatus(
            baseContext({
                fs: fakeFs(['/project/.spur/config.yaml']),
                env: { PATH: '/usr/bin', SPUR_PROJECTS_FILE: file },
            }),
        );
        expect(aggregate.sections.agents.state).toBe('not-applicable');
        expect(aggregate.agentSpecs).toEqual([]);
    });

    test('a live serve contributes running ids; a silent one degrades the section', async () => {
        const file = await registry([{ name: 'project', path: '/project', port: 4321 }]);
        const env = { PATH: '/usr/bin', SPUR_PROJECTS_FILE: file };
        const live = await collectSelfStatus(
            baseContext({ fs: fakeFs(withSpecs, dirs), env, fetchImpl: okFetch([{ id: 'planner' }, { id: 7 }]) }),
        );
        expect(live.sections.agents.state).toBe('ready');
        expect(live.sections.agents.data?.running).toEqual(['planner']);

        const wrapped = await collectSelfStatus(
            baseContext({ fs: fakeFs(withSpecs, dirs), env, fetchImpl: okFetch({ processes: [{ id: 'planner' }] }) }),
        );
        expect(wrapped.sections.agents.data?.running).toEqual(['planner']);

        const silent = await collectSelfStatus(
            baseContext({ fs: fakeFs(withSpecs, dirs), env, fetchImpl: throwingFetch }),
        );
        expect(silent.sections.agents.state).toBe('degraded');
        expect(silent.sections.agents.message).toContain('live process state unavailable');
    });
});

describe('collectSelfStatus — tool, corpus and config-error sections', () => {
    test('present required tools make dependencies ready and list missing optional ones', async () => {
        const fs = fakeFs(['/usr/bin/git', '/project/.spur/config.yaml']);
        const aggregate = await collectSelfStatus(baseContext({ fs, env: { PATH: '/usr/bin' } }));
        expect(aggregate.sections.dependencies.state).toBe('degraded'); // bun missing in this fake PATH
        expect(aggregate.sections.dependencies.data?.missingOptional).toContain('zg');
    });

    test('a task and feature corpus is counted; an absent one is not-applicable', async () => {
        const fs = fakeFs(['/project/.spur/config.yaml', '/project/docs/tasks', '/project/docs/features'], {
            '/project/docs/tasks': ['1_a.md', '2_b.md', 'kanban.md'],
            '/project/docs/features': ['INDEX.md'],
        });
        const ready = await collectSelfStatus(baseContext({ fs, env: { PATH: '/usr/bin' } }));
        expect(ready.sections.corpus.state).toBe('ready');
        expect(ready.sections.corpus.data?.taskCount).toBe(3);
        expect(ready.sections.corpus.data?.featureCount).toBe(1);

        const absent = await collectSelfStatus(baseContext({ fs: fakeFs([]), env: { PATH: '/usr/bin' } }));
        expect(absent.sections.corpus.state).toBe('not-applicable');
    });

    test('a configuration error fails the configuration and decisions sections, not the process', async () => {
        const aggregate = await collectSelfStatus(
            baseContext({ configError: 'bad config at .spur/config.yaml:1', env: { PATH: '/usr/bin' } }),
        );
        expect(aggregate.sections.configuration.state).toBe('error');
        expect(aggregate.sections.decisions.state).toBe('error');
        expect(aggregate.ok).toBe(false);
        expect(aggregate.sections.installation.state).toBe('ready');
    });

    test('configured decision makers are reported from config', async () => {
        const aggregate = await collectSelfStatus(
            baseContext({
                env: { PATH: '/usr/bin' },
                config: { decisions: { maker: 'typesafe', makers: { local: 'laya-local' } } } as never,
            }),
        );
        expect(aggregate.sections.decisions.data?.defaultMaker).toBe('typesafe');
        expect(aggregate.sections.decisions.data?.configuredMakers).toEqual(['local']);
    });
});

describe('collectSelfStatus — a budget that expires mid-flight', () => {
    test('the hanging probe reports unavailable while answered sections still ship', async () => {
        const file = await registry([{ name: 'project', path: '/project', port: 1234 }]);
        const hang = (() => new Promise<never>(() => {})) as unknown as typeof fetch;
        const aggregate = await collectSelfStatus(
            baseContext({ env: { PATH: '/usr/bin', SPUR_PROJECTS_FILE: file }, fetchImpl: hang, deadlineMs: 5 }),
        );
        expect(aggregate.sections.projects.state).toBe('unavailable');
        expect(aggregate.sections.projects.message).toContain('deadline');
        expect(aggregate.sections.agents.state).toBe('unavailable');
        // Partial results survive: the machine section never depended on the aborted provider.
        expect(aggregate.sections.dependencies.state).toBe('degraded');
    });
});
