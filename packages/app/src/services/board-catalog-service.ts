import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
    BOARD_MODULE_ROUTE_PREFIX,
    BoardModuleConfigError,
    type BoardModuleDeclaration,
    boardModuleRoute,
    type SpurConfig,
} from '@gobing-ai/spur-config';
import type { BoardCatalog, BoardHostRuntime, BoardModuleDescriptor } from '@gobing-ai/spur-contracts';

// ─── Project Board module catalog preparation (task 0989 R3/R4/R6) ───
//
// One deliverable owns the whole path from a loaded config to what the server serves: the
// public catalog DTO and the contained asset trees behind it. Nothing here evaluates
// downstream code — an enabled react module is a directory of built assets, and a disabled
// one is skipped before any IO so it can neither require files nor run (R3/AC2).

/**
 * One enabled react module's resolved asset tree.
 *
 * Server-only state: the roots never reach the catalog DTO (R4), they are what the request
 * handler confines itself to (R5). `root` is the declaration's directory resolved against
 * the project root; every other path is already proven to stay inside it.
 */
export interface BoardModuleAssetRoot {
    readonly id: string;
    readonly route: string;
    /** Absolute project-root-anchored directory the handler may serve from. */
    readonly root: string;
    /** Absolute entry asset inside {@link root}. */
    readonly entryPath: string;
    /** Absolute stylesheets inside {@link root}, in declaration order. */
    readonly stylePaths: readonly string[];
}

/**
 * The module snapshot one server owns for its whole lifetime (R6/AC5).
 *
 * Built once before `Bun.serve`; `catalog` answers the read-only procedure and `roots` backs
 * the asset handlers. A declaration edit on disk is therefore invisible until restart —
 * there is no live route insertion because there is no re-read.
 */
export interface PreparedBoardModules {
    readonly catalog: BoardCatalog;
    readonly roots: readonly BoardModuleAssetRoot[];
}

/** IO the preparation needs — injected so the whole slice is testable without a filesystem. */
export interface BoardModuleFileProbe {
    /** Whether an absolute path exists and is a file. */
    readonly isFile: (absolutePath: string) => Promise<boolean>;
    /** Whether an absolute path exists and is a directory. */
    readonly isDirectory: (absolutePath: string) => Promise<boolean>;
    /**
     * Symlink-resolved absolute path, or `undefined` when the backend has no such operation
     * (Cloudflare stubs). Callers treat `undefined` as "cannot verify", exactly like the
     * extension loader's optional containment check (ADR-022).
     */
    readonly realPath: (absolutePath: string) => string | undefined;
}

/**
 * The declared modules of a loaded config, in declaration order.
 *
 * The schema already resolved `enabled`/`styles` defaults, so callers never re-default here
 * (one source of the default: `packages/config/src/board-modules.ts`).
 */
export function declaredBoardModules(
    config: Pick<SpurConfig, 'bootstrap'> | null | undefined,
): readonly BoardModuleDeclaration[] {
    return config?.bootstrap?.modules ?? [];
}

/** Contribution/materialized-runtime protocol this host can render — the 0988 frozen v1 surface. */
export const SUPPORTED_BOARD_MANIFEST_VERSION = 1;

/** Contribution API version this host accepts (matches `BoardModuleContribution['apiVersion']`). */
export const SUPPORTED_BOARD_CONTRIBUTION_API_VERSION = 1;

/**
 * Resolve one declared react asset path inside its module directory.
 *
 * Rejects absolute paths and any path that escapes the directory after normalization, so a
 * declaration cannot name a file outside its own tree (R3). Pure string math: the symlink
 * half of containment is checked at request time against the real paths (R5).
 */
function resolveContained(
    index: number,
    projectRoot: string,
    moduleDirectory: string,
    declaredPath: string,
    id: string,
): string {
    if (isAbsolute(declaredPath)) {
        throw new BoardModuleConfigError(index, id, `"${declaredPath}" must be relative to the module directory`);
    }
    const root = resolve(projectRoot, moduleDirectory);
    const target = resolve(root, declaredPath);
    const rel = relative(root, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
        throw new BoardModuleConfigError(
            index,
            id,
            `"${declaredPath}" escapes the module directory "${moduleDirectory}"`,
        );
    }
    return target;
}

/** Whether an absolute path stays inside an absolute root (shared by prepare + request time). */
export function isInsideRoot(root: string, target: string): boolean {
    const rel = relative(root, target);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Resolve, verify and publish the declared modules for one server (R3/R4/R6).
 *
 * Enabled react modules are resolved against `projectRoot` and must exist as files before
 * this resolves — the caller runs it before `Bun.serve`, so a missing asset fails startup
 * instead of serving a half-broken board (AC1). Disabled declarations are dropped before any
 * IO. The returned catalog is frozen: one object per server, restart-only reload (AC5).
 *
 * @throws BoardModuleConfigError naming the module id and reason for any unusable declaration
 */
export async function prepareBoardModules(input: {
    readonly projectRoot: string;
    readonly declarations: readonly BoardModuleDeclaration[];
    readonly host: BoardHostRuntime | null;
    readonly probe: BoardModuleFileProbe;
}): Promise<PreparedBoardModules> {
    const descriptors: BoardModuleDescriptor[] = [];
    const roots: BoardModuleAssetRoot[] = [];
    const enabled = input.declarations.filter((declaration) => declaration.enabled);

    // R6: contributions without a renderer that speaks their contract are a configuration
    // error, not an empty board — the reserved inventory and the API version are read from the
    // selected distribution, so there is nothing to serve them with and nothing to guess.
    if (enabled.length > 0) {
        const firstIndex = input.declarations.findIndex((declaration) => declaration.enabled);
        const first = enabled[0];
        if (!input.host) {
            throw new BoardModuleConfigError(
                firstIndex,
                first?.id ?? '',
                'no Board distribution is installed — this server has no renderer for a project module',
            );
        }
        if (
            input.host.manifestVersion !== SUPPORTED_BOARD_MANIFEST_VERSION ||
            input.host.contributionApiVersion !== SUPPORTED_BOARD_CONTRIBUTION_API_VERSION
        ) {
            throw new BoardModuleConfigError(
                firstIndex,
                first?.id ?? '',
                `the installed Board distribution speaks manifest v${input.host.manifestVersion} / contribution api v${input.host.contributionApiVersion}, this host expects v${SUPPORTED_BOARD_MANIFEST_VERSION} / v${SUPPORTED_BOARD_CONTRIBUTION_API_VERSION}`,
            );
        }
    }

    // Resolved lazily: a config with no enabled native module asks the backend for nothing.
    let realProjectRoot: string | undefined;
    const projectRootRealPath = (): string => {
        realProjectRoot ??= input.probe.realPath(input.projectRoot) ?? input.projectRoot;
        return realProjectRoot;
    };

    for (const [index, declaration] of input.declarations.entries()) {
        if (!declaration.enabled) continue;

        const route = boardModuleRoute(declaration.id);
        if (declaration.type === 'iframe') {
            descriptors.push({ ...descriptorBase(declaration), type: 'iframe', route, url: declaration.url });
            continue;
        }

        const root = resolve(input.projectRoot, declaration.directory);
        const entryPath = resolveContained(
            index,
            input.projectRoot,
            declaration.directory,
            declaration.entry,
            declaration.id,
        );
        const stylePaths = declaration.styles.map((style) =>
            resolveContained(index, input.projectRoot, declaration.directory, style, declaration.id),
        );

        if (!(await input.probe.isDirectory(root))) {
            throw new BoardModuleConfigError(
                index,
                declaration.id,
                `module directory "${declaration.directory}" was not found`,
            );
        }
        if (!(await input.probe.isFile(entryPath))) {
            throw new BoardModuleConfigError(
                index,
                declaration.id,
                `entry asset "${declaration.entry}" was not found in "${declaration.directory}"`,
            );
        }
        for (const [styleIndex, stylePath] of stylePaths.entries()) {
            if (!(await input.probe.isFile(stylePath))) {
                throw new BoardModuleConfigError(
                    index,
                    declaration.id,
                    `style asset "${declaration.styles[styleIndex]}" was not found`,
                );
            }
        }

        // R3: containment is proven on the REAL paths before the server listens, so a
        // symlinked entry cannot be the difference between startup and request-time failure.
        const realRoot = input.probe.realPath(root);
        const realEntry = input.probe.realPath(entryPath);
        if (
            realRoot !== undefined &&
            realEntry !== undefined &&
            (!isInsideRoot(projectRootRealPath(), realRoot) || !isInsideRoot(realRoot, realEntry))
        ) {
            throw new BoardModuleConfigError(
                index,
                declaration.id,
                `"${declaration.directory}" resolves outside the project root or its entry resolves outside the module directory`,
            );
        }

        descriptors.push({
            ...descriptorBase(declaration),
            type: 'react',
            route,
            entryUrl: assetUrl(declaration.id, root, entryPath),
            styles: stylePaths.map((stylePath) => assetUrl(declaration.id, root, stylePath)),
        });
        roots.push(
            Object.freeze({ id: declaration.id, route, root, entryPath, stylePaths: Object.freeze(stylePaths) }),
        );
    }

    return Object.freeze({
        catalog: Object.freeze({ catalogVersion: 1 as const, host: input.host, modules: descriptors }),
        roots: Object.freeze(roots),
    });
}

/** Public asset URL for one contained file: the module's mount plus the path inside its root. */
function assetUrl(id: string, root: string, absolutePath: string): string {
    const inside = relative(root, absolutePath).split(sep).join('/');
    return `${BOARD_MODULE_ROUTE_PREFIX}${id}/${inside}`;
}

/** Contract-level fields every descriptor carries, regardless of module type. */
function descriptorBase(declaration: BoardModuleDeclaration) {
    return {
        id: declaration.id,
        name: declaration.name,
        icon: declaration.icon,
        sidebarLabel: declaration.sidebarLabel,
        description: declaration.description,
        order: declaration.order,
    };
}
