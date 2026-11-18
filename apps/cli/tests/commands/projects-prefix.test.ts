import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setGatewayProbeForTests, setPortProbeForTests } from '@gobing-ai/spur-app';
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

describe('spur projects list output (Q R5)', () => {
    let tempDir: string;
    let projectsFile: string;
    let out: string[];

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-projects-list-cli-'));
        projectsFile = join(tempDir, 'projects.json');
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
        // Lid closure: nothing listens, so no entry is adopted by its registered port.
        setPortProbeForTests(async () => 'available');
        // No gateway on this machine may leak into the URL column.
        setGatewayProbeForTests(async () => false);
        out = [];
    });

    afterEach(() => {
        setPortProbeForTests(undefined);
        setGatewayProbeForTests(undefined);
        removeEnvVar('SPUR_PROJECTS_FILE');
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
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

    it('shows the prefix and never a port-0 URL for a stopped project', async () => {
        const local = mkdtempSync(join(tmpdir(), 'spur-list-local-'));
        writeFileSync(
            projectsFile,
            JSON.stringify({
                schema_version: 1,
                projects: [{ name: 'Treasury', path: local, host: 'localhost', port: 0, prefix: '/treasury' }],
            }),
        );
        try {
            expect(await run(['projects', 'list'])).toBe(0);
            const text = out.join('');
            expect(text).toContain('prefix: /treasury');
            expect(text).not.toContain(':0/board');
            expect(text).toContain('url: none (stopped; start it with spur projects start Treasury)');
        } finally {
            rmSync(local, { recursive: true, force: true });
        }
    });

    it('marks a remote entry as having no prefix', async () => {
        writeFileSync(
            projectsFile,
            JSON.stringify({
                schema_version: 1,
                projects: [{ name: 'kk', path: '/tmp/kk', host: '192.168.87.27', port: 3003 }],
            }),
        );
        expect(await run(['projects', 'list'])).toBe(0);
        expect(out.join('')).toContain('prefix: none (remote)');
    });

    it('keeps the prefix in the machine-readable projection', async () => {
        const local = mkdtempSync(join(tmpdir(), 'spur-list-json-'));
        writeFileSync(
            projectsFile,
            JSON.stringify({
                schema_version: 1,
                projects: [{ name: 'Treasury', path: local, host: 'localhost', port: 0, prefix: '/treasury' }],
            }),
        );
        try {
            expect(await run(['projects', 'list', '--json'])).toBe(0);
            const parsed = JSON.parse(out.join('')) as { projects: Array<{ prefix: string | null }> };
            expect(parsed.projects[0]?.prefix).toBe('/treasury');
        } finally {
            rmSync(local, { recursive: true, force: true });
        }
    });
});

describe('spur projects clean suspects (Q R7)', () => {
    let tempDir: string;
    let projectsFile: string;
    let out: string[];

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-projects-clean-cli-'));
        projectsFile = join(tempDir, 'projects.json');
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
        setPortProbeForTests(async () => 'available');
        // No gateway on this machine may leak into the URL column.
        setGatewayProbeForTests(async () => false);
        out = [];
    });

    afterEach(() => {
        setPortProbeForTests(undefined);
        setGatewayProbeForTests(undefined);
        removeEnvVar('SPUR_PROJECTS_FILE');
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    });

    async function run(args: string[]): Promise<number> {
        return main(args, {
            cwd: tempDir,
            output: { write: (c: string) => out.push(c), error: (c: string) => out.push(c) },
        });
    }

    function seedEphemeralPlusReal() {
        // A long-lived root: this workspace, never under tmp.
        const real = process.cwd();
        // An ephemeral root that still exists: `refreshProjects` cannot purge it.
        // `tmpdir()`, never a hardcoded macOS path — Linux runners have no /private/tmp.
        const ephemeral = mkdtempSync(join(tmpdir(), 'spur-clean-ephemeral-'));
        writeFileSync(
            projectsFile,
            JSON.stringify({
                schema_version: 1,
                projects: [
                    { name: 'keep', path: real, host: 'localhost', port: 0, prefix: '/keep' },
                    { name: 'junk', path: ephemeral, host: 'localhost', port: 0, prefix: '/junk' },
                ],
            }),
        );
        return { real, ephemeral };
    }

    it('reports a suspect without removing it', async () => {
        const { ephemeral } = seedEphemeralPlusReal();
        try {
            expect(await run(['projects', 'clean', '--no-terminate-processes'])).toBe(0);
            const text = out.join('');
            expect(text).toContain('suspect');
            expect(text).toContain('junk');
            expect(text).toContain('--remove-suspects');
            const saved = JSON.parse(readFileSync(projectsFile, 'utf8')) as { projects: Array<{ name: string }> };
            expect(saved.projects.map((p) => p.name)).toEqual(['keep', 'junk']);
        } finally {
            rmSync(ephemeral, { recursive: true, force: true });
        }
    });

    it('removes exactly the suspect entry when asked', async () => {
        const { ephemeral } = seedEphemeralPlusReal();
        try {
            expect(await run(['projects', 'clean', '--no-terminate-processes', '--remove-suspects'])).toBe(0);
            const saved = JSON.parse(readFileSync(projectsFile, 'utf8')) as {
                projects: Array<{ name: string; prefix?: string }>;
            };
            expect(saved.projects.map((p) => p.name)).toEqual(['keep']);
            expect(saved.projects[0]?.prefix).toBe('/keep');
        } finally {
            rmSync(ephemeral, { recursive: true, force: true });
        }
    });
});
