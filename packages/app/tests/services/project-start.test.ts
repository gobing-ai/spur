import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRegistry } from '../../src/services/project-registry';
import { resolveSpurServeCommand, startRegisteredProject } from '../../src/services/project-start';

describe('project-start', () => {
    let tempDir: string;
    let projectsFile: string;
    let registry: ProjectRegistry;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-project-start-test-'));
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

    it('resolveSpurServeCommand returns a non-empty argv', () => {
        const cmd = resolveSpurServeCommand();
        expect(cmd.length).toBeGreaterThan(0);
        expect(typeof cmd[0]).toBe('string');
    });

    it('startRegisteredProject returns alreadyRunning when port is live', async () => {
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const livePort = (server.address() as { port: number }).port;

        try {
            await registry.upsert({ name: 'LiveApp', path: tempDir, port: livePort });
            const result = await startRegisteredProject(registry, 'LiveApp');
            expect(result.alreadyRunning).toBe(true);
            expect(result.port).toBe(livePort);
            expect(result.running).toBe(true);
            expect(result.url).toContain(String(livePort));
        } finally {
            server.close();
        }
    });

    it('startRegisteredProject rejects missing projects with a clear error', async () => {
        await expect(startRegisteredProject(registry, 'DoesNotExist')).rejects.toThrow(/not found/i);
    });

    it('startRegisteredProject expands tilde paths before treating them as cwd', async () => {
        // Hand-written tilde entry — must not throw posix_spawn ENOENT on bun binary.
        const tildeStyle = tempDir.replace(process.env.HOME ?? '', '~');
        // Only meaningful when HOME is a prefix of tempDir (true for /var vs /Users edge cases vary).
        // Force a synthetic tilde path that normalizes to tempDir via realpath of an existing dir.
        await registry.upsert({ name: 'TildeStart', path: tempDir, port: 0 });
        // Re-write as tilde form if possible
        if (tildeStyle.startsWith('~/') || tildeStyle.startsWith('~')) {
            const { writeFileSync } = await import('node:fs');
            writeFileSync(
                projectsFile,
                JSON.stringify(
                    { schema_version: 1, projects: [{ name: 'TildeStart', path: tildeStyle, port: 0 }] },
                    null,
                    2,
                ),
            );
        }

        // Pre-open a port so allocatePort + health poll succeeds without a real spur serve.
        // Mock Bun.spawn so we never leave a detached `spur serve` orphan.
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const targetPort = (server.address() as { port: number }).port;
        const origAllocate = ProjectRegistry.prototype.allocatePort;
        ProjectRegistry.prototype.allocatePort = async () => targetPort;
        const origSpawn = Bun.spawn;
        Bun.spawn = (() => ({
            exitCode: null,
            unref: () => {},
        })) as unknown as typeof Bun.spawn;

        try {
            const result = await startRegisteredProject(registry, 'TildeStart', {
                pollAttempts: 5,
                pollIntervalMs: 50,
            });
            expect(result.running).toBe(true);
            expect(result.port).toBe(targetPort);
            expect(result.path.startsWith('~')).toBe(false);
        } finally {
            Bun.spawn = origSpawn;
            ProjectRegistry.prototype.allocatePort = origAllocate;
            server.close();
        }
    });

    it('resolveSpurServeCommand resolves from process.argv[1] when matching spur entry', () => {
        const origArgv = process.argv[1];
        try {
            process.argv[1] = '/tmp/test/apps/cli/src/index.ts';
            const cmd = resolveSpurServeCommand();
            expect(cmd).toEqual([process.execPath, '/tmp/test/apps/cli/src/index.ts']);

            process.argv[1] = '/tmp/test/spur.js';
            const cmd2 = resolveSpurServeCommand();
            expect(cmd2).toEqual([process.execPath, '/tmp/test/spur.js']);
        } finally {
            if (origArgv !== undefined) {
                process.argv[1] = origArgv;
            }
        }
    });

    it('resolveSpurServeCommand throws error when process.argv[1] does not match, spur is not on PATH, and monorepo CLI absent', () => {
        const origArgv = process.argv[1];
        const origWhich = Bun.which;
        const origCwd = process.cwd;
        try {
            process.argv[1] = '/usr/bin/other-app';
            process.cwd = () => tempDir;
            Bun.which = () => null;
            expect(() => resolveSpurServeCommand()).toThrow(/Could not resolve the spur CLI/);
        } finally {
            if (origArgv !== undefined) {
                process.argv[1] = origArgv;
            }
            process.cwd = origCwd;
            Bun.which = origWhich;
        }
    });

    it('resolveSpurServeCommand prefers SPUR_CLI_PATH when set', () => {
        const origEnv = process.env.SPUR_CLI_PATH;
        try {
            const fakeCli = join(tempDir, 'fake-spur.js');
            const { writeFileSync } = require('node:fs');
            writeFileSync(fakeCli, '#!/usr/bin/env node');
            process.env.SPUR_CLI_PATH = fakeCli;
            const cmd = resolveSpurServeCommand();
            expect(cmd).toEqual([process.execPath, fakeCli]);
        } finally {
            if (origEnv !== undefined) {
                process.env.SPUR_CLI_PATH = origEnv;
            } else {
                delete process.env.SPUR_CLI_PATH;
            }
        }
    });

    it('startRegisteredProject throws error when entry path does not exist on disk', async () => {
        const nonExistentPath = join(tempDir, 'deleted-folder');
        await registry.upsert({ name: 'DeletedApp', path: nonExistentPath, port: 0 });
        await expect(startRegisteredProject(registry, 'DeletedApp')).rejects.toThrow(/Project path does not exist/);
    });

    it('startRegisteredProject throws error when port polling times out', async () => {
        await registry.upsert({ name: 'TimeoutApp', path: tempDir, port: 0 });
        const origSpawn = Bun.spawn;
        Bun.spawn = (() => ({
            exitCode: null,
            unref: () => {},
        })) as unknown as typeof Bun.spawn;

        try {
            await expect(
                startRegisteredProject(registry, 'TimeoutApp', {
                    port: 59999,
                    pollAttempts: 2,
                    pollIntervalMs: 10,
                }),
            ).rejects.toThrow(/failed to start on port/);
        } finally {
            Bun.spawn = origSpawn;
        }
    });

    it('startRegisteredProject throws error immediately when child exits before port ready', async () => {
        await registry.upsert({ name: 'ExitedApp', path: tempDir, port: 0 });
        const origSpawn = Bun.spawn;
        Bun.spawn = (() => ({
            exitCode: 1,
            unref: () => {},
        })) as unknown as typeof Bun.spawn;

        try {
            await expect(
                startRegisteredProject(registry, 'ExitedApp', {
                    port: 59998,
                    pollAttempts: 5,
                    pollIntervalMs: 10,
                }),
            ).rejects.toThrow(/exited with code 1/);
        } finally {
            Bun.spawn = origSpawn;
        }
    });
});
