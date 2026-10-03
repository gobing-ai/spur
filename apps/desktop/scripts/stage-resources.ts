import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot, platformBinarySuffix } from '../src/layout';

/**
 * Copy a compiled spur binary and `dist/web` next to each other so
 * `resolveWebDistPath` finds `dirname(execPath)/web`.
 *
 * Prefers `dist/cli/spur-<os>-<arch>` (has `serve --port --cwd`). Falls back to
 * `dist/server/spur-server`, which reads `PORT` and `HOST`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = findRepoRoot(here);
if (!repo) throw new Error('Could not find the spur repo root (apps/cli/src/index.ts).');

const suffix = platformBinarySuffix(process.platform, process.arch);
const outDir = join(repo, 'apps', 'desktop', 'resources', 'spur');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const serverName = process.platform === 'win32' ? 'spur-server.exe' : 'spur-server';
const cliName = suffix ? (process.platform === 'win32' ? `spur-${suffix}.exe` : `spur-${suffix}`) : undefined;
const cliPath = cliName ? join(repo, 'dist', 'cli', cliName) : undefined;
const serverPath = join(repo, 'dist', 'server', serverName);

let staged: string | undefined;
if (cliPath && existsSync(cliPath)) {
    const dest = join(outDir, process.platform === 'win32' ? 'spur.exe' : 'spur');
    copyFileSync(cliPath, dest);
    chmodSync(dest, 0o755);
    staged = dest;
} else if (existsSync(serverPath)) {
    const dest = join(outDir, serverName);
    copyFileSync(serverPath, dest);
    chmodSync(dest, 0o755);
    staged = dest;
} else {
    throw new Error(
        'No compiled spur binary found. Run `bun run build` (dist/server/spur-server) or `bun run --filter @gobing-ai/spur build:binaries`.',
    );
}

const webIndex = join(repo, 'dist', 'web', 'index.html');
if (!existsSync(webIndex)) {
    throw new Error(
        'dist/web/index.html is missing. Run `bun run build` or `bun run --filter @gobing-ai/spur-web build`.',
    );
}
cpSync(join(repo, 'dist', 'web'), join(outDir, 'web'), { recursive: true });
console.log(`Staged ${staged} and web assets into ${outDir}`);
