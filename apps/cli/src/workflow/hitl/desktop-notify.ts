import notifier from 'node-notifier';

/**
 * Fire-and-forget desktop notification via node-notifier. Never throws — notes are
 * best-effort display.
 *
 * Kept in its own tiny module on purpose: a file referencing node-notifier (statically or
 * via dynamic `import()`) can lose per-file coverage attribution under Bun's V8 coverage,
 * silently bypassing the 90% gate. The responder imports this wrapper instead, keeping the
 * blast radius to these few lines.
 */
export function desktopNotify(title: string, message: string): void {
    try {
        notifier.notify({ title, message });
    } catch {
        // Silently swallow — notes are best-effort display.
    }
}
