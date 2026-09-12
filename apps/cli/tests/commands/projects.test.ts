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
        // Declaration with one enabled + one disabled member.
        mkdirSync(join(projectPath, '.spur'), { recursive: true });
        writeFileSync(
            join(projectPath, '.spur', 'fleet.json'),
            JSON.stringify({
                version: 1,
                // Pinned executors (not in test agent config) resolve cleanly: R4
                // missing-data-never-grants gives fsWrite=unknown write=false.
                members: [
                    { id: 'lead', executor: 'build' },
                    { id: 'rev', executor: 'review', enabled: false },
                ],
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
            expect(text).toContain('no declaration (.spur/fleet.json)');

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
        // Invalid declaration (member declares neither role nor executor) — resolution throws.
        writeFileSync(
            join(projectPath, '.spur', 'fleet.json'),
            JSON.stringify({ version: 1, members: [{ purpose: 'ghost' }] }),
        );

        const mockList = createMockOutput();
        const listExit = await main(['projects', 'list', '--fleet'], { cwd: tempDir, output: mockList.output });
        expect(listExit).toBe(0);
        expect(mockList.getText()).toContain('fleet: unavailable');
        expect(mockList.getText()).toContain('must declare a role or an executor');

        const mockJson = createMockOutput();
        await main(['projects', 'list', '--fleet', '--json'], { cwd: tempDir, output: mockJson.output });
        const parsed = JSON.parse(mockJson.getText()) as {
            projects: Array<{ name: string; fleet: unknown; fleetError?: string }>;
        };
        const entry = parsed.projects.find((p) => p.name === 'brokenfleet');
        expect(entry?.fleet).toEqual(null);
        expect(entry?.fleetError).toContain('must declare a role or an executor');
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
});
