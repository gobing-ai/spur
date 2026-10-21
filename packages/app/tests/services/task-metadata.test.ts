import { expect, test } from 'bun:test';
import { taskMetadata } from '../../src/services/task-metadata';

test('legacy metadata is canonicalized without rewriting the source document', () => {
    const original = Object.freeze({ status: 'DONE', 'feature-id': 'M5' });
    expect(taskMetadata(original)).toEqual({ status: 'done', featureId: 'M5' });
    expect(original).toEqual({ status: 'DONE', 'feature-id': 'M5' });
});

test('canonical linkage wins and invalid historical status stays visible for diagnostics', () => {
    expect(taskMetadata({ status: 'unknown-old-state', feature_id: 'G11', 'feature-id': 'M4' })).toEqual({
        status: 'unknown-old-state',
        featureId: 'G11',
    });
    expect(taskMetadata({ status: null, feature_id: 12 })).toEqual({ status: '', featureId: null });
});
