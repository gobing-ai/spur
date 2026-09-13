import { afterEach, describe, expect, test } from 'bun:test';

import {
    DRAFT_STORAGE_KEY,
    type DraftRecord,
    emptyDraft,
    loadDraft,
    saveDraft,
} from '../../../src/modules/projects/drafts';

const PATH_A = '/repo/wt-a';
const PATH_B = '/repo/wt-b';

function record(overrides: Partial<DraftRecord> = {}): DraftRecord {
    return { path: PATH_A, text: 'working on it', refs: [{ kind: 'task', wbs: '0841' }], revision: 3, ...overrides };
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
});

/** Swap in a stub storage for the current test. */
function stubStorage(stub: Partial<Storage>): void {
    Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true });
}

describe('loadDraft path guard (0841 R2)', () => {
    test('absent key → empty draft, storage not written', () => {
        stubStorage({ getItem: () => null, setItem: () => {} });
        expect(loadDraft(PATH_A)).toEqual(emptyDraft(PATH_A));
    });

    test('stored record with matching path is returned as-is', () => {
        const stored = record();
        stubStorage({ getItem: () => JSON.stringify(stored), setItem: () => {} });
        expect(loadDraft(PATH_A)).toEqual(stored);
    });

    test('stored record whose path differs yields an empty draft and is OVERWRITTEN (port reuse)', () => {
        let saved: string | null = null;
        stubStorage({
            getItem: () => JSON.stringify(record({ path: PATH_B })),
            setItem: (_k, v) => {
                saved = v;
            },
        });
        expect(loadDraft(PATH_A)).toEqual(emptyDraft(PATH_A));
        expect(saved).not.toBeNull();
        expect(JSON.parse(saved as unknown as string).path).toBe(PATH_A);
    });

    test('shape-valid-but-wrong records each yield an empty draft (no throw, no notice)', () => {
        const garbage: unknown[] = [
            { text: 'no path', refs: [], revision: 1 },
            { path: PATH_A, refs: [], revision: 1 }, // missing text
            { path: PATH_A, text: 42, refs: [], revision: 1 }, // non-string text
            { path: PATH_A, text: 'x', refs: [], revision: 'many' }, // bad revision
            { path: PATH_A, text: 'x', refs: { nope: true }, revision: 1 }, // bad refs
            { path: PATH_A, text: 'x', refs: [{ kind: 'widget' }], revision: 1 }, // bad ref item
            [1, 2, 3],
            'just a string',
            null,
        ];
        for (const g of garbage) {
            stubStorage({ getItem: () => JSON.stringify(g), setItem: () => {} });
            expect(loadDraft(PATH_A)).toEqual(emptyDraft(PATH_A));
        }
    });

    test('invalid JSON and a throwing accessor each yield an empty draft, never a throw', () => {
        stubStorage({ getItem: () => '{not json', setItem: () => {} });
        expect(loadDraft(PATH_A)).toEqual(emptyDraft(PATH_A));
        stubStorage({
            getItem: () => {
                throw new Error('access denied');
            },
            setItem: () => {},
        });
        expect(loadDraft(PATH_A)).toEqual(emptyDraft(PATH_A));
    });

    test('no localStorage at all degrades to an empty draft', () => {
        stubStorage(undefined as unknown as Storage);
        expect(loadDraft(PATH_A)).toEqual(emptyDraft(PATH_A));
    });
});

describe('pending round-trip (0844 R1/R3)', () => {
    test('pending is preserved by the loader as an additive field and dropped by the clear contract', () => {
        const backing = new Map<string, string>();
        stubStorage({
            getItem: (k) => backing.get(k) ?? null,
            setItem: (k, v) => void backing.set(k, v),
        });
        const withPending = { ...record(), pending: { requestKey: 'rk-1', revision: 3 } };
        saveDraft(withPending);
        expect(loadDraft(PATH_A)).toEqual(withPending);

        // The clear contract (R2): a fresh empty revision, pending dropped.
        const cleared = { path: PATH_A, text: '', refs: [], revision: 4 };
        saveDraft(cleared);
        expect(loadDraft(PATH_A)).toEqual(cleared);
    });
});

describe('saveDraft (0841 R5)', () => {
    test('persists the record as JSON and round-trips through loadDraft', () => {
        const backing = new Map<string, string>();
        stubStorage({
            getItem: (k) => backing.get(k) ?? null,
            setItem: (k, v) => void backing.set(k, v),
        });
        const draft = record();
        saveDraft(draft);
        expect(backing.get(DRAFT_STORAGE_KEY)).toBe(JSON.stringify(draft));
        expect(loadDraft(PATH_A)).toEqual(draft);
    });

    test('a throwing setter is swallowed — saveDraft never throws', () => {
        stubStorage({
            getItem: () => null,
            setItem: () => {
                throw new Error('quota');
            },
        });
        expect(() => saveDraft(record())).not.toThrow();
    });
});
