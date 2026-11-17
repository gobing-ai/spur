import { describe, expect, it } from 'bun:test';

import {
    findPrefixCollisions,
    normalizePrefix,
    projectEntrySchema,
    RESERVED_PREFIX_SEGMENTS,
    resolveProjectPrefix,
    slugifyProjectName,
    validatePrefix,
} from '../src/projects';

describe('project prefix contract (K4 R1/R2)', () => {
    describe('slugifyProjectName', () => {
        it('slugifies display names', () => {
            expect(slugifyProjectName('Knowledge Kit')).toBe('knowledge-kit');
            expect(slugifyProjectName('  kk  ')).toBe('kk');
            expect(slugifyProjectName('A/B_C.d')).toBe('a-b-c-d');
        });

        it('falls back to "project" when nothing survives', () => {
            expect(slugifyProjectName('***')).toBe('project');
        });

        it('caps the slug at 63 characters', () => {
            expect(slugifyProjectName('x'.repeat(80)).length).toBe(63);
        });
    });

    describe('normalizePrefix', () => {
        it('adds the leading slash, drops the trailing one and lowercases', () => {
            expect(normalizePrefix('kk')).toBe('/kk');
            expect(normalizePrefix('/KK/')).toBe('/kk');
            expect(normalizePrefix('  /knowledge-kit  ')).toBe('/knowledge-kit');
        });

        it('leaves invalid characters for validatePrefix to report', () => {
            expect(normalizePrefix('Knowledge Kit')).toBe('/knowledge kit');
        });
    });

    describe('validatePrefix', () => {
        it('accepts a slug prefix', () => {
            expect(validatePrefix('/knowledge-kit')).toBeNull();
            expect(validatePrefix('/kk')).toBeNull();
        });

        it('names the slug rule for a space that survives normalization', () => {
            const message = validatePrefix(normalizePrefix('Knowledge Kit'));
            expect(message).toContain('slug');
        });

        it('names each reserved segment', () => {
            for (const segment of RESERVED_PREFIX_SEGMENTS) {
                const message = validatePrefix(`/${segment}`);
                expect(message).toContain(segment);
                expect(message).toContain('reserved');
            }
        });

        it('rejects reserved segments before the slug rule', () => {
            const message = validatePrefix('/_astro');
            expect(message).toContain('_astro');
            expect(message).toContain('reserved');
        });

        it('rejects a nested path', () => {
            expect(validatePrefix('/board/x')).not.toBeNull();
        });
    });

    describe('resolveProjectPrefix', () => {
        it('uses the explicit prefix for a local entry', () => {
            expect(resolveProjectPrefix({ name: 'Knowledge Kit', host: 'localhost', prefix: '/kk' })).toBe('/kk');
        });

        it('derives the prefix from the name when absent', () => {
            const entry = projectEntrySchema.parse({ name: 'Knowledge Kit', path: '/tmp/kk' });
            expect(resolveProjectPrefix(entry)).toBe('/knowledge-kit');
            expect(resolveProjectPrefix({ name: 'Knowledge Kit' })).toBe('/knowledge-kit');
        });

        it('returns null for a remote entry, with or without a stored prefix', () => {
            expect(resolveProjectPrefix({ name: 'Remote', host: '192.168.87.27', prefix: '/kk' })).toBeNull();
        });
    });

    describe('findPrefixCollisions', () => {
        it('reports two local entries that derive the same prefix', () => {
            const collisions = findPrefixCollisions([
                projectEntrySchema.parse({ name: 'kk', path: '/tmp/a' }),
                projectEntrySchema.parse({ name: 'KK', path: '/tmp/b' }),
            ]);
            expect(collisions.get('/kk')).toEqual(['kk', 'KK']);
        });

        it('ignores remote entries and unique prefixes', () => {
            const collisions = findPrefixCollisions([
                projectEntrySchema.parse({ name: 'kk', path: '/tmp/a' }),
                projectEntrySchema.parse({ name: 'Remote', path: '/tmp/b', host: '192.168.87.27' }),
            ]);
            expect(collisions.size).toBe(0);
        });
    });

    describe('legacy files', () => {
        it('parses entries without a prefix unchanged', () => {
            const parsed = projectEntrySchema.parse({ name: 'Legacy', path: '/tmp/legacy', port: 3003 });
            expect(parsed.prefix).toBeUndefined();
            expect(parsed.port).toBe(3003);
        });
    });
});
