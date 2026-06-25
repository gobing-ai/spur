import { describe, expect, test } from 'bun:test';
import {
    FEATURE_STATUS_ICONS,
    FEATURE_STATUSES,
    featureFrontmatterSchema,
    featureStatusIcon,
    normalizeFeatureStatus,
    normalizeTaskStatus,
    PRIORITIES,
    PROFILES,
    TASK_STATUS_ICONS,
    TASK_STATUSES,
    taskFrontmatterSchema,
    taskStatusIcon,
} from '../src/index';

const ISO = '2026-06-13T00:00:00.000Z';

const baseTaskFrontmatter = {
    schema_version: 1 as const,
    name: 'Sample task',
    status: 'wip' as const,
    created_at: ISO,
    updated_at: ISO,
};

const baseFeatureFrontmatter = {
    schema_version: 1 as const,
    id: 'A1',
    name: 'Sample feature',
    status: 'active' as const,
    priority: 'P1' as const,
    created_at: ISO,
    updated_at: ISO,
};

describe('taskFrontmatterSchema', () => {
    test('accepts the minimal required shape', () => {
        const parsed = taskFrontmatterSchema.parse(baseTaskFrontmatter);
        expect(parsed.schema_version).toBe(1);
        expect(parsed.status).toBe('wip');
        expect(parsed.type).toBe('task');
    });

    test('exposes every field-table row', () => {
        const parsed = taskFrontmatterSchema.parse({
            ...baseTaskFrontmatter,
            description: 'optional',
            type: 'brainstorm',
            profile: 'complex',
            feature_id: 'A11',
            parent_wbs: '0042',
            priority: 'P0',
            tags: ['rd3-migration', 'wave-0'],
            dependencies: ['0040'],
        });
        expect(parsed.type).toBe('brainstorm');
        expect(parsed.profile).toBe('complex');
        expect(parsed.feature_id).toBe('A11');
        expect(parsed.parent_wbs).toBe('0042');
        expect(parsed.priority).toBe('P0');
        expect(parsed.tags).toEqual(['rd3-migration', 'wave-0']);
        expect(parsed.dependencies).toEqual(['0040']);
    });

    test('rejects missing schema_version', () => {
        const result = taskFrontmatterSchema.safeParse({ ...baseTaskFrontmatter, schema_version: 2 });
        expect(result.success).toBe(false);
    });

    test('normalizes known alias status values', () => {
        // 'pending' is a known alias → 'backlog'
        const result = taskFrontmatterSchema.safeParse({ ...baseTaskFrontmatter, status: 'pending' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.status).toBe('backlog');
    });

    test('rejects truly unknown status values', () => {
        const result = taskFrontmatterSchema.safeParse({ ...baseTaskFrontmatter, status: 'bogus' });
        expect(result.success).toBe(false);
    });

    test('rejects feature_id that violates the regex', () => {
        const result = taskFrontmatterSchema.safeParse({ ...baseTaskFrontmatter, feature_id: 'a1' });
        expect(result.success).toBe(false);
        const resultZero = taskFrontmatterSchema.safeParse({ ...baseTaskFrontmatter, feature_id: 'A0' });
        expect(resultZero.success).toBe(false);
    });

    test('accepts single-letter feature_id', () => {
        const parsed = taskFrontmatterSchema.parse({ ...baseTaskFrontmatter, feature_id: 'A' });
        expect(parsed.feature_id).toBe('A');
    });

    test('rejects parent_wbs that is not a 4-digit string', () => {
        expect(taskFrontmatterSchema.safeParse({ ...baseTaskFrontmatter, parent_wbs: '41' }).success).toBe(false);
        expect(taskFrontmatterSchema.safeParse({ ...baseTaskFrontmatter, parent_wbs: '0041a' }).success).toBe(false);
    });

    test('accepts parent_wbs of exactly 4 digits', () => {
        const parsed = taskFrontmatterSchema.parse({ ...baseTaskFrontmatter, parent_wbs: '0041' });
        expect(parsed.parent_wbs).toBe('0041');
    });

    test('rejects non-ISO timestamps', () => {
        const result = taskFrontmatterSchema.safeParse({ ...baseTaskFrontmatter, created_at: 'not-a-date' });
        expect(result.success).toBe(false);
    });

    test('rejects missing required fields', () => {
        expect(taskFrontmatterSchema.safeParse({ ...baseTaskFrontmatter, name: '' }).success).toBe(false);
        expect(taskFrontmatterSchema.safeParse({ ...baseTaskFrontmatter, status: undefined }).success).toBe(false);
    });
});

describe('featureFrontmatterSchema', () => {
    test('accepts the minimal required shape', () => {
        const parsed = featureFrontmatterSchema.parse(baseFeatureFrontmatter);
        expect(parsed.id).toBe('A1');
        expect(parsed.status).toBe('active');
        expect(parsed.priority).toBe('P1');
    });

    test('accepts the verifying status (DD-13)', () => {
        const parsed = featureFrontmatterSchema.parse({ ...baseFeatureFrontmatter, status: 'verifying' });
        expect(parsed.status).toBe('verifying');
    });

    test('rejects task-only status values', () => {
        expect(featureFrontmatterSchema.safeParse({ ...baseFeatureFrontmatter, status: 'wip' }).success).toBe(false);
        expect(featureFrontmatterSchema.safeParse({ ...baseFeatureFrontmatter, status: 'testing' }).success).toBe(
            false,
        );
    });

    test('rejects feature_id that does not match the regex', () => {
        expect(featureFrontmatterSchema.safeParse({ ...baseFeatureFrontmatter, id: 'a1' }).success).toBe(false);
        expect(featureFrontmatterSchema.safeParse({ ...baseFeatureFrontmatter, id: 'A0' }).success).toBe(false);
    });

    test('accepts feature_id with single letter and any digit count', () => {
        expect(featureFrontmatterSchema.parse({ ...baseFeatureFrontmatter, id: 'A' }).id).toBe('A');
        expect(featureFrontmatterSchema.parse({ ...baseFeatureFrontmatter, id: 'A123' }).id).toBe('A123');
    });

    test('tolerates a missing priority (optional, parity with tasks)', () => {
        const result = featureFrontmatterSchema.safeParse({ ...baseFeatureFrontmatter, priority: undefined });
        expect(result.success).toBe(true);
    });

    test('rejects unknown priorities even though the field is optional', () => {
        const result = featureFrontmatterSchema.safeParse({ ...baseFeatureFrontmatter, priority: 'P9' as never });
        expect(result.success).toBe(false);
    });
});

describe('normalizeTaskStatus', () => {
    test('returns the canonical lowercase form for known inputs', () => {
        for (const status of TASK_STATUSES) {
            expect(normalizeTaskStatus(status)).toBe(status);
            expect(normalizeTaskStatus(status.toUpperCase())).toBe(status);
            expect(normalizeTaskStatus(`  ${status}  `)).toBe(status);
        }
    });

    test('maps legacy aliases to their canonical targets', () => {
        expect(normalizeTaskStatus('completed')).toBe('done');
        expect(normalizeTaskStatus('in-progress')).toBe('wip');
        expect(normalizeTaskStatus('in_progress')).toBe('wip');
        expect(normalizeTaskStatus('in progress')).toBe('wip');
        expect(normalizeTaskStatus('dropped')).toBe('cancelled');
        expect(normalizeTaskStatus('canceled')).toBe('cancelled');
        expect(normalizeTaskStatus('cancel')).toBe('cancelled');
        expect(normalizeTaskStatus('PENDING')).toBe('backlog');
        expect(normalizeTaskStatus('new')).toBe('backlog');
    });

    test('throws on values outside the alias map', () => {
        expect(() => normalizeTaskStatus('done-ish')).toThrow(/Unknown task status/);
    });
});

describe('normalizeFeatureStatus', () => {
    test('returns the canonical lowercase form for known inputs', () => {
        for (const status of FEATURE_STATUSES) {
            expect(normalizeFeatureStatus(status)).toBe(status);
            expect(normalizeFeatureStatus(status.toUpperCase())).toBe(status);
        }
    });

    test('maps legacy aliases to their canonical targets', () => {
        expect(normalizeFeatureStatus('completed')).toBe('done');
        expect(normalizeFeatureStatus('in-progress')).toBe('active');
        expect(normalizeFeatureStatus('dropped')).toBe('cancelled');
        expect(normalizeFeatureStatus('review')).toBe('verifying');
        expect(normalizeFeatureStatus('in-review')).toBe('verifying');
        expect(normalizeFeatureStatus('in_review')).toBe('verifying');
        expect(normalizeFeatureStatus('wip')).toBe('active');
    });

    test('throws on values outside the alias map', () => {
        expect(() => normalizeFeatureStatus('verifying-ish')).toThrow(/Unknown feature status/);
    });
});

describe('round-trip property', () => {
    test('parse → serialize lossless for a fully-populated task frontmatter', () => {
        const sample = {
            ...baseTaskFrontmatter,
            description: 'round-trip',
            type: 'task' as const,
            profile: 'standard' as const,
            feature_id: 'A11',
            parent_wbs: '0040',
            priority: 'P0' as const,
            tags: ['rd3-migration', 'wave-0'],
            dependencies: ['0039', '0040'],
        };
        const parsed = taskFrontmatterSchema.parse(sample);
        const reserialized = JSON.parse(JSON.stringify(parsed));
        expect(reserialized).toEqual({
            ...sample,
            status: 'wip',
        });
    });

    test('parse → serialize lossless for a fully-populated feature frontmatter', () => {
        const sample = {
            ...baseFeatureFrontmatter,
            tags: ['planning'],
        };
        const parsed = featureFrontmatterSchema.parse(sample);
        const reserialized = JSON.parse(JSON.stringify(parsed));
        expect(reserialized).toEqual(sample);
    });
});

describe('vocabulary exports', () => {
    test('status enums cover the design contracts', () => {
        expect(TASK_STATUSES).toEqual(['backlog', 'todo', 'wip', 'testing', 'blocked', 'done', 'cancelled']);
        expect(FEATURE_STATUSES).toEqual(['backlog', 'active', 'verifying', 'blocked', 'done', 'cancelled']);
    });

    test('priority + profile enums match the design tables', () => {
        expect(PRIORITIES).toEqual(['P0', 'P1', 'P2', 'P3']);
        expect(PROFILES).toEqual([
            'simple',
            'standard',
            'complex',
            'research',
            'refine',
            'plan',
            'unit',
            'review',
            'docs',
        ]);
    });
});

describe('status icon maps', () => {
    test('TASK_STATUS_ICONS has an entry for every status in TASK_STATUSES', () => {
        for (const status of TASK_STATUSES) {
            expect(TASK_STATUS_ICONS[status]).toBeDefined();
        }
    });

    test('TASK_STATUS_ICONS values are non-empty strings (emojis)', () => {
        for (const status of TASK_STATUSES) {
            expect(typeof TASK_STATUS_ICONS[status]).toBe('string');
            expect(TASK_STATUS_ICONS[status].length).toBeGreaterThan(0);
        }
    });

    test('taskStatusIcon returns the mapped emoji for a known status', () => {
        expect(taskStatusIcon('todo')).toBe(TASK_STATUS_ICONS.todo);
    });

    test('taskStatusIcon returns empty string for unknown status', () => {
        expect(taskStatusIcon('unknown')).toBe('');
    });

    test('FEATURE_STATUS_ICONS has an entry for every status in FEATURE_STATUSES', () => {
        for (const status of FEATURE_STATUSES) {
            expect(FEATURE_STATUS_ICONS[status]).toBeDefined();
        }
    });

    test('featureStatusIcon returns the mapped emoji for a known status', () => {
        expect(featureStatusIcon('active')).toBe(FEATURE_STATUS_ICONS.active);
    });

    test('featureStatusIcon returns empty string for unknown status', () => {
        expect(featureStatusIcon('unknown')).toBe('');
    });
});
