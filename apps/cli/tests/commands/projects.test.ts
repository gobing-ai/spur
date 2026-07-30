import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRegistry } from '@gobing-ai/spur-app';
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
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const livePort = (server.address() as { port: number }).port;

        try {
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
        } finally {
            server.close();
        }
    });

    it('should handle start for an un-registered target path (auto-register)', async () => {
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
            const mockJson = createMockOutput();
            const jsonExit = await main(['projects', 'start', projectPath, '--json'], {
                cwd: tempDir,
                output: mockJson.output,
            });
            expect(jsonExit).toBe(0);
            expect(mockJson.getText()).toContain('"running": true');
        } finally {
            Bun.spawn = origSpawn;
            ProjectRegistry.prototype.allocatePort = origAllocate;
            server.close();
        }
    });

    it('should handle start for a stopped project when port becomes live', async () => {
        const registry = new ProjectRegistry(projectsFile);
        await registry.upsert({ name: 'StoppedProj', path: projectPath, port: 0 });

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
            const mockJson = createMockOutput();
            const jsonExit = await main(['projects', 'start', 'StoppedProj', '--json'], {
                cwd: tempDir,
                output: mockJson.output,
            });
            expect(jsonExit).toBe(0);
            expect(mockJson.getText()).toContain('"running": true');
        } finally {
            Bun.spawn = origSpawn;
            ProjectRegistry.prototype.allocatePort = origAllocate;
            server.close();
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
        // Listen in THIS process so Linux `fuser <port>/tcp` returns our pid.
        // Production stop must skip self/ppid — otherwise CI dies with SIGTERM 143.
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const activePort = (server.address() as { port: number }).port;

        try {
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
        } finally {
            server.close();
        }
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
