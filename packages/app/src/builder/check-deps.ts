/**
 * Dependency health checks (A94 1412 predecessor — the `spur builder check-deps` verb).
 *
 * Two failure modes that look like code bugs, merged into one scoped check:
 *
 *  1. **A `bun link`ed package serving a stale `dist/`.** A linked package resolves through its
 *     `exports` entry (`dist/index.js`), never `src/`; editing its source changes nothing on this
 *     side until it rebuilds. That failure is silent and cost ~77 minutes in the task 0466 session
 *     before anyone suspected the build rather than the code. A `"prepare"` hook does not close it:
 *     bun fires lifecycle scripts only for git/github/root/workspace resolutions, never for a
 *     `bun link` symlink.
 *  2. **A lockfile resolution that disagrees with what is installed.** The tree then runs a version
 *     nobody resolved, and `bun install` is the fix.
 *
 * Both checks are scoped by a glob list (`builder.dependencyScope`), so a downstream project names
 * its own packages instead of inheriting `@gobing-ai/*`. An empty scope skips both.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** One finding, shaped for the `--json` envelope. */
export interface CheckDepsFinding {
    kind: 'stale-link' | 'drift';
    package: string;
    detail: string;
}

/** Newest file under `root` matching `ext`. */
interface Newest {
    rel: string;
    mtimeMs: number;
}

/** A linked package whose build output lags its sources. */
export interface StaleLink {
    pkg: string;
    realPath: string;
    src: Newest;
    dist: Newest | null;
}

/** A lockfile resolution that disagrees with the installed package. */
export interface DependencyDrift {
    readonly name: string;
    readonly locked: string;
    readonly installed: string | null;
}

/** Options for {@link checkDeps}. */
export interface CheckDepsOptions {
    cwd?: string;
    /** Glob list; empty skips both checks. */
    scope: readonly string[];
    lockfilePath?: string;
    nodeModulesDir?: string;
}

/** Whether `name` matches any scope glob. */
export function inScope(name: string, scope: readonly string[]): boolean {
    for (const pattern of scope) {
        if (new Bun.Glob(pattern).match(name)) return true;
    }
    return false;
}

/** True when the package's `exports`/`main` points into `dist/`. */
function exportsDist(value: unknown): boolean {
    if (typeof value === 'string') return /^\.\/dist(?:\/|$)/.test(value);
    if (Array.isArray(value)) return value.some(exportsDist);
    if (value && typeof value === 'object') {
        return Object.entries(value).some(([key, target]) => key !== 'types' && exportsDist(target));
    }
    return false;
}

/** Newest file with `ext` under `root`, or null. */
function newestFile(root: string, ext: string): Newest | null {
    if (!existsSync(root)) return null;
    let newest: Newest | null = null;
    for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
        const rel = entry.replaceAll('\\', '/');
        if (!rel.endsWith(ext)) continue;
        const full = join(root, rel);
        let stats: ReturnType<typeof statSync>;
        try {
            stats = statSync(full);
        } catch {
            continue; // broken symlink inside the tree — not our concern
        }
        if (!stats.isFile()) continue;
        if (!newest || stats.mtimeMs > newest.mtimeMs) newest = { rel, mtimeMs: stats.mtimeMs };
    }
    return newest;
}

/** Candidate install roots a symbolically linked scope entry can hide under. */
function scopeDirs(nodeModulesDir: string, scope: readonly string[]): string[] {
    const dirs = new Set<string>();
    for (const pattern of scope) {
        // `@scope/*` → `node_modules/@scope`; a bare glob scans node_modules itself.
        const scopeRoot = pattern.startsWith('@') ? pattern.split('/')[0] : '';
        dirs.add(scopeRoot ? join(nodeModulesDir, scopeRoot) : nodeModulesDir);
    }
    return [...dirs];
}

/**
 * Inspect symlinked entries matching `scope` under the project's node_modules and return the ones
 * whose newest build input is newer than their newest output.
 */
export function findStaleLinks(cwd: string, scope: readonly string[]): StaleLink[] {
    if (scope.length === 0) return [];
    const nodeModulesDir = join(cwd, 'node_modules');
    if (!existsSync(nodeModulesDir)) return [];
    // Resolved so a symlinked repo root still compares equal against realpaths.
    const localModules = `${realpathSync(nodeModulesDir)}/`;

    const stale: StaleLink[] = [];
    for (const scopeDir of scopeDirs(nodeModulesDir, scope)) {
        if (!existsSync(scopeDir)) continue;
        for (const name of readdirSync(scopeDir)) {
            const pkgName = scopeDir === nodeModulesDir ? name : `${scopeDir.slice(nodeModulesDir.length + 1)}/${name}`;
            if (!inScope(pkgName, scope)) continue;
            const entry = join(scopeDir, name);
            let realPath: string;
            try {
                if (!lstatSync(entry).isSymbolicLink()) continue;
                realPath = realpathSync(entry);
            } catch {
                continue; // dangling link — `bun install` will surface it
            }
            // Inside our own node_modules => a bun store copy, not a `bun link`.
            if (realPath.startsWith(localModules)) continue;
            const packageFile = join(realPath, 'package.json');
            if (existsSync(packageFile)) {
                const manifest = JSON.parse(readFileSync(packageFile, 'utf8')) as { exports?: unknown; main?: string };
                const entrypoints = manifest.exports ?? manifest.main;
                // Source-exporting workspaces and metadata-only exports do not consume dist/.
                if (entrypoints !== undefined && !exportsDist(entrypoints)) continue;
            }
            const srcDir = join(realPath, 'src');
            if (!existsSync(srcDir)) continue;

            const src = newestFile(srcDir, '.ts');
            if (!src) continue;
            const dist = newestFile(join(realPath, 'dist'), '.js');
            // Fresh: a build output exists and is at least as new as every input.
            if (dist && dist.mtimeMs >= src.mtimeMs) continue;
            stale.push({ pkg: pkgName, realPath, src, dist });
        }
    }
    return stale;
}

/**
 * Whether a bun.lock key belongs to `scope`: the package it names matches, or the resolution's
 * parent does (`@gobing-ai/ts-db/zod` is ts-db's nested copy of zod, so the parent decides).
 */
export function lockKeyInScope(lockKey: string, scope: readonly string[]): boolean {
    if (inScope(lockKeyPackageName(lockKey), scope)) return true;
    const parentKey = lockKey.slice(0, lockKey.length - lockKeyPackageName(lockKey).length - 1);
    return parentKey !== '' && inScope(parentKey, scope);
}

/** Parse `bun.lock` and return the locked version for every key matching `scope`. */
export function readLockedDependencies(lockfilePath: string, scope: readonly string[]): Map<string, string> {
    const content = readFileSync(lockfilePath, 'utf8');
    const cleaned = content.replace(/,(\s*[\]}])/g, '$1');
    const parsed = JSON.parse(cleaned) as { packages?: Record<string, unknown[]> };
    const result = new Map<string, string>();
    for (const [key, val] of Object.entries(parsed.packages ?? {})) {
        if (!lockKeyInScope(key, scope)) continue;
        const spec = val?.[0];
        if (typeof spec !== 'string') continue;
        const atIdx = spec.lastIndexOf('@');
        const version = atIdx >= 0 ? spec.slice(atIdx + 1) : spec;
        // `workspace:`/`link:` resolutions are this tree's own packages, not installed versions.
        if (version.startsWith('workspace:') || version.startsWith('link:')) continue;
        result.set(key, version);
    }
    return result;
}

/**
 * Resolve the package name a bun.lock key refers to. Keys are `<name>` or `<parent>/<name>`, where
 * segments are `@scope/pkg` or `pkg`.
 */
export function lockKeyPackageName(lockKey: string): string {
    const segs = lockKey.split('/');
    const last = segs[segs.length - 1] ?? lockKey;
    const scope = segs[segs.length - 2];
    return scope?.startsWith('@') ? `${scope}/${last}` : last;
}

/**
 * Locate the installed `package.json` for a bun.lock key: the nested resolution first, then the
 * hoisted copy, then bun's store dir (a transitive-only package has no visible node_modules entry).
 */
function findInstalledPkgJsonPath(nodeModulesDir: string, lockKey: string, lockedVersion: string): string | null {
    const name = lockKeyPackageName(lockKey);
    const parentKey = lockKey === name ? null : lockKey.slice(0, lockKey.length - name.length - 1);
    if (parentKey) {
        const nested = join(nodeModulesDir, parentKey, 'node_modules', name, 'package.json');
        if (existsSync(nested)) return nested;
    } else {
        const hoisted = join(nodeModulesDir, name, 'package.json');
        if (existsSync(hoisted)) return hoisted;
    }
    const storeDir = join(nodeModulesDir, '.bun');
    if (!existsSync(storeDir)) return null;
    // Store dirs are `<name>@<ver>` or `<name>@<ver>+<peer-hash>`.
    const base = `${name.replace('/', '+')}@${lockedVersion}`;
    for (const entry of readdirSync(storeDir)) {
        if (entry !== base && !entry.startsWith(`${base}+`)) continue;
        const storePath = join(storeDir, entry, 'node_modules', name, 'package.json');
        if (existsSync(storePath)) return storePath;
    }
    return null;
}

/** Every installed occurrence of a package name, so a nested resolution cannot hide a drift. */
function installedVersions(nodeModulesDir: string, lockKey: string, lockedVersion: string): string | null {
    const pkgJsonPath = findInstalledPkgJsonPath(nodeModulesDir, lockKey, lockedVersion);
    if (pkgJsonPath === null) return null;
    try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version?: string };
        return pkg.version ?? null;
    } catch {
        return null;
    }
}

/** Compare every in-scope lockfile resolution against the installed package. */
export function checkDependencyDrift(options: CheckDepsOptions): DependencyDrift[] {
    const cwd = options.cwd ?? process.cwd();
    if (options.scope.length === 0) return [];
    const lockfilePath = options.lockfilePath ?? join(cwd, 'bun.lock');
    if (!existsSync(lockfilePath)) {
        throw new Error(`check-deps: cannot read ${lockfilePath} for the configured dependencyScope`);
    }
    const nodeModulesDir = options.nodeModulesDir ?? join(cwd, 'node_modules');
    const drifts: DependencyDrift[] = [];
    for (const [lockKey, lockedVersion] of readLockedDependencies(lockfilePath, options.scope)) {
        const installed = installedVersions(nodeModulesDir, lockKey, lockedVersion);
        if (installed !== lockedVersion) {
            drifts.push({ name: lockKeyPackageName(lockKey), locked: lockedVersion, installed });
        }
    }
    return drifts;
}

/** Both checks, as one findings list. */
export function checkDeps(options: CheckDepsOptions): CheckDepsFinding[] {
    const cwd = options.cwd ?? process.cwd();
    const findings: CheckDepsFinding[] = [];
    for (const stale of findStaleLinks(cwd, options.scope)) {
        const dist = stale.dist ? `newest dist ${stale.dist.rel} is older than src ${stale.src.rel}` : 'never built';
        findings.push({
            kind: 'stale-link',
            package: stale.pkg,
            detail: `linked to ${stale.realPath}; ${dist} — run (cd ${stale.realPath} && bun run build)`,
        });
    }
    for (const drift of checkDependencyDrift({ ...options, cwd })) {
        findings.push({
            kind: 'drift',
            package: drift.name,
            detail: `installed ${drift.installed ?? 'missing'} != locked ${drift.locked} — run bun install`,
        });
    }
    return findings;
}
