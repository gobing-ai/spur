import { describe, expect, it } from 'bun:test';
import {
    AllowSchema,
    CapabilitiesSchema,
    PluginConfigSchema,
    PluginManifestError,
    PluginManifestSchema,
    TrustLevelSchema,
    validateManifest,
} from '../src/schema';

describe('TrustLevelSchema', () => {
    it('accepts valid trust levels', () => {
        expect(TrustLevelSchema.safeParse('bundled').success).toBe(true);
        expect(TrustLevelSchema.safeParse('curated').success).toBe(true);
        expect(TrustLevelSchema.safeParse('local').success).toBe(true);
        expect(TrustLevelSchema.safeParse('untrusted').success).toBe(true);
    });

    it('rejects invalid trust levels', () => {
        expect(TrustLevelSchema.safeParse('unknown').success).toBe(false);
        expect(TrustLevelSchema.safeParse('').success).toBe(false);
    });
});

describe('CapabilitiesSchema', () => {
    it('accepts empty capabilities', () => {
        expect(CapabilitiesSchema.safeParse({}).success).toBe(true);
    });

    it('accepts populated capabilities', () => {
        const result = CapabilitiesSchema.safeParse({
            commands: ['my.command'],
            skills: ['my.skill'],
        });
        expect(result.success).toBe(true);
    });

    it('rejects unknown keys (strict)', () => {
        const result = CapabilitiesSchema.safeParse({ unknown: ['x'] });
        expect(result.success).toBe(false);
    });
});

describe('AllowSchema', () => {
    it('accepts valid allow block', () => {
        const result = AllowSchema.safeParse({
            filesystem: ['/tmp'],
            network: ['api.example.com'],
        });
        expect(result.success).toBe(true);
    });

    it('rejects unknown keys', () => {
        const result = AllowSchema.safeParse({ unknown_key: [] });
        expect(result.success).toBe(false);
    });
});

describe('PluginManifestSchema', () => {
    const validManifest = {
        name: 'my-plugin',
        version: '1.0.0',
        trust: 'local' as const,
    };

    it('parses a valid minimal manifest', () => {
        const result = PluginManifestSchema.safeParse(validManifest);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.name).toBe('my-plugin');
            expect(result.data.version).toBe('1.0.0');
            expect(result.data.trust).toBe('local');
        }
    });

    it('defaults capabilities to empty object', () => {
        const result = PluginManifestSchema.safeParse(validManifest);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.capabilities).toEqual({});
        }
    });

    it('parses a full manifest', () => {
        const full = {
            name: 'full-plugin',
            version: '2.0.0',
            description: 'A full plugin',
            author: 'Test Author',
            trust: 'curated' as const,
            capabilities: {
                commands: ['full.cmd'],
                skills: ['full.skill'],
            },
            allow: {
                filesystem: ['/data'],
            },
            config: {
                key: 'value',
            },
        };
        const result = PluginManifestSchema.safeParse(full);
        expect(result.success).toBe(true);
    });

    it('rejects missing trust', () => {
        const result = PluginManifestSchema.safeParse({ name: 'x', version: '1.0.0' });
        expect(result.success).toBe(false);
    });

    it('rejects missing name', () => {
        const result = PluginManifestSchema.safeParse({ version: '1.0.0', trust: 'local' });
        expect(result.success).toBe(false);
    });

    it('rejects invalid name (must match regex)', () => {
        const result = PluginManifestSchema.safeParse({
            name: 'Invalid_Name!',
            version: '1.0.0',
            trust: 'local',
        });
        expect(result.success).toBe(false);
    });

    it('rejects unknown key (strict)', () => {
        const result = PluginManifestSchema.safeParse({
            ...validManifest,
            extra_field: 'should not be here',
        });
        expect(result.success).toBe(false);
    });

    it('rejects bad trust enum value', () => {
        const result = PluginManifestSchema.safeParse({
            ...validManifest,
            trust: 'unknown_level',
        });
        expect(result.success).toBe(false);
    });
});

describe('PluginConfigSchema', () => {
    it('accepts string-keyed object', () => {
        const result = PluginConfigSchema.safeParse({ key: 'value', num: 42 });
        expect(result.success).toBe(true);
    });

    it('accepts empty object', () => {
        const result = PluginConfigSchema.safeParse({});
        expect(result.success).toBe(true);
    });
});

describe('validateManifest', () => {
    it('returns parsed manifest on success', () => {
        const result = validateManifest({
            name: 'test-plugin',
            version: '1.0.0',
            trust: 'bundled',
        });
        expect(result.name).toBe('test-plugin');
    });

    it('throws PluginManifestError on missing name', () => {
        expect(() => validateManifest({ version: '1.0.0', trust: 'local' })).toThrow(PluginManifestError);
    });

    it('throws with path-pointed error messages', () => {
        try {
            validateManifest({});
        } catch (e) {
            expect(e).toBeInstanceOf(PluginManifestError);
            if (e instanceof PluginManifestError) {
                expect(e.issues.length).toBeGreaterThan(0);
                // At least one issue should reference a path
                const paths = e.issues.map((i) => i.path.join('.'));
                expect(paths.some((p) => p.length > 0)).toBe(true);
            }
        }
    });
});
