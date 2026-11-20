/**
 * Parallel action supervisor (A94 1414 R2) — the `builder.actions.<name>` `{parallel, graceMs}` form.
 *
 * One owner for every child: each entry starts in its own process group, and exactly one shutdown
 * path terminates them. A receive signal, the first child exit, or a spawn error runs the same
 * bounded shutdown (SIGTERM every owned group, wait `graceMs` unconditionally, then SIGKILL), so a
 * descendant that outlives its root is still reaped.
 *
 * Exit contract: the first-exiting child's code (`128 + signo` when a signal killed it), else
 * `128 + signo` for a received signal, else 1 for a spawn error.
 */
import { constants } from 'node:os';
import { getEnvVars } from '@gobing-ai/spur-config';
import type { ProcessSignal } from '@gobing-ai/ts-runtime';

/** Options for {@link superviseParallel}. */
export interface ParallelSupervisorOptions {
    /** Shell commands to run together (2+). Each runs through `sh -c`. */
    commands: readonly string[];
    /** Working directory for every child. */
    cwd: string;
    /** Bounded grace between SIGTERM and SIGKILL (ms). */
    graceMs?: number;
    /** Environment overlay for every child (the supervisor adds its own isolation). */
    env?: Record<string, string>;
    /** Called once per child when it exits or fails to start, before shutdown begins. */
    onChildEvent?: (event: { label: string; code: number | null; signal: string | null }) => void;
    /** Called once with the run's exit code just before the process is terminated. */
    onExit?: (code: number) => void;
}

/** Return handle of {@link superviseParallel}. */
export interface ParallelSupervisorHandle {
    /** Resolves with the run's exit code once every owned group has been reaped. */
    exited: Promise<number>;
    /** Terminate every owned group with the bounded shutdown and finish with `code`. */
    stop: (code: number) => void;
    /** True once a shutdown has begun. */
    readonly stopping: boolean;
}

/** SIGTERM → grace → SIGKILL against every owned group. */
function signalGroups(pids: readonly (number | null)[], signal: ProcessSignal): void {
    for (const pid of pids) {
        if (pid === null) continue;
        try {
            process.kill(process.platform === 'win32' ? pid : -pid, signal);
        } catch {
            // The owned group already exited.
        }
    }
}

/**
 * Start every command and supervise them as one unit. Returns as soon as the children are spawned;
 * shutdown runs from the signal/exit/error paths.
 */
export function superviseParallel(options: ParallelSupervisorOptions): ParallelSupervisorHandle {
    const graceMs = options.graceMs ?? 3000;
    const pids: (number | null)[] = [];
    let stopping = false;
    let settle: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
        settle = resolve;
    });

    const stop = (code: number): void => {
        if (stopping) return;
        stopping = true;
        // Roots may exit before their descendants; retain ownership until the bounded cleanup finishes.
        signalGroups(pids, 'SIGTERM');
        setTimeout(() => {
            signalGroups(pids, 'SIGKILL');
            options.onExit?.(code);
            settle(code);
        }, graceMs);
    };

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(signal, () => stop(128 + constants.signals[signal]));
    }

    options.commands.forEach((command, index) => {
        const label = `child-${index + 1}`;
        // `detached: true` is the whole point: each entry leads its own process group, so shutdown
        // can signal the group (`-pid`) and reap descendants the root never waited for. The ts-runtime
        // streaming executor exposes no detached option (see the rule exemption for this file).
        let child: ReturnType<typeof Bun.spawn>;
        try {
            child = Bun.spawn(['sh', '-c', command], {
                cwd: options.cwd,
                stdio: ['inherit', 'inherit', 'inherit'],
                detached: true,
                env: { ...getEnvVars(), ...options.env },
            });
        } catch {
            // A spawn that cannot even start (bad cwd, missing shell) is the run's first failure.
            options.onChildEvent?.({ label, code: 1, signal: null });
            stop(1);
            return;
        }
        pids.push(child.pid);
        // `exited` always resolves for a started child (a failed spawn is caught above), so this is
        // the single settled path.
        void child.exited.then((code) => {
            const exitCode = code ?? 1;
            options.onChildEvent?.({ label, code: exitCode, signal: null });
            stop(exitCode);
        });
    });

    return {
        exited,
        stop,
        get stopping() {
            return stopping;
        },
    };
}
