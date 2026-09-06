import { afterEach, describe, expect, test } from 'bun:test';
import {
    LEGACY_STORAGE_KEY,
    loadLayoutState,
    resetLayoutState,
    STORAGE_KEY,
    saveLayoutState,
} from '../../src/lib/layout-state';

// mock localStorage
const store = new Map<string, string>();
const originalGetItem = globalThis.localStorage?.getItem;
const originalSetItem = globalThis.localStorage?.setItem;
const originalRemoveItem = globalThis.localStorage?.removeItem;

function mockStorage() {
    globalThis.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
        get length() {
            return store.size;
        },
        key: () => null,
    } as Storage;
}

function restoreStorage() {
    globalThis.localStorage = {
        getItem: originalGetItem as Storage['getItem'],
        setItem: originalSetItem as Storage['setItem'],
        removeItem: originalRemoveItem as Storage['removeItem'],
        clear: () => {},
        get length() {
            return 0;
        },
        key: () => null,
    } as Storage;
}

describe('layout-state', () => {
    afterEach(() => {
        store.clear();
    });

    test('loadLayoutState returns defaults when storage is empty', () => {
        mockStorage();
        const state = loadLayoutState();
        expect(state.sidebarWidth).toBe(240);
        expect(state.rightPanelWidth).toBe(320);
        expect(state.sidebarCollapsed).toBe(true);
        expect(state.rightPanelCollapsed).toBe(true);
        restoreStorage();
    });

    test('saveLayoutState persists to localStorage under STORAGE_KEY', () => {
        mockStorage();
        saveLayoutState({
            sidebarWidth: 300,
            rightPanelWidth: 400,
            sidebarCollapsed: true,
            rightPanelCollapsed: false,
        });
        const raw = store.get(STORAGE_KEY);
        expect(raw).toBeDefined();
        if (!raw) return;
        const parsed = JSON.parse(raw);
        expect(parsed.version).toBe(2);
        expect(parsed.sidebarWidth).toBe(300);
        expect(parsed.sidebarCollapsed).toBe(true);
        restoreStorage();
    });

    test('loadLayoutState restores persisted values from v2 storage', () => {
        mockStorage();
        saveLayoutState({
            sidebarWidth: 280,
            rightPanelWidth: 350,
            sidebarCollapsed: false,
            rightPanelCollapsed: true,
        });
        const state = loadLayoutState();
        expect(state.sidebarWidth).toBe(280);
        expect(state.rightPanelWidth).toBe(350);
        expect(state.sidebarCollapsed).toBe(false);
        restoreStorage();
    });

    test('loadLayoutState migrates legacy unversioned state to v2 with sidebarCollapsed=true', () => {
        mockStorage();
        store.set(
            LEGACY_STORAGE_KEY,
            JSON.stringify({
                sidebarWidth: 280,
                rightPanelWidth: 350,
                sidebarCollapsed: false,
                rightPanelCollapsed: false,
            }),
        );
        const state = loadLayoutState();
        // Preserves custom panel widths
        expect(state.sidebarWidth).toBe(280);
        expect(state.rightPanelWidth).toBe(350);
        // Enforces folded default per A7 requirement 1.2
        expect(state.sidebarCollapsed).toBe(true);
        expect(state.rightPanelCollapsed).toBe(false);
        // Legacy key cleaned up and v2 key written
        expect(store.get(LEGACY_STORAGE_KEY)).toBeUndefined();
        expect(store.get(STORAGE_KEY)).toBeDefined();
        restoreStorage();
    });

    test('loadLayoutState handles corrupt JSON gracefully', () => {
        mockStorage();
        store.set(STORAGE_KEY, '{broken');
        const state = loadLayoutState();
        expect(state.sidebarWidth).toBe(240); // default
        expect(state.sidebarCollapsed).toBe(true);
        restoreStorage();
    });

    test('resetLayoutState removes both v2 and legacy keys', () => {
        mockStorage();
        store.set(LEGACY_STORAGE_KEY, '{"sidebarWidth":200}');
        saveLayoutState({
            sidebarWidth: 300,
            rightPanelWidth: 400,
            sidebarCollapsed: true,
            rightPanelCollapsed: false,
        });
        resetLayoutState();
        expect(store.get(STORAGE_KEY)).toBeUndefined();
        expect(store.get(LEGACY_STORAGE_KEY)).toBeUndefined();
        restoreStorage();
    });
});
