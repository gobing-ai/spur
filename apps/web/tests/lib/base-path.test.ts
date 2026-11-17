import { describe, expect, it } from 'bun:test';
import * as lib from '../../src/lib/base-path';
import { registerHappyDom } from '../happy-dom';

registerHappyDom();

/**
 * `src/lib/base-path.ts` is the application-side entry to the base-path contract; the implementation
 * lives under `src/components` because the module kit publishes it. This pins the re-export surface so
 * the two paths cannot drift.
 */
describe('lib/base-path re-export', () => {
    it('exposes the same functions as the kit-facing module', async () => {
        const canonical = await import('../../src/components/base-path');
        expect(lib.withBase).toBe(canonical.withBase);
        expect(lib.basePath).toBe(canonical.basePath);
        expect(lib.resolveApiUrl).toBe(canonical.resolveApiUrl);
        expect(typeof lib.resetBasePathForTesting).toBe('function');
    });

    it('behaves at the origin root', () => {
        expect(lib.basePath()).toBe('/');
        expect(lib.withBase('/api')).toBe('/api');
    });
});
