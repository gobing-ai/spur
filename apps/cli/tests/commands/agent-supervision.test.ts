/**
 * Supervision of agent loops (task 1088, feature G67):
 * - R1 — `agent status|stop|start|list --specs` target THIS project's live serve: the port comes
 *   from the project registry entry for the cwd (`ProjectRegistry.setPort`), with an explicit
 *   `--server` winning and `http://localhost:3000/api` as the no-live-entry fallback.
 * - R2 — a supervised `agent loop` aborts its loop signal when its parent process changes, so a
 *   SIGKILLed serve cannot leave orphan loops.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentCoordinationService, type PortProbeResult, setPortProbeForTests } from '@gobing-ai/spur-app';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { main } from '../../src';
import {
    resetAgentServerFetchForTesting,
    resolveAgentServer,
    setAgentServerFetchForTesting,
    startParentWatch,
} from '../../src/commands/agent';
import { createCliContext } from '../../src/context';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

const REGISTRY_PORT = 3011;

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A throwaway project whose registry entry claims `port`. `portProbe` decides whether the entry
 * reads as live: `healStale` (>0 ports only) probes it, so 'in-use' keeps the port and 'available'
 * lets the registry clear it to 0 — the dead-serve fallback.
 */
async function makeProject(
    port: number,
    portProbe: PortProbeResult,
): Promise<{
    cwd: string;
    out: CapturedOutput;
    cleanup: () => Promise<void>;
}> {
    setPortProbeForTests(() => Promise.resolve(portProbe));
    const cwd = await mkdtemp(join(tmpdir(), 'spur-agent-supervision-'));
    await mkdir(join(cwd, 'docs', 'tasks'), { recursive: true });
    const registryFile = join(cwd, 'projects.json');
    await writeFile(registryFile, JSON.stringify({ schema_version: 1, projects: [{ name: 'demo', path: cwd, port }] }));
    setEnvVar('SPUR_PROJECTS_FILE', registryFile);
    const out = createCapturedOutput();
    return {
        cwd,
        out,
        cleanup: async () => {
            resetAgentServerFetchForTesting();
            removeEnvVar('SPUR_PROJECTS_FILE');
            setPortProbeForTests(undefined);
            await rm(cwd, { recursive: true, force: true });
        },
    };
}

/** Seed one agent spec so the status/list paths reach the server lookup. */
async function seedSpec(cwd: string, specId: string): Promise<void> {
    await new AgentCoordinationService(createCliContext({ cwd, output: createCapturedOutput() })).createAgentSpec({
        id: specId,
        type: 'claude-code',
        purpose: 'plan it',
    });
}

describe('agent server resolution (1088 R1)', () => {
    test('resolveAgentServer renders the localhost host for the cwd registry port', async () => {
        const { cwd, cleanup } = await makeProject(REGISTRY_PORT, 'in-use');
        try {
            // host `localhost`, never the IPv4 literal `127.0.0.1`: `Bun.serve` with the `--host`
            // default binds IPv6 `[::1]` only, so a `127.0.0.1` client would get ECONNREFUSED.
            expect(await resolveAgentServer(cwd)).toBe(`http://localhost:${REGISTRY_PORT}/api`);
        } finally {
            await cleanup();
        }
    });

    test('resolveAgentServer falls back to port 3000 when no ancestor is registered', async () => {
        const { cwd, cleanup } = await makeProject(REGISTRY_PORT, 'in-use');
        try {
            // A path outside the registered tree. A path INSIDE it resolves to the project root's
            // serve — that is the ancestor walk, pinned by the subdirectory test below.
            expect(await resolveAgentServer(join(cwd, '..', 'not-registered'))).toBe('http://localhost:3000/api');
        } finally {
            await cleanup();
        }
    });

    test('resolveAgentServer falls back to port 3000 when the entry port is not live', async () => {
        const { cwd, cleanup } = await makeProject(REGISTRY_PORT, 'available');
        try {
            expect(await resolveAgentServer(cwd)).toBe('http://localhost:3000/api');
        } finally {
            await cleanup();
        }
    });

    test('resolveAgentServer lets an explicit --server win over the registry', async () => {
        const { cwd, cleanup } = await makeProject(REGISTRY_PORT, 'in-use');
        try {
            expect(await resolveAgentServer(cwd, 'http://x:9/api')).toBe('http://x:9/api');
        } finally {
            await cleanup();
        }
    });

    test('resolveAgentServer finds the nearest registered ancestor from a subdirectory', async () => {
        const projects = [{ name: 'demo', path: '/work/demo', port: 4321 }];
        const deps = { registry: { peek: () => ({ projects, unreadable: false }) }, isLive: async () => true };
        // Run from a nested directory: the exact-cwd lookup missed it and silently fell through
        // to the 3000 default, which may be a different project's serve (1088 follow-up).
        expect(await resolveAgentServer('/work/demo/packages/app/src', undefined, deps)).toBe(
            'http://localhost:4321/api',
        );
        // A path outside the registered tree still falls back.
        expect(await resolveAgentServer('/work/other', undefined, deps)).toBe('http://localhost:3000/api');
    });

    test('resolveAgentServer names the reason when the registry is unreadable', async () => {
        const warnings: string[] = [];
        const resolved = await resolveAgentServer('/work/demo', undefined, {
            registry: { peek: () => ({ projects: [], unreadable: true }) },
            warn: (m) => warnings.push(m),
        });
        expect(resolved).toBe('http://localhost:3000/api');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('project registry unreadable');
    });

    test('resolveAgentServer names the skipped port when the registered serve is not listening', async () => {
        const warnings: string[] = [];
        const resolved = await resolveAgentServer('/work/demo', undefined, {
            registry: {
                peek: () => ({ projects: [{ name: 'demo', path: '/work/demo', port: 4321 }], unreadable: false }),
            },
            isLive: async () => false,
            warn: (m) => warnings.push(m),
        });
        expect(resolved).toBe('http://localhost:3000/api');
        expect(warnings[0]).toContain('4321');
    });

    test('resolving the default server does not mutate the registry (read-only lookup)', async () => {
        // `getByPath` routed through `list()` -> healStale, which clears a `port > 0` entry whose
        // liveness probe misses. Resolving a read must not rewrite the operator's registry.
        const { cwd, cleanup } = await makeProject(REGISTRY_PORT, 'available');
        const registryFile = join(cwd, 'projects.json');
        try {
            const before = await readFile(registryFile, 'utf8');
            expect(await resolveAgentServer(cwd)).toBe('http://localhost:3000/api');
            expect(await readFile(registryFile, 'utf8')).toBe(before);
        } finally {
            await cleanup();
        }
    });

    test('agent status reports the registry-port serve’s live pid', async () => {
        const { cwd, out, cleanup } = await makeProject(REGISTRY_PORT, 'in-use');
        try {
            await seedSpec(cwd, 'planner');
            const urls: string[] = [];
            setAgentServerFetchForTesting((async (url: string) => {
                urls.push(String(url));
                return jsonResponse(200, {
                    processes: [{ agentId: 'planner', pid: 51234, status: 'running' }],
                });
            }) as typeof fetch);
            expect(await main(['agent', 'status'], { cwd, output: out, dbUrl: ':memory:' })).toBe(0);
            expect(urls).toEqual([`http://localhost:${REGISTRY_PORT}/api/processes`]);
            expect(
                out.messages
                    .at(-1)
                    ?.split('\n')
                    .find((l) => l.startsWith('planner\t')),
            ).toContain('\trunning pid=51234');
        } finally {
            await cleanup();
        }
    });

    test('agent status --server overrides the registry port', async () => {
        const { cwd, out, cleanup } = await makeProject(REGISTRY_PORT, 'in-use');
        try {
            await seedSpec(cwd, 'planner');
            const urls: string[] = [];
            setAgentServerFetchForTesting((async (url: string) => {
                urls.push(String(url));
                return jsonResponse(200, { processes: [] });
            }) as typeof fetch);
            expect(await main(['agent', 'status', '--server', 'http://x:9/api'], { cwd, output: out })).toBe(0);
            expect(urls).toEqual(['http://x:9/api/processes']);
        } finally {
            await cleanup();
        }
    });

    test('agent status surfaces the resolver diagnostic through the CLI output contract', async () => {
        // The resolver's warnings ride `context.output.error`, never raw stdio
        // (the `no-raw-stdout-stderr` rule). A dead registered port must say so instead of
        // silently querying the 3000 fallback — the registry no longer heals it away.
        const { cwd, out, cleanup } = await makeProject(REGISTRY_PORT, 'available');
        try {
            await seedSpec(cwd, 'planner');
            setAgentServerFetchForTesting((async () =>
                jsonResponse(200, { processes: [] })) as unknown as typeof fetch);
            expect(await main(['agent', 'status', '--json'], { cwd, output: out })).toBe(0);
            expect(out.errors.join('\n')).toContain(`${REGISTRY_PORT}`);
            expect(out.errors.join('\n')).toContain('not listening');
        } finally {
            await cleanup();
        }
    });

    test('agent status with no live registry entry queries port 3000', async () => {
        const { cwd, out, cleanup } = await makeProject(REGISTRY_PORT, 'available');
        try {
            await seedSpec(cwd, 'planner');
            const urls: string[] = [];
            setAgentServerFetchForTesting((async (url: string) => {
                urls.push(String(url));
                return jsonResponse(200, { processes: [] });
            }) as typeof fetch);
            expect(await main(['agent', 'status'], { cwd, output: out })).toBe(0);
            expect(urls).toEqual(['http://localhost:3000/api/processes']);
        } finally {
            await cleanup();
        }
    });

    test('agent stop posts to the registry-port serve (1088 AC1)', async () => {
        const { cwd, out, cleanup } = await makeProject(REGISTRY_PORT, 'in-use');
        try {
            const calls: Array<{ url: string; method: string }> = [];
            setAgentServerFetchForTesting((async (url: string, init: RequestInit) => {
                calls.push({ url: String(url), method: init?.method ?? '' });
                return jsonResponse(200, { ok: true });
            }) as typeof fetch);
            expect(await main(['agent', 'stop', 'planner'], { cwd, output: out })).toBe(0);
            expect(calls).toEqual([
                { url: `http://localhost:${REGISTRY_PORT}/api/agents/planner/stop`, method: 'POST' },
            ]);
            expect(out.messages.at(-1)).toBe('stopped planner');
        } finally {
            await cleanup();
        }
    });

    test('agent stop carries a same-origin Origin so the serve CSRF check admits it (1088 AC1)', async () => {
        const { cwd, out, cleanup } = await makeProject(REGISTRY_PORT, 'in-use');
        try {
            const origins: Array<string | undefined> = [];
            setAgentServerFetchForTesting((async (_url: string, init: RequestInit) => {
                origins.push(new Headers(init.headers).get('Origin') ?? undefined);
                return jsonResponse(200, { ok: true, pid: 6957, status: 'running' });
            }) as typeof fetch);
            expect(await main(['agent', 'stop', 'planner'], { cwd, output: out })).toBe(0);
            // hono `csrf()` 403s a POST with no Origin/Sec-Fetch-Site; the origin of the
            // resolved server is what a same-origin local caller sends.
            expect(origins).toEqual([`http://localhost:${REGISTRY_PORT}`]);
        } finally {
            await cleanup();
        }
    });

    test('agent start posts to the registry-port serve', async () => {
        const { cwd, out, cleanup } = await makeProject(REGISTRY_PORT, 'in-use');
        try {
            const urls: string[] = [];
            setAgentServerFetchForTesting((async (url: string) => {
                urls.push(String(url));
                return jsonResponse(200, { ok: true, pid: 99, status: 'running' });
            }) as typeof fetch);
            expect(await main(['agent', 'start', 'planner'], { cwd, output: out })).toBe(0);
            expect(urls).toEqual([`http://localhost:${REGISTRY_PORT}/api/agents/planner/start`]);
        } finally {
            await cleanup();
        }
    });

    test('agent list --specs merges live status from the registry-port serve', async () => {
        const { cwd, out, cleanup } = await makeProject(REGISTRY_PORT, 'in-use');
        try {
            await seedSpec(cwd, 'planner');
            const urls: string[] = [];
            setAgentServerFetchForTesting((async (url: string) => {
                urls.push(String(url));
                return jsonResponse(200, {
                    processes: [{ agentId: 'planner', pid: 4132, status: 'running' }],
                });
            }) as typeof fetch);
            expect(await main(['agent', 'list', '--specs'], { cwd, output: out })).toBe(0);
            expect(urls).toEqual([`http://localhost:${REGISTRY_PORT}/api/processes`]);
            expect(
                out.messages
                    .at(-1)
                    ?.split('\n')
                    .find((l) => l.startsWith('planner\t')),
            ).toContain('\trunning pid=4132');
        } finally {
            await cleanup();
        }
    });
});

describe('agent loop parent watch (1088 R2)', () => {
    test('aborts the loop signal when the parent process changes', async () => {
        const controller = new AbortController();
        let ppid = 4242;
        const stop = startParentWatch(controller, 5, () => ppid);
        try {
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(controller.signal.aborted).toBe(false);
            ppid = 1; // the serve was SIGKILLed; this loop was reparented
            await new Promise((resolve) => setTimeout(resolve, 40));
            expect(controller.signal.aborted).toBe(true);
        } finally {
            stop();
        }
    });

    test('leaves a loop with a stable parent running', async () => {
        const controller = new AbortController();
        const stop = startParentWatch(controller, 5, () => 4242);
        try {
            await new Promise((resolve) => setTimeout(resolve, 40));
            expect(controller.signal.aborted).toBe(false);
        } finally {
            stop();
        }
    });

    test('the returned stop function ends the watch', async () => {
        const controller = new AbortController();
        let ppid = 4242;
        const stop = startParentWatch(controller, 5, () => ppid);
        stop();
        ppid = 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(controller.signal.aborted).toBe(false);
    });
});
