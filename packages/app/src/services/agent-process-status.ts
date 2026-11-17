import type { MemberSessionObservation } from '@gobing-ai/spur-domain';

/** Process facts shared by standalone agent status and the read-only self aggregate. */
export interface AgentProcessStatus {
    status: 'running' | 'stopped' | 'errored' | 'unknown';
    pid: number | null;
    session?: MemberSessionObservation;
}

/** Normalize supervisor states to the public agent-status vocabulary. */
export function mapAgentProcessStatus(status: string): AgentProcessStatus['status'] {
    switch (status) {
        case 'running':
        case 'errored':
            return status;
        case 'stopped':
        case 'exited':
            return 'stopped';
        default:
            return 'unknown';
    }
}

/** Read the supervisor's agentId-keyed wire shape without opening a project database. */
export async function fetchAgentProcesses(
    server: string,
    options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Map<string, AgentProcessStatus> | null> {
    try {
        const response = await (options.fetchImpl ?? fetch)(`${server}/processes`, {
            method: 'GET',
            redirect: 'error',
            signal: options.signal ?? AbortSignal.timeout(1500),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { processes?: unknown };
        if (!Array.isArray(body?.processes)) return null;
        const processes = new Map<string, AgentProcessStatus>();
        for (const raw of body.processes) {
            if (raw === null || typeof raw !== 'object') continue;
            const row = raw as {
                agentId?: unknown;
                status?: unknown;
                pid?: unknown;
                session?: MemberSessionObservation;
            };
            if (typeof row.agentId !== 'string' || typeof row.status !== 'string') continue;
            processes.set(row.agentId, {
                status: mapAgentProcessStatus(row.status),
                pid: typeof row.pid === 'number' ? row.pid : null,
                ...(row.session === undefined ? {} : { session: row.session }),
            });
        }
        return processes;
    } catch {
        return null;
    }
}
