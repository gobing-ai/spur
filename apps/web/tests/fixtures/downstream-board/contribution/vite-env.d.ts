/// <reference types="vite/client" />

/**
 * Vite's client types cover `*.svg`; this fixture imports the asset with the `?no-inline` query
 * because a library build inlines assets by default (vite/src/node/plugins/asset.ts `shouldInline`),
 * and the proof needs a real emitted asset file.
 */
declare module '*.svg?no-inline' {
    const src: string;
    export default src;
}
