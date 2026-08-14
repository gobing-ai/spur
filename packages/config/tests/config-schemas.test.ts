import { describe, expect, test } from 'bun:test';
import {
    featuresConfigSchema,
    HistoryConfigSchema,
    HistoryRefreshConfigSchema,
    resolveHistoryRefreshTrigger,
    tasksConfigSchema,
} from '../src/index';

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

describe('historyConfigSchema / resolveHistoryRefreshTrigger (task 0549)', () => {
    test('defaults are opt-out: on_completion false, debounce_ms 600000 (0548 figures)', () => {
        const result = HistoryRefreshConfigSchema.parse({});
        expect(result.on_completion).toBe(false);
        expect(result.debounce_ms).toBe(600_000);
    });

    test('explicit opt-in values parse', () => {
        const result = HistoryConfigSchema.safeParse({
            refresh: { on_completion: true, debounce_ms: 300_000 },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.refresh).toEqual({ on_completion: true, debounce_ms: 300_000 });
        }
    });

    test('debounce_ms below the 1000 ms floor is rejected', () => {
        expect(HistoryRefreshConfigSchema.safeParse({ debounce_ms: 10 }).success).toBe(false);
    });

    test('resolveHistoryRefreshTrigger tolerates null config (trigger disabled by default)', () => {
        expect(resolveHistoryRefreshTrigger(null)).toEqual({ onCompletion: false, debounceMs: 600_000 });
    });
});
