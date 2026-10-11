import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    normalizeProjectPath,
    setPortProbeForTests,
    setProcessHelpersForTests,
} from '../../src/services/project-registry';
import {
    type StopRegisteredProjectOptions,
    setProjectStopFetchForTests,
    stopRegisteredProject,
} from '../../src/services/project-stop';

/**
 * 1156 ownership-verified stop matrix. All process/port/HTTP surfaces are
 * injected seams with fake PIDs — no real host process is ever signaled.
 */
describe('stopRegisteredProject', () => {
    let tempDir: string;
    let projectPath: string;

    const PORT = 3987;
    const PID = 42424;

    let signals: Array<{ pid: number; signal: string }>;
    let liveState: boolean;
    let pidScript: number[];

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-project-stop-test-'));
        projectPath = normalizeProjectPath(tempDir);
        signals = [];
        liveState = true;
        pidScript = [PID];

        setPortProbeForTests(async (port) => (port === PORT && liveState ? 'in-use' : 'available'));
        setProcessHelpersForTests({
            pidFinder: (port) => {
                if (port !== PORT) return undefined;
                return pidScript.length > 0 ? pidScript.shift() : PID;
            },
            processKiller: (pid, signal) => {
                signals.push({ pid, signal });
                return true;
            },
        });
    });

    afterEach(() => {
        setPortProbeForTests(undefined);
        setProcessHelpersForTests(undefined);
        setProjectStopFetchForTests(undefined);
        rmSync(tempDir, { recursive: true, force: true });
    });

    const entry = () => ({ name: 'OwnedProj', path: projectPath, port: PORT });

    /** Fetch seam: valid Spur identity for the registered project on both loopback hosts. */
    function ownedFetch(overrides?: {
        service?: unknown;
        projectPath?: unknown;
        failIpv4?: boolean;
        failAll?: boolean;
        malformedJson?: boolean;
        healthStatus?: number;
    }): typeof fetch {
        const impl = async (input: string | URL | Request) => {
            const url = new URL(String(input));
            if (overrides?.failAll) {
                throw new Error('connect ECONNREFUSED');
            }
            if (overrides?.failIpv4 && url.hostname === '127.0.0.1') {
                throw new Error('connect ECONNREFUSED');
            }
            if (overrides?.malformedJson) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => {
                        throw new Error('Unexpected token');
                    },
                } as unknown as Response;
            }
            if (overrides?.healthStatus !== undefined && url.pathname === '/api/health') {
                return {
                    ok: false,
                    status: overrides.healthStatus,
                    json: async () => ({}),
                } as unknown as Response;
            }
            if (url.pathname === '/api/health') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ status: 'ok', service: overrides?.service ?? 'spur' }),
                } as unknown as Response;
            }
            if (url.pathname === '/api/project') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        name: 'OwnedProj',
                        path: overrides && 'projectPath' in overrides ? overrides.projectPath : projectPath,
                    }),
                } as unknown as Response;
            }
            return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
        };
        return impl as unknown as typeof fetch;
    }

    const opts = (fetchImpl: typeof fetch): StopRegisteredProjectOptions => ({
        killTimeoutMs: 120,
        requestTimeoutMs: 50,
        fetchImpl,
    });

    it('stops a verified same-owned listener with SIGTERM and reports termination', async () => {
        setProcessHelpersForTests({
            pidFinder: () => {
                return PID;
            },
            processKiller: (pid, signal) => {
                signals.push({ pid, signal });
                if (signal === 'SIGTERM') liveState = false;
                return true;
            },
        });

        const result = await stopRegisteredProject(entry(), opts(ownedFetch()));
        expect(result.stopped).toBe(true);
        expect(result.terminated).toEqual({ pid: PID, port: PORT, signal: 'SIGTERM' });
        expect(signals).toEqual([{ pid: PID, signal: 'SIGTERM' }]);
    });

    it('verifies identity over IPv6 when IPv4 loopback is unavailable', async () => {
        setProcessHelpersForTests({
            pidFinder: () => PID,
            processKiller: (pid, signal) => {
                signals.push({ pid, signal });
                if (signal === 'SIGTERM') liveState = false;
                return true;
            },
        });

        const result = await stopRegisteredProject(entry(), opts(ownedFetch({ failIpv4: true })));
        expect(result.stopped).toBe(true);
        expect(result.terminated?.signal).toBe('SIGTERM');
    });

    it('treats an absent listener as an idempotent stop without any signal', async () => {
        liveState = false;
        const result = await stopRegisteredProject(entry(), opts(ownedFetch()));
        expect(result.stopped).toBe(true);
        expect(result.terminated).toBeUndefined();
        expect(signals).toEqual([]);
    });

    it('refuses a foreign service listener without signaling', async () => {
        const result = await stopRegisteredProject(entry(), opts(ownedFetch({ service: 'nginx' })));
        expect(result.stopped).toBe(false);
        expect(result.reason).toContain('not a Spur server');
        expect(result.terminated).toBeUndefined();
        expect(signals).toEqual([]);
    });

    it('refuses a Spur server serving a different project path', async () => {
        const result = await stopRegisteredProject(entry(), opts(ownedFetch({ projectPath: '/other/project' })));
        expect(result.stopped).toBe(false);
        expect(result.reason).toContain('does not match');
        expect(signals).toEqual([]);
    });

    it('refuses when the server reports no project path (legacy server)', async () => {
        const result = await stopRegisteredProject(entry(), opts(ownedFetch({ projectPath: null })));
        expect(result.stopped).toBe(false);
        expect(result.reason).toContain('did not report a project path');
        expect(signals).toEqual([]);
    });

    it('refuses on malformed identity JSON', async () => {
        const result = await stopRegisteredProject(entry(), opts(ownedFetch({ malformedJson: true })));
        expect(result.stopped).toBe(false);
        expect(signals).toEqual([]);
    });

    it('refuses on non-OK health status', async () => {
        const result = await stopRegisteredProject(entry(), opts(ownedFetch({ healthStatus: 503 })));
        expect(result.stopped).toBe(false);
        expect(signals).toEqual([]);
    });

    it('refuses when identity endpoints time out on both hosts', async () => {
        const result = await stopRegisteredProject(entry(), opts(ownedFetch({ failAll: true })));
        expect(result.stopped).toBe(false);
        expect(result.reason).toContain('unreachable');
        expect(signals).toEqual([]);
    });

    it('refuses a self or parent PID without probing or signaling', async () => {
        for (const unsafePid of [process.pid, process.ppid, 1]) {
            pidScript = [unsafePid];
            const result = await stopRegisteredProject(entry(), opts(ownedFetch()));
            expect(result.stopped).toBe(false);
            expect(result.reason).toContain('unsafe PID');
        }
        expect(signals).toEqual([]);
    });

    it('refuses when no listening PID can be discovered', async () => {
        setProcessHelpersForTests({
            pidFinder: () => undefined,
            processKiller: (pid, signal) => {
                signals.push({ pid, signal });
                return true;
            },
        });
        const result = await stopRegisteredProject(entry(), opts(ownedFetch()));
        expect(result.stopped).toBe(false);
        expect(result.reason).toContain('no listening PID');
        expect(signals).toEqual([]);
    });

    it('blocks SIGTERM when the PID changes during verification', async () => {
        // First discovery 42424, rediscovery 43434 — replacement listener.
        pidScript = [42424, 43434];
        const result = await stopRegisteredProject(entry(), opts(ownedFetch()));
        expect(result.stopped).toBe(false);
        expect(result.reason).toContain('PID changed');
        expect(signals).toEqual([]);
    });

    it('never SIGKILLs a replacement listener during escalation', async () => {
        // Port stays live after SIGTERM; revalidation discovers a different PID.
        pidScript = [42424, 42424, 55555, 55555];
        const result = await stopRegisteredProject(entry(), opts(ownedFetch()));
        expect(result.stopped).toBe(false);
        expect(result.reason).toContain('replacement listener');
        expect(signals).toEqual([{ pid: 42424, signal: 'SIGTERM' }]);
    });

    it('never SIGKILLs when ownership identity disappears during escalation', async () => {
        // SIGTERM lands but the port stays bound and the server stops answering
        // identity — no blind KILL after health disappears.
        let fetchImpl: typeof fetch = ownedFetch();
        setProcessHelpersForTests({
            pidFinder: () => PID,
            processKiller: (pid, signal) => {
                signals.push({ pid, signal });
                if (signal === 'SIGTERM') {
                    fetchImpl = ownedFetch({ failAll: true });
                }
                return true;
            },
        });
        const dynamicOpts: StopRegisteredProjectOptions = {
            killTimeoutMs: 120,
            requestTimeoutMs: 50,
            fetchImpl: ((input: string | URL | Request, init?: RequestInit) =>
                fetchImpl(input, init)) as unknown as typeof fetch,
        };
        const result = await stopRegisteredProject(entry(), dynamicOpts);
        expect(result.stopped).toBe(false);
        expect(result.reason).toContain('revalidation failed');
        expect(signals).toEqual([{ pid: PID, signal: 'SIGTERM' }]);
    });

    it('escalates to SIGKILL for a stubborn verified listener and confirms disappearance', async () => {
        setProcessHelpersForTests({
            pidFinder: () => PID,
            processKiller: (pid, signal) => {
                signals.push({ pid, signal });
                if (signal === 'SIGKILL') liveState = false;
                return true;
            },
        });
        const result = await stopRegisteredProject(entry(), opts(ownedFetch()));
        expect(result.stopped).toBe(true);
        expect(result.terminated).toEqual({ pid: PID, port: PORT, signal: 'SIGKILL' });
        expect(signals).toEqual([
            { pid: PID, signal: 'SIGTERM' },
            { pid: PID, signal: 'SIGKILL' },
        ]);
    });

    it('reports refusal when SIGTERM delivery fails', async () => {
        setProcessHelpersForTests({
            pidFinder: () => PID,
            processKiller: (pid, signal) => {
                signals.push({ pid, signal });
                return false;
            },
        });
        const result = await stopRegisteredProject(entry(), opts(ownedFetch()));
        expect(result.stopped).toBe(false);
        expect(result.reason).toContain('SIGTERM could not be delivered');
        expect(result.terminated).toBeUndefined();
    });

    it('reports refusal when the listener survives SIGKILL (no terminated record)', async () => {
        // Port stays bound forever.
        const result = await stopRegisteredProject(entry(), opts(ownedFetch()));
        expect(result.stopped).toBe(false);
        expect(result.reason).toContain('still alive after SIGKILL');
        expect(result.terminated).toBeUndefined();
    });

    it('matches the project path through normalization (tilde/realpath equivalence)', async () => {
        setProcessHelpersForTests({
            pidFinder: () => PID,
            processKiller: (pid, signal) => {
                signals.push({ pid, signal });
                if (signal === 'SIGTERM') liveState = false;
                return true;
            },
        });
        // Server reports the raw (non-realpath) form; normalization must align it.
        const rawPath = join(tmpdir(), tempDir.split('/').pop() ?? '');
        const result = await stopRegisteredProject(entry(), opts(ownedFetch({ projectPath: rawPath })));
        expect(result.stopped).toBe(true);
        expect(result.terminated?.signal).toBe('SIGTERM');
    });
});
