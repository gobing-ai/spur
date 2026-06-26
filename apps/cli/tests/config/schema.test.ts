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

    test('backward-compat: an old agent block without executors/default-by-phase parses', () => {
        // The new binary must read pre-0126 config files unchanged: `agent.executors`
        // and `agent.default-by-phase` are optional, so a bare `{ default: omp }` is valid.
        const result = SpurAppConfigSchema.safeParse({
            version: '1',
            name: 'legacy',
            agent: { default: 'omp' },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.agent?.default).toBe('omp');
            expect(result.data.agent?.executors).toBeUndefined();
            expect(result.data.agent?.['default-by-phase']).toBeUndefined();
        }
    });

    test('accepts agent executors and a default-by-phase map', () => {
        const result = SpurAppConfigSchema.safeParse({
            agent: {
                default: 'omp',
                executors: [
                    { name: 'omp', agent: 'omp' },
                    { name: 'omp-zai', agent: 'omp', model: 'zai//glm-5.2' },
                ],
                'default-by-phase': { 'dev-run': 'omp-zai', 'dev-review': 'claude' },
            },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.agent?.executors?.[1]?.model).toBe('zai//glm-5.2');
            expect(result.data.agent?.['default-by-phase']?.['dev-run']).toBe('omp-zai');
        }
    });

    test('rejects an executor missing required name/agent', () => {
        const result = SpurAppConfigSchema.safeParse({
            agent: { executors: [{ agent: 'omp' }] },
        });
        expect(result.success).toBe(false);
    });

    test('rejects a non-string executor model', () => {
        const result = SpurAppConfigSchema.safeParse({
            agent: { executors: [{ name: 'omp', agent: 'omp', model: 123 }] },
        });
        expect(result.success).toBe(false);
    });

    test('rejects duplicate executor names', () => {
        const result = SpurAppConfigSchema.safeParse({
            agent: {
                executors: [
                    { name: 'omp', agent: 'omp' },
                    { name: 'omp', agent: 'claude' },
                ],
            },
        });
        expect(result.success).toBe(false);
    });

    test('rejects the legacy array-of-map default-by-phase form', () => {
        const result = SpurAppConfigSchema.safeParse({
            agent: { 'default-by-phase': [{ 'dev-run': 'omp-zai' }] },
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
