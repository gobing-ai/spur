import { describe, expect, test } from 'bun:test';
import { type SpurAppConfig, SpurAppConfigSchema } from '../../src/config/schema';

describe('SpurAppConfigSchema', () => {
    test('accepts a valid full config', () => {
        const result = SpurAppConfigSchema.safeParse({
            version: '1',
            name: 'my-project',
            agent: { default: 'pi' },
            rules: { paths: ['.spur/rules/**/*.yaml'] },
            workflows: { paths: ['.spur/workflows/'] },
            redaction: { enabled: false },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.version).toBe('1');
            expect(result.data.name).toBe('my-project');
            expect(result.data.agent?.default).toBe('pi');
        }
    });

    test('accepts a minimal config with only version and name', () => {
        const result = SpurAppConfigSchema.safeParse({
            version: '1',
            name: 'minimal',
        });
        expect(result.success).toBe(true);
    });

    test('accepts an empty object (all fields optional)', () => {
        const result = SpurAppConfigSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    test('rejects invalid type for version', () => {
        const result = SpurAppConfigSchema.safeParse({
            version: 1,
        });
        expect(result.success).toBe(false);
    });

    test('rejects invalid type for agent.default', () => {
        const result = SpurAppConfigSchema.safeParse({
            agent: { default: 123 },
        });
        expect(result.success).toBe(false);
    });

    test('rejects invalid type for redaction.enabled', () => {
        const result = SpurAppConfigSchema.safeParse({
            redaction: { enabled: 'yes' },
        });
        expect(result.success).toBe(false);
    });

    test('rejects invalid type for rules.paths', () => {
        const result = SpurAppConfigSchema.safeParse({
            rules: { paths: 'not-an-array' },
        });
        expect(result.success).toBe(false);
    });

    test('infers SpurAppConfig type from schema', () => {
        const config: SpurAppConfig = {
            version: '1',
            name: 'typed',
            agent: { default: 'claude' },
            rules: { paths: ['.spur/rules/**/*.yaml'] },
            workflows: { paths: ['.spur/workflows/'] },
            redaction: { enabled: true },
        };
        expect(config.version).toBe('1');
        expect(config.agent?.default).toBe('claude');
    });
});
