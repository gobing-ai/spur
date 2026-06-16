/**
 * Cross-platform URL opener. Uses the OS-native open command
 * (reuses the same `ProcessExecutor` seam as the CLI's `$EDITOR` pattern).
 */
export async function openUrl(url: string): Promise<void> {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    Bun.spawn([cmd, url], { stdio: ['ignore', 'ignore', 'ignore'] });
}
