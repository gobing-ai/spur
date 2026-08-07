/**
 * link-check — fail loudly when a `bun link`-ed `@gobing-ai/*` package is
 * serving a `dist/` that is older than its `src/`.
 *
 * WHY this exists: a linked package resolves through its `exports` entry
 * (`dist/index.js`), never `src/`. Editing the linked package's source changes
 * nothing on this side until that package rebuilds — the edit *looks* applied
 * and is not. That failure is silent and cost ~77 minutes in the task 0466
 * session before anyone suspected the build rather than the code.
 *
 * A `"prepare": "bun run build"` hook in the linked package does NOT close
 * this. Bun enqueues lifecycle scripts only for `ResolutionTag::Git | Github |
 * Root` and `Workspace` (`src/install/lockfile/Package/Scripts.rs:167-194`);
 * a `bun link` yields a `Symlink` resolution (`src/install/resolution.rs:84-91`)
 * and never fires them. So the guard has to live on the consumer side, here,
 * where it holds regardless of the package manager's lifecycle semantics.
 *
 * Scope: only entries that resolve OUTSIDE this repo's `node_modules`. Bun's
 * store copies (`node_modules/.bun/<pkg>@<ver>/…`) are symlinked too and these
 * packages publish `src/` alongside `dist/` (`files: ["dist", "src"]`), so
 * "has a src/ dir" does not distinguish them — but their real path stays
 * inside the repo, and a `bun link` always escapes it. Their mtimes come from
 * tarball extraction and mean nothing, so comparing them would false-alarm on
 * every install.
 */
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Newest file under `root` matching `ext`, or null when the tree has none. */
interface Newest {
    rel: string;
    mtimeMs: number;
}

/** A linked package whose build output lags its sources. */
interface StaleLink {
    pkg: string;
    realPath: string;
    src: Newest;
    dist: Newest | null;
}

const SCOPE = '@gobing-ai';

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

/**
 * Inspect every symlinked `@gobing-ai/*` entry under `cwd`'s node_modules and
 * return the ones whose newest build input is newer than their newest output.
 */
export function findStaleLinks(cwd: string = process.cwd()): StaleLink[] {
    const scopeDir = join(cwd, 'node_modules', SCOPE);
    if (!existsSync(scopeDir)) return [];
    // Resolved so a symlinked repo root still compares equal against realpaths.
    const localModules = `${realpathSync(join(cwd, 'node_modules'))}/`;

    const stale: StaleLink[] = [];
    for (const name of readdirSync(scopeDir)) {
        const entry = join(scopeDir, name);
        let realPath: string;
        try {
            if (!lstatSync(entry).isSymbolicLink()) continue;
            realPath = realpathSync(entry);
        } catch {
            continue; // dangling link — `bun install` will surface it
        }
        // Inside our own node_modules => a Bun store copy, not a `bun link`.
        if (realPath.startsWith(localModules)) continue;
        const srcDir = join(realPath, 'src');
        const distDir = join(realPath, 'dist');
        if (!existsSync(srcDir) || !existsSync(distDir)) continue;

        const src = newestFile(srcDir, '.ts');
        if (!src) continue;
        const dist = newestFile(distDir, '.js');
        // Fresh: a build output exists and is at least as new as every input.
        if (dist && dist.mtimeMs >= src.mtimeMs) continue;
        stale.push({ pkg: `${SCOPE}/${name}`, realPath, src, dist });
    }
    return stale;
}

export async function linkCheck(cwd: string = process.cwd()): Promise<number> {
    const stale = findStaleLinks(cwd);
    if (stale.length === 0) {
        console.log('link-check OK — no linked @gobing-ai package is serving a stale dist/.');
        return 0;
    }

    console.error('link-check FAILED — a linked package is serving build output older than its source.');
    console.error('Every import of it in this repo loads the OLD code; your edits are not applied.\n');
    for (const s of stale) {
        console.error(`  ${s.pkg}`);
        console.error(`    linked to  ${s.realPath}`);
        console.error(`    newest src src/${s.src.rel}`);
        console.error(s.dist ? `    newest dist dist/${s.dist.rel} (older)` : '    newest dist <none — never built>');
        console.error(`    fix        (cd ${s.realPath} && bun run build)\n`);
    }
    return 1;
}
