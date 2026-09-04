#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
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

    for (const [name, lockedVersion] of locked.entries()) {
        const pkgJsonPath = join(nodeModulesDir, name, 'package.json');
        let installedVersion: string | null = null;

        if (existsSync(pkgJsonPath)) {
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
 * Runs in the spur-check chain before lint.
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
