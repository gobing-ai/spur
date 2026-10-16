registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import type { DatabaseColumn, DatabaseTableResponse } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import {
    clearStoredColumns,
    DEFAULT_MAX_VISIBLE_COLUMNS,
    getDefaultVisibleColumns,
    getTableStorageKey,
    loadStoredColumns,
    saveStoredColumns,
    TableMetadataModal,
} from '../../../src/modules/projects/DatabaseView';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);
afterEach(() => cleanup());

function createMockColumn(name: string, pk = false, type = 'TEXT'): DatabaseColumn {
    return { name, type, notNull: pk, pk };
}

describe('DatabaseView column visibility and persistence', () => {
    test('DEFAULT_MAX_VISIBLE_COLUMNS is 7', () => {
        expect(DEFAULT_MAX_VISIBLE_COLUMNS).toBe(7);
    });

    describe('getTableStorageKey', () => {
        test('prefixes table name with spur:database:columns:v1:', () => {
            expect(getTableStorageKey('coordination_runs')).toBe('spur:database:columns:v1:coordination_runs');
            expect(getTableStorageKey('tasks')).toBe('spur:database:columns:v1:tasks');
        });
    });

    describe('getDefaultVisibleColumns', () => {
        test('returns all columns if total count <= maxDefault', () => {
            const cols = [createMockColumn('id', true), createMockColumn('title'), createMockColumn('status')];
            const result = getDefaultVisibleColumns(cols, 7);
            expect(result).toEqual(['id', 'title', 'status']);
        });

        test('limits to maxDefault columns when table has more fields', () => {
            const cols = [
                createMockColumn('col1'),
                createMockColumn('col2'),
                createMockColumn('col3'),
                createMockColumn('col4'),
                createMockColumn('col5'),
                createMockColumn('col6'),
                createMockColumn('col7'),
                createMockColumn('col8'),
                createMockColumn('col9'),
                createMockColumn('col10'),
            ];
            const result = getDefaultVisibleColumns(cols, 7);
            expect(result.length).toBe(7);
            expect(result).toEqual(['col1', 'col2', 'col3', 'col4', 'col5', 'col6', 'col7']);
        });

        test('ensures primary key is included even if located past maxDefault', () => {
            const cols = [
                createMockColumn('col1'),
                createMockColumn('col2'),
                createMockColumn('col3'),
                createMockColumn('col4'),
                createMockColumn('col5'),
                createMockColumn('col6'),
                createMockColumn('col7'),
                createMockColumn('pk_col', true), // PK located at index 7 (> 6)
                createMockColumn('col9'),
            ];
            const result = getDefaultVisibleColumns(cols, 7);
            expect(result.length).toBe(7);
            expect(result).toContain('pk_col');
            // Preserves relative schema order
            expect(result).toEqual(['col1', 'col2', 'col3', 'col4', 'col5', 'col6', 'pk_col']);
        });

        test('handles composite primary keys', () => {
            const cols = [
                createMockColumn('tenant_id', true),
                createMockColumn('col1'),
                createMockColumn('col2'),
                createMockColumn('col3'),
                createMockColumn('user_id', true),
                createMockColumn('col4'),
                createMockColumn('col5'),
                createMockColumn('col6'),
            ];
            const result = getDefaultVisibleColumns(cols, 5);
            expect(result.length).toBe(5);
            expect(result).toContain('tenant_id');
            expect(result).toContain('user_id');
            expect(result).toEqual(['tenant_id', 'col1', 'col2', 'col3', 'user_id']);
        });

        test('handles empty columns array', () => {
            expect(getDefaultVisibleColumns([])).toEqual([]);
        });
    });

    describe('storage operations (load, save, clear)', () => {
        function createMockStorage(): Storage {
            const store = new Map<string, string>();
            return {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: (k: string, v: string) => store.set(k, v),
                removeItem: (k: string) => store.delete(k),
                clear: () => store.clear(),
                key: (i: number) => Array.from(store.keys())[i] ?? null,
                get length() {
                    return store.size;
                },
            };
        }

        test('loadStoredColumns returns null if key does not exist', () => {
            const storage = createMockStorage();
            expect(loadStoredColumns('test_table', ['col1', 'col2'], storage)).toBeNull();
        });

        test('loadStoredColumns returns null for corrupted JSON', () => {
            const storage = createMockStorage();
            storage.setItem(getTableStorageKey('test_table'), '{not-valid-json');
            expect(loadStoredColumns('test_table', ['col1', 'col2'], storage)).toBeNull();
        });

        test('loadStoredColumns returns null for non-array JSON', () => {
            const storage = createMockStorage();
            storage.setItem(getTableStorageKey('test_table'), JSON.stringify({ col1: true }));
            expect(loadStoredColumns('test_table', ['col1', 'col2'], storage)).toBeNull();
        });

        test('loadStoredColumns filters out stale columns not in availableColumns', () => {
            const storage = createMockStorage();
            storage.setItem(getTableStorageKey('test_table'), JSON.stringify(['col1', 'dropped_col', 'col3']));
            const loaded = loadStoredColumns('test_table', ['col1', 'col2', 'col3'], storage);
            expect(loaded).toEqual(['col1', 'col3']);
        });

        test('loadStoredColumns returns null if all stored columns are stale', () => {
            const storage = createMockStorage();
            storage.setItem(getTableStorageKey('test_table'), JSON.stringify(['dropped1', 'dropped2']));
            const loaded = loadStoredColumns('test_table', ['col1', 'col2'], storage);
            expect(loaded).toBeNull();
        });

        test('saveStoredColumns writes JSON array to storage', () => {
            const storage = createMockStorage();
            saveStoredColumns('my_table', ['col1', 'col4'], storage);
            expect(storage.getItem(getTableStorageKey('my_table'))).toBe(JSON.stringify(['col1', 'col4']));
            const reloaded = loadStoredColumns('my_table', ['col1', 'col2', 'col3', 'col4'], storage);
            expect(reloaded).toEqual(['col1', 'col4']);
        });

        test('clearStoredColumns removes item from storage', () => {
            const storage = createMockStorage();
            saveStoredColumns('my_table', ['col1'], storage);
            expect(storage.getItem(getTableStorageKey('my_table'))).not.toBeNull();
            clearStoredColumns('my_table', storage);
            expect(storage.getItem(getTableStorageKey('my_table'))).toBeNull();
        });
    });

    describe('TableMetadataModal', () => {
        const mockSchema: DatabaseTableResponse = {
            name: 'coordination_runs',
            rowCount: 187,
            columns: [
                createMockColumn('run_id', true, 'TEXT'),
                createMockColumn('agent_kind', false, 'TEXT'),
                createMockColumn('generation', false, 'INTEGER'),
            ],
        };

        test('renders nothing when open is false', () => {
            const { container } = render(
                createElement(TableMetadataModal, { open: false, onClose: () => {}, schema: mockSchema }),
            );
            expect(container.querySelector('[data-database-metadata-modal]')).toBeNull();
        });

        test('renders nothing when schema is null', () => {
            const { container } = render(
                createElement(TableMetadataModal, { open: true, onClose: () => {}, schema: null }),
            );
            expect(container.querySelector('[data-database-metadata-modal]')).toBeNull();
        });

        test('renders table metadata stats and field rows when open', () => {
            const { container, getAllByText, getByText } = render(
                createElement(TableMetadataModal, { open: true, onClose: () => {}, schema: mockSchema }),
            );
            const modal = container.querySelector('[data-database-metadata-modal]');
            expect(modal).not.toBeNull();
            expect(getAllByText('coordination_runs').length).toBe(2);
            expect(getByText('187')).not.toBeNull();
            expect(getByText('run_id')).not.toBeNull();
            expect(getByText('agent_kind')).not.toBeNull();
            expect(getByText('generation')).not.toBeNull();
            expect(getByText('PK')).not.toBeNull();
            expect(getByText('NOT NULL')).not.toBeNull();
        });

        test('invokes onClose when close button is clicked', () => {
            let closed = false;
            const { container } = render(
                createElement(TableMetadataModal, {
                    open: true,
                    onClose: () => {
                        closed = true;
                    },
                    schema: mockSchema,
                }),
            );
            const closeBtn = container.querySelector('button[aria-label="Close metadata"]');
            expect(closeBtn).not.toBeNull();
            if (closeBtn) {
                fireEvent.click(closeBtn);
            }
            expect(closed).toBe(true);
        });
    });
});
