import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runCli } from '../../helpers';

/**
 * `spur self status` consolidated readiness (feature A93, task 1352 R1-R4).
 *
 * Failure modes first — each one is a way this command could lie or mutate:
 *   - it creates or migrates a database while merely reporting readiness
 *   - it repaints a missing project, missing schema or unreachable provider as healthy
 *   - it drops a legacy field or changes the project-config exit contract
 *   - it echoes a credential value into stdout/stderr
 *   - it hangs past the aggregate deadline on an unreachable provider
 *
 * Every case drives the real source CLI in a subprocess with an isolated HOME, registry
 * and config root, then snapshots the filesystem before/after.
 */

const SECTION_KEYS = [
    'agents',
    'configuration',
    'corpus',
    'decisions',
    'dependencies',
    'gateway',
    'installation',
    'projects',
    'schema',
    'workflows',
];

interface Fixture {
    cwd: string;
    home: string;
    env: Record<string, string | undefined>;
    cleanup: () => Promise<void>;
}

async function fixture(config?: string): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), 'spur-self-status-'));
    const cwd = join(root, 'project');
    const home = join(root, 'home');
    await mkdir(cwd, { recursive: true });
    await mkdir(home, { recursive: true });
    if (config !== undefined) {
        await mkdir(join(cwd, '.spur'), { recursive: true });
        await writeFile(join(cwd, '.spur', 'config.yaml'), config);
    }
    const env = {
        HOME: home,
        PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
        SPUR_GLOBAL_RULES_DIR: join(home, 'rules'),
        SPUR_PROJECTS_FILE: join(home, 'projects.json'),
    };
    return { cwd, home, env, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Recursive relative-path listing — the before/after no-mutation snapshot. */
async function snapshot(dir: string, prefix = ''): Promise<string[]> {
    if (!existsSync(dir)) return [];
    const entries = await readdir(join(dir, prefix === '' ? '.' : prefix), { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = prefix === '' ? entry.name : join(prefix, entry.name);
        if (entry.isDirectory()) {
            out.push(`${rel}/`);
            out.push(...(await snapshot(dir, rel)));
        } else {
            out.push(rel);
        }
    }
    return out;
}

interface SelfStatusJson {
    ok: boolean;
    packageJson: boolean;
    spurConfig: boolean;
    git: { root: string | null; branch: string | null; dirty: boolean };
    agentSpecs: string[];
    decisionMaker: { state: string; credentialPresent: boolean };
    schemaVersion: number;
    overallState: string;
    sections: Record<string, { state: string; scope: string; source: string; message: string; data?: unknown }>;
}

describe('A93 verification regressions', () => {
    test('reports the actual global layer and config locations', async () => {
        const fx = await fixture('project: fixture\n');
        try {
            const first = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            expect((first.json as SelfStatusJson).sections.configuration?.data).toMatchObject({ globalLayers: 0 });
            await mkdir(fx.env.SPUR_GLOBAL_RULES_DIR ?? '', { recursive: true });
            const globalPath = join(fx.env.SPUR_GLOBAL_RULES_DIR ?? '', 'config.yaml');
            await writeFile(globalPath, '# global defaults\n');
            const second = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            expect((second.json as SelfStatusJson).sections.configuration?.data).toMatchObject({
                globalLayers: 1,
                globalPath,
                projectPath: join(await realpath(fx.cwd), '.spur', 'config.yaml'),
            });
        } finally {
            await fx.cleanup();
        }
    });

    test('unavailable sections degrade the aggregate without changing the scaffold exit', async () => {
        const fx = await fixture('project: fixture\n');
        try {
            const result = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            const json = result.json as SelfStatusJson;
            expect(result.code).toBe(0);
            expect(json.sections.workflows?.state).toBe('unavailable');
            expect(json.overallState).toBe('degraded');
        } finally {
            await fx.cleanup();
        }
    });

    test('uses real agentId process rows and preserves every legacy spec filename', async () => {
        const fx = await fixture('project: fixture\n');
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: () =>
                Response.json({
                    processes: [
                        { agentId: 'planner', status: 'running', pid: 42 },
                        { agentId: 'stopped', status: 'exited', pid: null },
                    ],
                }),
        });
        try {
            await mkdir(join(fx.cwd, '.spur', 'agents'), { recursive: true });
            await writeFile(join(fx.cwd, '.spur', 'agents', 'planner.yaml'), 'id: planner\n');
            await writeFile(
                fx.env.SPUR_PROJECTS_FILE ?? '',
                JSON.stringify({
                    schema_version: 1,
                    projects: [{ name: 'fixture', path: fx.cwd, host: '127.0.0.1', port: server.port }],
                }),
            );
            const before = await snapshot(fx.cwd);
            const result = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            const json = result.json as SelfStatusJson;
            expect(result.code).toBe(0);
            expect(json.agentSpecs).toEqual(['planner']);
            expect(json.sections.agents?.data).toMatchObject({ running: ['planner'], live: true });
            expect(await snapshot(fx.cwd)).toEqual(before);
        } finally {
            server.stop(true);
            await fx.cleanup();
        }
    });

    test('consolidates the shared decision catalog without creating a database', async () => {
        const fx = await fixture('project: fixture\n');
        try {
            await mkdir(join(fx.cwd, '.spur', 'decisions'), { recursive: true });
            await writeFile(
                join(fx.cwd, '.spur', 'decisions', 'audit.yaml'),
                [
                    'version: 1',
                    'defaults:',
                    '  minConfidence: 0.8',
                    'decisions:',
                    '  audit-self:',
                    '    type: choice',
                    '    description: readiness fixture',
                    '    parameters: {}',
                    '    criteria:',
                    '      ready: Ready',
                    '      wait: Wait',
                    '    fallback: ready',
                    '',
                ].join('\n'),
            );
            const result = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            const data = (result.json as SelfStatusJson).sections.decisions?.data as {
                perDecision?: Array<{ id: string }>;
            };
            expect(result.code).toBe(0);
            expect(data.perDecision?.some((row) => row.id === 'audit-self')).toBe(true);
            expect(existsSync(join(fx.cwd, '.spur', 'spur.db'))).toBe(false);
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur self status — no project', () => {
    test('reports missing readiness, exits 1 and creates nothing', async () => {
        const fx = await fixture();
        try {
            const before = await snapshot(fx.cwd);
            // Only Spur-owned state counts: bun's own install cache also lives under HOME.
            const homeBefore = await snapshot(join(fx.home, '.config'));
            const result = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            const json = result.json as SelfStatusJson;
            expect(json.ok).toBe(false);
            expect(json.schemaVersion).toBe(1);
            expect(json.overallState).toBe('missing');
            expect(Object.keys(json.sections).sort()).toEqual(SECTION_KEYS);
            expect(json.sections.configuration?.state).toBe('missing');
            expect(json.sections.schema?.state).toBe('missing');
            expect(await snapshot(fx.cwd)).toEqual(before);
            expect(await snapshot(join(fx.home, '.config'))).toEqual(homeBefore);
            expect(existsSync(join(fx.cwd, '.spur'))).toBe(false);
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur self status — configured project', () => {
    test('keeps the legacy fields and exit contract while adding sections', async () => {
        const fx = await fixture('project: fixture\n');
        try {
            const before = await snapshot(fx.cwd);
            const result = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(0);
            const json = result.json as SelfStatusJson;
            expect(json.ok).toBe(true);
            expect(json.spurConfig).toBe(true);
            expect(typeof json.packageJson).toBe('boolean');
            expect(json.git).toBeDefined();
            expect(Array.isArray(json.agentSpecs)).toBe(true);
            expect(json.decisionMaker).toBeDefined();
            expect(json.overallState).not.toBe('missing');
            expect(json.sections.configuration?.state).toBe('ready');
            expect(json.sections.installation?.scope).toBe('machine');
            expect(json.sections.decisions?.state).toBe('ready');
            // Readiness reporting must not create or migrate the project database.
            expect(existsSync(join(fx.cwd, '.spur', 'spur.db'))).toBe(false);
            expect(await snapshot(fx.cwd)).toEqual(before);
        } finally {
            await fx.cleanup();
        }
    });

    test('reports an unavailable ledger read honestly instead of empty counts', async () => {
        const fx = await fixture('project: fixture\n');
        try {
            const result = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            const json = result.json as SelfStatusJson;
            const schema = json.sections.schema;
            expect(['missing', 'unavailable']).toContain(schema?.state ?? '');
            if (schema?.state === 'unavailable') expect(schema.message.length ?? 0).toBeGreaterThan(0);
            expect(json.sections.workflows?.state).not.toBe('ready');
        } finally {
            await fx.cleanup();
        }
    });

    test('never echoes a credential value', async () => {
        const fx = await fixture('project: fixture\n');
        try {
            const sentinel = 'sk-sentinel-do-not-print-0123456789';
            const result = await runCli(['self', 'status', '--json'], fx.cwd, {
                ...fx.env,
                TYPESAFE_API_KEY: sentinel,
            });
            const json = result.json as SelfStatusJson;
            expect(json.decisionMaker.credentialPresent).toBe(true);
            expect(result.stdout).not.toContain(sentinel);
            expect(result.stderr).not.toContain(sentinel);
        } finally {
            await fx.cleanup();
        }
    });

    test('keeps the legacy path argument and its failure exit', async () => {
        const fx = await fixture('project: fixture\n');
        try {
            const missing = await runCli(['self', 'status', 'no-such-file.txt'], fx.cwd, fx.env);
            expect(missing.code).toBe(1);
            expect(`${missing.stdout}${missing.stderr}`).toContain('path does not exist');
            await writeFile(join(fx.cwd, 'present.txt'), 'ok\n');
            const present = await runCli(['self', 'status', 'present.txt', '--json'], fx.cwd, fx.env);
            expect(present.code).toBe(0);
            const json = present.json as SelfStatusJson & { target?: { path: string; size: number } };
            expect(json.target?.path).toBe('present.txt');
            expect(json.target?.size).toBe(3);
        } finally {
            await fx.cleanup();
        }
    });

    test('renders the legacy text lines', async () => {
        const fx = await fixture('project: fixture\n');
        try {
            const result = await runCli(['self', 'status'], fx.cwd, fx.env);
            expect(result.code).toBe(0);
            for (const line of ['Project: ok', 'Package:', 'Agents:', 'Git:', 'DecisionMaker:']) {
                expect(result.stdout).toContain(line);
            }
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur self status — malformed project config', () => {
    test('fails closed with a safe diagnostic and no side effects', async () => {
        const fx = await fixture('project: [unterminated\n');
        try {
            const before = await snapshot(fx.cwd);
            const result = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            expect(result.code).toBe(1);
            const payload = JSON.parse(result.stdout) as { error?: { code: string; message: string } };
            expect(payload.error?.code).toBe('config');
            expect(payload.error?.message.length ?? 0).toBeGreaterThan(0);
            expect(result.stdout).not.toContain('unterminated\n');
            expect(await snapshot(fx.cwd)).toEqual(before);
        } finally {
            await fx.cleanup();
        }
    });
});

describe('spur self status — aggregate deadline', () => {
    test('a serve that never answers is cut off by the aggregate deadline', async () => {
        const fx = await fixture('project: fixture\n');
        // A listener that accepts the connection and never answers: only a real deadline bounds it.
        const silent = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
        try {
            await writeFile(
                fx.env.SPUR_PROJECTS_FILE as string,
                `${JSON.stringify({ schema_version: 1, projects: [{ name: 'fixture', path: fx.cwd, port: silent.port }] })}\n`,
            );
            const result = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            // Prove the deadline fired from its own report, not a wall-clock budget: a <9s ceiling also
            // counted the CLI process spawn and failed at 10066ms on a loaded host (load 22, 10 cores).
            // A missing deadline still hangs and trips the 20s test timeout below.
            expect(result.code).toBe(0);
            const json = result.json as SelfStatusJson;
            expect(json.sections.projects?.state).toBe('unavailable');
            expect(json.sections.projects?.message).toBe('project readiness exceeded the collection deadline');
            expect(json.sections.configuration?.state).toBe('ready');
        } finally {
            silent.stop(true);
            await fx.cleanup();
        }
        // The CLI enforces a 5000ms internal budget; the test's own ceiling must sit above it.
    }, 20_000);
});

describe('spur self status — bounded partial results', () => {
    test('an unreachable registered serve degrades its section without hanging', async () => {
        const fx = await fixture('project: fixture\n');
        try {
            // Port 1 on localhost refuses immediately; the section must degrade, not throw.
            await writeFile(
                fx.env.SPUR_PROJECTS_FILE as string,
                `${JSON.stringify({ schema_version: 1, projects: [{ name: 'fixture', path: fx.cwd, port: 1 }] })}\n`,
            );
            const startedAt = Date.now();
            const result = await runCli(['self', 'status', '--json'], fx.cwd, fx.env);
            const elapsed = Date.now() - startedAt;
            expect(elapsed).toBeLessThan(8_000);
            expect(result.code).toBe(0);
            const json = result.json as SelfStatusJson;
            expect(['degraded', 'unavailable', 'error']).toContain(json.sections.projects?.state ?? '');
            expect(json.sections.projects?.message.length ?? 0).toBeGreaterThan(0);
            // Partial results: the reachable sections are still present.
            expect(json.sections.configuration?.state).toBe('ready');
        } finally {
            await fx.cleanup();
        }
    });
});
