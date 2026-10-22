/**
 * Exact process identity for fleet guests (G75 R2, task 1279).
 *
 * A guest lease is renewed by a helper that outlives the short-lived CLI that joined it,
 * and renewal must stop the moment the *agent* process is gone. A PID alone cannot prove
 * that — PIDs are reused. The fingerprint is `{pid, startedAt, executable}` read from
 * `ps -o ppid=,lstart=,comm= -p <pid>`: `lstart` is a stable wall-clock birth time, unlike
 * `etime`, which is a duration that drifts between two reads of the same live process.
 *
 * Identity is only ever *read*. Nothing here signals, adopts or kills a process.
 */

import { basename } from 'node:path';
import { NodeProcessExecutor, type ProcessExecutor } from '@gobing-ai/ts-runtime';

/** A process fingerprint read from the host process table. */
export interface ProcessIdentity {
    /** The process id that was read. */
    pid: number;
    /** `ps` `lstart` birth time, verbatim — the anchor that makes PID reuse detectable. */
    startedAt: string;
    /** `ps` `comm` executable path; may contain spaces. */
    executable: string;
    /** Parent pid at read time; `0`/`1` end an ancestor walk. */
    parentPid: number;
}

/** Injectable reader seam, so the parser and the ancestor walk are testable without spawning. */
export interface ProcessIdentityReader {
    /** One process by pid, or null when it is gone or the host cannot report it. */
    read(pid: number): Promise<ProcessIdentity | null>;
}

/** The subset of a fingerprint that proves "still the same process" across two reads. */
export type ProcessFingerprint = Pick<ProcessIdentity, 'pid' | 'startedAt'>;

/** Executor executable names a guest's agent ancestor may carry. */
export const AGENT_EXECUTABLE_NAMES: readonly string[] = [
    'claude',
    'codex',
    'pi',
    'omp',
    'opencode',
    'gemini',
    'grok',
    'antigravity',
];

/** Default ancestor-walk depth; a deeper chain is not a host session. */
export const AGENT_ANCESTOR_MAX_HOPS = 8;

/**
 * Parse one `ps -o ppid=,lstart=,comm= -p <pid>` row.
 *
 * `comm` (the executable) is the last column and may contain spaces, while `lstart` is always
 * exactly five whitespace-separated tokens (`Wed Oct 22 09:39:27 2026`) — so the row is parsed
 * positionally from the left and everything after the fifth timestamp token is the executable.
 */
export function parseProcessIdentity(stdout: string, pid: number): ProcessIdentity | null {
    const line = stdout.trim();
    if (line === '') return null;
    const tokens = line.split(/\s+/);
    // 1 ppid + 5 lstart + at least 1 executable token.
    if (tokens.length < 7) return null;
    const parentPid = Number(tokens[0]);
    const executable = tokens.slice(6).join(' ');
    if (!Number.isInteger(parentPid) || executable === '') return null;
    return { pid, startedAt: tokens.slice(1, 6).join(' '), executable, parentPid };
}

/** A `ps`-backed reader (macOS and Linux). A missing process is `null`, never a throw. */
export function createPsProcessIdentityReader(
    executor: ProcessExecutor = new NodeProcessExecutor(),
): ProcessIdentityReader {
    return {
        read: async (pid) => {
            try {
                const result = await executor.run({
                    command: 'ps',
                    args: ['-o', 'ppid=,lstart=,comm=', '-p', String(pid)],
                    rejectOnError: false,
                });
                if (result.exitCode !== 0) return null;
                return parseProcessIdentity(result.stdout, pid);
            } catch {
                return null;
            }
        },
    };
}

/**
 * True when a fingerprint still describes the same live process. A reused PID carries a
 * different `lstart`, so the pair (pid, startedAt) is the identity — never the pid alone.
 */
export function sameProcess(recorded: ProcessFingerprint, live: ProcessIdentity | null): boolean {
    return live !== null && live.pid === recorded.pid && live.startedAt === recorded.startedAt;
}

/**
 * The agent ancestor of `startPid`, or null when no process within `maxHops` matches one of
 * `executors`. The walk starts at `startPid` itself and moves to its parent, so a caller
 * passes the CLI's own parent to find the agent that launched the shell.
 */
export async function findAgentAncestor(
    startPid: number,
    reader: ProcessIdentityReader,
    options: { executors?: readonly string[]; maxHops?: number } = {},
): Promise<ProcessIdentity | null> {
    const executors = new Set((options.executors ?? AGENT_EXECUTABLE_NAMES).map((name) => name.toLowerCase()));
    const maxHops = options.maxHops ?? AGENT_ANCESTOR_MAX_HOPS;
    let pid = startPid;
    for (let hop = 0; hop < maxHops; hop++) {
        const current = await reader.read(pid);
        if (current === null) return null;
        if (matchesExecutor(current.executable, executors)) return current;
        // `1` is init/launchd and `0` is the kernel — neither is an agent.
        if (current.parentPid <= 1 || current.parentPid === current.pid) return null;
        pid = current.parentPid;
    }
    return null;
}

/** Whether an executable path names one of the expected executors (`/usr/bin/claude` → `claude`). */
function matchesExecutor(executable: string, executors: ReadonlySet<string>): boolean {
    const name = basename(executable)
        .toLowerCase()
        .replace(/\.(exe|cmd|bat)$/, '');
    return executors.has(name);
}
