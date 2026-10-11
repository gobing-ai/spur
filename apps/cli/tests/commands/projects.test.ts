import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    normalizeProjectPath,
    ProjectRegistry,
    setDetachedServeSpawnForTests,
    setPortProbeForTests,
    setProcessHelpersForTests,
    setProjectStopFetchForTests,
} from '@gobing-ai/spur-app';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
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
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
    });

    afterEach(() => {
        setPortProbeForTests(undefined);
        setProcessHelpersForTests(undefined);
        setProjectStopFetchForTests(undefined);
        ProjectRegistry.prototype.list = origList;
        ProjectRegistry.prototype.allocatePort = origAllocate;
        removeEnvVar('SPUR_PROJECTS_FILE');
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
        }
        if (existsSync(projectPath)) {
            rmSync(projectPath, { recursive: true, force: true });
        }
    });

    // 1156: fetch seams for the ownership identity probes the stop path requires.
    function ownedFetchFor(path: string): typeof fetch {
        return (async (input: string | URL) => {
            const url = new URL(String(input));
            const body =
                url.pathname === '/api/health'
                    ? { status: 'ok', service: 'spur' }
                    : { name: 'proj', path: normalizeProjectPath(path) };
            return { ok: true, status: 200, json: async () => body } as unknown as Response;
        }) as unknown as typeof fetch;
    }

    function foreignFetch(): typeof fetch {
        return (async (input: string | URL) => {
            const url = new URL(String(input));
            const body = url.pathname === '/api/health' ? { status: 'ok', service: 'nginx' } : { error: 'Not Found' };
            return { ok: true, status: 200, json: async () => body } as unknown as Response;
        }) as unknown as typeof fetch;
    }

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
        let liveState = true;
        setPortProbeForTests(async (p) => (p === activePort && liveState ? 'in-use' : 'available'));

        // 1156: the stop path signals only a verified same-owned Spur listener —
        // fake PID via the process seams, identity via the fetch seam, and the
        // port goes quiet once SIGTERM lands. Fake PIDs only: the test runner is
        // never signaled.
        const signalsReceived: Array<{ pid: number; signal: string }> = [];
        setProcessHelpersForTests({
            pidFinder: (p) => (p === activePort ? 97531 : undefined),
            processKiller: (pid, signal) => {
                signalsReceived.push({ pid, signal });
                if (signal === 'SIGTERM') liveState = false;
                return true;
            },
        });
        setProjectStopFetchForTests(ownedFetchFor(projectPath));

        await registry.upsert({ name: 'ActiveStop', path: projectPath, port: activePort });

        // Stop JSON — verified listener, existing success shape.
        const mockJson = createMockOutput();
        const exitJson = await main(['projects', 'stop', 'ActiveStop', '--json'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(exitJson).toBe(0);
        expect(mockJson.getText()).toContain('"stopped": "ActiveStop"');
        expect(signalsReceived).toEqual([{ pid: 97531, signal: 'SIGTERM' }]);
        // Still alive after stop (would not reach here if we SIGTERM'd ourselves).
        expect(process.pid).toBeGreaterThan(0);

        // Stop text (port already cleared — idempotent no-listener path)
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

    it('should stop idempotently when no listener answers the registered port', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const deadPort = 3509;
        // Port is not live: absent listener is a successful stop that clears the
        // stale port without any signal (1156 AC2).
        setPortProbeForTests(async () => 'available');
        const signalsReceived: Array<{ pid: number; signal: string }> = [];
        setProcessHelpersForTests({
            pidFinder: () => 97533,
            processKiller: (pid, signal) => {
                signalsReceived.push({ pid, signal });
                return true;
            },
        });

        await registry.upsert({ name: 'AbsentStop', path: projectPath, port: deadPort });

        const mock = createMockOutput();
        const exit = await main(['projects', 'stop', 'AbsentStop'], { cwd: tempDir, output: mock.output });
        expect(exit).toBe(0);
        expect(mock.getText()).toContain('Stopped project "AbsentStop"');
        expect(signalsReceived).toEqual([]);
        expect(registry.readRaw().projects.find((p) => p.name === 'AbsentStop')?.port).toBe(0);
    });

    it('should refuse to stop a foreign listener without signaling, clearing its port, or printing Stopped', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const foreignPort = 3506;
        setPortProbeForTests(async (p) => (p === foreignPort ? 'in-use' : 'available'));
        const signalsReceived: Array<{ pid: number; signal: string }> = [];
        setProcessHelpersForTests({
            pidFinder: (p) => (p === foreignPort ? 97532 : undefined),
            processKiller: (pid, signal) => {
                signalsReceived.push({ pid, signal });
                return true;
            },
        });
        // A non-Spur service owns the port: identity proof fails closed (1156 AC1).
        setProjectStopFetchForTests(foreignFetch());

        await registry.upsert({ name: 'ForeignStop', path: projectPath, port: foreignPort });

        const mockJson = createMockOutput();
        const exitJson = await main(['projects', 'stop', 'ForeignStop', '--json'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(exitJson).toBe(1);
        expect(mockJson.getText()).toContain('"ok": false');
        expect(mockJson.getText()).toContain('Refused to stop');
        expect(mockJson.getText()).not.toContain('"stopped"');

        const mockText = createMockOutput();
        const exitText = await main(['projects', 'stop', 'ForeignStop'], {
            cwd: tempDir,
            output: mockText.output,
        });
        expect(exitText).toBe(1);
        expect(mockText.getText()).toContain('Error: Refused to stop');
        expect(mockText.getText()).not.toContain('Stopped project');

        // Foreign listener survives unsignaled and its registry port is preserved.
        expect(signalsReceived).toEqual([]);
        expect(registry.readRaw().projects.find((p) => p.name === 'ForeignStop')?.port).toBe(foreignPort);
    });

    it('should refuse to stop when the listener PID resolves to the CLI process itself', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const selfPort = 3507;
        setPortProbeForTests(async (p) => (p === selfPort ? 'in-use' : 'available'));
        const signalsReceived: Array<{ pid: number; signal: string }> = [];
        setProcessHelpersForTests({
            // The unsafe-PID guard fires before any identity probe or signal, so
            // an in-process listener can never suicide the CLI (1156 AC3).
            pidFinder: () => process.pid,
            processKiller: (pid, signal) => {
                signalsReceived.push({ pid, signal });
                return true;
            },
        });
        setProjectStopFetchForTests(ownedFetchFor(projectPath));

        await registry.upsert({ name: 'SelfStop', path: projectPath, port: selfPort });

        const mock = createMockOutput();
        const exit = await main(['projects', 'stop', 'SelfStop', '--json'], { cwd: tempDir, output: mock.output });
        expect(exit).toBe(1);
        expect(mock.getText()).toContain('unsafe PID');
        expect(signalsReceived).toEqual([]);
        expect(registry.readRaw().projects.find((p) => p.name === 'SelfStop')?.port).toBe(selfPort);
    });

    it('should purge missing projects and report results via clean --json', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const missingPath = join(tempDir, 'ghost-project');
        await registry.upsert({ name: 'KeepMe', path: projectPath, port: 0 });
        await registry.upsert({ name: 'GhostMe', path: missingPath, port: 0 });

        const mockJson = createMockOutput();
        const exit = await main(['projects', 'clean', '--json'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(exit).toBe(0);
        const data = JSON.parse(mockJson.getText()) as {
            ok: boolean;
            purgedCount: number;
            purgedProjects: Array<{ name: string; path: string }>;
            terminatedProcesses: Array<unknown>;
        };
        expect(data.ok).toBe(true);
        expect(data.purgedCount).toBe(1);
        expect(data.purgedProjects[0]?.name).toBe('GhostMe');

        // Registry should now only contain KeepMe
        const raw = registry.readRaw();
        expect(raw.projects.map((p) => p.name)).toEqual(['KeepMe']);
    });

    it('should support refresh alias and text output when clean', async () => {
        const registry = new ProjectRegistry(projectsFile);
        await registry.upsert({ name: 'Existing', path: projectPath, port: 0 });

        const mockText = createMockOutput();
        const exit = await main(['projects', 'refresh'], {
            cwd: tempDir,
            output: mockText.output,
        });
        expect(exit).toBe(0);
        expect(mockText.getText()).toContain('Registry is clean. No stale project entries found.');
    });

    it('should purge missing project and terminate lingering process via clean with human text', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const missingPath = join(tempDir, 'ghost-with-port');
        const ghostPort = 3599;
        let liveState = true;
        setPortProbeForTests(async (p) => (p === ghostPort && liveState ? 'in-use' : 'available'));

        const killedPids: number[] = [];
        setProcessHelpersForTests({
            pidFinder: async (port) => (port === ghostPort ? 98765 : undefined),
            processKiller: (pid, signal) => {
                killedPids.push(pid);
                if (signal === 'SIGTERM') liveState = false;
                return true;
            },
        });
        // 1156: the ghost's listener proves service:spur and the exact deleted path.
        setProjectStopFetchForTests(ownedFetchFor(missingPath));

        await registry.upsert({ name: 'GhostWithPort', path: missingPath, port: ghostPort });

        const mockText = createMockOutput();
        const exit = await main(['projects', 'clean'], {
            cwd: tempDir,
            output: mockText.output,
        });
        expect(exit).toBe(0);
        const output = mockText.getText();
        expect(output).toContain('Purged 1 stale project(s):');
        expect(output).toContain('GhostWithPort');
        expect(output).toContain('Terminated 1 lingering process(es):');
        expect(output).toContain('PID 98765 on port 3599');
        expect(killedPids).toContain(98765);
    });

    it('should purge a missing project but report no termination for a foreign listener via clean', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const missingPath = join(tempDir, 'ghost-foreign-port');
        const ghostPort = 3598;
        setPortProbeForTests(async (p) => (p === ghostPort ? 'in-use' : 'available'));

        const signalsReceived: Array<{ pid: number; signal: string }> = [];
        setProcessHelpersForTests({
            pidFinder: async (port) => (port === ghostPort ? 98764 : undefined),
            processKiller: (pid, signal) => {
                signalsReceived.push({ pid, signal });
                return true;
            },
        });
        // Foreign service owns the stale port: purged with no terminated entry (1156 AC1).
        setProjectStopFetchForTests(foreignFetch());

        await registry.upsert({ name: 'GhostForeign', path: missingPath, port: ghostPort });

        const mockJson = createMockOutput();
        const exit = await main(['projects', 'clean', '--json'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(exit).toBe(0);
        const data = JSON.parse(mockJson.getText()) as {
            ok: boolean;
            purgedCount: number;
            terminatedProcesses: Array<unknown>;
        };
        expect(data.ok).toBe(true);
        expect(data.purgedCount).toBe(1);
        expect(data.terminatedProcesses).toEqual([]);
        expect(signalsReceived).toEqual([]);
        expect(registry.readRaw().projects).toHaveLength(0);
    });

    it('should support --json-envelope on clean', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const missingPath = join(tempDir, 'ghost-env');
        await registry.upsert({ name: 'GhostEnv', path: missingPath, port: 0 });

        const mockJson = createMockOutput();
        const exit = await main(['projects', 'clean', '--json', '--json-envelope'], {
            cwd: tempDir,
            output: mockJson.output,
        });
        expect(exit).toBe(0);
        const env = JSON.parse(mockJson.getText()) as {
            ok: boolean;
            data?: { purgedCount: number; purgedProjects: Array<{ name: string }> };
        };
        expect(env.ok).toBe(true);
        expect(env.data?.purgedCount).toBe(1);
        expect(env.data?.purgedProjects[0]?.name).toBe('GhostEnv');
    });
});
