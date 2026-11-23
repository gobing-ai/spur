/**
 * A2A wire projection (feature G9 task 1336).
 *
 * The HTTP+JSON binding of A2A v1.0 (specification/a2a.proto `google.api.http` annotations) uses
 * lowerCamelCase JSON with proto3 enum names (`ROLE_USER`, `TASK_STATE_*`). Everything here is a
 * pure projection: the durable truth stays in the inbox and `coordination_runs`, and a restart
 * changes nothing because no state is held in this process.
 */

import { A2A_WRITE_FENCING_EXTENSION } from '@gobing-ai/spur-app';

/** The one protocol version this surface speaks (R2). */
export const A2A_PROTOCOL_VERSION = '1.0';

/** The only binding this surface speaks — streaming, push and gRPC are declared absent (R2). */
export const A2A_PROTOCOL_BINDING = 'HTTP+JSON';

/** A Spur member that fences its own working tree may accept write-shaped work (1337 R3). */
export { A2A_WRITE_FENCING_EXTENSION };

/** A2A task states (`TaskState` enum) this surface can report. */
export type A2ATaskState =
    | 'TASK_STATE_SUBMITTED'
    | 'TASK_STATE_WORKING'
    | 'TASK_STATE_COMPLETED'
    | 'TASK_STATE_FAILED'
    | 'TASK_STATE_CANCELED';

/** A message part. v1 carries text only, so a non-text part never reaches the wire. */
export interface A2APart {
    text: string;
}

/** The `Message` object echoed in a task's history/status. */
export interface A2AMessage {
    messageId: string;
    role: 'ROLE_USER' | 'ROLE_AGENT';
    parts: A2APart[];
}

/** The `Task` object `SendMessage` and `GetTask` answer with. */
export interface A2ATask {
    id: string;
    contextId: string;
    status: { state: A2ATaskState; message?: A2AMessage; timestamp?: string };
    artifacts?: { artifactId: string; parts: A2APart[] }[];
    history?: A2AMessage[];
    /** Spur-specific task metadata; A2A permits custom key/value metadata. */
    metadata?: { remoteBranch?: string; runStopped?: boolean };
}

/** One Agent Card for one live member (R2). */
export interface AgentCardInput {
    /** The member's inbox address (`<projectSlug>-<memberLocalId>`). */
    instanceId: string;
    /** Resolved executor name, for the human-readable description. */
    executor: string;
    /** Absolute origin the caller reached, so the advertised interface URL matches it. */
    origin: string;
    /** Layer-1 role id from the member declaration; absent yields the default `general` skill (1421 R4). */
    role?: string;
    /** The member's human description (`purpose` in the fleet declaration), used as the skill text. */
    purpose?: string;
}

/**
 * The origin a card advertises (1395 R4).
 *
 * Behind the gateway the incoming `host` is the upstream loopback authority, so the card must build
 * its interface URL from the forwarded identity instead — otherwise it advertises an ephemeral serve
 * port that dies on the next restart. The upstream binds loopback only, so these headers can come
 * from a local process, and they affect the advertised URL alone: never authentication.
 */
export function cardOrigin(
    forwarded: { host?: string | null; prefix?: string | null; proto?: string | null },
    fallback: string,
): string {
    const host = forwarded.host?.trim() ?? '';
    const prefix = forwarded.prefix?.trim() ?? '';
    if (host === '' || prefix === '') return fallback;
    const proto = forwarded.proto?.split(',')[0]?.trim().toLowerCase() === 'https' ? 'https' : 'http';
    return `${proto}://${host}${prefix.replace(/\/+$/, '')}`;
}

/** Build the card: protocol 1.0, HTTP+JSON only, streaming and push declared false. */
export function agentCard(input: AgentCardInput): Record<string, unknown> {
    const description = `Spur fleet member ${input.instanceId}${input.executor === '' ? '' : ` (${input.executor})`}`;
    // 1421 R4: an A2A caller selects work by skill, so the card advertises the member's declared
    // role — and a member with no role still offers one skill rather than an empty array.
    const skill = input.role ?? 'general';
    return {
        name: input.instanceId,
        description,
        version: '1.0.0',
        supportedInterfaces: [
            {
                url: `${input.origin}/a2a/members/${encodeURIComponent(input.instanceId)}`,
                protocolBinding: A2A_PROTOCOL_BINDING,
                protocolVersion: A2A_PROTOCOL_VERSION,
            },
        ],
        capabilities: {
            streaming: false,
            pushNotifications: false,
            extensions: [{ uri: A2A_WRITE_FENCING_EXTENSION, description: 'The member fences its own working tree' }],
        },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [
            {
                id: skill,
                name: skill,
                description: input.purpose ?? description,
                tags: [skill],
            },
        ],
    };
}

/** The A2A error envelope (proto3 JSON `google.rpc.Status` with `ErrorInfo` details). */
export function a2aError(
    code: number,
    status: string,
    message: string,
    detail?: { reason: string; metadata?: Record<string, string> },
): { error: Record<string, unknown> } {
    return {
        error: {
            code,
            status,
            message,
            ...(detail === undefined
                ? {}
                : {
                      details: [
                          {
                              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                              domain: 'a2a-protocol.org',
                              reason: detail.reason,
                              ...(detail.metadata === undefined ? {} : { metadata: detail.metadata }),
                          },
                      ],
                  }),
        },
    };
}

/** Join the text parts of a caller message; non-text parts are ignored (v1 is text-only). */
export function textParts(parts: unknown): string {
    if (!Array.isArray(parts)) return '';
    return parts
        .flatMap((part) =>
            typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
                ? [(part as { text: string }).text]
                : [],
        )
        .join('\n')
        .trim();
}

/**
 * Map the durable record onto an A2A task state (R4) — the inverse of design §4.2's sender-side
 * table. A cancel intent outranks the receipt: the run exits `errored` when stopped, and the
 * caller must still read `canceled` (R5/AC4).
 */
export function projectState(input: {
    canceled: boolean;
    runStatus: 'running' | 'exited' | 'errored' | null;
    messageStatus: string;
}): A2ATaskState {
    if (input.canceled) return 'TASK_STATE_CANCELED';
    if (input.runStatus === 'exited') return 'TASK_STATE_COMPLETED';
    if (input.runStatus === 'errored') return 'TASK_STATE_FAILED';
    if (input.runStatus === 'running') return 'TASK_STATE_WORKING';
    if (input.messageStatus === 'failed') return 'TASK_STATE_FAILED';
    if (input.messageStatus === 'claimed') return 'TASK_STATE_WORKING';
    return 'TASK_STATE_SUBMITTED';
}
