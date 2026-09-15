import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    normalizeProjectPath,
    ProjectRegistry,
    setDetachedServeSpawnForTests,
    setPortProbeForTests,
} from '@gobing-ai/spur-app';
import { stringify } from 'yaml';
import { main } from '../../src/index';

describe('spur projects CLI command', () => {
    let tempDir: string;
    let projectsFile: string;
    let projectPath: string;
    const origList = ProjectRegistry.prototype.list;
    const origAllocate = ProjectRegistry.prototype.allocatePort;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-projects-cli-test-'));
        projectsFile = join(tempDir, 'projects.json');
        projectPath = mkdtempSync(join(tmpdir(), 'spur-sample-project-'));
        process.env.SPUR_PROJECTS_FILE = projectsFile;
    });

    afterEach(() => {
        setPortProbeForTests(undefined);
        ProjectRegistry.prototype.list = origList;
        ProjectRegistry.prototype.allocatePort = origAllocate;
        delete process.env.SPUR_PROJECTS_FILE;
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
        }
        if (existsSync(projectPath)) {
            rmSync(projectPath, { recursive: true, force: true });
        }
    });

    function createMockOutput() {
        let outputText = '';
        return {
            output: {
                write: (msg: string) => {
                    outputText += msg;
                },
                error: (msg: string) => {
                    outputText += msg;
                },
            },
            getText: () => outputText,
        };
    }

    it('should add, list, and remove a project via CLI with --json', async () => {
        const mockAdd = createMockOutput();
        const addExit = await main(['projects', 'add', projectPath, '--name', 'My Project', '--json'], {
            cwd: tempDir,
            output: mockAdd.output,
        });
        expect(addExit).toBe(0);
        const addJson = JSON.parse(mockAdd.getText()) as { ok: boolean };
        expect(addJson.ok).toBe(true);

        const mockList = createMockOutput();
        const listExit = await main(['projects', 'list', '--json'], { cwd: tempDir, output: mockList.output });
        expect(listExit).toBe(0);
        const listJson = JSON.parse(mockList.getText()) as { projects: Array<{ name: string }> };
        expect(listJson.projects.some((p) => p.name === 'My Project')).toBe(true);

        const mockRemove = createMockOutput();
        const removeExit = await main(['projects', 'remove', 'My Project', '--json'], {
            cwd: tempDir,
            output: mockRemove.output,
        });
        expect(removeExit).toBe(0);
        const removeJson = JSON.parse(mockRemove.getText()) as { ok: boolean };
        expect(removeJson.ok).toBe(true);
    });

    it('should resolve fleet declarations under list --fleet (0835)', async () => {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        await main(['projects', 'add', projectPath, '--name', 'fleetproj'], {
            cwd: tempDir,
            output: createMockOutput().output,
        });
        // 0858: the roster is declared under `agent.fleet` in the project config; the
        // retired `.spur/fleet.json` would now fail the load instead of resolving.
        mkdirSync(join(projectPath, '.spur'), { recursive: true });
        writeFileSync(
            join(projectPath, '.spur', 'config.yaml'),
            stringify({
                agent: {
                    fleet: {
                        enabled: true,
                        // Pinned executors (not in test agent config) resolve cleanly: R4
                        // missing-data-never-grants gives fsWrite=unknown write=false.
                        members: [
                            { id: 'lead', executor: 'build' },
                            { id: 'rev', executor: 'review', enabled: false },
                        ],
                    },
                },
            }),
        );
        // A second registered project with NO declaration (R7 says-so path).
        const bareProject = mkdtempSync(join(tmpdir(), 'spur-bare-project-'));
        try {
            await main(['projects', 'add', bareProject, '--name', 'bareproj'], {
                cwd: tempDir,
                output: createMockOutput().output,
            });

            // 0838: persist a gtd strategy (twice — v2 proves the monotonic bump) in
            // fleetproj's own project db; bareproj stays unpersisted.
            const { ProjectStrategyDao, createMigratedDb } = await import('@gobing-ai/spur-domain');
            // The registry normalizes the project path (realpath) — seed under the
            // SAME key the list command reads.
            const normalized = normalizeProjectPath(projectPath);
            const projectDb = await createMigratedDb({ url: join(normalized, '.spur', 'spur.db') });
            const strategyDao = new ProjectStrategyDao(projectDb);
            await strategyDao.set(normalized, 'gtd');
            expect((await strategyDao.set(normalized, 'gtd')).strategyVersion).toBe(2);
            projectDb.close();

            const mockList = createMockOutput();
            const listExit = await main(['projects', 'list', '--fleet'], {
                cwd: tempDir,
                output: mockList.output,
            });
            expect(listExit).toBe(0);
            const text = mockList.getText();
            expect(text).toContain('- fleetproj-lead role=- executor=build fsWrite=unknown write=false');
            expect(text).toContain('fleetproj-rev [disabled]');
            expect(text).toContain('bareproj');
            expect(text).toContain('no declaration (agent.fleet)');

            const mockJson = createMockOutput();
            const jsonExit = await main(['projects', 'list', '--fleet', '--json'], {
                cwd: tempDir,
                output: mockJson.output,
            });
            expect(jsonExit).toBe(0);
            const parsed = JSON.parse(mockJson.getText()) as {
                projects: Array<{
                    name: string;
                    fleet: { members: Array<{ instanceId: string; enabled: boolean }> } | null;
                    fleetError?: string;
                    strategy: { strategy: string; strategyVersion: number } | null;
                    strategyError?: string;
                }>;
            };
            const fleetEntry = parsed.projects.find((p) => p.name === 'fleetproj');
            expect(fleetEntry?.fleet?.members.map((m) => m.instanceId)).toContain('fleetproj-lead');
            const bareEntry = parsed.projects.find((p) => p.name === 'bareproj');
            expect(bareEntry?.fleet?.members).toEqual([]); // R7: missing declaration resolves cleanly
            expect(bareEntry?.fleetError).toBeUndefined();

            // 0838 R1: the persisted strategy surfaces in text and JSON — the seeded
            // row for fleetproj, the `rest` default (nothing persisted) for bareproj.
            expect(text).toContain('strategy: gtd (v2)');
            // bareproj's text stops at the no-declaration line; its JSON still carries
            // strategy: null — the rest default renders only where the fleet resolved.
            expect(fleetEntry?.strategy).toMatchObject({ strategy: 'gtd', strategyVersion: 2 });
            expect(bareEntry?.strategy).toBeNull();
        } finally {
            rmSync(bareProject, { recursive: true, force: true });
        }
    });

    it('should report a per-project fleet resolution error without failing the listing (0835)', async () => {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        await main(['projects', 'add', projectPath, '--name', 'brokenfleet'], {
            cwd: tempDir,
            output: createMockOutput().output,
        });
        mkdirSync(join(projectPath, '.spur'), { recursive: true });
        // 0858 R6/R8: an invalid section fails the project's config load, naming every
        // issue with its `agent.fleet.*` path (member declares neither role nor executor).
        writeFileSync(
            join(projectPath, '.spur', 'config.yaml'),
            stringify({ agent: { fleet: { members: [{ purpose: 'ghost' }] } } }),
        );

        const mockList = createMockOutput();
        const listExit = await main(['projects', 'list', '--fleet'], { cwd: tempDir, output: mockList.output });
        expect(listExit).toBe(0);
        expect(mockList.getText()).toContain('fleet: unavailable');
        expect(mockList.getText()).toContain('agent.fleet.members[0]');

        const mockJson = createMockOutput();
        await main(['projects', 'list', '--fleet', '--json'], { cwd: tempDir, output: mockJson.output });
        const parsed = JSON.parse(mockJson.getText()) as {
            projects: Array<{ name: string; fleet: unknown; fleetError?: string }>;
        };
        const entry = parsed.projects.find((p) => p.name === 'brokenfleet');
        expect(entry?.fleet).toEqual(null);
        expect(entry?.fleetError).toContain('agent.fleet.members[0]');
    });

    it('should handle text formatting for add, list, and remove commands', async () => {
        // List empty
        const mockEmpty = createMockOutput();
        const emptyExit = await main(['projects', 'list'], { cwd: tempDir, output: mockEmpty.output });
        expect(emptyExit).toBe(0);
        expect(mockEmpty.getText()).toContain('No projects registered');

        // Add text
        const mockAdd = createMockOutput();
        const addExit = await main(['projects', 'add', projectPath, '--name', 'Text Proj'], {
            cwd: tempDir,
            output: mockAdd.output,
        });
        expect(addExit).toBe(0);
        expect(mockAdd.getText()).toContain('Registered project "Text Proj"');

        // List text
        const mockList = createMockOutput();
        const listExit = await main(['projects', 'list'], { cwd: tempDir, output: mockList.output });
        expect(listExit).toBe(0);
        expect(mockList.getText()).toContain('- Text Proj [STOPPED]');

        // Remove text
        const mockRemove = createMockOutput();
        const removeExit = await main(['projects', 'remove', 'Text Proj'], {
            cwd: tempDir,
            output: mockRemove.output,
        });
        expect(removeExit).toBe(0);
        expect(mockRemove.getText()).toContain('Removed project "Text Proj"');
    });

    it('should return error when adding a non-existent directory path', async () => {
        const mockJson = createMockOutput();
        const exitJson = await main(['projects', 'add', '/non/existent/dir', '--json'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(exitJson).toBe(1);
        expect(mockJson.getText()).toContain('"ok": false');

        const mockText = createMockOutput();
        const exitText = await main(['projects', 'add', '/non/existent/dir'], {
            cwd: tempDir,
            output: mockText.output,
        });
        expect(exitText).toBe(1);
        expect(mockText.getText()).toContain('Error: Directory does not exist');
    });

    it('should return non-zero exit code when removing non-existent project', async () => {
        const mockOutput = createMockOutput();
        const exitCode = await main(['projects', 'remove', 'NonExistent', '--json'], {
            cwd: tempDir,
            output: mockOutput.output,
        });
        expect(exitCode).toBe(1);
        const errJson = JSON.parse(mockOutput.getText()) as { ok: boolean };
        expect(errJson.ok).toBe(false);

        const mockText = createMockOutput();
        const exitText = await main(['projects', 'remove', 'NonExistent'], {
            cwd: tempDir,
            output: mockText.output,
        });
        expect(exitText).toBe(1);
        expect(mockText.getText()).toContain('Error: Project not found in registry');
    });

    it('should handle list command error paths', async () => {
        ProjectRegistry.prototype.list = async () => {
            throw new Error('List read error');
        };

        const mockJson = createMockOutput();
        const exitJson = await main(['projects', 'list', '--json'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(exitJson).toBe(1);
        expect(mockJson.getText()).toContain('"ok": false');

        const mockText = createMockOutput();
        const exitText = await main(['projects', 'list'], {
            cwd: tempDir,
            output: mockText.output,
        });
        expect(exitText).toBe(1);
        expect(mockText.getText()).toContain('Error: List read error');
    });

    it('should handle start for an already running project', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const livePort = 3500;
        setPortProbeForTests(async (p) => (p === livePort ? 'in-use' : 'available'));

        await registry.upsert({ name: 'RunningProj', path: projectPath, port: livePort });

        // Start running project --json
        const mockJson = createMockOutput();
        const jsonExit = await main(['projects', 'start', 'RunningProj', '--json'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(jsonExit).toBe(0);
        expect(mockJson.getText()).toContain('"running": true');

        // Start running project plain text
        const mockText = createMockOutput();
        const textExit = await main(['projects', 'start', 'RunningProj'], {
            cwd: tempDir,
            output: mockText.output,
        });
        expect(textExit).toBe(0);
        expect(mockText.getText()).toContain('already running at');
    });

    it('should handle start for an un-registered target path (auto-register)', async () => {
        const targetPort = 3501;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
        const origAllocate = ProjectRegistry.prototype.allocatePort;
        ProjectRegistry.prototype.allocatePort = async () => targetPort;

        // Inject fake serve spawn — never reassign Bun.spawn (breaks execa/ProcessExecutor).
        setDetachedServeSpawnForTests(() => ({ exitCode: null, unref: () => {} }));

        try {
            const mockJson = createMockOutput();
            const jsonExit = await main(['projects', 'start', projectPath, '--json'], {
                cwd: tempDir,
                output: mockJson.output,
            });
            expect(jsonExit).toBe(0);
            expect(mockJson.getText()).toContain('"running": true');
        } finally {
            setDetachedServeSpawnForTests(undefined);
            ProjectRegistry.prototype.allocatePort = origAllocate;
        }
    });

    it('should handle start for a stopped project when port becomes live', async () => {
        const registry = new ProjectRegistry(projectsFile);
        await registry.upsert({ name: 'StoppedProj', path: projectPath, port: 0 });

        const targetPort = 3502;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
        const origAllocate = ProjectRegistry.prototype.allocatePort;
        ProjectRegistry.prototype.allocatePort = async () => targetPort;

        setDetachedServeSpawnForTests(() => ({ exitCode: null, unref: () => {} }));

        try {
            const mockJson = createMockOutput();
            const jsonExit = await main(['projects', 'start', 'StoppedProj', '--json'], {
                cwd: tempDir,
                output: mockJson.output,
            });
            expect(jsonExit).toBe(0);
            expect(mockJson.getText()).toContain('"running": true');
        } finally {
            setDetachedServeSpawnForTests(undefined);
            ProjectRegistry.prototype.allocatePort = origAllocate;
        }
    });

    it('should handle start for non-existent target error', async () => {
        const mockJson = createMockOutput();
        const exitJson = await main(['projects', 'start', 'NonExistentProj', '--json'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(exitJson).toBe(1);
        expect(mockJson.getText()).toContain('"ok": false');

        const mockText = createMockOutput();
        const exitText = await main(['projects', 'start', 'NonExistentProj'], {
            cwd: tempDir,
            output: mockText.output,
        });
        expect(exitText).toBe(1);
        expect(mockText.getText()).toContain('Error: Project not found in registry');
    });

    it('should stop a registered project with active port via CLI', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const activePort = 3503;
        setPortProbeForTests(async (p) => (p === activePort ? 'in-use' : 'available'));

        await registry.upsert({ name: 'ActiveStop', path: projectPath, port: activePort });

        // Stop JSON — must not kill the test runner even when fuser reports us.
        const mockJson = createMockOutput();
        const exitJson = await main(['projects', 'stop', 'ActiveStop', '--json'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(exitJson).toBe(0);
        expect(mockJson.getText()).toContain('"stopped": "ActiveStop"');
        // Still alive after stop (would not reach here if we SIGTERM'd ourselves).
        expect(process.pid).toBeGreaterThan(0);

        // Stop text (port already cleared — no fuser path)
        const mockText = createMockOutput();
        const exitText = await main(['projects', 'stop', 'ActiveStop'], {
            cwd: tempDir,
            output: mockText.output,
        });
        expect(exitText).toBe(0);
        expect(mockText.getText()).toContain('Stopped project "ActiveStop"');
    });

    it('should return error when stopping a non-existent project', async () => {
        const mockJson = createMockOutput();
        const exitJson = await main(['projects', 'stop', 'GhostProj', '--json'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(exitJson).toBe(1);
        expect(mockJson.getText()).toContain('"ok": false');

        const mockText = createMockOutput();
        const exitText = await main(['projects', 'stop', 'GhostProj'], {
            cwd: tempDir,
            output: mockText.output,
        });
        expect(exitText).toBe(1);
        expect(mockText.getText()).toContain('Error: Project not found');
    });

    it('should render orchestrator binding states and strategy fallbacks under list --fleet (0836/0838)', async () => {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        const { ProjectClaimDao, createMigratedDb } = await import('@gobing-ai/spur-domain');

        const orchestratorCarrier = { id: 'lead', executor: 'build', role: 'planner', purpose: 'orchestrator' };
        const seedFleetProject = async (
            name: string,
            fleet: { members: object[]; orchestrator?: string; enabled?: boolean },
            corruptDb = false,
        ) => {
            const dir = mkdtempSync(join(tmpdir(), `spur-${name}-`));
            mkdirSync(join(dir, '.spur'), { recursive: true });
            // 0858: written as the project's `agent.fleet` section, not the retired file.
            writeFileSync(
                join(dir, '.spur', 'config.yaml'),
                stringify({ agent: { fleet: { enabled: fleet.enabled ?? true, ...fleet } } }),
            );
            if (corruptDb) writeFileSync(join(dir, '.spur', 'spur.db'), 'definitely not a sqlite database');
            await main(['projects', 'add', dir, '--name', name], {
                cwd: tempDir,
                output: createMockOutput().output,
            });
            return dir;
        };

        // bound-online: declared binding + live claim row in the project's own db.
        const onlineDir = await seedFleetProject('orch-online', {
            members: [orchestratorCarrier],
            orchestrator: 'lead',
        });
        const normalizedOnline = normalizeProjectPath(onlineDir);
        const onlineDb = await createMigratedDb({ url: join(normalizedOnline, '.spur', 'spur.db') });
        await new ProjectClaimDao(onlineDb).claim(normalizedOnline, 'orchestrator', 'orch-online-lead', 60_000);
        onlineDb.close();

        // bound-offline: declared binding, no live claim (R4 — start/heartbeat fixes it).
        const offlineDir = await seedFleetProject('orch-offline', {
            members: [orchestratorCarrier],
            orchestrator: 'lead',
        });
        // unresolvable: the pointer names no declared member id.
        const ghostDir = await seedFleetProject('orch-ghost', {
            members: [{ id: 'a', executor: 'build' }],
            orchestrator: 'ghost',
        });
        // Resolves cleanly with zero enabled members — `missing` names the fix (R7) —
        // and the strategy read reports the `rest` default (0838 R1).
        const disabledDir = await seedFleetProject('orch-disabled', {
            members: [{ id: 'rev', executor: 'review', enabled: false }],
        });
        // Unavailable reads: valid binding shape, corrupt project db — both the
        // orchestrator claim read and the strategy read fail per-project (0835 R6).
        const corruptDir = await seedFleetProject(
            'orch-corrupt',
            { members: [orchestratorCarrier], orchestrator: 'lead' },
            true,
        );

        try {
            const mock = createMockOutput();
            const exit = await main(['projects', 'list', '--fleet'], { cwd: tempDir, output: mock.output });
            expect(exit).toBe(0);
            const text = mock.getText();
            expect(text).toContain('fleet: no enabled members');
            expect(text).toContain('bound-online');
            expect(text).toContain('(holder orch-online-lead)');
            expect(text).toContain('bound-offline');
            expect(text).toContain('(no live claim)');
            expect(text).toContain('orchestrator: unresolvable (unknown-member:ghost');
            expect(text).toContain('orchestrator: unavailable');
            expect(text).toContain('strategy: unavailable');
            expect(text).toContain('strategy: rest (default)');
        } finally {
            for (const dir of [onlineDir, offlineDir, ghostDir, disabledDir, corruptDir]) {
                if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('should start a stopped project and print the text confirmation', async () => {
        const registry = new ProjectRegistry(projectsFile);
        await registry.upsert({ name: 'TextStart', path: projectPath, port: 0 });

        const targetPort = 3505;
        setPortProbeForTests(async (p) => (p === targetPort ? 'in-use' : 'available'));
        ProjectRegistry.prototype.allocatePort = async () => targetPort;
        setDetachedServeSpawnForTests(() => ({ exitCode: null, unref: () => {} }));

        try {
            const mock = createMockOutput();
            const exit = await main(['projects', 'start', 'TextStart'], { cwd: tempDir, output: mock.output });
            expect(exit).toBe(0);
            expect(mock.getText()).toContain('Started project "TextStart" on ');
        } finally {
            setDetachedServeSpawnForTests(undefined);
            ProjectRegistry.prototype.allocatePort = origAllocate;
        }
    });

    it('should signal fuser-reported pids but never itself during stop', async () => {
        const { chmodSync, writeFileSync } = await import('node:fs');
        const registry = new ProjectRegistry(projectsFile);
        const activePort = 3506;
        setPortProbeForTests(async (p) => (p === activePort ? 'in-use' : 'available'));
        await registry.upsert({ name: 'FuserStop', path: projectPath, port: activePort });

        // Fake `fuser` on PATH: reports this test's own pid (skipped — never
        // SIGTERM ourselves) and an impossible pid (kill → ESRCH, ignored per-pid).
        const binDir = mkdtempSync(join(tmpdir(), 'spur-fake-fuser-'));
        const fuserPath = join(binDir, 'fuser');
        writeFileSync(fuserPath, `#!/bin/sh\necho "${process.pid} 99999998"\n`);
        chmodSync(fuserPath, 0o755);
        const origPath = process.env.PATH;
        process.env.PATH = `${binDir}${origPath !== undefined ? `:${origPath}` : ''}`;

        try {
            const mock = createMockOutput();
            const exit = await main(['projects', 'stop', 'FuserStop', '--json'], {
                cwd: tempDir,
                output: mock.output,
            });
            expect(exit).toBe(0);
            expect(mock.getText()).toContain('"stopped": "FuserStop"');
        } finally {
            if (origPath !== undefined) process.env.PATH = origPath;
            else delete process.env.PATH;
            if (existsSync(binDir)) rmSync(binDir, { recursive: true, force: true });
        }
    });
});
