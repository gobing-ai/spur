/**
 * Coordination tools: the agent roster and the inbox send/inbox/reply round trip.
 *
 * Task 1445 R7 split: the descriptors and handlers that used to sit in `index.ts`, moved here
 * verbatim so each domain owns one file.
 */
import { InvalidArgumentsError, type McpToolDescriptor } from './protocol';
import { optionalString, READ_TOOL, requiredString, type ToolHandler, WRITE_TOOL } from './tools-shared';

/** Descriptor rows the module entry composes into `TOOL_DESCRIPTORS`. */
export const descriptors: McpToolDescriptor[] = [
    {
        name: 'sp_agent_status',
        annotations: READ_TOOL,
        description:
            'Report the project roster: addressable agent specs plus the declared fleet members with their executor binding. Read-only.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'sp_message_send',
        annotations: WRITE_TOOL,
        description:
            'Enqueue one inbox message for an agent. `from` is caller-supplied: the bearer token is the trust boundary.',
        inputSchema: {
            type: 'object',
            properties: {
                to: { type: 'string', description: 'Recipient agent id' },
                from: { type: 'string', description: 'Sender id' },
                body: { type: 'string', description: 'Message body' },
            },
            required: ['to', 'from', 'body'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_message_inbox',
        annotations: READ_TOOL,
        description:
            "List one member's inbox page (mode list, the default) or the request feed (mode requests). Read-only.",
        inputSchema: {
            type: 'object',
            properties: {
                member: { type: 'string', description: 'Agent id whose inbox is read' },
                mode: { type: 'string', enum: ['list', 'requests'], description: 'Inbox page or request feed' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'sp_message_reply',
        annotations: WRITE_TOOL,
        description:
            'Thread a reply to a message, addressed back to its sender. The reply is written as the original recipient.',
        inputSchema: {
            type: 'object',
            properties: {
                messageId: { type: 'string', description: 'Message id to reply to' },
                body: { type: 'string', description: 'Reply body' },
            },
            required: ['messageId', 'body'],
            additionalProperties: false,
        },
    },
];

/** One handler per descriptor name; the module entry's dispatcher delegates here. */
export const dispatch: Record<string, ToolHandler> = {
    sp_agent_status: async (ctx, _args) => {
        return {
            agents: await ctx.coordination().listAgentSpecs(),
            members: await ctx.coordination().listFleetMembers(),
        };
    },
    sp_message_send: async (ctx, args) => {
        return ctx.inbox().send({
            from: requiredString(args, 'from'),
            to: requiredString(args, 'to'),
            body: requiredString(args, 'body'),
        });
    },
    sp_message_inbox: async (ctx, args) => {
        const member = optionalString(args, 'member');
        if (optionalString(args, 'mode') === 'requests') return ctx.inbox().requests(member);
        if (member === undefined) {
            throw new InvalidArgumentsError('sp_message_inbox requires member for mode "list"');
        }
        return ctx.inbox().list(member, 'in');
    },
    sp_message_reply: async (ctx, args) => {
        const messageId = requiredString(args, 'messageId');
        const original = await ctx.inbox().get(messageId);
        if (original === null) throw new Error(`message ${messageId} not found`);
        // Reply as the original recipient, the peer the sender is talking to (as the CLI does).
        return ctx.inbox().reply(messageId, original.toId, requiredString(args, 'body'));
    },
};
