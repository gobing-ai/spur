#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DependencyDrift {
    readonly name: string;
    readonly locked: string;
    readonly installed: string | null;
}

export interface DependencyDriftCheckOptions {
    lockfilePath?: string;
    nodeModulesDir?: string;
    quiet?: boolean;
}

/**
 * Parses bun.lock (handling trailing commas and JSON quirks) and extracts locked versions
 * for packages matching `@gobing-ai/ts-*`.
 */
export function readLockedTsDependencies(lockfilePath: string): Map<string, string> {
    const content = readFileSync(lockfilePath, 'utf8');
    const cleaned = content.replace(/,(\s*[\]}])/g, '$1');
    const parsed = JSON.parse(cleaned) as { packages?: Record<string, unknown[]> };
    const result = new Map<string, string>();

    for (const [key, val] of Object.entries(parsed.packages ?? {})) {
        if (key.startsWith('@gobing-ai/ts-')) {
            const spec = val?.[0];
            if (typeof spec === 'string') {
                const atIdx = spec.lastIndexOf('@');
                const lockedVersion = atIdx >= 0 ? spec.slice(atIdx + 1) : spec;
                result.set(key, lockedVersion);
            }
        }
    }

    return result;
}

/**
 * Resolves the package name a bun.lock packages-key refers to. Keys are either
 * "<name>" or "<parentKey>/<name>" (a dependency resolved inside <parent>),
 * where name segments are "@scope/pkg" or "pkg". Nested key example:
 * "@gobing-ai/ts-llm-jsonl-importer/@gobing-ai/ts-db" -> "@gobing-ai/ts-db".
 */
export function lockKeyPackageName(lockKey: string): string {
    const segs = lockKey.split('/');
    const last = segs[segs.length - 1] ?? lockKey;
    const scope = segs[segs.length - 2];
    if (scope?.startsWith('@')) {
        return `${scope}/${last}`;
    }
    return last;
}

/**
 * Locates the installed package.json for a bun.lock packages-key. A nested key
 * ("<parentKey>/<name>") pins <name>'s version inside <parent>, which bun
 * installs at node_modules/<parentKey>/node_modules/<name> when the resolution
 * diverges from the hoisted one — so the nested path is checked first, then the
 * hoisted node_modules/<name>.
 *
 * Bun ≥1.2 store layout: a package bun hoists only as a transitive dependency
 * (no workspace names it directly) gets no user-visible node_modules/<name>
 * entry — it lives solely at node_modules/.bun/<@scope+name@version+hash>/
 * node_modules/<name> and resolves through its parent's store dir. The store
 * fallback (keyed on name@lockedVersion) finds those; without it every
 * transitive-only @gobing-ai/ts-* package false-positives as `installed
 * missing`. The version match keeps real drift detectable: a store dir pinned
 * to a different version simply misses the prefix and the drift still reports.
 */
function findInstalledPkgJsonPath(nodeModulesDir: string, lockKey: string, lockedVersion: string): string | null {
    const name = lockKeyPackageName(lockKey);
    const parentKey = lockKey === name ? null : lockKey.slice(0, lockKey.length - name.length - 1);
    if (parentKey) {
        const nested = join(nodeModulesDir, parentKey, 'node_modules', name, 'package.json');
        if (existsSync(nested)) return nested;
    }
    const hoisted = join(nodeModulesDir, name, 'package.json');
    if (existsSync(hoisted)) return hoisted;
    const storeDir = join(nodeModulesDir, '.bun');
    if (!existsSync(storeDir)) return null;
    const prefix = `${name.replace('/', '+')}@${lockedVersion}+`;
    for (const entry of readdirSync(storeDir)) {
        if (!entry.startsWith(prefix)) continue;
        const storePath = join(storeDir, entry, 'node_modules', name, 'package.json');
        if (existsSync(storePath)) return storePath;
    }
    return null;
}

/**
 * Compares every installed `@gobing-ai/ts-*` package against its resolution in `bun.lock`.
 * Returns a list of mismatches.
 */
export function checkDependencyDrift(options?: { lockfilePath?: string; nodeModulesDir?: string }): DependencyDrift[] {
    const lockfilePath = options?.lockfilePath ?? join(process.cwd(), 'bun.lock');
    const nodeModulesDir = options?.nodeModulesDir ?? join(process.cwd(), 'node_modules');

    if (!existsSync(lockfilePath)) {
        return [];
    }

    const locked = readLockedTsDependencies(lockfilePath);
    const drifts: DependencyDrift[] = [];

    for (const [lockKey, lockedVersion] of locked.entries()) {
        const name = lockKeyPackageName(lockKey);
        const pkgJsonPath = findInstalledPkgJsonPath(nodeModulesDir, lockKey, lockedVersion);
        let installedVersion: string | null = null;

        if (pkgJsonPath !== null) {
            try {
                const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version?: string };
                installedVersion = pkg.version ?? null;
            } catch {
                installedVersion = null;
            }
        }

        if (installedVersion !== lockedVersion) {
            drifts.push({
                name,
                locked: lockedVersion,
                installed: installedVersion,
            });
        }
    }

    return drifts;
}

/**
 * CLI command checking for @gobing-ai/ts-* dependency drift.
 * Runs in the feature-scoped `spur-check-feature` chain (ADR-119, task 0872).
 */
export async function dependencyDriftCheck(options?: DependencyDriftCheckOptions): Promise<number> {
    const quiet = options?.quiet ?? false;
    const drifts = checkDependencyDrift(options);

    if (drifts.length > 0) {
        if (!quiet) {
            console.error('dependency-drift-check FAILED — dependency drift detected for @gobing-ai/ts-* packages:');
            for (const drift of drifts) {
                console.error(`  ${drift.name}: installed ${drift.installed ?? 'missing'} != locked ${drift.locked}`);
            }
            console.error('Remediation: Run `bun install` to synchronize node_modules with bun.lock.\n');
        }
        return 1;
    }

    if (!quiet) {
        console.log('dependency-drift-check OK — all @gobing-ai/ts-* packages match locked versions.');
    }
    return 0;
}

if (import.meta.main) {
    const code = await dependencyDriftCheck();
    process.exit(code);
}
