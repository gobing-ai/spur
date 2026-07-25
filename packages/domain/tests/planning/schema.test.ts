import { describe, expect, test } from 'bun:test';
import {
    FEATURE_STATUS_ICONS,
    FEATURE_STATUSES,
    type FeatureStatus,
    featureFrontmatterSchema,
    featureStatusIcon,
    normalizeFeatureStatus,
    normalizeTaskStatus,
    normalizeTaskStatusSafe,
    TASK_STATUS_ICONS,
    TASK_STATUSES,
    taskFrontmatterSchema,
    taskStatusIcon,
} from '../../src/planning/schema';

describe('planning schema — icons', () => {
    test('taskStatusIcon returns emoji for known canonical status', () => {
        expect(taskStatusIcon('todo')).toBe(TASK_STATUS_ICONS.todo);
    });

    test('taskStatusIcon normalizes aliases (legacy PascalCase)', () => {
        expect(taskStatusIcon('Backlog')).toBe(TASK_STATUS_ICONS.backlog);
    });

    test('taskStatusIcon returns empty string for unknown status', () => {
        expect(taskStatusIcon('nonexistent')).toBe('');
    });

    test('featureStatusIcon returns emoji for known status', () => {
        expect(featureStatusIcon('backlog')).toBe(FEATURE_STATUS_ICONS.backlog);
    });

    test('featureStatusIcon returns empty string for unknown status', () => {
        expect(featureStatusIcon('nonexistent')).toBe('');
    });
});

describe('planning schema — normalizeTaskStatus', () => {
    test('normalizes canonical lowercase status', () => {
        expect(normalizeTaskStatus('todo')).toBe('todo');
        expect(normalizeTaskStatus('done')).toBe('done');
    });

    test('normalizes case-insensitively', () => {
        expect(normalizeTaskStatus('TODO')).toBe('todo');
        expect(normalizeTaskStatus('Done')).toBe('done');
    });

    test('normalizes legacy aliases', () => {
        expect(normalizeTaskStatus('Backlog')).toBe('backlog');
        expect(normalizeTaskStatus('In Progress')).toBe('wip');
    });

    test('throws on unknown status with allowed set in message', () => {
        expect(() => normalizeTaskStatus('nonexistent')).toThrow(/Unknown task status/);
        expect(() => normalizeTaskStatus('nonexistent')).toThrow(TASK_STATUSES.join(', '));
    });

    test('Safe variant falls back to todo for unknown status', () => {
        expect(normalizeTaskStatusSafe('nonexistent')).toBe('todo');
    });

    test('Safe variant normalizes known aliases', () => {
        expect(normalizeTaskStatusSafe('Backlog')).toBe('backlog');
        expect(normalizeTaskStatusSafe('Done')).toBe('done');
    });
});

describe('planning schema — normalizeFeatureStatus', () => {
    test('normalizes canonical lowercase status', () => {
        expect(normalizeFeatureStatus('backlog')).toBe('backlog');
        expect(normalizeFeatureStatus('done')).toBe('done');
    });

    test('normalizes case-insensitively', () => {
        expect(normalizeFeatureStatus('BACKLOG')).toBe('backlog');
    });

    test('throws on unknown status with allowed set in message', () => {
        expect(() => normalizeFeatureStatus('nonexistent')).toThrow(/Unknown feature status/);
        expect(() => normalizeFeatureStatus('nonexistent')).toThrow(FEATURE_STATUSES.join(', '));
    });
});

describe('planning schema — frontmatter schemas', () => {
    const validTaskFrontmatter = {
        schema_version: 1,
        name: 'Test task',
        status: 'todo',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        parent_wbs: '0001',
    };

    test('taskFrontmatterSchema accepts minimal valid task', () => {
        const result = taskFrontmatterSchema.parse(validTaskFrontmatter);
        expect(result.name).toBe('Test task');
        expect(result.type).toBe('task');
    });

    test('taskFrontmatterSchema rejects unrecognized status', () => {
        const result = taskFrontmatterSchema.safeParse({
            ...validTaskFrontmatter,
            status: 'nonexistent',
        });
        expect(result.success).toBe(false);
    });

    test('taskFrontmatterSchema rejects invalid schema_version', () => {
        const result = taskFrontmatterSchema.safeParse({
            ...validTaskFrontmatter,
            schema_version: 99,
        });
        expect(result.success).toBe(false);
    });

    test('taskFrontmatterSchema accepts feature_link_declined boolean or string', () => {
        const parsedBool = taskFrontmatterSchema.parse({
            ...validTaskFrontmatter,
            feature_link_declined: true,
        });
        expect(parsedBool.feature_link_declined).toBe(true);

        const parsedStr = taskFrontmatterSchema.parse({
            ...validTaskFrontmatter,
            feature_link_declined: 'true',
        });
        expect(parsedStr.feature_link_declined).toBe(true);
    });

    const validFeatureFrontmatter = {
        schema_version: 1,
        id: 'F1',
        name: 'Test feature',
        status: 'backlog',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
    };

    test('featureFrontmatterSchema accepts valid feature', () => {
        const result = featureFrontmatterSchema.parse(validFeatureFrontmatter);
        expect(result.id).toBe('F1');
    });

    test('featureFrontmatterSchema rejects invalid feature id format', () => {
        const result = featureFrontmatterSchema.safeParse({
            ...validFeatureFrontmatter,
            id: 'invalid-id',
        });
        expect(result.success).toBe(false);
    });

    test('featureFrontmatterSchema rejects invalid feature status (no preprocess)', () => {
        const result = featureFrontmatterSchema.safeParse({
            ...validFeatureFrontmatter,
            status: 'BACKLOG',
        });
        expect(result.success).toBe(false);
    });

    test('FeatureStatus type is assignable to string', () => {
        const status: FeatureStatus = 'backlog';
        expect(typeof status).toBe('string');
    });
});
