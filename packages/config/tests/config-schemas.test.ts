import { describe, expect, test } from 'bun:test';
import {
    featuresConfigSchema,
    HistoryConfigSchema,
    HistoryRefreshConfigSchema,
    misplacedGlobalKeys,
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
        expect(resolveHistoryRefreshTrigger(null)).toEqual({
            onCompletion: false,
            debounceMs: 600_000,
            scheduleMinutes: null,
        });
    });

    test('schedule_minutes resolves to a scheduler interval; unset stays null (task 0696)', () => {
        expect(
            resolveHistoryRefreshTrigger({
                history: { refresh: { on_completion: false, debounce_ms: 600_000, schedule_minutes: 10 } },
            }).scheduleMinutes,
        ).toBe(10);
        expect(resolveHistoryRefreshTrigger({ history: {} }).scheduleMinutes).toBeNull();
        expect(HistoryRefreshConfigSchema.safeParse({ schedule_minutes: 0 }).success).toBe(false);
    });
});

describe('misplacedGlobalKeys (task 0649 R4)', () => {
    test('returns every project-shaped top-level key present at the global layer', () => {
        expect(
            misplacedGlobalKeys({
                name: 'spur-new',
                bootstrap: { logging: { level: 'info' } },
                rules: { paths: ['.spur/rules/**'] },
                redaction: {},
                tasks: {},
                features: {},
            }),
        ).toEqual(['name', 'bootstrap', 'rules', 'redaction', 'tasks', 'features']);
    });

    test('reports agent.team as a project-shaped key without flagging global agent.* keys', () => {
        expect(
            misplacedGlobalKeys({
                agent: {
                    team: { name: 'x' },
                    default: 'coder',
                    executors: [],
                    roles: {},
                },
                workflows: {},
            }),
        ).toEqual(['agent.team']);
    });

    test('a correctly shaped global config produces no finding (agent.default/executors/roles + workflows)', () => {
        expect(
            misplacedGlobalKeys({
                agent: { default: 'coder', executors: [], roles: {} },
                workflows: { paths: [] },
            }),
        ).toEqual([]);
    });

    test('an empty or global-only config produces no finding', () => {
        expect(misplacedGlobalKeys({})).toEqual([]);
        expect(misplacedGlobalKeys({ workflows: {} })).toEqual([]);
    });
});
