import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { ProjectRegistry, setPortProbeForTests } from '../../src/services/project-registry';
import { setDetachedServeSpawnForTests, startRegisteredProject } from '../../src/services/project-start';

/**
 * Two registry entries can share one path on different hosts (a project served locally and from a
 * LAN address). Adopting by path alone handed the remote entry's port to the local prefix — the
 * gateway 502'd against a port that belonged to another machine's serve.
 */
describe('startRegisteredProject entry identity (Q R3)', () => {
    let tempDir: string;
    let projectsFile: string;
    let registry: ProjectRegistry;
    const ownerPort = 3666;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-project-identity-test-'));
        projectsFile = join(tempDir, 'projects.json');
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
        writeFileSync(
            projectsFile,
            JSON.stringify({
                schema_version: 1,
                projects: [
                    { name: 'knowledge-kit', path: tempDir, host: '192.168.87.27', port: 3003 },
                    { name: 'knowledge-kit', path: tempDir, host: 'localhost', port: 0, prefix: '/knowledge-kit' },
                ],
            }),
        );
        registry = new ProjectRegistry(projectsFile);
        // Nothing is live, so neither entry is adopted by its registered port.
        setPortProbeForTests(async () => 'available');
        setDetachedServeSpawnForTests(() => ({ exitCode: null, unref: () => {} }));
    });

    afterEach(() => {
        setPortProbeForTests(undefined);
        setDetachedServeSpawnForTests(undefined);
        removeEnvVar('SPUR_PROJECTS_FILE');
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    });

    function saved() {
        return JSON.parse(readFileSync(projectsFile, 'utf8')) as {
            projects: Array<{ host?: string; port: number; prefix?: string }>;
        };
    }

    it('adopts the owner-claimed serve for the entry it was handed, not the same-path remote port', async () => {
        const entry = (await registry.list()).find((p) => p.host === 'localhost');
        expect(entry).toBeDefined();
        const result = await startRegisteredProject(registry, tempDir, {
            entry,
            resolveOwnerPort: async () => ownerPort,
        });
        expect(result.alreadyRunning).toBe(true);
        expect(result.port).toBe(ownerPort);
        expect(result.port).not.toBe(3003);
    });

    it('heals the local entry only, leaving the same-path remote entry at its own port', async () => {
        const entry = (await registry.list()).find((p) => p.host === 'localhost');
        await startRegisteredProject(registry, tempDir, { entry, resolveOwnerPort: async () => ownerPort });
        const projects = saved().projects;
        const remote = projects.find((p) => p.host === '192.168.87.27');
        const local = projects.find((p) => p.host === 'localhost');
        expect(remote?.port).toBe(3003);
        expect(local?.port).toBe(ownerPort);
        expect(local?.prefix).toBe('/knowledge-kit');
    });
});
