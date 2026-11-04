import type { AgentService, InboxMessage, UnresolvedDelivery } from '@gobing-ai/spur-app';
import { DEFAULT_STALL_MS, FleetService, InboxService, normalizeProjectPath, WaitError } from '@gobing-ai/spur-app';
import type { SystemEventDao, SystemEventRow } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';

/** Default sender used for operator-originated messages. */
export const DEFAULT_FROM = 'operator';

/** Default poll interval for `spur message watch` (ms). */
export const DEFAULT_WATCH_INTERVAL_MS = 2000;

/** The inbox plane this command talks to (G11 R5: every `message` verb calls InboxService). */
export function inboxOf(context: CliContext): InboxService {
    return new InboxService({ getDb: () => context.getDb() });
}

/** The project's orchestrator member address, or null when none is bound (never a guessed id). */
export async function resolveOrchestratorAddress(context: CliContext): Promise<string | null> {
    let fleet: FleetService;
    try {
        fleet = new FleetService({
            fs: context.fs,
            spurConfig: await context.loadAgentConfig(context.cwd),
            roles: context.agentRoles,
            openDb: () => context.getDb(),
        });
    } catch (error) {
        // A config the loader rejects is a real fault, not "no orchestrator": say so instead of
        // pretending the project simply has none.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`message send could not load the project config: ${message}`);
    }
    const { state, instanceId } = await fleet.resolveOrchestrator(normalizeProjectPath(context.cwd));
    if (state === 'missing' || state === 'unresolvable') return null;
    return typeof instanceId === 'string' && instanceId !== '' ? instanceId : null;
}

/** Format a single inbox row for plain-text listing (body truncated). */
export function formatInboxLine(entry: InboxMessage): string {
    const from = entry.fromId || DEFAULT_FROM;
    const body = entry.body.length > 60 ? `${entry.body.slice(0, 57)}...` : entry.body;
    return `${entry.id}\t${entry.status}\t${from}\t${body}\t${new Date(entry.createdAt).toISOString()}`;
}

/** Widen one inbox row with the 0834 fields: attempts, last error, hold reason, run correlation. */
export function widenInboxRow(
    entry: InboxMessage,
    hold?: UnresolvedDelivery,
): InboxMessage & {
    injectAttempts: number;
    injectError: string | null;
    reason?: string;
    runId?: string;
    taskId?: string | null;
    runStatus?: string;
    artifacts: UnresolvedDelivery['artifacts'];
} {
    return {
        ...entry,
        injectAttempts: entry.attempts,
        injectError: entry.error ?? null,
        ...(hold?.reason !== undefined ? { reason: hold.reason } : {}),
        ...(hold?.runId !== undefined ? { runId: hold.runId } : {}),
        taskId: hold?.taskId ?? null,
        ...(hold?.runStatus !== undefined ? { runStatus: hold.runStatus } : {}),
        artifacts: hold?.artifacts ?? [],
    };
}

/**
 * Wait until the SENT message leaves `queued` (G11 R2), bounded by the caller's timeout and a
 * stall check: an occupant that never moves the row is a stall, not a wait.
 */
export async function waitForMessageClaim(
    context: CliContext,
    msgId: string,
    agentService: AgentService,
    pin: { specId: string; runId: string; generation: number },
    timeoutMs: number | undefined,
    signal?: AbortSignal,
): Promise<void> {
    const start = Date.now();
    const deadline = timeoutMs === undefined ? Number.POSITIVE_INFINITY : start + timeoutMs;
    const stallMs = Math.min(timeoutMs ?? DEFAULT_STALL_MS, DEFAULT_STALL_MS);
    let lastPending = -1; // -1 = not yet sampled
    for (;;) {
        if (signal?.aborted) throw new WaitError('timeout', 'wait aborted');
        const clock = Date.now();
        if (clock >= deadline) throw new WaitError('timeout', `wait timed out after ${timeoutMs}ms`);
        const occupant = await agentService.getOccupant({ specId: pin.specId });
        if (occupant === null) throw new WaitError('occupant_gone', `occupant for specId "${pin.specId}" is gone`);
        if (occupant.runId !== pin.runId) throw new WaitError('run_replaced', `run ${pin.runId} replaced`);
        if (occupant.generation > pin.generation) throw new WaitError('run_replaced', `generation bumped`);
        // The sent row's own status is the signal (G11 R2). `queued` means nobody took it yet;
        // anything else (claimed/delivered/failed) means this message was consumed.
        const row = await inboxOf(context).get(msgId);
        if (row === null) throw new WaitError('occupant_gone', `message ${msgId} disappeared`);
        const pending = row.status === 'queued' ? 1 : 0;
        // Progress = the row moved (a claim, a delivery, a failure). A row that never moves
        // from an idle occupant is a stall, not a wait.
        const progressed = lastPending >= 0 && pending !== lastPending;
        if (pending === 0) return;
        if (lastPending >= 0 && !progressed && clock - start >= stallMs) {
            throw new WaitError('wait_stalled', `inbox not draining within ${stallMs}ms`);
        }
        lastPending = pending;
        await sendSleep(100, signal);
    }
}

/** Cancellable sleep for the send wait path; resolves immediately when the signal aborted. */
export function sendSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}

/** Parse a positive integer millisecond interval, or null when the value is not one. */
export function parseInterval(raw: string): number | null {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

/** Parse a positive millisecond timeout, or undefined when absent; throws on a bad value. */
export function parseTimeout(raw: string | boolean | undefined): number | undefined {
    if (raw === undefined || typeof raw === 'boolean') return undefined;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --timeout "${raw}" (expected a positive integer ms)`);
    }
    return n;
}

/** Emit a `--wait` failure through the JSON/text seam and return its exit code. */
export function sendWaitFail(
    context: CliContext,
    options: { json?: boolean; jsonEnvelope?: boolean },
    code: string,
    message: string,
): number {
    if (options.json) {
        context.output.write(
            toEnvelopeJson(
                { error: { code, message } },
                {
                    enveloped: options.jsonEnvelope,
                    error: { code: 'INTERNAL_ERROR', message: message, details: { cliCode: code } },
                },
            ),
        );
    } else {
        context.output.error(`${code}: ${message}`);
    }
    return 1;
}

/** The newest invoke lifecycle event for one run, or null when the ledger has none. */
export async function readLatestInvokeEvent(
    dao: SystemEventDao,
    runId: string,
): Promise<{ eventName: string; sequence: number | null } | null> {
    const rows: SystemEventRow[] = await dao.query({
        run_id: runId,
        names: ['agent.invoke.start', 'agent.invoke.exit'],
        limit: 1,
    });
    const row = rows[0];
    if (row === undefined) return null;
    return { eventName: row.event_name, sequence: row.sequence };
}
