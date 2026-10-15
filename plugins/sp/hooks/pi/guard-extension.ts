/**
 * Pi extension for the Spur (sp) plugin — a thin wrapper over `spur self hook <id> --host pi`
 * (script-absorption plan §5.3). Pi can only load in-process TypeScript, blocking needs a return
 * value and `ask` needs `ctx.ui.confirm`, so this adapter stays; every policy (task-file ownership,
 * destructive-command classification, Pi→ledger normalization, lifecycle states) lives in spur.
 *
 * Guards await spur's `{action, reason}` verdict; capture/lifecycle events run on one serial queue
 * (ledger order = event order) that `session_shutdown` drains. spur missing, slow or broken → allow.
 *
 * Install: declared in plugin.json `extensions.pi`, or reference this file from
 * `~/.pi/agent/settings.json` → `"pi": { "extensions": ["path/to/guard-extension.ts"] }`.
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { runSpurHookAsync } from '../../lib/spur-hook';

/** spur's Pi verdict; anything unparseable is `allow`. */
interface Verdict {
    action: 'allow' | 'deny' | 'ask';
    reason?: string;
}

const sessionId = (ctx: ExtensionContext): string => ctx.sessionManager.getSessionId().trim();
const send = (id: string, payload: Record<string, unknown>, timeoutMs: number) =>
    runSpurHookAsync(id, JSON.stringify(payload), { host: 'pi', cwd: process.cwd(), timeoutMs });

async function guard(id: string, payload: Record<string, unknown>): Promise<Verdict> {
    try {
        const verdict = JSON.parse((await send(id, payload, 5_000))?.stdout ?? '') as Verdict;
        return verdict.action === 'deny' || verdict.action === 'ask' ? verdict : { action: 'allow' };
    } catch {
        return { action: 'allow' };
    }
}

let queue: Promise<unknown> = Promise.resolve();
/** Append one capture/lifecycle event to the serial queue; the returned promise settles when it ran. */
function enqueue(id: string, payload: Record<string, unknown>): Promise<unknown> {
    queue = queue.then(() => send(id, payload, 10_000)).catch(() => undefined);
    return queue;
}

export default function (pi: ExtensionAPI): void {
    pi.on('tool_call', async (event, ctx) => {
        const input = (event.input ?? {}) as Record<string, unknown>;
        const path = typeof input.path === 'string' ? input.path : String(input.file_path ?? '');
        if ((event.toolName === 'write' || event.toolName === 'edit') && path.endsWith('.md')) {
            const verdict = await guard('task-write-guard', { toolName: event.toolName, input });
            if (verdict.action === 'deny') {
                ctx.ui.notify(verdict.reason ?? '', 'error');
                return { block: true, reason: verdict.reason };
            }
        }
        if (event.toolName === 'bash') {
            const verdict = await guard('careful-guard', { toolName: event.toolName, input });
            if (verdict.action === 'ask') {
                ctx.ui.notify(verdict.reason ?? '', 'warning');
                if (!(await ctx.ui.confirm('Destructive command', verdict.reason ?? ''))) {
                    return { block: true, reason: 'Cancelled by user' };
                }
            }
        }
        return {};
    });

    pi.on('tool_result', async (event, ctx) => {
        const { toolName, input } = event;
        void enqueue('context-post-tool', { toolName, input, content: event.content, sessionId: sessionId(ctx) });
    });
    pi.on('session_start', async (_event, ctx) => {
        void enqueue('context-session-start', { event: 'session_start', sessionId: sessionId(ctx) });
    });
    pi.on('session_shutdown', async (_event, ctx) => {
        await enqueue('context-session-stop', { event: 'session_shutdown', sessionId: sessionId(ctx) });
    });
    // Fleet lifecycle (working / idle); spur makes it a no-op outside a fleet.
    pi.on('agent_start', async () => void enqueue('agent-lifecycle', { event: 'agent_start' }));
    pi.on('agent_settled', async () => void enqueue('agent-lifecycle', { event: 'agent_settled' }));
}
