import { describe, expect, test } from 'bun:test';
import { featuresConfigSchema, tasksConfigSchema } from '../src/index';

describe('tasksConfigSchema', () => {
    test('parses valid tasks config with a folders map (design §9)', () => {
        const result = tasksConfigSchema.safeParse({
            folders: {
                'docs/tasks': { baseCounter: 0, label: 'Core' },
            },
            active: 'docs/tasks',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.folders['docs/tasks']?.baseCounter).toBe(0);
            expect(result.data.folders['docs/tasks']?.label).toBe('Core');
        }
    });

    test('applies defaults for missing fields', () => {
        const result = tasksConfigSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.active).toBe('docs/tasks');
            expect(result.data.folders).toEqual({});
        }
    });

    test('folder entry baseCounter defaults to 0 when omitted', () => {
        const result = tasksConfigSchema.safeParse({
            folders: { 'docs/tasks': {} },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.folders['docs/tasks']?.baseCounter).toBe(0);
        }
    });
});

describe('featuresConfigSchema', () => {
    test('parses valid features config', () => {
        const result = featuresConfigSchema.safeParse({ dir: 'docs/features' });
        expect(result.success).toBe(true);
    });

    test('applies default dir', () => {
        const result = featuresConfigSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.dir).toBe('docs/features');
        }
    });
});
