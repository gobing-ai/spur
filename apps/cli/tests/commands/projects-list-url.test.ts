import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setGatewayProbeForTests } from '@gobing-ai/spur-app';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { main } from '../../src/index';

/** K4 R7: `projects list` resolves gateway URLs and reports derived prefix collisions. */
describe('spur projects list --url (K4 R7)', () => {
    let tempDir: string;
    let projectsFile: string;
    let out: string[];

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-projects-url-'));
        projectsFile = join(tempDir, 'projects.json');
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
        // A gateway running on this machine must not decide the URL column.
        setGatewayProbeForTests(async () => false);
        out = [];
    });

    afterEach(() => {
        setGatewayProbeForTests(undefined);
        removeEnvVar('SPUR_PROJECTS_FILE');
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    });

    async function seed(projects: Array<Record<string, unknown>>): Promise<void> {
        // `list()` purges entries whose project directory is gone, so every local path must exist.
        for (const project of projects) {
            const path = project.path;
            if (typeof path === 'string' && path.startsWith(tempDir)) mkdirSync(path, { recursive: true });
        }
        writeFileSync(projectsFile, JSON.stringify({ schema_version: 1, projects }, null, 2), 'utf8');
    }

    async function list(args: string[] = []): Promise<number> {
        return main(['projects', 'list', ...args], {
            cwd: tempDir,
            output: {
                write: (chunk: string) => {
                    out.push(chunk);
                },
                error: (chunk: string) => {
                    out.push(chunk);
                },
            },
        });
    }

    it('adds prefix and url to the JSON rows', async () => {
        await seed([
            { name: 'kk', path: join(tempDir, 'kk'), host: 'localhost', port: 0, prefix: '/kk' },
            { name: 'remote', path: '/srv/remote', host: '192.168.87.27', port: 3003 },
        ]);
        // A gateway answering on the configured port would change the local URL; no gateway runs in
        // this test, so the per-port form is what the CLI must report.
        expect(await list(['--json'])).toBe(0);
        const parsed = JSON.parse(out.join('')) as {
            projects: Array<{ name: string; prefix: string | null; url: string }>;
        };
        const local = parsed.projects.find((p) => p.name === 'kk');
        const remote = parsed.projects.find((p) => p.name === 'remote');
        expect(local?.prefix).toBe('/kk');
        expect(local?.url).toBe('http://localhost:0/board');
        expect(remote?.prefix).toBeNull();
        expect(remote?.url).toBe('http://192.168.87.27:3003/board');
    });

    it('names the route instead of a port-0 url, and the collision remedy (Q R5/R6)', async () => {
        await seed([
            { name: 'kk', path: join(tempDir, 'a'), host: 'localhost', port: 0 },
            { name: 'KK', path: join(tempDir, 'b'), host: 'localhost', port: 0 },
        ]);
        expect(await list()).toBe(0);
        const text = out.join('');
        // No gateway answers in this test, so a stopped entry has no URL at all.
        expect(text).not.toContain(':0/board');
        expect(text).toContain('url: none (stopped; start it with spur projects start kk)');
        expect(text).toContain('Prefix /kk is claimed by "kk" and "KK"');
        expect(text).toContain('--prefix /<other>');
    });
});
