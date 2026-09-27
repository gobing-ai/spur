/**
 * Section-Status-Matrix loader — the SOLE section authority for task creation,
 * checks, and the guarded transition gate (F92 R1, task 0966 R4).
 *
 * Historically this resolution was duplicated: the CLI kept its own cached
 * `loadSectionMatrix` / `loadSectionMatrixUncached` (validating) and the server
 * kept `loadServerSectionMatrix` (not validating). Same two-tier contract, two
 * copies, two validation policies. This module is the one owner.
 *
 * Resolution order:
 *   1. `.spur/tasks/section-matrix.yaml` (project-local, seeded by `spur init`)
 *   2. bundled / packaged `tasks/section-matrix.yaml` (data copied/generated from
 *      the canonical build-time matrix asset under the repo `config` `tasks` tree)
 *
 * Fails loudly with the attempted paths when neither asset is reachable — there
 * is NO hand-maintained permissive built-in (one would make the same task
 * validate/render differently by installation layout).
 *
 * `embeddedSchemas` is optional and caller-supplied: the CLI hands in its
 * compiled binary's embedded schema map (so a `bun build --compile` standalone
 * validates identically to a dev tree), the server passes nothing and keeps its
 * unvalidated load (its matrix is a build-time generated asset, not operator
 * input).
 */
import { join } from 'node:path';
import { bundledConfigRoot, loadStructuredSpurConfig } from '@gobing-ai/spur-config/loader';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { SectionMatrix } from './task-check';

/**
 * Optional loader knobs. Both default to the caller's existing policy: no schema
 * validation (server) and the package's bundled-config walk.
 */
export interface LoadSectionMatrixOptions {
    /**
     * Schema text keyed by `schemas/<name>.schema.json` subpath. When present the
     * document is validated against its `$schema` declaration; when absent the
     * load stays unvalidated (the caller's existing policy).
     */
    embeddedSchemas?: ReadonlyMap<string, string>;
    /**
     * Bundled-config root resolver; defaults to `bundledConfigRoot()` (this package's
     * upward walk). `() => null` selects the no-bundled-tree layout — what a
     * `bun build --compile` binary runs as, and the only way to exercise the
     * fail-loudly branch from a test.
     */
    bundledRoot?: () => string | null;
}

/**
 * In-process cache. The key carries the validation mode as well as the root so a
 * raw (server) load and a validated (CLI) load of the same root never share an
 * entry — a mixed process would otherwise get one caller's policy.
 */
const cache = new Map<string, Promise<SectionMatrix>>();

/**
 * Load the Section-Status-Matrix for `projectRoot`, or throw naming every path
 * that was tried. Cached per (root, validation mode); rejected promises are
 * evicted so a later call retries instead of replaying the failure.
 *
 * Deliberately not `async`: an `async` wrapper would return a fresh promise on
 * every call, so two callers racing the same root would each hold a different
 * promise for the same in-flight load. Returning the cached promise keeps the
 * in-flight load genuinely shared.
 */
export function loadSectionMatrix(projectRoot: string, options: LoadSectionMatrixOptions = {}): Promise<SectionMatrix> {
    const key = `${options.embeddedSchemas === undefined ? 'raw' : 'validated'}:${projectRoot}`;
    // A custom bundled-root resolver is a test/exotic-layout seam: caching by project
    // root alone would let one resolver's result answer another's call.
    if (options.bundledRoot !== undefined) return loadSectionMatrixUncached(projectRoot, options);

    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const promise = loadSectionMatrixUncached(projectRoot, options);
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
    return promise;
}

async function loadSectionMatrixUncached(
    projectRoot: string,
    options: LoadSectionMatrixOptions,
): Promise<SectionMatrix> {
    const fs = createNodeFileSystem(projectRoot);
    const read = async (path: string): Promise<SectionMatrix> => {
        const data = await loadStructuredSpurConfig(path, {
            validateJsonSchema: options.embeddedSchemas !== undefined,
            ...(options.embeddedSchemas !== undefined ? { embeddedSchemas: options.embeddedSchemas } : {}),
        });
        // SAFETY: when `embeddedSchemas` was supplied the document was validated
        // against the section-matrix JSON schema, so the parsed shape satisfies
        // SectionMatrix; when it was not, the path pins the document shape by
        // contract (`.spur/tasks/section-matrix.yaml` / the bundled canonical
        // `tasks/section-matrix.yaml` are a SectionMatrix by generation).
        return data as unknown as SectionMatrix;
    };

    // 1. Project-local: .spur/tasks/section-matrix.yaml
    const localPath = fs.resolve('.spur', 'tasks', 'section-matrix.yaml');
    if (await fs.exists(localPath)) return read(localPath);

    // 2. Bundled / packaged fallback: tasks/section-matrix.yaml
    const root = (options.bundledRoot ?? bundledConfigRoot)();
    if (root !== null) {
        const matrixPath = join(root, 'tasks', 'section-matrix.yaml');
        if (await fs.exists(matrixPath)) return read(matrixPath);
    }

    // No hand-maintained fallback (F92 R1): the matrix is the sole section
    // authority. A permissive built-in here would make the same task validate /
    // render differently by installation layout. Fail loudly with the paths tried.
    throw new Error(
        `no canonical section-matrix found for task section authority (F92 R1); tried:\n` +
            `  - ${localPath}\n` +
            (root !== null ? `  - ${join(root, 'tasks', 'section-matrix.yaml')}\n` : '') +
            'copy/generate section-matrix.yaml from the canonical build-time matrix asset (repo `config` `tasks` tree) into one of those paths',
    );
}
