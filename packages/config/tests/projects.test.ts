import { afterEach, describe, expect, it } from 'bun:test';

import { homedir } from 'node:os';
import { join } from 'node:path';
import { getProjectsFilePath, projectEntrySchema, projectsFileSchema } from '../src/projects';

describe('packages/config projects schemas and path resolution', () => {
    const originalEnv = process.env.SPUR_PROJECTS_FILE;

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.SPUR_PROJECTS_FILE = originalEnv;
        } else {
            delete process.env.SPUR_PROJECTS_FILE;
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
        });

        it('defaults port to 0 when omitted', () => {
            const entry = projectEntrySchema.parse({
                name: 'Test App',
                path: '/path/to/app',
            });
            expect(entry.port).toBe(0);
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
            process.env.SPUR_PROJECTS_FILE = '/custom/projects.json';
            expect(getProjectsFilePath()).toBe('/custom/projects.json');
        });

        it('returns default ~/.config/spur/projects.json when SPUR_PROJECTS_FILE is unset', () => {
            delete process.env.SPUR_PROJECTS_FILE;
            const expected = join(homedir(), '.config', 'spur', 'projects.json');
            expect(getProjectsFilePath()).toBe(expected);
        });
    });
});
