import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Marker that identifies a spur checkout (the dev server entry). */
const REPO_MARKER = join('apps', 'cli', 'src', 'index.ts');

/** Filesystem probes so layout resolution can be tested without a real tree. */
export interface LayoutFs {
    exists(path: string): boolean;
    isDirectory(path: string): boolean;
}

/** Node filesystem probes used by the Electron main process. */
export function nodeLayoutFs(): LayoutFs {
    return {
        exists: existsSync,
        isDirectory(path: string): boolean {
            try {
                return statSync(path).isDirectory();
            } catch {
                return false;
            }
        },
    };
}

/** Inputs for {@link resolveLayout}. */
export interface LayoutInput {
    isPackaged: boolean;
    cwd: string;
    execDir: string;
    resourcesPath?: string;
    env: Record<string, string | undefined>;
    argv: readonly string[];
}

/** Where the shell should launch the child server from. */
export interface DesktopLayout {
    mode: 'dev' | 'prod';
    repoRoot: string | undefined;
    projectRoot: string;
    resourcesDir: string | undefined;
}

/** Bun `--target` suffix for the current (or injected) platform, if we ship one. */
export function platformBinarySuffix(platform: NodeJS.Platform, arch: string): string | undefined {
    const os = platform === 'win32' ? 'windows' : platform === 'darwin' || platform === 'linux' ? platform : undefined;
    const normalizedArch = arch === 'x64' || arch === 'arm64' ? arch : undefined;
    if (!os || !normalizedArch) return undefined;
    return `${os}-${normalizedArch}`;
}

/** Walk parents until `apps/cli/src/index.ts` exists. */
export function findRepoRoot(start: string, fs: LayoutFs = nodeLayoutFs()): string | undefined {
    let dir = resolve(start);
    for (let i = 0; i < 24; i++) {
        if (fs.exists(join(dir, REPO_MARKER))) return dir;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
    return undefined;
}

/** Read `--project <path>` / `--project=<path>` from Electron's argv. */
export function parseProjectArg(argv: readonly string[]): string | undefined {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--project') {
            const next = argv[i + 1];
            if (next && !next.startsWith('-')) return next;
        } else if (arg?.startsWith('--project=')) {
            const value = arg.slice('--project='.length);
            if (value) return value;
        }
    }
    return undefined;
}

/** `dev` or `prod`, from `SPUR_DESKTOP_MODE` or whether the app is packaged. */
export function resolveDesktopMode(envValue: string | undefined, isPackaged: boolean): 'dev' | 'prod' {
    if (envValue === undefined || envValue.trim() === '') return isPackaged ? 'prod' : 'dev';
    if (envValue === 'dev' || envValue === 'prod') return envValue;
    throw new Error(`SPUR_DESKTOP_MODE must be dev or prod (received ${envValue})`);
}

function nonempty(value: string | undefined): string | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    return value;
}

/**
 * Resolve dev vs prod, the checkout that contains `apps/cli`, and the project
 * whose `.spur/spur.db` the child server owns.
 */
export function resolveLayout(input: LayoutInput, fs: LayoutFs = nodeLayoutFs()): DesktopLayout {
    const mode = resolveDesktopMode(input.env.SPUR_DESKTOP_MODE, input.isPackaged);
    const repoRoot = findRepoRoot(input.execDir, fs) ?? findRepoRoot(input.cwd, fs);
    const requested =
        parseProjectArg(input.argv) ??
        nonempty(input.env.SPUR_PROJECT_ROOT) ??
        (mode === 'dev' ? repoRoot : undefined) ??
        input.cwd;
    const projectRoot = resolve(input.cwd, requested);
    if (!fs.isDirectory(projectRoot)) {
        throw new Error(`Project root does not exist or is not a directory: ${projectRoot}`);
    }
    let resourcesDir: string | undefined;
    if (mode === 'prod') {
        // Unpackaged Electron still sets `process.resourcesPath` to Electron's own
        // resources directory. Only a packaged app should look there.
        resourcesDir =
            input.isPackaged && input.resourcesPath
                ? join(input.resourcesPath, 'spur')
                : repoRoot
                  ? join(repoRoot, 'apps', 'desktop', 'resources', 'spur')
                  : undefined;
    }
    return { mode, repoRoot, projectRoot, resourcesDir };
}
