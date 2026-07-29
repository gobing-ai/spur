import { describe, expect, test } from 'bun:test';
import {
    compareModules,
    discoverModules,
    discoverViaFs,
    discoverViaGlob,
    type FsDirent,
    type FsSeam,
    isWebModule,
    readModule,
} from '../../src/modules/discover';
import type { WebModule } from '../../src/modules/types';

/** Minimal valid WebModule; fields not under test are filled with plausible values. */
function shape(over: Partial<WebModule> = {}): WebModule {
    return {
        id: 'tasks',
        name: 'Tasks',
        icon: '?',
        route: 'tasks',
        component: () => null,
        ...over,
    };
}

/** Build a fake FsDirent. */
function dirent(name: string, isDir = true): FsDirent {
    return { name, isDirectory: () => isDir };
}

describe('readModule', () => {
    test('reads the named `module` export', () => {
        const mod = shape();
        expect(readModule({ module: mod })).toEqual(mod);
    });

    test('falls back to the `default` export when `module` is absent', () => {
        const mod = shape();
        expect(readModule({ default: mod })).toEqual(mod);
    });

    test('prefers `module` over `default` when both are present and valid', () => {
        const named = shape({ id: 'named' });
        const def = shape({ id: 'default' });
        expect(readModule({ module: named, default: def })?.id).toBe('named');
    });

    test('falls back to `default` when `module` is present but malformed', () => {
        const def = shape({ id: 'fallback' });
        expect(readModule({ module: { id: 'broken' }, default: def })?.id).toBe('fallback');
    });

    test('returns null when neither export is a WebModule', () => {
        expect(readModule({ foo: shape() })).toBeNull();
        expect(readModule({ module: { id: 'x' } })).toBeNull();
    });

    test('returns null for non-object entries', () => {
        expect(readModule(null)).toBeNull();
        expect(readModule('string')).toBeNull();
        expect(readModule(42)).toBeNull();
        expect(readModule(undefined)).toBeNull();
    });
});

describe('isWebModule', () => {
    test('accepts a well-formed module', () => {
        expect(isWebModule(shape())).toBe(true);
    });

    test('rejects non-objects', () => {
        expect(isWebModule(null)).toBe(false);
        expect(isWebModule('x')).toBe(false);
        expect(isWebModule(42)).toBe(false);
    });

    test('rejects when any required field is missing or mistyped', () => {
        // id not string
        expect(isWebModule({ ...shape(), id: 123 })).toBe(false);
        // name missing
        const { name: _omit, ...noName } = shape();
        expect(isWebModule(noName)).toBe(false);
        // icon not string
        expect(isWebModule({ ...shape(), icon: 1 })).toBe(false);
        // route not string
        expect(isWebModule({ ...shape(), route: null })).toBe(false);
        // component not function
        expect(isWebModule({ ...shape(), component: 'notafn' })).toBe(false);
        // id key absent
        const { id: _drop, ...noId } = shape();
        expect(isWebModule(noId)).toBe(false);
    });
});

describe('compareModules', () => {
    test('both declared: sorts ascending by order', () => {
        expect(compareModules(shape({ order: 2 }), shape({ order: 1 }))).toBe(1);
        expect(compareModules(shape({ order: 1 }), shape({ order: 2 }))).toBe(-1);
        expect(compareModules(shape({ order: 1 }), shape({ order: 1 }))).toBe(0);
    });

    test('only a declared: a sorts before b', () => {
        expect(compareModules(shape({ order: 5 }), shape({}))).toBe(-1);
    });

    test('only b declared: a sorts after b', () => {
        expect(compareModules(shape({}), shape({ order: 5 }))).toBe(1);
    });

    test('neither declared: returns 0 (stable sort preserves input order)', () => {
        expect(compareModules(shape({}), shape({}))).toBe(0);
    });
});

describe('discoverViaGlob', () => {
    test('collects valid modules and sorts them by id', () => {
        const b = shape({ id: 'b', route: 'b' });
        const a = shape({ id: 'a', route: 'a' });
        const fakeGlob = () => ({
            './b/index.tsx': { module: b },
            './a/index.tsx': { module: a },
        });
        const result = discoverViaGlob(fakeGlob);
        expect(result.map((m) => m.id)).toEqual(['a', 'b']);
    });

    test('skips entries that do not yield a WebModule', () => {
        const valid = shape({ id: 'valid' });
        const fakeGlob = () => ({
            './valid/index.tsx': { module: valid },
            './not-a-module/index.tsx': { foo: 'bar' },
            './malformed/index.tsx': { module: { id: 'x' } },
            './nonobject/index.tsx': 'string',
        });
        const result = discoverViaGlob(fakeGlob);
        expect(result.map((m) => m.id)).toEqual(['valid']);
    });

    test('returns empty when the glob yields nothing', () => {
        expect(discoverViaGlob(() => ({}))).toEqual([]);
    });

    test('declared-order modules sort first by order, undeclared follow in id order (AC Scenario 2)', () => {
        // Given out of id order; zeta declares order:0, alpha declares order:1, beta/gamma undeclared.
        const zeta = shape({ id: 'zeta', route: 'zeta', order: 0 });
        const alpha = shape({ id: 'alpha', route: 'alpha', order: 1 });
        const beta = shape({ id: 'beta', route: 'beta' });
        const gamma = shape({ id: 'gamma', route: 'gamma' });
        const fakeGlob = () => ({
            './zeta/index.tsx': { module: zeta },
            './alpha/index.tsx': { module: alpha },
            './beta/index.tsx': { module: beta },
            './gamma/index.tsx': { module: gamma },
        });
        const result = discoverViaGlob(fakeGlob);
        // id pre-sort -> [alpha, beta, gamma, zeta]; compareModules lifts declared -> [zeta(0), alpha(1), beta, gamma]
        expect(result.map((m) => m.id)).toEqual(['zeta', 'alpha', 'beta', 'gamma']);
    });
});

describe('discoverViaFs', () => {
    test('discovers modules from sorted directory entries (covers sort comparator)', () => {
        const alpha = shape({ id: 'alpha', route: 'alpha' });
        const beta = shape({ id: 'beta', route: 'beta' });
        // Entries given out-of-order to prove the sort comparator runs and orders by name.
        const seam: FsSeam = {
            readdirSync: () => [dirent('beta-dir'), dirent('alpha-dir')],
            tryRequire: (p) => {
                if (p.endsWith('alpha-dir/index.tsx')) return { module: alpha };
                if (p.endsWith('beta-dir/index.tsx')) return { module: beta };
                throw new Error('no such module');
            },
        };
        const result = discoverViaFs('/fake/root', seam);
        expect(result.map((m) => m.id)).toEqual(['alpha', 'beta']);
    });

    test('returns empty when readdirSync throws (covers readdir catch)', () => {
        const seam: FsSeam = {
            readdirSync: () => {
                throw new Error('ENOENT');
            },
            tryRequire: () => {
                throw new Error('unreachable');
            },
        };
        expect(discoverViaFs('/missing', seam)).toEqual([]);
    });

    test('skips directories whose require throws and tries .ts after .tsx fails (covers require catch + ext loop)', () => {
        const good = shape({ id: 'good' });
        const seam: FsSeam = {
            readdirSync: () => [
                dirent('good'), // valid via .tsx
                dirent('ts-only'), // valid via .ts (tsx throws)
                dirent('broken'), // both throw -> skipped
                dirent('not-a-module.ts', false), // file, not dir -> filtered out
            ],
            tryRequire: (p) => {
                if (p.endsWith('good/index.tsx')) return { module: good };
                if (p.endsWith('ts-only/index.ts')) return { module: shape({ id: 'ts-only' }) };
                throw new Error('cannot load');
            },
        };
        const result = discoverViaFs('/fake/root', seam);
        expect(result.map((m) => m.id)).toEqual(['good', 'ts-only']);
    });

    test('declared-order modules sort first by order, undeclared retain dir-name order (R6 / AC Scenario 2)', () => {
        // gamma-dir hosts order:0, alpha-dir undeclared, beta-dir hosts order:1.
        // dir-name pre-sort -> [alpha-dir, beta-dir, gamma-dir]; require order matches.
        // compareModules lifts declared -> [gamma(0), beta(1), alpha(undeclared, retains position)].
        const gamma = shape({ id: 'gamma', route: 'gamma', order: 0 });
        const alpha = shape({ id: 'alpha', route: 'alpha' });
        const beta = shape({ id: 'beta', route: 'beta', order: 1 });
        const seam: FsSeam = {
            readdirSync: () => [dirent('gamma-dir'), dirent('alpha-dir'), dirent('beta-dir')],
            tryRequire: (p) => {
                if (p.endsWith('gamma-dir/index.tsx')) return { module: gamma };
                if (p.endsWith('alpha-dir/index.tsx')) return { module: alpha };
                if (p.endsWith('beta-dir/index.tsx')) return { module: beta };
                throw new Error('no such module');
            },
        };
        const result = discoverViaFs('/fake/root', seam);
        expect(result.map((m) => m.id)).toEqual(['gamma', 'beta', 'alpha']);
    });

    test('skips a dir whose module exports are not WebModule-shaped (readModule null, no throw)', () => {
        const seam: FsSeam = {
            readdirSync: () => [dirent('no-export')],
            tryRequire: () => ({ foo: 'bar' }), // loads fine but not a WebModule
        };
        expect(discoverViaFs('/fake/root', seam)).toEqual([]);
    });
});

describe('discoverModules (real fs fallback under bun test)', () => {
    /**
     * Integration test for the real fs fallback. Under `bun test`,
     * `import.meta.glob` is `undefined`, so this exercises the production
     * dispatcher + real filesystem path end-to-end, proving the fallback
     * resolves the `task-kanban` module.
     */
    test('resolves the task-kanban module', () => {
        const discovered = discoverModules();
        const ids = discovered.map((m) => m.id);
        expect(ids).toContain('tasks');

        const tasks = discovered.find((m) => m.id === 'tasks') as WebModule | undefined;
        expect(tasks).toBeDefined();
        expect(tasks?.name).toBe('Tasks');
        expect(tasks?.route).toBe('tasks');
        expect(typeof tasks?.component).toBe('function');
    });

    test('every discovered module is WebModule-shaped', () => {
        for (const mod of discoverModules()) {
            expect(typeof mod.id).toBe('string');
            expect(typeof mod.name).toBe('string');
            expect(typeof mod.icon).toBe('string');
            expect(typeof mod.route).toBe('string');
            expect(typeof mod.component).toBe('function');
        }
    });

    test('observability is the first discovered module and therefore the default landing route (AC Scenario 1)', () => {
        const discovered = discoverModules();
        expect(discovered.length).toBeGreaterThan(0);
        expect(discovered[0]?.id).toBe('observability');
        expect(discovered[0]?.order).toBe(0);
    });
});
