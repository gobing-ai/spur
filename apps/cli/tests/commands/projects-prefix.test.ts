import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { main } from '../../src/index';

describe('spur projects add --prefix (K4 R1/R2)', () => {
    let tempDir: string;
    let projectsFile: string;
    let projectPath: string;
    let out: string[];

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-projects-prefix-cli-'));
        projectsFile = join(tempDir, 'projects.json');
        projectPath = mkdtempSync(join(tmpdir(), 'spur-prefix-project-'));
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
        out = [];
    });

    afterEach(() => {
        removeEnvVar('SPUR_PROJECTS_FILE');
        for (const dir of [tempDir, projectPath]) {
            if (existsSync(dir)) {
                rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    async function run(args: string[]): Promise<number> {
        return main(args, {
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

    it('stores a normalized prefix and leaves untouched entries byte-identical', async () => {
        const seeded = {
            schema_version: 1,
            projects: [{ name: 'Remote', path: '/tmp/remote', host: '192.168.87.27', port: 3003 }],
        };
        writeFileSync(projectsFile, JSON.stringify(seeded, null, 2), 'utf8');
        const before = readFileSync(projectsFile, 'utf8');

        const exit = await run(['projects', 'add', projectPath, '--name', 'Knowledge Kit', '--prefix', 'kk', '--json']);
        expect(exit).toBe(0);

        const written = JSON.parse(readFileSync(projectsFile, 'utf8'));
        expect(written.projects).toContainEqual(seeded.projects[0] as never);
        const local = written.projects.find((p: { name: string }) => p.name === 'Knowledge Kit');
        expect(local.prefix).toBe('/kk');
        // The untouched remote entry keeps its exact serialized bytes, nested indent included.
        const expectedBlock = JSON.stringify(seeded.projects[0], null, 2).replace(/\n/g, '\n    ');
        expect(readFileSync(projectsFile, 'utf8')).toContain(expectedBlock);
        // The seeded entry's own line run is preserved verbatim.
        expect(before).toContain('"port": 3003');
    });

    it('refuses an invalid prefix with exit 1 and no registry write', async () => {
        const exit = await run(['projects', 'add', projectPath, '--name', 'KK', '--prefix', 'Knowledge Kit', '--json']);
        expect(exit).toBe(1);
        expect(out.join('')).toContain('slug');
        expect(existsSync(projectsFile)).toBe(false);
    });

    it('refuses --prefix together with a remote --host', async () => {
        const exit = await run([
            'projects',
            'add',
            '/tmp/remote-proj',
            '--host',
            '192.168.87.27',
            '--prefix',
            'kk',
            '--json',
        ]);
        expect(exit).toBe(1);
        expect(out.join('')).toContain('local');
        expect(existsSync(projectsFile)).toBe(false);
    });
});
