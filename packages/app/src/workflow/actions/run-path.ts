import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';

/**
 * Raised when a `.spur/run`-confined artifact or result-file path cannot be proven physically
 * confined beneath the canonical run tree (task 0785 R2). Callers convert it into an actionable
 * `ok: false` action result — never into a degraded lexical-only check.
 */
export class RunArtifactPathError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RunArtifactPathError';
    }
}

/** Strict containment: `child` must be `ancestor` itself or lie beneath it. */
function within(child: string, ancestor: string): boolean {
    return child === ancestor || child.startsWith(`${ancestor}${sep}`);
}

/**
 * Prove an artifact/result path is physically confined beneath `.spur/run/` (task 0785 R2).
 *
 * Preserves the 0781 lexical descent first, then canonicalizes the project workdir and proves the
 * run directory plus every existing target/ancestor remains beneath that canonical boundary. The
 * installed FileSystem contract exposes optional synchronous `realPath`, `stat` (which follows
 * symlinks), and `readDir` — there is no `lstat` or `isSymbolicLink` — so symlink escapes are
 * detected by comparing canonical resolutions against the canonical boundary, and dangling links
 * by a name the parent directory lists while `stat` cannot resolve it. A missing output leaf is
 * fine: the walk ascends to the nearest existing ancestor and reconstructs only the missing
 * segments. Permission errors, unreadable ancestors, and a filesystem without `realPath` fail
 * closed rather than silently skipping confinement.
 *
 * This prevents static symlink escapes; it does not claim protection against a hostile process
 * swapping links concurrently (TOCTOU), and introduces no sandbox.
 */
export async function resolveRunArtifactPath(
    fileSystem: FileSystem,
    workdir: string,
    pathRaw: string,
): Promise<string> {
    if (typeof fileSystem.realPath !== 'function') {
        throw new RunArtifactPathError(
            'physical path confinement requires a FileSystem with realPath support — refusing to skip confinement (0785 R2)',
        );
    }

    // 0781 lexical descent, preserved verbatim: traversal and sibling prefixes are rejected before
    // any filesystem access. The run directory itself is not a valid artifact path.
    const lexicalTarget = normalize(resolve(workdir, pathRaw));
    const lexicalRunRoot = normalize(join(resolve(workdir), '.spur', 'run'));
    if (!lexicalTarget.startsWith(`${lexicalRunRoot}${sep}`)) {
        throw new RunArtifactPathError(`must resolve beneath .spur/run/ (got ${pathRaw})`);
    }

    const workdirAbs = resolve(workdir);
    let canonicalWorkdir: string;
    try {
        canonicalWorkdir = fileSystem.realPath(workdirAbs);
    } catch (error) {
        throw new RunArtifactPathError(`project workdir could not be canonicalized: ${(error as Error).message}`);
    }

    // `.spur/run` may legitimately be a symlink, but only to a directory that stays inside the
    // project workdir — otherwise the boundary itself would be defined outside the project.
    const canonicalRunRootCandidate = join(canonicalWorkdir, '.spur', 'run');
    let canonicalRunRoot = canonicalRunRootCandidate;
    const rootStat = await fileSystem.stat(canonicalRunRootCandidate);
    if (rootStat !== null) {
        try {
            canonicalRunRoot = fileSystem.realPath(canonicalRunRootCandidate);
        } catch (error) {
            throw new RunArtifactPathError(`.spur/run could not be canonicalized: ${(error as Error).message}`);
        }
        if (!within(canonicalRunRoot, canonicalWorkdir)) {
            throw new RunArtifactPathError('.spur/run resolves outside the project workdir through a symlink');
        }
    }

    // Ascend to the nearest existing ancestor, rejecting dangling links along the way: a name the
    // parent directory lists while stat cannot resolve it is a broken symlink, not a missing leaf.
    let probe = lexicalTarget;
    for (;;) {
        const stat = await fileSystem.stat(probe);
        if (stat !== null) break;
        const parent = dirname(probe);
        let listed: string[] | null;
        try {
            listed = await fileSystem.readDir(parent);
        } catch (error) {
            if (String((error as Error).message).includes('ENOENT')) {
                listed = null;
            } else {
                throw new RunArtifactPathError(`ancestor ${parent} is unreadable: ${(error as Error).message}`);
            }
        }
        const base = probe.slice(parent.length + 1);
        if (listed?.includes(base)) {
            throw new RunArtifactPathError(`dangling symlink at ${probe} — refusing artifact path`);
        }
        const parentNorm = normalize(parent);
        if (parentNorm === probe) {
            throw new RunArtifactPathError(`no existing ancestor found for ${pathRaw}`);
        }
        probe = parentNorm;
    }

    let anchor: string;
    try {
        anchor = fileSystem.realPath(probe);
    } catch (error) {
        // stat said the ancestor exists but realPath cannot resolve it — treated as a broken or
        // hostile link, never silently accepted.
        throw new RunArtifactPathError(`ancestor ${probe} could not be canonicalized: ${(error as Error).message}`);
    }
    if (!within(anchor, canonicalWorkdir)) {
        throw new RunArtifactPathError(`ancestor ${probe} escapes the project workdir through a symlink`);
    }

    // Reconstruct the missing leaf segments on the canonical anchor and require the result to sit
    // strictly inside the canonical run tree. Internal symlinks that resolve within the run tree
    // pass; any resolution outside it is rejected before write/dispatch/ledger effects.
    const reconstructed = normalize(join(anchor, relative(probe, lexicalTarget)));
    if (!reconstructed.startsWith(`${canonicalRunRoot}${sep}`)) {
        throw new RunArtifactPathError(`path escapes .spur/run/ through a symlink (got ${pathRaw})`);
    }
    return reconstructed;
}
