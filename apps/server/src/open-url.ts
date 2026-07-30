/**
 * Cross-platform URL opener via ProcessExecutor (not Bun.spawn).
 *
 * On Bun, execa is implemented with Bun.spawn. Tests must never reassign global
 * Bun.spawn to stub browser open — that poisons concurrent ProcessExecutor suites
 * (workflow shell / agent / rules → exitCode null).
 */
import { NodeProcessExecutor, type ProcessExecutor } from '@gobing-ai/ts-runtime';

/** Optional deps for tests — inject a fake executor without touching Bun.spawn. */
export interface OpenUrlDeps {
    executor?: ProcessExecutor;
}

/**
 * Open a URL with the OS-native handler (`open` / `cmd start` / `xdg-open`).
 */
export async function openUrl(url: string, deps: OpenUrlDeps = {}): Promise<void> {
    // `start` is a cmd.exe builtin, not an executable — spawn it via `cmd /c`.
    // The empty `""` title arg stops `start` from consuming the URL as a window title.
    const argv =
        process.platform === 'darwin'
            ? (['open', url] as const)
            : process.platform === 'win32'
              ? (['cmd', '/c', 'start', '', url] as const)
              : (['xdg-open', url] as const);

    const executor = deps.executor ?? new NodeProcessExecutor();
    // Browser launchers often detach with odd exit codes — never fail the caller.
    await executor.run({
        command: argv[0],
        args: [...argv.slice(1)],
        forceBuffered: true,
        rejectOnError: false,
    });
}
