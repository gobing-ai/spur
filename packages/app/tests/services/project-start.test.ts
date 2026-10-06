import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { ProjectRegistry, setPortProbeForTests } from '../../src/services/project-registry';
import {
    assertProjectServerAvailable,
    buildWindowsDetachedServeLaunch,
    type DetachedServeChild,
    type DetachedServeSpawn,
    defaultDetachedServeSpawn,
    defaultResolveOwnerPort,
    resolveSpurServeCommand,
    setDetachedServeSpawnForTests,
    startRegisteredProject,
} from '../../src/services/project-start';

/**
 * Can this process create a directory under the real home? The tilde-expansion test
 * needs one; a sandbox or hardened runtime may deny it with EPERM.
 */
function homeWriteAvailable(): boolean {
    try {
        const probe = mkdtempSync(join(homedir(), '.spur-home-probe-'));
        rmSync(probe, { recursive: true, force: true });
        return true;
    } catch {
        return false;
    }
}

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
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
        registry = new ProjectRegistry(projectsFile);
    });

    afterEach(() => {
        setPortProbeForTests(undefined);
        setDetachedServeSpawnForTests(undefined);
        removeEnvVar('SPUR_PROJECTS_FILE');
        removeEnvVar('SPUR_CLI_PATH');
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
        const livePort = 3500;
        setPortProbeForTests(async (p) => (p === livePort ? 'in-use' : 'available'));
        await registry.upsert({ name: 'LiveApp', path: tempDir, port: livePort });
        const result = await startRegisteredProject(registry, 'LiveApp');
        expect(result.alreadyRunning).toBe(true);
        expect(result.port).toBe(livePort);
        expect(result.running).toBe(true);
        expect(result.url).toContain(String(livePort));
    });

    it('startRegisteredProject rejects missing projects with a clear error', async () => {
        await expect(startRegisteredProject(registry, 'DoesNotExist')).rejects.toThrow(/not found/i);
    });

    it('startRegisteredProject expands tilde paths before treating them as cwd', async () => {
        const tildeStyle = tempDir.replace(getEnvVar('HOME') ?? '', '~');
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

        const targetPort = 3501;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
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
        const origEnv = getEnvVar('SPUR_CLI_PATH');
        try {
            const fakeCli = join(tempDir, 'fake-spur.js');
            writeFileSync(fakeCli, '#!/usr/bin/env node');
            setEnvVar('SPUR_CLI_PATH', fakeCli);
            const cmd = resolveSpurServeCommand();
            expect(cmd).toEqual([process.execPath, fakeCli]);
        } finally {
            if (origEnv !== undefined) {
                setEnvVar('SPUR_CLI_PATH', origEnv);
            } else {
                removeEnvVar('SPUR_CLI_PATH');
            }
        }
    });

    it('startRegisteredProject throws error when entry path does not exist on disk', async () => {
        const nonExistentPath = join(tempDir, 'deleted-folder');
        await registry.upsert({ name: 'DeletedApp', path: nonExistentPath, port: 0 });
        // Task 0923: registry query auto-purges entries whose paths do not exist on disk,
        // so starting a project with a deleted directory rejects as not found in registry.
        await expect(startRegisteredProject(registry, 'DeletedApp')).rejects.toThrow(/Project not found in registry/);
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
        const targetPort = 3502;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
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
        }
    });

    it('startRegisteredProject auto-registers an on-disk path not yet in the registry', async () => {
        const targetPort = 3503;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
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
        }
    });

    // Capability-gated like the Bucket A port tests (task 0585 R5), for a different
    // capability: this asserts `~/…` expansion end to end, so it needs a real directory
    // under the real home. `os.homedir()` reads the passwd entry under Bun and ignores
    // $HOME, so a fake home cannot stand in without deleting what the test proves.
    // CI dependency note: .github/workflows/ci.yml runs bun run check unsandboxed.
    // If CI ever loses home-write capability, this test decays to green-by-absence.
    it('startRegisteredProject starts a project stored as ~/… (registry heals on list)', async () => {
        if (!homeWriteAvailable()) {
            console.warn(
                '[SKIP:home-write-denied] Writing under the home directory is denied in this environment. This tilde-expansion test executes in CI unsandboxed.',
            );
            return;
        }
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

        const targetPort = 3504;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
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
            rmSync(underHome, { recursive: true, force: true });
        }
    });

    it('startRegisteredProject uses options.port when provided instead of allocatePort', async () => {
        await registry.upsert({ name: 'FixedPort', path: tempDir, port: 0 });
        const targetPort = 3505;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
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
        }
    });

    it('resolveSpurServeCommand falls back to Bun.which("spur") when monorepo CLI is absent', () => {
        const origArgv = process.argv[1];
        const origWhich = Bun.which;
        const origCwd = process.cwd;
        const origEnv = getEnvVar('SPUR_CLI_PATH');
        try {
            removeEnvVar('SPUR_CLI_PATH');
            process.argv[1] = '/usr/bin/other-app';
            process.cwd = () => tempDir; // no apps/cli/src/index.ts under tempDir
            Bun.which = (bin: string) => (bin === 'spur' ? '/usr/local/bin/spur' : null);
            expect(resolveSpurServeCommand()).toEqual(['/usr/local/bin/spur']);
        } finally {
            if (origArgv !== undefined) process.argv[1] = origArgv;
            process.cwd = origCwd;
            Bun.which = origWhich;
            if (origEnv !== undefined) setEnvVar('SPUR_CLI_PATH', origEnv);
            else removeEnvVar('SPUR_CLI_PATH');
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
        const targetPort = 3506;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
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
    });

    // The registry can forget a live serve (a `healStale` probe miss under load rewrites a live
    // entry's port to 0 while the owner keeps listening). The start path must ADOPT that owner
    // instead of spawning a duplicate the owner claim then refuses — observed 2026-10-05: the
    // switcher could not launch ts-libs / knowledge-kit while forgotten serves held 3004/3005.
    describe('owner adoption', () => {
        it('adopts the live owner instead of spawning when the registry says stopped', async () => {
            let spawned = false;
            setPortProbeForTests(async (p) => (p === 3999 ? 'in-use' : 'available'));
            await registry.upsert({ name: 'Forgotten', path: tempDir, port: 0 });
            const result = await startRegisteredProject(registry, 'Forgotten', {
                resolveOwnerPort: async () => 3999,
                spawn: fakeServeSpawn(null, () => {
                    spawned = true;
                }),
            });
            expect(result.alreadyRunning).toBe(true);
            expect(result.port).toBe(3999);
            expect(result.url).toContain('3999');
            expect(spawned).toBe(false);
            // The divergence is healed: the entry names the real port again.
            expect((await registry.getByPath(tempDir))?.port).toBe(3999);
        });

        it('heals a stale recorded port to the one the owner actually serves', async () => {
            setPortProbeForTests(async (p) => (p === 3998 ? 'in-use' : 'available'));
            await registry.upsert({ name: 'StalePort', path: tempDir, port: 3111 });
            const result = await startRegisteredProject(registry, 'StalePort', {
                resolveOwnerPort: async () => 3998,
                spawn: fakeServeSpawn(null),
            });
            expect(result.alreadyRunning).toBe(true);
            expect(result.port).toBe(3998);
            expect((await registry.getByPath(tempDir))?.port).toBe(3998);
        });

        it('falls through to spawn when no live owner serves the project', async () => {
            let spawned = false;
            const targetPort = 3502;
            setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
            const origAllocate = ProjectRegistry.prototype.allocatePort;
            ProjectRegistry.prototype.allocatePort = async () => targetPort;
            try {
                await registry.upsert({ name: 'NoOwner', path: tempDir, port: 0 });
                const result = await startRegisteredProject(registry, 'NoOwner', {
                    pollAttempts: 5,
                    pollIntervalMs: 10,
                    resolveOwnerPort: async () => null,
                    spawn: fakeServeSpawn(null, () => {
                        spawned = true;
                    }),
                });
                expect(result.alreadyRunning).toBe(false);
                expect(result.port).toBe(targetPort);
                expect(spawned).toBe(true);
            } finally {
                ProjectRegistry.prototype.allocatePort = origAllocate;
            }
        });

        it('does not probe the owner when the registry port is already live', async () => {
            let probed = false;
            setPortProbeForTests(async (p) => (p === 3600 ? 'in-use' : 'available'));
            await registry.upsert({ name: 'LiveKnown', path: tempDir, port: 3600 });
            const result = await startRegisteredProject(registry, 'LiveKnown', {
                resolveOwnerPort: async () => {
                    probed = true;
                    return null;
                },
            });
            expect(result.alreadyRunning).toBe(true);
            expect(probed).toBe(false);
        });

        it('default probe adopts a real listener owned by a claimed live pid', async () => {
            if (process.platform === 'win32') return;
            const lockDir = join(tempDir, '.spur', 'server-owner.lock');
            mkdirSync(lockDir, { recursive: true });
            writeFileSync(join(lockDir, `${process.pid}-${crypto.randomUUID()}`), '');
            const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') });
            const realPort = server.port;
            if (realPort === undefined) throw new Error('Bun.serve did not allocate an ephemeral port');
            try {
                setPortProbeForTests(async (p) => (p === realPort ? 'in-use' : 'available'));
                expect(await defaultResolveOwnerPort(tempDir)).toBe(realPort);
            } finally {
                server.stop(true);
            }
        });

        it('default probe returns null for a live owner that listens nowhere (boot-hung)', async () => {
            if (process.platform === 'win32') return;
            const sleeper = Bun.spawn(['sleep', '30'], { stdio: ['ignore', 'ignore', 'ignore'] });
            try {
                const lockDir = join(tempDir, '.spur', 'server-owner.lock');
                mkdirSync(lockDir, { recursive: true });
                writeFileSync(join(lockDir, `${sleeper.pid}-${crypto.randomUUID()}`), '');
                expect(await defaultResolveOwnerPort(tempDir)).toBeNull();
            } finally {
                sleeper.kill();
            }
        });

        it('default probe returns null for malformed, multiple, or dead-pid claims', async () => {
            if (process.platform === 'win32') return;
            const lockDir = join(tempDir, '.spur', 'server-owner.lock');
            mkdirSync(lockDir, { recursive: true });
            // Two entries — an ownership transition in flight; never guess.
            writeFileSync(join(lockDir, `11111-${crypto.randomUUID()}`), '');
            writeFileSync(join(lockDir, `22222-${crypto.randomUUID()}`), '');
            expect(await defaultResolveOwnerPort(tempDir)).toBeNull();
            // Unknown format fails closed.
            rmSync(lockDir, { recursive: true, force: true });
            mkdirSync(lockDir, { recursive: true });
            writeFileSync(join(lockDir, 'not-a-claim'), '');
            expect(await defaultResolveOwnerPort(tempDir)).toBeNull();
            // A dead owner is reaped by the boot path's own stale sweep, not adopted.
            rmSync(lockDir, { recursive: true, force: true });
            mkdirSync(lockDir, { recursive: true });
            writeFileSync(join(lockDir, `99999999-${crypto.randomUUID()}`), '');
            expect(await defaultResolveOwnerPort(tempDir)).toBeNull();
        });
    });

    describe('daemon log capture', () => {
        it('a spawn failure names the daemon log lines written after the spawn', async () => {
            setPortProbeForTests(async () => 'available');
            const runDir = join(tempDir, '.spur', 'run');
            mkdirSync(runDir, { recursive: true });
            writeFileSync(join(runDir, 'serve-spawn.log'), 'stale failure from last week\n');
            await registry.upsert({ name: 'Blocked', path: tempDir, port: 0 });
            const spawn: DetachedServeSpawn = () => {
                // The daemon gets as far as the owner claim, then refuses and dies.
                writeFileSync(
                    join(runDir, 'serve-spawn.log'),
                    'Project already has a server owner (pid 12629). Close it before starting another one.\n',
                    { flag: 'a' },
                );
                return { exitCode: null, unref: () => {} };
            };
            await expect(
                startRegisteredProject(registry, 'Blocked', {
                    pollAttempts: 2,
                    pollIntervalMs: 10,
                    resolveOwnerPort: async () => null,
                    spawn,
                }),
            ).rejects.toThrow(/server owner \(pid 12629\)/);
            // …and the stale lines from before this spawn are not reported as this run's cause.
            await expect(
                startRegisteredProject(registry, 'Blocked', {
                    pollAttempts: 2,
                    pollIntervalMs: 10,
                    resolveOwnerPort: async () => null,
                    spawn: fakeServeSpawn(null),
                }),
            ).rejects.toThrow(/^((?!stale failure)[\s\S])*$/);
        });

        it('defaultDetachedServeSpawn redirects daemon stderr into the project log when cwd is set', async () => {
            if (process.platform === 'win32') return;
            const child = await defaultDetachedServeSpawn(['/bin/sh', '-c', 'echo boom >&2'], {
                cwd: tempDir,
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
            });
            child.unref();
            const logPath = join(tempDir, '.spur', 'run', 'serve-spawn.log');
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                if (existsSync(logPath) && readFileSync(logPath, 'utf8').includes('boom')) return;
                await new Promise((r) => setTimeout(r, 50));
            }
            throw new Error(`daemon stderr never landed in ${logPath}`);
        });

        it('defaultDetachedServeSpawn returns while a long-lived daemon is still running', async () => {
            if (process.platform === 'win32') return;
            // Regression (2026-10-06): `mkdir … && nohup … &` backgrounded the whole AND list, whose
            // subshell held the launcher's stdout pipe for the daemon's lifetime — the spawn (and
            // the Board's /api/projects/start) never returned, so the switcher aborted.
            const started = Date.now();
            const child = await defaultDetachedServeSpawn(['sleep', '5'], {
                cwd: tempDir,
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
            });
            child.unref();
            expect(Date.now() - started).toBeLessThan(2000);
        });
    });

    // 0964: the win32 branch of defaultDetachedServeSpawn delegates to the builder below;
    // POSIX hosts (this test host) exercise the same pure launch spec directly.
    describe('buildWindowsDetachedServeLaunch', () => {
        it('hands every argv element to the daemon via SPUR_SERVE_ARG_<i> under Start-Process (AC1)', () => {
            const cmd = ['C:\\bun.exe', 'C:\\a%PATH%b', 'x!y!', 'a&b|c', 'p q', '^caret', ''];
            const launch = buildWindowsDetachedServeLaunch(cmd);
            expect(launch.command).toBe('powershell.exe');
            expect(launch.args).toEqual([
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                'Start-Process -FilePath $env:SPUR_SERVE_ARG_0 -ArgumentList @($env:SPUR_SERVE_ARG_1,$env:SPUR_SERVE_ARG_2,$env:SPUR_SERVE_ARG_3,$env:SPUR_SERVE_ARG_4,$env:SPUR_SERVE_ARG_5,$env:SPUR_SERVE_ARG_6) -WindowStyle Hidden',
            ]);
            // argv must never be inlined: no shell may re-parse it (cmd expands %, and win32
            // argv escaping mangles embedded quotes).
            for (const [i, arg] of cmd.entries()) {
                expect(launch.args.join(' ').includes(arg)).toBe(arg === '');
                expect(launch.env[`SPUR_SERVE_ARG_${i}`]).toBe(arg);
            }
        });

        it('throws naming the index for an argument containing a double quote (AC2)', () => {
            expect(() => buildWindowsDetachedServeLaunch(['C:\\bun.exe', 'serve', 'he said "hi"'])).toThrow(
                /argument 2 contains '"', which the launch spec cannot carry/,
            );
        });

        it('throws for .cmd/.bat launchers that would re-expand % (AC2)', () => {
            expect(() => buildWindowsDetachedServeLaunch(['C:\\tools\\spur.CMD', 'serve'])).toThrow(
                /batch launcher C:\\tools\\spur\.CMD re-expands %; use the bun executable/,
            );
            expect(() => buildWindowsDetachedServeLaunch(['C:\\tools\\spur.bat', 'serve'])).toThrow(/batch launcher/);
        });

        it('throws on an empty command', () => {
            expect(() => buildWindowsDetachedServeLaunch([])).toThrow(/command must not be empty/);
        });

        it('builds the launch spec the win32 branch passes to the executor for a real serve argv', () => {
            const launch = buildWindowsDetachedServeLaunch([
                process.execPath,
                'serve',
                '--cwd',
                'C:\\tmp\\p%x',
                '--port',
                '4100',
            ]);
            expect(launch.command).toBe('powershell.exe');
            expect(launch.args.slice(0, 4)).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command']);
            expect(launch.args[4]).toBe(
                'Start-Process -FilePath $env:SPUR_SERVE_ARG_0 -ArgumentList @($env:SPUR_SERVE_ARG_1,$env:SPUR_SERVE_ARG_2,$env:SPUR_SERVE_ARG_3,$env:SPUR_SERVE_ARG_4,$env:SPUR_SERVE_ARG_5) -WindowStyle Hidden',
            );
            expect(launch.env.SPUR_SERVE_ARG_3).toBe('C:\\tmp\\p%x');
        });
    });
});

it('refuses a live registered server without mutating the registry', async () => {
    const registry = {
        readRaw: () => ({
            schema_version: 1 as const,
            projects: [{ name: 'project', path: '/tmp/spur-owner-test', port: 1234 }],
        }),
    };
    const before = JSON.stringify(registry.readRaw());
    await expect(
        assertProjectServerAvailable('/tmp/spur-owner-test', { registry, isLive: async () => true }),
    ).rejects.toThrow('already has a live server');
    expect(JSON.stringify(registry.readRaw())).toBe(before);
    await assertProjectServerAvailable('/tmp/spur-owner-test', { registry, isLive: async () => false });
    await assertProjectServerAvailable('/tmp/other-project', { registry, isLive: async () => true });
    await assertProjectServerAvailable('/tmp/spur-owner-test', {
        registry: {
            readRaw: () => ({
                schema_version: 1,
                projects: [{ name: 'project', path: '/tmp/spur-owner-test', port: 0 }],
            }),
        },
    });
});
