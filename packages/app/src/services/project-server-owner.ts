import { existsSync, mkdirSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Exclusive project runtime claim; live owners never expire. */
export interface ProjectServerOwner {
    release(): void;
}

/** Handoff tuning in milliseconds for {@link acquireProjectServerOwner}. */
export interface ProjectServerOwnerOptions {
    /**
     * Total wait for a stopping owner to drop its claim before refusing (default
     * {@link HANDOFF_TIMEOUT_MS}); `0` refuses as soon as a live owner is seen.
     */
    handoffTimeoutMs?: number;
    /** Claim re-read interval while waiting (default {@link HANDOFF_POLL_MS}). */
    handoffPollMs?: number;
}

/** A stopping owner keeps its claim through its whole drain; a restart waits this long for it. */
const HANDOFF_TIMEOUT_MS = 5_000;
const HANDOFF_POLL_MS = 50;

/** Blocking sleep — the claim is taken before any runtime work is scheduled. */
function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Signal-0 existence probe; unknown failures (EPERM) fail closed as a live owner. */
function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

/**
 * Wait out an owner that is stopping.
 *
 * `release()` runs only after the runtime and both DB owners have drained (serve.ts shutdown),
 * so an owner that is already logging `Shutting down server` still holds the claim with no live
 * service behind it; a restart issued in that window saw a live pid and refused. Waiting is the
 * only safe option — the claim must not be taken over while that owner may still hold its DB.
 *
 * @returns true once the claim was released or its owner died, false when the deadline passed.
 */
function awaitClaimHandoff(directory: string, pid: number, deadline: number, pollMs: number): boolean {
    for (;;) {
        if (!existsSync(directory)) return true;
        if (!isProcessAlive(pid)) return true;
        if (Date.now() >= deadline) return false;
        sleepSync(pollMs);
    }
}

/** Claim before any DB boot; keep until runtime shutdown has closed its DB. */
export function acquireProjectServerOwner(
    projectRoot: string,
    options: ProjectServerOwnerOptions = {},
): ProjectServerOwner {
    const directory = join(realpathSync(projectRoot), '.spur', 'server-owner.lock');
    mkdirSync(join(realpathSync(projectRoot), '.spur'), { recursive: true });
    const marker = `${process.pid}-${crypto.randomUUID()}`;
    const deadline = Date.now() + (options.handoffTimeoutMs ?? HANDOFF_TIMEOUT_MS);
    const pollMs = Math.max(1, options.handoffPollMs ?? HANDOFF_POLL_MS);
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            mkdirSync(directory);
            writeFileSync(join(directory, marker), '', { flag: 'wx' });
            let released = false;
            return {
                release() {
                    if (released) return;
                    released = true;
                    // Only the successful remover of our unique marker may remove
                    // the directory. A stale reaper can never remove a replacement.
                    try {
                        unlinkSync(join(directory, marker));
                        rmdirSync(directory);
                    } catch (error) {
                        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                    }
                },
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const owners = readdirSync(directory);
        const owner = owners.length === 1 ? owners[0] : undefined;
        const pid = owner?.match(/^(\d+)-[a-f0-9-]+$/)?.[1];
        // Incomplete/unknown claims fail closed; never erase a just-created claim.
        if (!pid || !owner) throw new Error(`Project server ownership claim is incomplete at ${directory}`);
        // A stopping owner is alive until its drain finishes, so wait for the handoff it is
        // about to make instead of reporting an owner that serves nothing any more.
        if (isProcessAlive(Number(pid)) && !awaitClaimHandoff(directory, Number(pid), deadline, pollMs))
            throw new Error(`Project already has a server owner (pid ${pid}). Close it before starting another one.`);
        try {
            unlinkSync(join(directory, owner));
            rmdirSync(directory);
        } catch (error) {
            // Another stale reaper won. Never rmdir a replacement claim.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }
    throw new Error('Project server ownership changed during startup; retry the launch.');
}
