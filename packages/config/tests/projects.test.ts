import { afterEach, describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, removeEnvVar, setEnvVar } from '../src/index';
import {
    findRegistryFindings,
    findRegistrySuspects,
    getProjectsFilePath,
    projectEntrySchema,
    projectsFileSchema,
    resolveProjectHost,
} from '../src/projects';

describe('packages/config projects schemas and path resolution', () => {
    const originalEnv = getEnvVar('SPUR_PROJECTS_FILE');

    afterEach(() => {
        if (originalEnv !== undefined) {
            setEnvVar('SPUR_PROJECTS_FILE', originalEnv);
        } else {
            removeEnvVar('SPUR_PROJECTS_FILE');
        }
    });

    describe('projectEntrySchema', () => {
        it('parses a valid project entry', () => {
            const entry = projectEntrySchema.parse({
                name: 'Test App',
                path: '/path/to/app',
                port: 3000,
            });
            expect(entry.name).toBe('Test App');
            expect(entry.path).toBe('/path/to/app');
            expect(entry.port).toBe(3000);
            expect(resolveProjectHost(entry)).toBe('localhost');
        });

        it('defaults port to 0 when omitted and leaves host optional', () => {
            const entry = projectEntrySchema.parse({
                name: 'Test App',
                path: '/path/to/app',
            });
            expect(entry.port).toBe(0);
            expect(entry.host).toBeUndefined();
            expect(resolveProjectHost(entry)).toBe('localhost');
        });

        it('resolves empty or whitespace host as localhost via resolveProjectHost', () => {
            const entry = projectEntrySchema.parse({
                name: 'Test App',
                path: '/path/to/app',
                host: '   ',
            });
            expect(resolveProjectHost(entry)).toBe('localhost');
        });

        it('preserves custom remote host and resolves it', () => {
            const entry = projectEntrySchema.parse({
                name: 'Test App',
                path: '/path/to/app',
                host: 'remote.server.internal',
                port: 3000,
            });
            expect(entry.host).toBe('remote.server.internal');
            expect(resolveProjectHost(entry)).toBe('remote.server.internal');
            expect(entry.port).toBe(3000);
        });

        it('rejects empty name or path', () => {
            expect(() => projectEntrySchema.parse({ name: '', path: '/path' })).toThrow();
            expect(() => projectEntrySchema.parse({ name: 'Test', path: '' })).toThrow();
        });
    });

    describe('projectsFileSchema', () => {
        it('parses empty projects file with defaults', () => {
            const parsed = projectsFileSchema.parse({});
            expect(parsed.schema_version).toBe(1);
            expect(parsed.projects).toEqual([]);
        });

        it('parses a projects file containing entries', () => {
            const parsed = projectsFileSchema.parse({
                schema_version: 1,
                projects: [{ name: 'Project 1', path: '/path/1', port: 3001 }],
            });
            expect(parsed.projects.length).toBe(1);
            expect(parsed.projects[0]?.name).toBe('Project 1');
        });
    });

    describe('getProjectsFilePath', () => {
        it('returns SPUR_PROJECTS_FILE env override when set', () => {
            setEnvVar('SPUR_PROJECTS_FILE', '/custom/projects.json');
            expect(getProjectsFilePath()).toBe('/custom/projects.json');
        });

        it('returns default ~/.config/spur/projects.json when SPUR_PROJECTS_FILE is unset', () => {
            removeEnvVar('SPUR_PROJECTS_FILE');
            const expected = join(homedir(), '.config', 'spur', 'projects.json');
            expect(getProjectsFilePath()).toBe(expected);
        });
    });
});

describe('findRegistryFindings (Q R6)', () => {
    it('reports a prefix two local entries claim, with the remedy', () => {
        const findings = findRegistryFindings([
            { name: 'b', path: '/tmp/a', port: 0, prefix: '/b' },
            { name: 'b', path: '/tmp/c', port: 0, prefix: '/b' },
        ]);
        const collision = findings.find((f) => f.kind === 'prefix-collision');
        expect(collision?.prefix).toBe('/b');
        expect(collision?.names).toEqual(['b', 'b']);
        expect(collision?.message).toContain('spur projects add');
    });

    it('reports a path registered for more than one host', () => {
        const findings = findRegistryFindings([
            { name: 'kk', path: '/tmp/kk', host: '192.168.87.27', port: 3003 },
            { name: 'kk', path: '/tmp/kk', host: 'localhost', port: 0, prefix: '/kk' },
        ]);
        const duplicate = findings.find((f) => f.kind === 'duplicate-path');
        expect(duplicate?.path).toBe('/tmp/kk');
        expect(duplicate?.names).toEqual(['kk', 'kk']);
    });

    it('reports nothing for a clean registry', () => {
        expect(
            findRegistryFindings([
                { name: 'a', path: '/tmp/a', port: 0, prefix: '/a' },
                { name: 'b', path: '/tmp/b', host: '10.0.0.2', port: 3003 },
            ]),
        ).toEqual([]);
    });
});

describe('findRegistrySuspects (Q R7)', () => {
    it('flags an ephemeral local root and names the reason', () => {
        const [suspect] = findRegistrySuspects([
            { name: 'a2a-smoke', path: '/private/tmp/a2a-smoke', host: 'localhost', port: 0 },
        ]);
        expect(suspect?.name).toBe('a2a-smoke');
        expect(suspect?.reasons).toEqual(['ephemeral-path']);
        expect(suspect?.message).toContain('ephemeral');
    });

    it('flags a path registered more than once, comparing canonical paths', () => {
        const suspects = findRegistrySuspects([
            { name: 'kk', path: '/Users/robin/xprojects/kk', host: '192.168.87.27', port: 3003 },
            { name: 'kk', path: '/Users/robin/xprojects/kk', port: 0, prefix: '/kk' },
        ]);
        expect(suspects.map((s) => s.reasons)).toEqual([['duplicate-path']]);
    });

    it('reports both reasons when an ephemeral path is also registered twice', () => {
        const [suspect] = findRegistrySuspects([
            { name: 'b', path: '/private/tmp/b', port: 0, prefix: '/b' },
            { name: 'b', path: '/private/tmp/b', port: 0, prefix: '/b-2' },
        ]);
        expect(suspect?.reasons).toEqual(['ephemeral-path', 'duplicate-path']);
    });

    it("never flags a remote entry by this machine's tmp roots", () => {
        expect(
            findRegistrySuspects([{ name: 'remote', path: '/tmp/other-host-dir', host: '192.168.87.27', port: 3003 }]),
        ).toEqual([]);
    });

    it('reports nothing for a live project under a normal path', () => {
        expect(
            findRegistrySuspects([{ name: 'spur-new', path: '/Users/robin/xprojects/spur-new', port: 3000 }]),
        ).toEqual([]);
    });
});

describe('findRegistrySuspects foreign port (Q R7)', () => {
    it('reports a stored port that disagrees with what the path owner serves', () => {
        const [suspect] = findRegistrySuspects(
            [{ name: 'credit-sentry', path: '/Users/robin/xprojects/credit-sentry', port: 3007 }],
            {
                portOwners: new Map([['/Users/robin/xprojects/credit-sentry', 3000]]),
            },
        );
        expect(suspect?.reasons).toEqual(['foreign-port']);
        expect(suspect?.message).toContain('stored port');
    });

    it('stays silent when the stored port matches the owner, or no owner is known', () => {
        const path = '/Users/robin/xprojects/credit-sentry';
        expect(
            findRegistrySuspects([{ name: 'cs', path, port: 3007 }], { portOwners: new Map([[path, 3007]]) }),
        ).toEqual([]);
        expect(findRegistrySuspects([{ name: 'cs', path, port: 3007 }])).toEqual([]);
    });
});
