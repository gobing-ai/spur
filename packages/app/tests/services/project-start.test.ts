import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRegistry } from '../../src/services/project-registry';
import {
    type DetachedServeChild,
    type DetachedServeSpawn,
    defaultDetachedServeSpawn,
    resolveSpurServeCommand,
    setDetachedServeSpawnForTests,
    startRegisteredProject,
} from '../../src/services/project-start';

/** Fake detached serve — never touches global Bun.spawn. */
function fakeServeSpawn(
    exitCode: number | null = null,
    onSpawn?: (cmd: string[], options: unknown) => void,
): DetachedServeSpawn {
    return (cmd, options) => {
        onSpawn?.(cmd, options);
        const child: DetachedServeChild = {
            exitCode,
            unref: () => {},
        };
        return child;
    };
}

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
        setDetachedServeSpawnForTests(undefined);
        delete process.env.SPUR_PROJECTS_FILE;
        delete process.env.SPUR_CLI_PATH;
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
        const tildeStyle = tempDir.replace(process.env.HOME ?? '', '~');
        await registry.upsert({ name: 'TildeStart', path: tempDir, port: 0 });
        if (tildeStyle.startsWith('~/') || tildeStyle.startsWith('~')) {
            writeFileSync(
                projectsFile,
                JSON.stringify(
                    { schema_version: 1, projects: [{ name: 'TildeStart', path: tildeStyle, port: 0 }] },
                    null,
                    2,
                ),
            );
        }

        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const targetPort = (server.address() as { port: number }).port;
        const origAllocate = ProjectRegistry.prototype.allocatePort;
        ProjectRegistry.prototype.allocatePort = async () => targetPort;

        try {
            const result = await startRegisteredProject(registry, 'TildeStart', {
                pollAttempts: 5,
                pollIntervalMs: 50,
                spawn: fakeServeSpawn(null),
            });
            expect(result.running).toBe(true);
            expect(result.port).toBe(targetPort);
            expect(result.path.startsWith('~')).toBe(false);
        } finally {
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
        await expect(
            startRegisteredProject(registry, 'TimeoutApp', {
                port: 59999,
                pollAttempts: 2,
                pollIntervalMs: 10,
                spawn: fakeServeSpawn(null),
            }),
        ).rejects.toThrow(/failed to start on port/);
    });

    it('startRegisteredProject throws error immediately when child exits before port ready', async () => {
        await registry.upsert({ name: 'ExitedApp', path: tempDir, port: 0 });
        await expect(
            startRegisteredProject(registry, 'ExitedApp', {
                port: 59998,
                pollAttempts: 5,
                pollIntervalMs: 10,
                spawn: fakeServeSpawn(1),
            }),
        ).rejects.toThrow(/exited with code 1/);
    });

    it('setDetachedServeSpawnForTests overrides spawn when options.spawn is omitted', async () => {
        await registry.upsert({ name: 'OverrideApp', path: tempDir, port: 0 });
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const targetPort = (server.address() as { port: number }).port;
        let sawServe = false;
        setDetachedServeSpawnForTests(
            fakeServeSpawn(null, (cmd) => {
                sawServe = cmd.includes('serve');
            }),
        );
        const origAllocate = ProjectRegistry.prototype.allocatePort;
        ProjectRegistry.prototype.allocatePort = async () => targetPort;
        try {
            const result = await startRegisteredProject(registry, 'OverrideApp', {
                pollAttempts: 5,
                pollIntervalMs: 20,
            });
            expect(result.running).toBe(true);
            expect(result.port).toBe(targetPort);
            expect(sawServe).toBe(true);
        } finally {
            ProjectRegistry.prototype.allocatePort = origAllocate;
            server.close();
        }
    });

    it('startRegisteredProject auto-registers an on-disk path not yet in the registry', async () => {
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const targetPort = (server.address() as { port: number }).port;
        const origAllocate = ProjectRegistry.prototype.allocatePort;
        ProjectRegistry.prototype.allocatePort = async () => targetPort;
        try {
            // Target is the absolute directory path — not a registered name.
            const result = await startRegisteredProject(registry, tempDir, {
                pollAttempts: 5,
                pollIntervalMs: 20,
                spawn: fakeServeSpawn(null),
            });
            expect(result.running).toBe(true);
            // realpath may rewrite /var → /private/var on macOS
            expect(existsSync(result.path)).toBe(true);
            expect(result.alreadyRunning).toBe(false);
            const entry = await registry.getByPath(result.path);
            expect(entry).toBeDefined();
        } finally {
            ProjectRegistry.prototype.allocatePort = origAllocate;
            server.close();
        }
    });

    it('startRegisteredProject starts a project stored as ~/… (registry heals on list)', async () => {
        // Registry.list() rewrites ~/… before startRegisteredProject sees the entry.
        // Assert the end-to-end path: hand-edited tilde form still starts cleanly.
        const underHome = mkdtempSync(join(homedir(), '.spur-project-start-heal-'));
        const relativeFromHome = underHome.slice(homedir().length + 1);
        const tildePath = `~/${relativeFromHome}`;
        const homeProjectsFile = join(underHome, 'projects.json');
        writeFileSync(
            homeProjectsFile,
            JSON.stringify(
                {
                    schema_version: 1,
                    projects: [{ name: 'HealMe', path: tildePath, port: 0 }],
                },
                null,
                2,
            ),
        );
        // Raw file still has the tilde form (hand-edited projects.json).
        expect(JSON.parse(readFileSync(homeProjectsFile, 'utf8')).projects[0].path).toBe(tildePath);
        const homeRegistry = new ProjectRegistry(homeProjectsFile);

        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const targetPort = (server.address() as { port: number }).port;
        const origAllocate = ProjectRegistry.prototype.allocatePort;
        ProjectRegistry.prototype.allocatePort = async () => targetPort;
        try {
            const result = await startRegisteredProject(homeRegistry, 'HealMe', {
                pollAttempts: 5,
                pollIntervalMs: 20,
                spawn: fakeServeSpawn(null),
            });
            expect(result.path.startsWith('~')).toBe(false);
            expect(existsSync(result.path)).toBe(true);
            expect(result.running).toBe(true);
        } finally {
            ProjectRegistry.prototype.allocatePort = origAllocate;
            server.close();
            rmSync(underHome, { recursive: true, force: true });
        }
    });

    it('startRegisteredProject uses options.port when provided instead of allocatePort', async () => {
        await registry.upsert({ name: 'FixedPort', path: tempDir, port: 0 });
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const targetPort = (server.address() as { port: number }).port;
        let allocateCalled = false;
        const origAllocate = ProjectRegistry.prototype.allocatePort;
        ProjectRegistry.prototype.allocatePort = async () => {
            allocateCalled = true;
            return 1;
        };
        try {
            const result = await startRegisteredProject(registry, 'FixedPort', {
                port: targetPort,
                pollAttempts: 5,
                pollIntervalMs: 20,
                spawn: fakeServeSpawn(null),
            });
            expect(result.port).toBe(targetPort);
            expect(allocateCalled).toBe(false);
        } finally {
            ProjectRegistry.prototype.allocatePort = origAllocate;
            server.close();
        }
    });

    it('resolveSpurServeCommand falls back to Bun.which("spur") when monorepo CLI is absent', () => {
        const origArgv = process.argv[1];
        const origWhich = Bun.which;
        const origCwd = process.cwd;
        const origEnv = process.env.SPUR_CLI_PATH;
        try {
            delete process.env.SPUR_CLI_PATH;
            process.argv[1] = '/usr/bin/other-app';
            process.cwd = () => tempDir; // no apps/cli/src/index.ts under tempDir
            Bun.which = (bin: string) => (bin === 'spur' ? '/usr/local/bin/spur' : null);
            expect(resolveSpurServeCommand()).toEqual(['/usr/local/bin/spur']);
        } finally {
            if (origArgv !== undefined) process.argv[1] = origArgv;
            process.cwd = origCwd;
            Bun.which = origWhich;
            if (origEnv !== undefined) process.env.SPUR_CLI_PATH = origEnv;
            else delete process.env.SPUR_CLI_PATH;
        }
    });

    it('defaultDetachedServeSpawn returns a child with exitCode and unref', async () => {
        // ProcessExecutor + nohup path (async). Uses `true` so the background job exits quickly.
        const child = await defaultDetachedServeSpawn(['true'], {
            detached: true,
            stdio: ['ignore', 'ignore', 'ignore'],
        });
        expect(typeof child.unref).toBe('function');
        expect('exitCode' in child).toBe(true);
        child.unref();
    });

    it('options.spawn wins over setDetachedServeSpawnForTests', async () => {
        await registry.upsert({ name: 'Precedence', path: tempDir, port: 0 });
        let globalHits = 0;
        let optionHits = 0;
        setDetachedServeSpawnForTests(
            fakeServeSpawn(null, () => {
                globalHits += 1;
            }),
        );
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const targetPort = (server.address() as { port: number }).port;
        try {
            await startRegisteredProject(registry, 'Precedence', {
                port: targetPort,
                pollAttempts: 5,
                pollIntervalMs: 20,
                spawn: fakeServeSpawn(null, () => {
                    optionHits += 1;
                }),
            });
            expect(optionHits).toBe(1);
            expect(globalHits).toBe(0);
        } finally {
            server.close();
        }
    });
});
