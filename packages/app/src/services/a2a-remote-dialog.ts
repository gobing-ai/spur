import type { ProjectEntry } from '@gobing-ai/spur-config';
import { type InboxMessage, type IntegrationsOutboundMember, inboxMessageSchema } from '@gobing-ai/spur-contracts';
import { resolveProjectGatewayBase } from './a2a-member-address';

/** A2A R4 (1468) — the remote read never leaves the loopback interface and never waits long. */
const REMOTE_DIALOG_TIMEOUT_MS = 2_000;

/**
 * The remote half of an A2A dialog, or the marker that explains why there is none (feature A822).
 *
 * A discriminated union, never a throw: an outbound receipt renders one of three things — the
 * remote transcript, "that peer is not behind this gateway", or "the read failed and here is why".
 */
export type RemoteDialogResult =
    | { status: 'remote'; messages: InboxMessage[] }
    | { status: 'outside-gateway' }
    | { status: 'unavailable'; reason: string };

/** Everything the read needs; the registry and gateway port are injected, never read from here. */
export interface ReadRemoteDialogInput {
    /** The outbound member the receipt belongs to (`kind: 'a2a' | 'project'`). */
    member: Pick<IntegrationsOutboundMember, 'kind' | 'target'>;
    /** The `remoteContextId` the receipt persisted — the remote inbox thread root. */
    remoteContextId: string | null | undefined;
    gatewayPort: number;
    listProjects: () => Promise<ProjectEntry[]>;
    fetchImpl?: typeof fetch;
}

/**
 * Read the remote side of an outbound A2A turn through the local gateway (1468 R1/R2/R4).
 *
 * Only a registry-resolved `project` member is same-gateway; an `a2a` member or a project with no
 * local registry entry is marked `outside-gateway` WITHOUT a fetch, because guessing a peer's
 * address is exactly what the feature forbids. The read is loopback-only, follows no redirect and
 * forwards no credential: the remote project authenticates its own gateway, not this one's token.
 */
export async function readRemoteDialog(input: ReadRemoteDialogInput): Promise<RemoteDialogResult> {
    if (input.member.kind !== 'project') return { status: 'outside-gateway' };

    const contextId = (input.remoteContextId ?? '').trim();
    if (contextId === '') return { status: 'unavailable', reason: 'the receipt recorded no remote context id' };

    // `target` is `project` or `project/member`; the dialog lives on the project's gateway base.
    const project = input.member.target.split('/')[0] ?? '';
    const resolved = await resolveProjectGatewayBase({
        project,
        gatewayPort: input.gatewayPort,
        listProjects: input.listProjects,
        ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    });
    if ('error' in resolved) {
        // Another host, or a name this registry does not know: a peer we cannot claim to read.
        return resolved.reason === 'no-entry' || resolved.reason === 'remote-host'
            ? { status: 'outside-gateway' }
            : { status: 'unavailable', reason: resolved.error };
    }

    const url = `${resolved.base}/api/inbox/messages/${encodeURIComponent(contextId)}/thread`;
    let response: Response;
    try {
        response = await (input.fetchImpl ?? fetch)(url, {
            method: 'GET',
            // R4: no credential headers, no redirect following — a 3xx is a failure, not a detour.
            headers: { accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(REMOTE_DIALOG_TIMEOUT_MS),
        });
    } catch (error) {
        return { status: 'unavailable', reason: describeFetchFailure(error) };
    }
    if (!response.ok) return { status: 'unavailable', reason: `remote thread read failed: HTTP ${response.status}` };

    const parsed = inboxMessageSchema.array().safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) return { status: 'unavailable', reason: 'remote thread body is not an inbox message list' };
    // Oldest first, whatever order the peer used: the dialog reads top-down on the Board.
    const messages = [...parsed.data].sort((left, right) => left.createdAt - right.createdAt);
    return { status: 'remote', messages };
}

/** A fetch failure in the caller's words: a timeout and a dead socket read differently to an operator. */
function describeFetchFailure(error: unknown): string {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
        return `remote thread read timed out after ${REMOTE_DIALOG_TIMEOUT_MS} ms`;
    }
    const message = error instanceof Error ? error.message : String(error);
    return `remote thread read failed: ${message}`;
}
