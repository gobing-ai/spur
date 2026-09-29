import { describe, expect, test } from 'bun:test';
import {
    BOARD_FACADE_SPECIFIERS,
    type BoardRuntimeManifest,
    buildRuntimeManifest,
    facadeChunkName,
    facadeSource,
    importMapFor,
    injectImportMap,
    renderImportMapScript,
} from '../../../src/modules/runtime/manifest';

/** Manifest fixture: every supported specifier mapped to a distinct asset URL. */
function manifestFixture(overrides: Partial<BoardRuntimeManifest> = {}): BoardRuntimeManifest {
    return {
        ...buildRuntimeManifest({
            versions: { react: '19.2.1', reactDom: '19.2.1', reactRouter: '7.11.0' },
            imports: Object.fromEntries(BOARD_FACADE_SPECIFIERS.map((s) => [s, `/assets/${facadeChunkName(s)}.js`])),
            reservedModules: [{ id: 'tasks', route: 'tasks' }],
        }),
        ...overrides,
    };
}

describe('board runtime manifest (task 0988 R2)', () => {
    test('records the frozen manifest/catalog/contribution versions and measured package versions', () => {
        const manifest = manifestFixture();
        expect(manifest.manifestVersion).toBe(1);
        expect(manifest.catalogVersion).toBe(1);
        expect(manifest.contributionApiVersion).toBe(1);
        expect(manifest.reactVersion).toBe('19.2.1');
        expect(manifest.reactDomVersion).toBe('19.2.1');
        expect(manifest.reactRouterVersion).toBe('7.11.0');
    });

    test('lists every supported specifier explicitly — no wildcard promise', () => {
        const manifest = manifestFixture();
        expect(Object.keys(manifest.imports).sort()).toEqual([...BOARD_FACADE_SPECIFIERS].sort());
        // Minimum contract: React and both JSX runtimes must resolve.
        expect(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'].every((s) => s in manifest.imports)).toBeTrue();
        expect(Object.keys(manifest.imports).some((key) => key.includes('*'))).toBeFalse();
    });

    test('refuses to publish a manifest with a missing facade asset', () => {
        expect(() =>
            buildRuntimeManifest({
                versions: { react: '19.2.1', reactDom: '19.2.1', reactRouter: '7.11.0' },
                imports: { react: '/assets/board-facade-react.js' },
                reservedModules: [],
            }),
        ).toThrow('no facade asset emitted for "react/jsx-runtime"');
    });

    test('facade chunk names are stable and path-safe', () => {
        expect(facadeChunkName('react')).toBe('board-facade-react');
        expect(facadeChunkName('react/jsx-runtime')).toBe('board-facade-react-jsx-runtime');
        expect(facadeChunkName('react-router/dom')).toBe('board-facade-react-router-dom');
    });

    test('facade source re-exports the measured names, never a wildcard', () => {
        const source = facadeSource('react', ['version', 'default', 'useState']);
        expect(source).toContain("import * as ns from 'react';");
        expect(source).toContain('export const useState = ns.useState;');
        expect(source).toContain('export const version = ns.version;');
        expect(source).not.toContain('export *');
        // `default` is emitted once, through the interop-aware line, and is never shadowed by a
        // named `export const default` (which is not valid module syntax anyway).
        expect(source).toContain("export default typeof ns.default === 'undefined' ? ns : ns.default;");
        expect(source.split('\n').filter((line) => line !== '')).toHaveLength(4);
    });

    test('facade source for a specifier without any measured name still yields a valid module', () => {
        expect(facadeSource('react-router', [])).toBe(
            "import * as ns from 'react-router';\nexport default typeof ns.default === 'undefined' ? ns : ns.default;\n",
        );
    });

    test('the import map script carries exactly the manifest imports', () => {
        const manifest = manifestFixture();
        const script = renderImportMapScript(manifest);
        expect(script.startsWith('<script type="importmap">')).toBeTrue();
        const body = script.slice('<script type="importmap">'.length, -'</script>'.length);
        expect(JSON.parse(body)).toEqual(importMapFor(manifest));
    });
});

describe('import map injection (task 0988 R2)', () => {
    const script = '<script type="importmap">{"imports":{"react":"/a.js"}}</script>';

    test('lands immediately after <head>, before the document theme script', () => {
        const html = '<!DOCTYPE html><html><head><script type="module">theme()</script></head><body></body></html>';
        const out = injectImportMap(html, script);
        expect(out.indexOf(script)).toBe(out.indexOf('<head>') + '<head>'.length);
        expect(out.indexOf(script)).toBeLessThan(out.indexOf('<script type="module">'));
    });

    test('honors a head with attributes and other head content', () => {
        const html = '<html><head lang="en"><meta charset="utf-8"><title>x</title></head><body></body></html>';
        const out = injectImportMap(html, script);
        expect(out).toBe(
            `<html><head lang="en">${script}<meta charset="utf-8"><title>x</title></head><body></body></html>`,
        );
    });

    test('falls back to the first script when the document has no head', () => {
        const html =
            '<body><script type="module" src="/_astro/App.js"></script>' +
            '<astro-island component-url="/_astro/App.js"></astro-island></body>';
        const out = injectImportMap(html, script);
        expect(out.indexOf(script)).toBe('<body>'.length);
        expect(out.indexOf(script)).toBeLessThan(out.indexOf('<script type="module"'));
    });

    test('falls back to the front of a scriptless document', () => {
        expect(injectImportMap('<p>hello</p>', script)).toBe(`${script}<p>hello</p>`);
    });

    test('is idempotent — an existing import map is not duplicated', () => {
        const html = `<html><head>${script}</head><body></body></html>`;
        expect(injectImportMap(html, script)).toBe(html);
    });
});
