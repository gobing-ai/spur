import type { ProcessInspector } from './process-inspector';
import { UnsupportedProcessPlatformError } from './process-inspector';
import type { ProcessEntry } from './supervisor-service';

/** How the inventory classified a process row. */
export type ProcessInventorySource = 'serve' | 'supervisor' | 'descendant';

/** One process in the serve-rooted inventory (flat list, depth-ordered). */
export interface ProcessInventoryRow {
    pid: number;
    ppid: number;
    depth: number;
    source: ProcessInventorySource;
    /** Display label (agent id for supervisor, short name otherwise). */
    label: string;
    agentId?: string;
    command: string;
    status: string;
    rssBytes: number;
    /** Elapsed wall time in seconds when known. */
    elapsedSeconds: number | null;
    /** ISO timestamp when known (supervisor startedAt, or derived from etime). */
    startedAt: string | null;
}

/** Envelope for GET /api/observability/processes. */
export interface ProcessInventorySnapshot {
    processes: ProcessInventoryRow[];
    rootPid: number;
    capturedAt: string;
}

/** Overlay entry from SupervisorService (or a test double). */
export interface SupervisorOverlayEntry {
    agentId: string;
    pid: number | null;
    status: string;
    startedAt: string;
}

/**
 * Options for constructing a `ProcessInventoryService`.
 *
 * The service is a thin serve-rooted process inventory: it walks the
 * process tree under a chosen `rootPid` (defaulting to the current
 * process), lets a caller overlay supervisor-tracked processes via
 * `listSupervised`, and serializes entries to a tab-separated text
 * representation with a `maxCommandLength` cap (default 200 chars).
 */
export interface ProcessInventoryServiceOptions {
    inspector: ProcessInspector;
    /** Defaults to `process.pid` (serve's own pid). */
    rootPid?: number;
    /** Defaults to truncating at 200 chars. */
    maxCommandLength?: number;
    /**
     * Returns current supervised processes for pid → agent overlay.
     * Optional — inventory still works with OS tree alone.
     */
    listSupervised?: () => SupervisorOverlayEntry[] | ProcessEntry[];
}

const DEFAULT_MAX_COMMAND = 200;

/**
 * Builds a serve-rooted process inventory (task 0243).
 *
 * Walks OS children of the serve PID, then overlays SupervisorService rows
 * matched by pid. Does not depend on a ProcessExecutor live registry.
 */
export class ProcessInventoryService {
    private readonly inspector: ProcessInspector;
    private readonly rootPid: number;
    private readonly maxCommandLength: number;
    private readonly listSupervised?: () => SupervisorOverlayEntry[] | ProcessEntry[];

    constructor(options: ProcessInventoryServiceOptions) {
        this.inspector = options.inspector;
        this.rootPid = options.rootPid ?? process.pid;
        this.maxCommandLength = options.maxCommandLength ?? DEFAULT_MAX_COMMAND;
        this.listSupervised = options.listSupervised;
    }

    /**
     * Snapshot the serve process tree.
     * @throws {UnsupportedProcessPlatformError} when the inspector cannot list processes
     */
    async snapshot(): Promise<ProcessInventorySnapshot> {
        const capturedAt = new Date().toISOString();
        let all: Awaited<ReturnType<ProcessInspector['listAll']>>;
        try {
            all = await this.inspector.listAll();
        } catch (err) {
            if (err instanceof UnsupportedProcessPlatformError) throw err;
            throw err;
        }

        const byPid = new Map(all.map((r) => [r.pid, r]));
        const children = new Map<number, number[]>();
        for (const row of all) {
            const list = children.get(row.ppid) ?? [];
            list.push(row.pid);
            children.set(row.ppid, list);
        }

        // Ensure root appears even if `ps` omitted it (rare) — synthesize minimal row.
        if (!byPid.has(this.rootPid)) {
            byPid.set(this.rootPid, {
                pid: this.rootPid,
                ppid: 0,
                rssBytes: 0,
                elapsedSeconds: null,
                command: `serve:${this.rootPid}`,
            });
        }

        const supervisedByPid = new Map<number, SupervisorOverlayEntry>();
        if (this.listSupervised) {
            for (const entry of this.listSupervised()) {
                if (entry.pid == null) continue;
                supervisedByPid.set(entry.pid, {
                    agentId: entry.agentId,
                    pid: entry.pid,
                    status: entry.status,
                    startedAt: entry.startedAt,
                });
            }
        }

        const ordered: ProcessInventoryRow[] = [];
        const visit = (pid: number, depth: number) => {
            const os = byPid.get(pid);
            if (!os) return;
            const sup = supervisedByPid.get(pid);
            const source: ProcessInventorySource = pid === this.rootPid ? 'serve' : sup ? 'supervisor' : 'descendant';
            const command = truncateCommand(os.command, this.maxCommandLength);
            const label = sup?.agentId ?? shortLabel(command, source, pid);
            const startedAt =
                sup?.startedAt ??
                (os.elapsedSeconds != null ? startedAtFromElapsed(os.elapsedSeconds, capturedAt) : null);

            ordered.push({
                pid,
                ppid: os.ppid,
                depth,
                source,
                label,
                agentId: sup?.agentId,
                command,
                status: sup?.status ?? 'running',
                rssBytes: os.rssBytes,
                elapsedSeconds: os.elapsedSeconds,
                startedAt,
            });

            const kids = (children.get(pid) ?? []).slice().sort((a, b) => a - b);
            for (const childPid of kids) {
                // Guard against cycles (should not happen on a real process table).
                if (childPid === pid) continue;
                visit(childPid, depth + 1);
            }
        };

        visit(this.rootPid, 0);

        return {
            processes: ordered,
            rootPid: this.rootPid,
            capturedAt,
        };
    }
}

function truncateCommand(command: string, max: number): string {
    if (command.length <= max) return command;
    return `${command.slice(0, max - 1)}…`;
}

function shortLabel(command: string, source: ProcessInventorySource, pid: number): string {
    if (source === 'serve') return 'spur serve';
    const base = command.split(/\s+/)[0] ?? '';
    const leaf = base.includes('/') ? (base.split('/').pop() ?? base) : base;
    return leaf || `pid:${pid}`;
}

function startedAtFromElapsed(elapsedSeconds: number, capturedAtIso: string): string {
    const captured = new Date(capturedAtIso).getTime();
    return new Date(captured - elapsedSeconds * 1000).toISOString();
}
