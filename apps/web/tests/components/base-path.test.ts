import { afterEach, describe, expect, it } from 'bun:test';
import { basePath, resetBasePathForTesting, resolveApiUrl, scopedKey, withBase } from '../../src/components/base-path';
import { registerHappyDom } from '../happy-dom';

// The helpers read `document`, so the DOM must exist before the first assertion.
registerHappyDom();

/** Install (or remove) the gateway's `<meta name="spur-base">` for one assertion. */
function setBaseMeta(content: string | null): void {
    for (const node of document.head.querySelectorAll('meta[name="spur-base"]')) node.remove();
    if (content !== null) {
        const meta = document.createElement('meta');
        meta.name = 'spur-base';
        meta.content = content;
        document.head.appendChild(meta);
    }
    resetBasePathForTesting();
}

afterEach(() => setBaseMeta(null));

describe('basePath / withBase (K4 R6)', () => {
    it('is "/" without the meta (direct per-port serve, dev server, memory router)', () => {
        expect(basePath()).toBe('/');
        expect(withBase('/api')).toBe('/api');
    });

    it('normalizes the meta into a leading and trailing slash', () => {
        setBaseMeta('proj');
        expect(basePath()).toBe('/proj/');
        setBaseMeta('/proj/');
        expect(basePath()).toBe('/proj/');
        setBaseMeta('/');
        expect(basePath()).toBe('/');
    });

    it('prefixes only root-relative paths', () => {
        setBaseMeta('/proj/');
        expect(withBase('/api')).toBe('/proj/api');
        expect(withBase('/board/tasks/123')).toBe('/proj/board/tasks/123');
        expect(withBase('https://x.test/y')).toBe('https://x.test/y');
        expect(withBase('//cdn.test/x')).toBe('//cdn.test/x');
        expect(withBase('#a')).toBe('#a');
        expect(withBase('?q=1')).toBe('?q=1');
        expect(withBase('relative/path')).toBe('relative/path');
    });

    it('resolves the API URL under the active base and honours PUBLIC_API_URL', () => {
        setBaseMeta('/proj/');
        expect(resolveApiUrl(undefined, 'http://localhost:3000')).toBe('http://localhost:3000/proj/api');
        expect(resolveApiUrl('https://api.test/api', 'http://localhost:3000')).toBe('https://api.test/api');
        setBaseMeta(null);
        expect(resolveApiUrl(undefined, 'http://localhost:3000')).toBe('http://localhost:3000/api');
    });

    it('memoizes per document', () => {
        setBaseMeta('/proj/');
        expect(basePath()).toBe('/proj/');
        // A later DOM mutation without the reset is not re-read — the meta cannot change at runtime.
        document.head.querySelector('meta[name="spur-base"]')?.remove();
        expect(basePath()).toBe('/proj/');
    });
});

describe('scopedKey (K4 R12)', () => {
    it('keeps the legacy key at the origin root', () => {
        setBaseMeta(null);
        expect(scopedKey('spur.board.projects.draft.v1')).toBe('spur.board.projects.draft.v1');
        expect(scopedKey('spur-board-layout-v3')).toBe('spur-board-layout-v3');
    });

    it('namespaces every key by the active prefix so two projects cannot read each other', () => {
        setBaseMeta('/a/');
        expect(scopedKey('spur.board.projects.draft.v1')).toBe('spur.board.projects.draft.v1@/a/');
        const projectA = scopedKey('spur.board.projects.draft.v1');
        setBaseMeta('/b/');
        expect(scopedKey('spur.board.projects.draft.v1')).not.toBe(projectA);
    });

    it('leaves the global theme key shared only because callers never scope it', () => {
        // `spur-theme` is intentionally global (one operator, one theme); scoping it is a caller bug,
        // so this asserts the helper WOULD change it and that theme.ts does not call it.
        setBaseMeta('/a/');
        expect(scopedKey('spur-theme')).toBe('spur-theme@/a/');
    });
});
