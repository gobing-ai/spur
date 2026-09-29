/**
 * Astro build integration for the Board's shared runtime distribution (task 0988 R2/R4).
 *
 * Node-only build tooling, deliberately under `scripts/` rather than `src/`: the browser source
 * tree must not spawn processes or do filesystem IO (constraint rules `no-direct-process-spawn` /
 * `no-direct-fs-io`), and nothing here reaches the client bundle. The pure manifest/import-map
 * helpers it uses live in `src/modules/runtime/manifest.ts`.
 *
 * Three jobs, one build graph:
 *  1. emit one facade chunk per supported bare specifier, resolved from the SAME client
 *     build as the Board renderer (`export * from 'react'` inside that graph), so a module
 *     resolved through the import map gets the renderer's module instance — not a second
 *     copy of React;
 *  2. write `board-runtime.json` at the web distribution root with the measured resolved
 *     versions, the explicit specifier -> facade URL map, and the reserved host inventory
 *     generated from the board's own module declarations;
 *  3. inject `<script type="importmap">` into every built HTML document BEFORE its first
 *     script, because an import map is only honored before the first module load.
 *
 * It carries no test seam: the browser proof injects its adapter contribution into
 * `src/modules/` around its own build (see `tests/test-helpers/board-build.ts`), so a shipped build
 * has no test route or fixture by construction.
 *
 * Run by `astro.config.mjs` in both the dev and the build pipeline. Node loads this file
 * through Astro's config bundler, so relative imports here stay bundler-resolved.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroConfig, AstroIntegration } from 'astro';
import {
    BOARD_FACADE_SPECIFIERS,
    type BoardFacadeSpecifier,
    type BoardReservedModule,
    type BoardRuntimeVersions,
    buildRuntimeManifest,
    facadeChunkName,
    facadeSource,
    injectImportMap,
    renderImportMapScript,
} from '../src/modules/runtime/manifest';

/** Distribution-root file a consumer reads before loading project contributions. */
export const BOARD_RUNTIME_MANIFEST_FILE = 'board-runtime.json';

/** Virtual module id prefix for one facade entry. */
const FACADE_ID_PREFIX = 'spur:board-runtime-facade/';

/**
 * The Vite plugin type Astro itself is typed against.
 *
 * This workspace has no nested `vite` dependency (Vite is reached through Astro's own package
 * graph), so importing `vite` types here would bind to an unrelated ancestor installation and
 * produce confusable-type errors. Astro's config type is the same plugin contract the
 * integration is handed.
 */
type BoardVitePlugin = NonNullable<NonNullable<AstroConfig['vite']>['plugins']>[number];

/** Resolve the installed version of a package reached through the client build graph. */
async function packageVersionFrom(
    resolve: (specifier: string) => Promise<{ id: string } | null>,
    name: string,
): Promise<string> {
    const resolved = await resolve(name);
    if (!resolved) throw new Error(`board-runtime: "${name}" is not resolvable in the client build graph`);
    let dir = dirname(resolved.id);
    for (let depth = 0; depth < 6; depth += 1) {
        const text = await readFile(join(dir, 'package.json'), 'utf-8').catch(() => undefined);
        if (text) {
            const pkg = JSON.parse(text) as { name?: string; version?: string };
            if (pkg.name === name) {
                if (!pkg.version) throw new Error(`board-runtime: ${name} has no version in ${dir}/package.json`);
                return pkg.version;
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error(`board-runtime: could not read the installed version of "${name}" from ${resolved.id}`);
}

/** Which supported specifier a facade chunk belongs to (by emitted chunk name). */
function facadeSpecifierFor(chunkName: string | undefined): BoardFacadeSpecifier | undefined {
    if (!chunkName) return undefined;
    return BOARD_FACADE_SPECIFIERS.find((specifier) => facadeChunkName(specifier) === chunkName);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Export names of the module the client build resolves for a specifier.
 *
 * Measured from the resolved file itself (same package the browser bundle loads), so the facade
 * re-export list is generated rather than hand-maintained.
 */
function exportNamesOf(resolvedId: string): string[] {
    // Rollup ids may carry Vite's optimizer query (`…/react/index.js?v=<hash>`).
    const file = resolvedId.split('?')[0] as string;
    const loaded = createRequire(file)(file) as Record<string, unknown>;
    return Object.keys(loaded).filter((name) => IDENTIFIER.test(name));
}

/** Vite plugin: emit facade entries in the client build and capture their emitted URLs. */
function facadePlugin(
    facades: Map<BoardFacadeSpecifier, string>,
    versions: { value?: BoardRuntimeVersions },
): BoardVitePlugin {
    const isClient = (environment: { name?: string } | undefined): boolean => environment?.name === 'client';
    const sources = new Map<BoardFacadeSpecifier, string>();
    return {
        name: 'spur:board-runtime-facades',
        resolveId(id) {
            return id.startsWith(FACADE_ID_PREFIX) ? `\0${id}` : null;
        },
        load(id) {
            if (!id.startsWith(`\0${FACADE_ID_PREFIX}`)) return null;
            const specifier = id.slice(`\0${FACADE_ID_PREFIX}`.length) as BoardFacadeSpecifier;
            if (!BOARD_FACADE_SPECIFIERS.includes(specifier)) {
                throw new Error(`board-runtime: unsupported facade specifier "${specifier}"`);
            }
            const source = sources.get(specifier);
            if (source === undefined) throw new Error(`board-runtime: facade source for "${specifier}" was not built`);
            return source;
        },
        async buildStart() {
            if (!isClient(this.environment)) return;
            versions.value = {
                react: await packageVersionFrom((spec) => this.resolve(spec), 'react'),
                reactDom: await packageVersionFrom((spec) => this.resolve(spec), 'react-dom'),
                reactRouter: await packageVersionFrom((spec) => this.resolve(spec), 'react-router'),
            };
            for (const specifier of BOARD_FACADE_SPECIFIERS) {
                const resolved = await this.resolve(specifier);
                if (!resolved) throw new Error(`board-runtime: cannot resolve "${specifier}" in the client build`);
                if (resolved.external) throw new Error(`board-runtime: "${specifier}" resolved as external`);
                sources.set(specifier, facadeSource(specifier, exportNamesOf(resolved.id)));
                this.emitFile({
                    type: 'chunk',
                    id: `${FACADE_ID_PREFIX}${specifier}`,
                    name: facadeChunkName(specifier),
                });
            }
        },
        generateBundle(_options, bundle) {
            if (!isClient(this.environment)) return;
            for (const output of Object.values(bundle)) {
                const specifier = facadeSpecifierFor(output.type === 'chunk' ? output.name : undefined);
                if (specifier) facades.set(specifier, output.fileName);
            }
        },
    };
}

/** Same-origin URL for every supported specifier, honoring the configured Astro base. */
function facadeUrls(facades: ReadonlyMap<BoardFacadeSpecifier, string>, base: string): Record<string, string> {
    const prefix = base.endsWith('/') ? base : `${base}/`;
    return Object.fromEntries(
        BOARD_FACADE_SPECIFIERS.map((specifier) => {
            const asset = facades.get(specifier);
            if (!asset) throw new Error(`board-runtime: no facade chunk emitted for "${specifier}"`);
            return [specifier, `${prefix}${asset}`];
        }),
    );
}

/** Reserved host identities, generated from the board's own module + router declarations. */
export function loadHostReservedModules(webRoot: string): BoardReservedModule[] {
    const script = join(webRoot, 'scripts/host-inventory.ts');
    const stdout = execFileSync('bun', [script], { cwd: webRoot, encoding: 'utf-8' });
    return JSON.parse(stdout) as BoardReservedModule[];
}

/** Every built HTML document below the distribution root. */
async function htmlFiles(root: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith('_')) continue;
            found.push(...(await htmlFiles(full)));
        } else if (entry.name.endsWith('.html')) {
            found.push(full);
        }
    }
    return found;
}

/** The Board runtime distribution integration (see `astro.config.mjs`). */
export function boardRuntime(): AstroIntegration {
    const facades = new Map<BoardFacadeSpecifier, string>();
    const versions: { value?: BoardRuntimeVersions } = {};
    let webRoot = process.cwd();
    let base = '/';

    return {
        name: 'spur:board-runtime',
        hooks: {
            'astro:config:setup': async ({ config, updateConfig }) => {
                webRoot = fileURLToPath(config.root);
                base = config.base;
                updateConfig({ vite: { plugins: [facadePlugin(facades, versions)] } });
            },
            'astro:build:done': async ({ dir, logger }) => {
                const outDir = fileURLToPath(dir);
                if (!versions.value) {
                    throw new Error('board-runtime: the client build did not report runtime versions');
                }
                const manifest = buildRuntimeManifest({
                    versions: versions.value,
                    imports: facadeUrls(facades, base),
                    reservedModules: loadHostReservedModules(webRoot),
                });
                await mkdir(outDir, { recursive: true });
                await writeFile(
                    join(outDir, BOARD_RUNTIME_MANIFEST_FILE),
                    `${JSON.stringify(manifest, null, 4)}\n`,
                    'utf-8',
                );

                const script = renderImportMapScript(manifest);
                for (const file of await htmlFiles(outDir)) {
                    const html = await readFile(file, 'utf-8');
                    const injected = injectImportMap(html, script);
                    if (injected !== html) await writeFile(file, injected, 'utf-8');
                }
                logger.info(
                    `${relative(process.cwd(), outDir) || '.'}/${BOARD_RUNTIME_MANIFEST_FILE}: ` +
                        `react ${manifest.reactVersion}, react-dom ${manifest.reactDomVersion}, ` +
                        `react-router ${manifest.reactRouterVersion}, ${manifest.reservedModules.length} reserved identities`,
                );
            },
        },
    };
}

export default boardRuntime;
