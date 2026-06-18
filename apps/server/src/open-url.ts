/**
 * Cross-platform URL opener. Uses the OS-native open command
 * (reuses the same `ProcessExecutor` seam as the CLI's `$EDITOR` pattern).
 */
export async function openUrl(url: string): Promise<void> {
    // `start` is a cmd.exe builtin, not an executable — spawn it via `cmd /c`.
    // The empty `""` title arg stops `start` from consuming the URL as a window title.
    const argv =
        process.platform === 'darwin'
            ? ['open', url]
            : process.platform === 'win32'
              ? ['cmd', '/c', 'start', '', url]
              : ['xdg-open', url];
    Bun.spawn(argv, { stdio: ['ignore', 'ignore', 'ignore'] });
}
