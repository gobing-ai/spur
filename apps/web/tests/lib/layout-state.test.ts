import { afterEach, describe, expect, test } from 'bun:test';
import { loadLayoutState, resetLayoutState, saveLayoutState } from '../../src/lib/layout-state';

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
        expect(state.sidebarCollapsed).toBe(false);
        expect(state.rightPanelCollapsed).toBe(true);
        restoreStorage();
    });

    test('saveLayoutState persists to localStorage', () => {
        mockStorage();
        saveLayoutState({
            sidebarWidth: 300,
            rightPanelWidth: 400,
            sidebarCollapsed: true,
            rightPanelCollapsed: false,
        });
        const raw = store.get('spur-board-layout');
        expect(raw).toBeDefined();
        if (!raw) return;
        const parsed = JSON.parse(raw);
        expect(parsed.sidebarWidth).toBe(300);
        expect(parsed.sidebarCollapsed).toBe(true);
        restoreStorage();
    });

    test('loadLayoutState restores persisted values', () => {
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
        restoreStorage();
    });

    test('loadLayoutState handles corrupt JSON gracefully', () => {
        mockStorage();
        store.set('spur-board-layout', '{broken');
        const state = loadLayoutState();
        expect(state.sidebarWidth).toBe(240); // default
        restoreStorage();
    });

    test('resetLayoutState removes the key', () => {
        mockStorage();
        saveLayoutState({
            sidebarWidth: 300,
            rightPanelWidth: 400,
            sidebarCollapsed: true,
            rightPanelCollapsed: false,
        });
        resetLayoutState();
        expect(store.get('spur-board-layout')).toBeUndefined();
        restoreStorage();
    });
});
