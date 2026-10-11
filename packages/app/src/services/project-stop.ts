import type { ProjectEntry } from '@gobing-ai/spur-config';
import { NodeProcessExecutor, type ProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    findListeningPid,
    isPortLive,
    normalizeProjectPath,
    sendSignalToPid,
    type TerminatedProcessInfo,
} from './project-registry';

/**
 * Verified ownership-based stop for a registered project's listener (1156).
 *
 * Neither a live TCP port nor a discovered PID proves a process belongs to the
 * selected project: any foreign service can hold the port of a deleted or
 * stopped registration. Before any SIGTERM/SIGKILL this module requires the
 * local HTTP identity of the listener — `GET /api/health` must report
 * `service: 'spur'` and `GET /api/project` must report the exact normalized
 * registry path — probed over the same loopback host, with the listening PID
 * rediscovered unchanged immediately before each signal.
 *
 * This is local ownership verification, not authentication against a
 * malicious local server, and portable PID checks cannot make the OS kill
 * atomic: a PID-reuse race remains between the final check and the signal.
 */

/** Options for {@link stopRegisteredProject}. */
export interface StopRegisteredProjectOptions {
    /** Maximum wait in milliseconds before escalating SIGTERM to SIGKILL (default: 2000). */
    killTimeoutMs?: number;
    /** Per-request timeout in milliseconds for the identity probes (default: 1000). */
    requestTimeoutMs?: number;
    /** ProcessExecutor used for PID discovery (default: NodeProcessExecutor). */
    processExecutor?: ProcessExecutor;
    /** Injectable fetch implementation (tests). */
    fetchImpl?: typeof fetch;
}

/** Result of a stop attempt. Callers map refusal to their existing error channel. */
export interface StopRegisteredProjectResult {
    /** True when the entry's listener is gone (verified stop or already absent). */
    stopped: boolean;
    /** Present only when a verified listener was signaled and observed gone. */
    terminated?: TerminatedProcessInfo;
    /** Human-readable refusal reason when stopped is false. */
    reason?: string;
}

let testFetchImpl: typeof fetch | undefined;

/** Install or clear the process-wide fetch override for identity probes (tests only). */
export function setProjectStopFetchForTests(fetchImpl: typeof fetch | undefined): void {
    testFetchImpl = fetchImpl;
}

const LOOPBACK_HOSTS = ['127.0.0.1', '[::1]'] as const;
const POLL_INTERVAL_MS = 50;

class HostUnavailableError extends Error {}

/** Fetch one identity endpoint; network failure marks the host unavailable, anything else fails closed. */
async function fetchIdentityJson(fetchImpl: typeof fetch, url: string, requestTimeoutMs: number): Promise<unknown> {
    let response: Response;
    try {
        response = await fetchImpl(url, {
            redirect: 'error',
            signal: AbortSignal.timeout(requestTimeoutMs),
        });
    } catch (err) {
        throw new HostUnavailableError(err instanceof Error ? err.message : String(err));
    }
    if (!response.ok) {
        throw new Error(`status ${response.status}`);
    }
    return response.json();
}

/**
 * Probe the listener's HTTP identity on one loopback host family at a time
 * (never mixing health from one host with project identity from the other).
 * Returns an error detail, or undefined when ownership is proven.
 */
async function probeOwnershipIdentity(
    port: number,
    expectedPath: string,
    fetchImpl: typeof fetch,
    requestTimeoutMs: number,
): Promise<string | undefined> {
    for (const host of LOOPBACK_HOSTS) {
        let health: unknown;
        let project: unknown;
        try {
            health = await fetchIdentityJson(fetchImpl, `http://${host}:${port}/api/health`, requestTimeoutMs);
            project = await fetchIdentityJson(fetchImpl, `http://${host}:${port}/api/project`, requestTimeoutMs);
        } catch (err) {
            if (err instanceof HostUnavailableError) {
                continue;
            }
            return `identity endpoint failed closed (${err instanceof Error ? err.message : String(err)})`;
        }
        if (typeof health !== 'object' || health === null || (health as { service?: unknown }).service !== 'spur') {
            return 'listener is not a Spur server';
        }
        const projectPath =
            typeof project === 'object' && project !== null ? (project as { path?: unknown }).path : undefined;
        if (typeof projectPath !== 'string' || projectPath.length === 0) {
            return 'server did not report a project path';
        }
        if (normalizeProjectPath(projectPath) !== expectedPath) {
            return `server project path ${normalizeProjectPath(projectPath)} does not match ${expectedPath}`;
        }
        return undefined;
    }
    return 'identity endpoints unreachable on 127.0.0.1 and ::1';
}

/**
 * Verify the listener on the entry's port is a Spur server for this exact
 * project: discover the PID (rejecting self/parent/system PIDs), probe the
 * documented HTTP identity, then rediscover the PID unchanged.
 */
async function verifyProjectListener(
    entry: ProjectEntry,
    options: StopRegisteredProjectOptions,
): Promise<{ pid: number } | { error: string }> {
    const executor = options.processExecutor ?? new NodeProcessExecutor();
    const fetchImpl = options.fetchImpl ?? testFetchImpl ?? fetch;
    const requestTimeoutMs = options.requestTimeoutMs ?? 1000;
    const expectedPath = normalizeProjectPath(entry.path);

    const pid = await findListeningPid(entry.port, executor);
    if (pid === undefined) {
        return { error: 'no listening PID found' };
    }
    if (pid <= 1 || pid === process.pid || pid === process.ppid) {
        return { error: `unsafe PID ${pid} (self, parent, or system)` };
    }

    const identityError = await probeOwnershipIdentity(entry.port, expectedPath, fetchImpl, requestTimeoutMs);
    if (identityError !== undefined) {
        return { error: identityError };
    }

    const pidAfter = await findListeningPid(entry.port, executor);
    if (pidAfter !== pid) {
        return { error: 'listener PID changed during ownership verification' };
    }
    return { pid };
}

async function waitForPortDeath(port: number, timeoutMs: number): Promise<boolean> {
    const maxTicks = Math.max(1, Math.ceil(timeoutMs / POLL_INTERVAL_MS));
    for (let tick = 0; tick < maxTicks; tick++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (!(await isPortLive(port))) {
            return true;
        }
    }
    return false;
}

/**
 * Stop the listener registered for a project, only after ownership verification.
 *
 * - Absent listener (or port <= 0): idempotent success, no signal, no terminated record.
 * - Unverified live listener: refusal; the caller preserves the port and reports
 *   through its existing error channel.
 * - Verified listener: SIGTERM, bounded wait, SIGKILL only when ownership fully
 *   revalidates with the same PID. Termination is reported only after the
 *   original listener is observed gone; a replacement PID is never signaled.
 */
export async function stopRegisteredProject(
    entry: ProjectEntry,
    options: StopRegisteredProjectOptions = {},
): Promise<StopRegisteredProjectResult> {
    const port = entry.port;
    const killTimeoutMs = options.killTimeoutMs ?? 2000;
    if (port <= 0) {
        return { stopped: true };
    }
    if (!(await isPortLive(port))) {
        return { stopped: true };
    }

    const refuse = (detail: string): StopRegisteredProjectResult => ({
        stopped: false,
        reason: `Refused to stop project "${entry.name}" on port ${port}: ${detail}`,
    });

    const verified = await verifyProjectListener(entry, options);
    if ('error' in verified) {
        return refuse(verified.error);
    }
    const pid = verified.pid;

    if (!sendSignalToPid(pid, 'SIGTERM')) {
        return refuse(`SIGTERM could not be delivered to PID ${pid}`);
    }
    if (await waitForPortDeath(port, killTimeoutMs)) {
        return { stopped: true, terminated: { pid, port, signal: 'SIGTERM' } };
    }

    // Escalation revalidates everything: a replacement listener (different PID,
    // foreign identity, or unreadable identity after shutdown) is never SIGKILLed.
    const reverified = await verifyProjectListener(entry, options);
    if ('error' in reverified) {
        return refuse(`ownership revalidation failed before SIGKILL (${reverified.error})`);
    }
    if (reverified.pid !== pid) {
        return refuse('listener PID changed before SIGKILL (replacement listener)');
    }
    if (!sendSignalToPid(pid, 'SIGKILL')) {
        return refuse(`SIGKILL could not be delivered to PID ${pid}`);
    }
    if (await waitForPortDeath(port, killTimeoutMs)) {
        return { stopped: true, terminated: { pid, port, signal: 'SIGKILL' } };
    }
    return refuse(`listener PID ${pid} still alive after SIGKILL`);
}
