/**
 * OS process snapshot port + macOS/Linux `ps` adapter (task 0243).
 *
 * The inventory service depends on this port so tests inject fixtures without
 * spawning real processes. Production uses {@link createPsProcessInspector}.
 */

import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';

/** One row from a host process table (pre-tree-filter). */
export interface OsProcessRow {
    pid: number;
    ppid: number;
    /** Resident set size in bytes (normalized from `ps` RSS KB). */
    rssBytes: number;
    /** Wall-clock elapsed seconds when parseable; otherwise null. */
    elapsedSeconds: number | null;
    /** Full command line as reported by the OS. */
    command: string;
}

/** Port used by {@link ProcessInventoryService}. */
export interface ProcessInspector {
    /** Snapshot every visible process (caller filters to a tree). */
    listAll(): Promise<OsProcessRow[]>;
}

/** Error when the host OS cannot supply a process table for inventory. */
export class UnsupportedProcessPlatformError extends Error {
    readonly code = 'UNSUPPORTED_PLATFORM' as const;

    constructor(platform: string) {
        super(`Process inventory is not supported on platform "${platform}" (macOS and Linux only)`);
        this.name = 'UnsupportedProcessPlatformError';
    }
}

/**
 * Parse `ps -axo pid=,ppid=,rss=,etime=,command=` style output.
 * Columns are whitespace-separated until command (which may contain spaces).
 */
export function parsePsOutput(stdout: string): OsProcessRow[] {
    const rows: OsProcessRow[] = [];
    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trimEnd();
        if (!line.trim()) continue;
        // Skip header if present (PID PPID …)
        if (/^\s*PID\b/i.test(line)) continue;

        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
        if (!match) continue;
        const pid = Number(match[1]);
        const ppid = Number(match[2]);
        const rssKb = Number(match[3]);
        const etime = match[4] ?? '';
        const command = (match[5] ?? '').trim();
        if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
        rows.push({
            pid,
            ppid,
            rssBytes: Number.isFinite(rssKb) ? rssKb * 1024 : 0,
            elapsedSeconds: parseEtimeToSeconds(etime),
            command,
        });
    }
    return rows;
}

/**
 * Parse `ps` etime forms: `SS`, `MM:SS`, `HH:MM:SS`, `DD-HH:MM:SS`.
 */
export function parseEtimeToSeconds(etime: string): number | null {
    const t = etime.trim();
    if (!t || t === '-') return null;

    // DD-HH:MM:SS
    const dayMatch = t.match(/^(\d+)-(\d+):(\d+):(\d+)$/);
    if (dayMatch) {
        const d = Number(dayMatch[1]);
        const h = Number(dayMatch[2]);
        const m = Number(dayMatch[3]);
        const s = Number(dayMatch[4]);
        return d * 86_400 + h * 3600 + m * 60 + s;
    }

    const parts = t.split(':').map((p) => Number(p));
    if (parts.some((n) => !Number.isFinite(n))) return null;
    if (parts.length === 1) return parts[0] ?? null;
    if (parts.length === 2) {
        const [m, s] = parts;
        return (m ?? 0) * 60 + (s ?? 0);
    }
    if (parts.length === 3) {
        const [h, m, s] = parts;
        return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
    }
    return null;
}

/** Default `ps` argv shared by macOS and Linux (GNU/BSD-compatible flags). */
export const PS_LIST_ARGV = ['ps', '-axo', 'pid=,ppid=,rss=,etime=,command='] as const;

/**
 * Create a process inspector that shells out to `ps`.
 * Throws {@link UnsupportedProcessPlatformError} on non-darwin/linux.
 */
export function createPsProcessInspector(
    platform: string = process.platform,
    runPs: () => Promise<string> = defaultRunPs,
): ProcessInspector {
    if (platform !== 'darwin' && platform !== 'linux') {
        return {
            listAll: async () => {
                throw new UnsupportedProcessPlatformError(platform);
            },
        };
    }
    return {
        async listAll(): Promise<OsProcessRow[]> {
            const stdout = await runPs();
            return parsePsOutput(stdout);
        },
    };
}

/**
 * Run `ps` and return stdout, throwing on a non-zero exit.
 *
 * The executor is injectable so both branches are testable without spawning a real process — the
 * default was previously unreachable from tests (every caller injects `runPs`), leaving the
 * non-zero-exit error path with no coverage at all.
 */
export async function defaultRunPs(
    executor: { run: NodeProcessExecutor['run'] } = new NodeProcessExecutor(),
): Promise<string> {
    // ProcessExecutor seam — do not Bun.spawn here (no-direct-process-spawn +
    // concurrent-test isolation: execa uses Bun.spawn under the hood on Bun).
    const [command, ...args] = PS_LIST_ARGV;
    const result = await executor.run({
        command: command ?? 'ps',
        args,
        forceBuffered: true,
        rejectOnError: false,
    });
    if (result.exitCode !== 0) {
        throw new Error(`ps failed (exit ${result.exitCode}): ${result.stderr.trim() || 'no stderr'}`);
    }
    return result.stdout;
}
