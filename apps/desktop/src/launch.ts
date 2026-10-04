import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { DesktopLayout } from './layout';
import { platformBinarySuffix } from './layout';

/** Loopback host the child server binds and the window loads. */
export const DESKTOP_HOST = '127.0.0.1';

/** How the child process was chosen. */
export type ServeLaunchKind = 'dev-cli' | 'prod-cli' | 'prod-server';

/** Command line for the single child that owns SQLite. */
export interface ServeLaunch {
    kind: ServeLaunchKind;
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
}

/** Copy the parent environment, dropping `DATABASE_URL` so the child uses `<cwd>/.spur/spur.db`. */
export function childEnv(
    parent: Record<string, string | undefined>,
    extras: Record<string, string | undefined>,
): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(parent)) {
        if (typeof value === 'string') env[key] = value;
    }
    delete env.DATABASE_URL;
    for (const [key, value] of Object.entries(extras)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
    }
    return env;
}

/** `spur-server` is the standalone server binary; every other name is the CLI. */
export function binaryKind(filePath: string): 'cli' | 'server' {
    const base = basename(filePath)
        .toLowerCase()
        .replace(/\.exe$/, '');
    return base === 'spur-server' ? 'server' : 'cli';
}

/** Dev launch: `bun apps/cli/src/index.ts serve ...` from the checkout root. */
export function buildDevCliLaunch(input: {
    bun: string;
    repoRoot: string;
    projectRoot: string;
    port: number;
    parentEnv: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
}): ServeLaunch {
    return {
        kind: 'dev-cli',
        command: input.bun,
        args: [
            'apps/cli/src/index.ts',
            'serve',
            '--host',
            DESKTOP_HOST,
            '--port',
            String(input.port),
            '--no-open',
            '--cwd',
            input.projectRoot,
        ],
        cwd: input.repoRoot,
        env: childEnv(input.parentEnv, { HOST: DESKTOP_HOST }),
    };
}

/** Prod launch: CLI `serve` flags, or `PORT`/`HOST` for the standalone server binary. */
export function buildProdLaunch(input: {
    binary: string;
    projectRoot: string;
    port: number;
    parentEnv: Record<string, string | undefined>;
}): ServeLaunch {
    if (binaryKind(input.binary) === 'server') {
        return {
            kind: 'prod-server',
            command: input.binary,
            args: [],
            cwd: input.projectRoot,
            env: childEnv(input.parentEnv, { HOST: DESKTOP_HOST, PORT: String(input.port) }),
        };
    }
    return {
        kind: 'prod-cli',
        command: input.binary,
        args: ['serve', '--host', DESKTOP_HOST, '--port', String(input.port), '--no-open', '--cwd', input.projectRoot],
        cwd: input.projectRoot,
        env: childEnv(input.parentEnv, { HOST: DESKTOP_HOST }),
    };
}

/**
 * Absolute path for `SPUR_DESKTOP_BIN`. A relative override is resolved against the
 * directory Electron was launched from, not the child `cwd` (the project root).
 * `spawn` would otherwise look up the same relative command from `projectRoot`.
 */
export function resolveDesktopBin(bin: string, launchCwd: string): string {
    return isAbsolute(bin) ? bin : resolve(launchCwd, bin);
}

/**
 * Path the standalone server uses for history refresh:
 * `dirname(execPath)/../cli/spur` (`resolveStandaloneSpurInvocation`).
 */
export function standaloneServerCliCompanion(
    serverBinary: string,
    platform: NodeJS.Platform = process.platform,
): string {
    const name = platform === 'win32' ? 'spur.exe' : 'spur';
    return join(dirname(serverBinary), '..', 'cli', name);
}

/** Candidate compiled binaries, most specific first. Windows names include `.exe`. */
export function listProdBinaryCandidates(input: {
    envBin?: string;
    resourcesDir?: string;
    repoRoot?: string;
    platform: NodeJS.Platform;
    arch: string;
}): string[] {
    const candidates: string[] = [];
    if (input.envBin) candidates.push(input.envBin);
    const exe = input.platform === 'win32' ? '.exe' : '';
    if (input.resourcesDir) {
        candidates.push(join(input.resourcesDir, `spur${exe}`));
        candidates.push(join(input.resourcesDir, `spur-server${exe}`));
    }
    const suffix = platformBinarySuffix(input.platform, input.arch);
    if (input.repoRoot && suffix) {
        const cliName = input.platform === 'win32' ? `spur-${suffix}.exe` : `spur-${suffix}`;
        candidates.push(join(input.repoRoot, 'dist', 'cli', cliName));
        candidates.push(join(input.repoRoot, 'dist', 'server', `spur-server${exe}`));
    }
    return candidates;
}

/** Pick the dev command or the first compiled binary that exists. */
export function resolveServeLaunch(input: {
    layout: DesktopLayout;
    port: number;
    parentEnv: Record<string, string | undefined>;
    bunPath: string;
    exists: (path: string) => boolean;
    /** Directory Electron was launched from. Relative `SPUR_DESKTOP_BIN` resolves against this. */
    launchCwd?: string;
    platform?: NodeJS.Platform;
    arch?: string;
}): ServeLaunch {
    if (input.layout.mode === 'dev') {
        if (!input.layout.repoRoot) {
            throw new Error(
                'Development desktop mode needs a spur checkout (apps/cli/src/index.ts). Set SPUR_DESKTOP_MODE=prod to launch a compiled binary.',
            );
        }
        return buildDevCliLaunch({
            bun:
                input.bunPath.includes('/') || input.bunPath.includes('\\')
                    ? resolveDesktopBin(input.bunPath, input.launchCwd ?? process.cwd())
                    : input.bunPath,
            repoRoot: input.layout.repoRoot,
            projectRoot: input.layout.projectRoot,
            port: input.port,
            parentEnv: input.parentEnv,
            platform: input.platform ?? process.platform,
        });
    }

    const envBin = input.parentEnv.SPUR_DESKTOP_BIN;
    if (envBin) {
        const binary = resolveDesktopBin(envBin, input.launchCwd ?? process.cwd());
        if (!input.exists(binary)) throw new Error(`SPUR_DESKTOP_BIN does not exist: ${binary}`);
        return buildProdLaunch({
            binary,
            projectRoot: input.layout.projectRoot,
            port: input.port,
            parentEnv: input.parentEnv,
        });
    }

    const candidates = listProdBinaryCandidates({
        resourcesDir: input.layout.resourcesDir,
        repoRoot: input.layout.repoRoot,
        platform: input.platform ?? process.platform,
        arch: input.arch ?? process.arch,
    });
    const found = candidates.find((candidate) => input.exists(candidate));
    if (!found) {
        const looked = candidates.length > 0 ? candidates.map((candidate) => `- ${candidate}`).join('\n') : '- (none)';
        throw new Error(
            `No compiled spur binary found. Looked for:\n${looked}\nRun \`bun run build\` (dist/server/spur-server and dist/web), then \`bun run desktop:stage\`.`,
        );
    }
    return buildProdLaunch({
        binary: found,
        projectRoot: input.layout.projectRoot,
        port: input.port,
        parentEnv: input.parentEnv,
    });
}
