import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    classifyPortBindError,
    isPortAvailable,
    isPortLive,
    normalizeProjectPath,
    ProjectRegistry,
    portBindingAvailable,
    probePort,
    setPortProbeForTests,
} from '../../src/services/project-registry';

describe('ProjectRegistry', () => {
    let tempDir: string;
    let projectsFile: string;
    let registry: ProjectRegistry;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-project-registry-test-'));
        projectsFile = join(tempDir, 'projects.json');
        process.env.SPUR_PROJECTS_FILE = projectsFile;
        registry = new ProjectRegistry(projectsFile);
    });

    afterEach(() => {
        setPortProbeForTests(undefined);
        delete process.env.SPUR_PROJECTS_FILE;
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('should initialize empty list when file does not exist', async () => {
        const list = await registry.list();
        expect(list).toEqual([]);
    });

    it('should upsert and retrieve a project by path and name', async () => {
        const entry = await registry.upsert({
            name: 'Test Project',
            path: tempDir,
            port: 0,
        });

        expect(entry.name).toBe('Test Project');
        expect(entry.path).toBe(normalizeProjectPath(tempDir));
        expect(entry.port).toBe(0);

        const fetchedByPath = await registry.getByPath(tempDir);
        expect(fetchedByPath?.name).toBe('Test Project');

        const fetchedByName = await registry.getByName('Test Project');
        expect(fetchedByName?.path).toBe(normalizeProjectPath(tempDir));

        // Case-insensitive name lookup
        const fetchedByLower = await registry.getByName('test project');
        expect(fetchedByLower?.name).toBe('Test Project');
    });

    // Bucket A test: OS bind is the unit under test.
    // CI dependency note: .github/workflows/ci.yml runs bun run check unsandboxed.
    // If CI ever loses TCP bind capability, these tests decay to green-by-absence.
    it('should update port for an existing project when port is live', async () => {
        if (!(await portBindingAvailable())) {
            console.warn(
                '[SKIP:port-bind-denied] TCP port binding is denied in this environment. This OS bind test executes in CI unsandboxed.',
            );
            return;
        }
        await registry.upsert({ name: 'Spur', path: tempDir, port: 0 });

        // Start a dummy server on free port
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const address = server.address();
        const livePort = typeof address === 'object' && address ? address.port : 0;

        try {
            const updated = await registry.setPort(tempDir, livePort);
            expect(updated).toBe(true);

            const fetched = await registry.getByPath(tempDir);
            expect(fetched?.port).toBe(livePort);
        } finally {
            server.close();
        }
    });

    it('should return false when setPort is called for non-existent project', async () => {
        const res = await registry.setPort('/non/existent/path', 3000);
        expect(res).toBe(false);
    });

    it('should remove a project entry by name or path', async () => {
        await registry.upsert({ name: 'Project A', path: tempDir });
        const removed = await registry.remove('Project A');
        expect(removed).toBe(true);

        const list = await registry.list();
        expect(list.length).toBe(0);

        // Removal of non-existent project returns false
        const removeNonExistent = await registry.remove('NonExistent');
        expect(removeNonExistent).toBe(false);
    });

    // Bucket A test: allocatePort binds real ports on the OS.
    it('should allocate a port in 3000-3999 band and respect preferredPort', async () => {
        if (!(await portBindingAvailable())) {
            console.warn(
                '[SKIP:port-bind-denied] TCP port binding is denied in this environment. This OS bind test executes in CI unsandboxed.',
            );
            return;
        }
        const port = await registry.allocatePort();
        expect(port).toBeGreaterThanOrEqual(3000);
        expect(port).toBeLessThanOrEqual(3999);
        const available = await isPortAvailable(port);
        expect(available).toBe(true);

        // Preferred port allocation
        const preferred = await registry.allocatePort(3888);
        expect(preferred).toBe(3888);
    });

    it('should throw when all ports in range 3000-3999 are claimed', async () => {
        const fullList = Array.from({ length: 1000 }, (_, i) => ({
            name: `Project ${i}`,
            path: `/path/${i}`,
            port: 3000 + i,
        }));
        registry.writeRaw({ schema_version: 1, projects: fullList });

        expect(registry.allocatePort()).rejects.toThrow('No available ports in range 3000–3999');
    });

    it('should handle lock contention and retry in withLock', async () => {
        const lockDir = `${projectsFile}.lock`;
        mkdirSync(lockDir, { recursive: true });

        const lockPromise = registry.upsert({ name: 'Lock Project', path: tempDir });

        setTimeout(() => {
            if (existsSync(lockDir)) {
                rmSync(lockDir, { recursive: true, force: true });
            }
        }, 80);

        const entry = await lockPromise;
        expect(entry.name).toBe('Lock Project');
    });

    it('should heal stale port entries when process is not listening', async () => {
        await registry.upsert({ name: 'Stale Project', path: tempDir, port: 3999 });

        // list() triggers healStale()
        const projects = await registry.list();
        const staleEntry = projects.find((p) => p.name === 'Stale Project');
        expect(staleEntry?.port).toBe(0);
    });

    it('should handle corrupt file in readRaw gracefully', () => {
        writeFileSync(projectsFile, '{ invalid json', 'utf-8');
        const raw = registry.readRaw();
        expect(raw).toEqual({ schema_version: 1, projects: [] });
    });

    it('should correctly report isPortLive for non-listening and invalid ports', async () => {
        expect(await isPortLive(0)).toBe(false);
        expect(await isPortLive(-1)).toBe(false);
        expect(await isPortLive(59999)).toBe(false);
    });

    // Bucket A test: checks IPv6 dual-stack OS bind.
    it('should detect IPv6 localhost listeners (Bun.serve hostname localhost)', async () => {
        if (!(await portBindingAvailable())) {
            console.warn(
                '[SKIP:port-bind-denied] TCP port binding is denied in this environment. This OS bind test executes in CI unsandboxed.',
            );
            return;
        }
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '::1', () => resolve()));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        try {
            expect(port).toBeGreaterThan(0);
            expect(await isPortLive(port)).toBe(true);
        } finally {
            server.close();
        }
    });

    it('should heal tilde paths to absolute on list', async () => {
        const tildePath = `~/tmp-spur-registry-heal-test-${Date.now()}`;
        // Write a hand-edited registry entry with a tilde path (as users often do).
        writeFileSync(
            projectsFile,
            JSON.stringify(
                {
                    schema_version: 1,
                    projects: [{ name: 'TildeProj', path: tildePath, port: 0 }],
                },
                null,
                2,
            ),
            'utf-8',
        );
        const projects = await registry.list();
        expect(projects).toHaveLength(1);
        expect(projects[0]?.path.startsWith('~')).toBe(false);
        expect(projects[0]?.path).toBe(normalizeProjectPath(tildePath));
    });

    // Bucket A test: checks occupied and invalid ports on the OS.
    it('should correctly report isPortAvailable for occupied and invalid ports', async () => {
        expect(await isPortAvailable(0)).toBe(false);
        expect(await isPortAvailable(70000)).toBe(false);

        if (!(await portBindingAvailable())) {
            console.warn(
                '[SKIP:port-bind-denied] TCP port binding is denied in this environment. This OS bind test executes in CI unsandboxed.',
            );
            return;
        }

        // Occupied port check
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const address = server.address();
        const busyPort = typeof address === 'object' && address ? address.port : 0;

        try {
            expect(await isPortAvailable(busyPort)).toBe(false);
        } finally {
            server.close();
        }
    });

    // AC1: classifyPortBindError unit tests covering error codes
    it('classifyPortBindError classifies error codes into in-use and denied', () => {
        expect(classifyPortBindError({ code: 'EADDRINUSE' })).toBe('in-use');
        expect(classifyPortBindError({ code: 'EADDRNOTAVAIL' })).toBe('in-use');
        expect(classifyPortBindError({ code: 'EPERM' })).toBe('denied');
        expect(classifyPortBindError({ code: 'EACCES' })).toBe('denied');
        expect(classifyPortBindError({ code: 'ECONNREFUSED' })).toBe('denied');
        expect(classifyPortBindError(new Error('generic'))).toBe('denied');
        expect(classifyPortBindError(null)).toBe('denied');
    });

    // AC1 / AC2: probePort & isPortAvailable via seam
    it('probePort and isPortAvailable wrap results and respect seam', async () => {
        setPortProbeForTests(async (port) => {
            if (port === 3001) return 'available';
            if (port === 3002) return 'in-use';
            return 'denied';
        });

        expect(await probePort(3001)).toBe('available');
        expect(await isPortAvailable(3001)).toBe(true);

        expect(await probePort(3002)).toBe('in-use');
        expect(await isPortAvailable(3002)).toBe(false);

        expect(await probePort(3003)).toBe('denied');
        expect(await isPortAvailable(3003)).toBe(false);
    });

    // AC3: allocatePort throws naming permission when all probes denied
    it('allocatePort throws naming permission when all probes are denied', async () => {
        setPortProbeForTests(async () => 'denied');

        await expect(registry.allocatePort()).rejects.toThrow(/permission/i);
        await expect(registry.allocatePort()).rejects.not.toThrow('No available ports in range 3000–3999');
    });

    // Regression (0585 R2 verify): the claimed-port skip also set `sawInUse`, so a single
    // registered project inside the band masked a fully denied environment and restored the
    // misleading exhaustion message — the common case for anyone actually using `spur projects`.
    it('allocatePort still names permission when a claimed port sits in the band', async () => {
        await registry.upsert({ name: 'Claimed', path: tempDir, port: 3005 });
        setPortProbeForTests(async () => 'denied');

        await expect(registry.allocatePort()).rejects.toThrow(/permission/i);
    });

    // A claimed port is not a denial signal either: with every port claimed no probe runs,
    // so the cause really is exhaustion and the original message must stand.
    it('allocatePort reports exhaustion when every port is claimed and none is probed', async () => {
        // Seeded directly: `upsert` keys on path, so 1000 calls with one path collapse
        // to a single entry and would not claim the band.
        writeFileSync(
            projectsFile,
            JSON.stringify({
                schema_version: 1,
                projects: Array.from({ length: 1000 }, (_, i) => ({
                    name: `P${3000 + i}`,
                    path: join(tempDir, `p${3000 + i}`),
                    port: 3000 + i,
                })),
            }),
        );
        const many = new ProjectRegistry(projectsFile);
        setPortProbeForTests(async () => 'denied');

        await expect(many.allocatePort()).rejects.toThrow('No available ports in range 3000–3999');
    });

    // AC4: allocatePort preserves exact exhaustion message when at least one port was in-use
    it('allocatePort preserves exhaustion message when at least one port is in-use', async () => {
        setPortProbeForTests(async (port) => (port === 3050 ? 'in-use' : 'denied'));

        await expect(registry.allocatePort()).rejects.toThrow('No available ports in range 3000–3999');
    });

    // Regression (0583 verify, 2026-08-18): withLock retried mkdir 50×50 ms before
    // giving up. A permission failure is permanent, so that backoff burned 2.5 s and
    // then failed anyway — it was the entire cost of three `startServer` tests blowing
    // the 5 s default in a home-write-denied environment. Retry contention, not denial.
    it('withLock fails fast and names permission when the lock cannot be created', async () => {
        const roParent = mkdtempSync(join(tmpdir(), 'spur-ro-registry-'));
        chmodSync(roParent, 0o555);
        try {
            // Parent EXISTS and is read-only, so the ensureDir guard is skipped and the
            // retry loop itself is what must fail fast.
            const denied = new ProjectRegistry(join(roParent, 'projects.json'));
            const started = Date.now();
            await expect(denied.withLock(async () => 'unreachable')).rejects.toThrow(/permission denied/i);
            // The 50×50 ms backoff would put this well past 2 s.
            expect(Date.now() - started).toBeLessThan(1000);
        } finally {
            chmodSync(roParent, 0o755);
            rmSync(roParent, { recursive: true, force: true });
        }
    });

    // AC6: seam resets cleanly and production path is default
    it('setPortProbeForTests clears and restores default path', async () => {
        setPortProbeForTests(async () => 'in-use');
        expect(await probePort(3500)).toBe('in-use');
        setPortProbeForTests(undefined);
        // With seam cleared, probePort invalid port returns 'denied' directly without calling any mock
        expect(await probePort(0)).toBe('denied');
    });
});
