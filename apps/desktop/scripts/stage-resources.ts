import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { standaloneServerCliCompanion } from '../src/launch';
import { findRepoRoot, platformBinarySuffix } from '../src/layout';

/**
 * Copy a compiled spur binary and `dist/web` next to each other so
 * `resolveWebDistPath` finds `dirname(execPath)/web`.
 *
 * Prefers `dist/cli/spur-<os>-<arch>` (has `serve --port --cwd`). Falls back to
 * `dist/server/spur-server`, which reads `PORT` and `HOST`. The fallback also
 * stages a CLI at `dirname(server)/../cli/spur`, the path
 * `resolveStandaloneSpurInvocation` uses for history refresh. `bun run build`
 * does not emit a platform CLI, so this script compiles `dist/cli/spur` when
 * no companion artifact exists yet.
 */
const here = dirname(fileURLToPath(import.meta.url));
const foundRepo = findRepoRoot(here);
if (!foundRepo) throw new Error('Could not find the spur repo root (apps/cli/src/index.ts).');
const repo: string = foundRepo;

const suffix = platformBinarySuffix(process.platform, process.arch);
const resourcesRoot = join(repo, 'apps', 'desktop', 'resources');
const outDir = join(resourcesRoot, 'spur');
rmSync(outDir, { recursive: true, force: true });
rmSync(join(resourcesRoot, 'cli'), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const serverName = process.platform === 'win32' ? 'spur-server.exe' : 'spur-server';
const cliFileName = process.platform === 'win32' ? 'spur.exe' : 'spur';
const platformCliName = suffix ? (process.platform === 'win32' ? `spur-${suffix}.exe` : `spur-${suffix}`) : undefined;
const platformCliPath = platformCliName ? join(repo, 'dist', 'cli', platformCliName) : undefined;
const localCliCandidates = [join(repo, 'dist', 'cli', cliFileName), join(repo, 'dist', 'cli', 'spur')];
const serverPath = join(repo, 'dist', 'server', serverName);

function firstExisting(paths: Array<string | undefined>): string | undefined {
    return paths.find((path) => path !== undefined && existsSync(path));
}

function compileLocalCli(): void {
    const result = spawnSync('bun', ['run', join(repo, 'scripts', 'spur-dev.ts'), 'build-cli'], {
        cwd: repo,
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        throw new Error('Failed to compile the Spur CLI companion (`bun run scripts/spur-dev.ts build-cli`).');
    }
}

let staged: string | undefined;
let serverBinary: string | undefined;
if (platformCliPath && existsSync(platformCliPath)) {
    const dest = join(outDir, cliFileName);
    copyFileSync(platformCliPath, dest);
    chmodSync(dest, 0o755);
    staged = dest;
} else if (existsSync(serverPath)) {
    const dest = join(outDir, serverName);
    copyFileSync(serverPath, dest);
    chmodSync(dest, 0o755);
    staged = dest;
    serverBinary = dest;
} else {
    throw new Error(
        'No compiled spur binary found. Run `bun run build` (dist/server/spur-server) or `bun run --filter @gobing-ai/spur build:binaries`.',
    );
}

// History refresh on the standalone server spawns this exact relative path.
const companionDest = standaloneServerCliCompanion(serverBinary ?? join(outDir, serverName), process.platform);
let companionSrc = firstExisting([platformCliPath, ...localCliCandidates]);
if (!companionSrc) {
    console.log('No CLI artifact found; compiling dist/cli/spur for the desktop history-refresh companion.');
    compileLocalCli();
    companionSrc = firstExisting(localCliCandidates);
}
if (!companionSrc) {
    throw new Error(
        `Standalone server history refresh needs ${companionDest}. Compile failed to produce dist/cli/${cliFileName}.`,
    );
}
mkdirSync(dirname(companionDest), { recursive: true });
copyFileSync(companionSrc, companionDest);
chmodSync(companionDest, 0o755);

const webIndex = join(repo, 'dist', 'web', 'index.html');
if (!existsSync(webIndex)) {
    throw new Error(
        'dist/web/index.html is missing. Run `bun run build` or `bun run --filter @gobing-ai/spur-web build`.',
    );
}
cpSync(join(repo, 'dist', 'web'), join(outDir, 'web'), { recursive: true });
console.log(`Staged ${staged} and web assets into ${outDir}`);
console.log(`Staged CLI companion ${companionSrc} -> ${companionDest}`);
