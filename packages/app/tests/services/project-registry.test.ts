import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    isPortAvailable,
    isPortLive,
    normalizeProjectPath,
    ProjectRegistry,
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

    it('should update port for an existing project when port is live', async () => {
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

    it('should allocate a port in 3000-3999 band and respect preferredPort', async () => {
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

    it('should correctly report isPortAvailable for occupied and invalid ports', async () => {
        expect(await isPortAvailable(0)).toBe(false);
        expect(await isPortAvailable(70000)).toBe(false);

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
});
