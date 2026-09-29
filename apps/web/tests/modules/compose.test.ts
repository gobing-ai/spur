import { afterAll, describe, expect, it } from 'bun:test';
import type { BoardCatalog } from '@gobing-ai/spur-contracts';
import { composeBoardModules, NATIVE_MODULE_LOAD_TIMEOUT_MS } from '../../src/modules/compose';
import type { WebModule } from '../../src/modules/types';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

/**
 * Composition tests for the Board render slice (task 0990, R1–R3).
 *
 * The loader seams (`importEntry`, `loadStyle`, `loadTimeoutMs`) are injected where a test targets a
 * branch; the two default loaders (real dynamic import, real `<link>` stylesheet) are exercised by
 * the last block so the shipped path — not just the seam — is covered.
 */

registerHappyDom();

afterAll(teardownHappyDom);

function builtin(id: string): WebModule {
    return { id, name: id, icon: '•', route: id, component: () => null };
}

const BUILTINS = [builtin('tasks'), builtin('projects')];

function catalog(overrides: Partial<BoardCatalog> = {}): BoardCatalog {
    return {
        catalogVersion: 1,
        host: {
            manifestVersion: 1,
            contributionApiVersion: 1,
            reactVersion: '19.0.0',
            reactDomVersion: '19.0.0',
            reactRouterVersion: '7.0.0',
            imports: { react: '/_astro/board-facade-react.js' },
            reservedModules: [],
        },
        modules: [],
        ...overrides,
    };
}

function reactDescriptor(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        name: id,
        icon: '◆',
        type: 'react' as const,
        route: `/modules/${id}`,
        entryUrl: `/_astro/modules/${id}/entry.js`,
        styles: [] as string[],
        ...overrides,
    };
}

describe('composeBoardModules', () => {
    it('keeps built-ins and reports a catalog diagnostic when the catalog is unavailable', async () => {
        const composed = await composeBoardModules(null, BUILTINS);

        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects']);
        expect(composed.hostDiagnostics).toEqual([
            { moduleId: 'catalog', category: 'catalog', message: 'the project module catalog could not be read' },
        ]);
    });

    it('keeps built-ins when no Board web distribution is installed', async () => {
        const composed = await composeBoardModules(catalog({ host: null }), BUILTINS);

        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects']);
        expect(composed.hostDiagnostics[0]?.category).toBe('unsupported');
    });

    it('appends a resolved downstream module after the built-ins', async () => {
        const component = () => null;
        const composed = await composeBoardModules(catalog({ modules: [reactDescriptor('docs')] }), BUILTINS, {
            importEntry: async () => ({ webModule: { apiVersion: 1, component } }),
        });

        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects', 'docs']);
        const docs = composed.modules[2];
        expect(docs?.component).toBe(component);
        expect(docs?.contributionType).toBe('react');
        expect(docs?.route).toBe('modules/docs');
        expect(composed.hostDiagnostics).toEqual([]);
    });

    it('applies explicit styles before evaluating the entry', async () => {
        const order: string[] = [];
        await composeBoardModules(
            catalog({ modules: [reactDescriptor('docs', { styles: ['/_astro/modules/docs/a.css'] })] }),
            BUILTINS,
            {
                loadStyle: async (url) => {
                    order.push(`style:${url}`);
                },
                importEntry: async () => {
                    order.push('import');
                    return { webModule: { apiVersion: 1, component: () => null } };
                },
            },
        );

        expect(order).toEqual(['style:/_astro/modules/docs/a.css', 'import']);
    });

    it('routes an unsupported apiVersion to a diagnostic entry instead of throwing', async () => {
        const composed = await composeBoardModules(catalog({ modules: [reactDescriptor('docs')] }), BUILTINS, {
            importEntry: async () => ({ webModule: { apiVersion: 2, component: () => null } }),
        });

        const docs = composed.modules.find((m) => m.id === 'docs');
        expect(docs?.route).toBe('modules/docs');
        expect(docs?.contributionType).toBe('react');
        expect(docs?.component).not.toBeUndefined();
    });

    it('contains one failing module without rejecting the batch', async () => {
        const composed = await composeBoardModules(
            catalog({ modules: [reactDescriptor('broken'), reactDescriptor('ok')] }),
            BUILTINS,
            {
                importEntry: async (url) => {
                    if (url.includes('broken')) throw new Error('boom');
                    return { webModule: { apiVersion: 1, component: () => null } };
                },
            },
        );

        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects', 'broken', 'ok']);
        expect(composed.hostDiagnostics).toEqual([]);
    });

    it('discards a stalled import at the bound and keeps built-ins', async () => {
        const composed = await composeBoardModules(catalog({ modules: [reactDescriptor('slow')] }), BUILTINS, {
            loadTimeoutMs: 5,
            importEntry: () => new Promise(() => {}),
        });

        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects', 'slow']);
        expect(NATIVE_MODULE_LOAD_TIMEOUT_MS).toBe(10_000);
    });

    it('orders downstream entries by configured order then id', async () => {
        const composed = await composeBoardModules(
            catalog({
                modules: [
                    reactDescriptor('beta', { order: 2 }),
                    reactDescriptor('gamma', { order: 1 }),
                    reactDescriptor('alpha', { order: 2 }),
                ],
            }),
            BUILTINS,
            { importEntry: async () => ({ webModule: { apiVersion: 1, component: () => null } }) },
        );

        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects', 'gamma', 'alpha', 'beta']);
    });

    it('does not render iframe descriptors through a native bridge', async () => {
        const composed = await composeBoardModules(
            catalog({
                modules: [
                    {
                        id: 'frame',
                        name: 'frame',
                        icon: '▢',
                        type: 'iframe',
                        route: '/modules/frame',
                        url: '/modules/frame/index.html',
                    },
                ],
            }),
            BUILTINS,
            {
                importEntry: async () => {
                    throw new Error('an iframe descriptor must not be imported');
                },
            },
        );

        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects', 'frame']);
        expect(composed.modules[2]?.contributionType).toBe('iframe');
    });

    it('reports a style failure without evaluating the entry', async () => {
        let imported = false;
        const composed = await composeBoardModules(
            catalog({ modules: [reactDescriptor('styled', { styles: ['/_astro/modules/styled/a.css'] })] }),
            BUILTINS,
            {
                loadStyle: async () => {
                    throw new Error('stylesheet failed to load');
                },
                importEntry: async () => {
                    imported = true;
                    return { webModule: { apiVersion: 1, component: () => null } };
                },
            },
        );

        expect(imported).toBe(false);
        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects', 'styled']);
    });

    it('reports a missing webModule export as an export diagnostic entry', async () => {
        const composed = await composeBoardModules(catalog({ modules: [reactDescriptor('bare')] }), BUILTINS, {
            importEntry: async () => ({}),
        });

        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects', 'bare']);
    });

    it('carries the optional right panel through to the entry', async () => {
        const rightPanelComponent = () => null;
        const composed = await composeBoardModules(catalog({ modules: [reactDescriptor('paneled')] }), BUILTINS, {
            importEntry: async () => ({ webModule: { apiVersion: 1, component: () => null, rightPanelComponent } }),
        });

        expect(composed.modules[2]?.rightPanelComponent).toBe(rightPanelComponent);
    });

    it('keeps an unreadable catalog navigable with built-ins only', async () => {
        const composed = await composeBoardModules(catalog({ host: null, modules: [] }), BUILTINS);

        expect(composed.modules.every((m) => m.contributionType === undefined)).toBe(true);
    });
});

/** The shipped loaders: a real dynamic ESM import, and a real `<link>` stylesheet in the DOM. */
describe('default loaders', () => {
    const NATIVE_IMPORT = { importEntry: async () => ({ webModule: { apiVersion: 1, component: () => null } }) };

    it('reports a failed default dynamic import as an actionable entry', async () => {
        const composed = await composeBoardModules(
            catalog({ modules: [reactDescriptor('missing', { entryUrl: '/__no_such_entry__.js' })] }),
            BUILTINS,
        );

        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects', 'missing']);
        expect(composed.hostDiagnostics).toEqual([]);
    });

    it('applies a stylesheet through the default loader before the entry is displayed', async () => {
        const pending = composeBoardModules(
            catalog({ modules: [reactDescriptor('css', { styles: ['/assets/board/css.css'] })] }),
            BUILTINS,
            NATIVE_IMPORT,
        );

        const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href="/assets/board/css.css"]');
        expect(link).not.toBeNull();
        link?.dispatchEvent(new Event('load'));

        const composed = await pending;
        expect(composed.modules[2]?.contributionType).toBe('react');
    });

    it('bounds a stylesheet that never loads', async () => {
        const composed = await composeBoardModules(
            catalog({ modules: [reactDescriptor('bad-css', { styles: ['/assets/board/bad.css'] })] }),
            BUILTINS,
            { loadTimeoutMs: 20, importEntry: async () => ({}) },
        );

        expect(composed.modules.map((m) => m.id)).toEqual(['tasks', 'projects', 'bad-css']);
    });

    it('reuses an already-applied stylesheet instead of appending a second link', async () => {
        const url = '/assets/board/reused.css';
        const first = composeBoardModules(
            catalog({ modules: [reactDescriptor('first-css', { styles: [url] })] }),
            BUILTINS,
            NATIVE_IMPORT,
        );
        document
            .querySelector<HTMLLinkElement>(`link[rel="stylesheet"][href="${url}"]`)
            ?.dispatchEvent(new Event('load'));
        await first;

        const second = composeBoardModules(
            catalog({ modules: [reactDescriptor('second-css', { styles: [url] })] }),
            BUILTINS,
            NATIVE_IMPORT,
        );
        await second;

        expect(document.querySelectorAll(`link[rel="stylesheet"][href="${url}"]`).length).toBe(1);
    });
});
