import type { Command } from '@commander-js/extra-typings';
import {
    createPsProcessIdentityReader,
    findAgentAncestor,
    GUEST_LEASE_TTL_MS,
    GuestLeaseRenewer,
    type GuestRecord,
    type ProcessIdentity,
    type ProcessIdentityReader,
    shQuote,
} from '@gobing-ai/spur-app';
import { getEnvVars } from '@gobing-ai/spur-config';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { resolveSpurArgv } from '../../workflow/resolve-spur-bin';
import { SHARED_OPTIONS } from '../shared-options';
import { guestService, guestUsageError, hostSessionId } from './shared';

/**
 * Env marker that turns a re-invoked `agent join` into the detached lease renewer
 * (G75 R1). Set only on the renewer's own launch, never inherited by the join itself.
 */
export const GUEST_RENEWER_ENV = 'SPUR_GUEST_RENEWER';

/** Renewal interval: a third of the lease TTL, mirroring the owner timer (`agent-loop-service`). */
export const GUEST_RENEWAL_INTERVAL_MS = Math.floor(GUEST_LEASE_TTL_MS / 3);

/**
 * Test seam for the renewer's launch argv. In-process tests run under the test runner, where
 * `Bun.main` is the test file — so `resolveSpurArgv()` cannot name the CLI. Production leaves
 * this undefined and the resolver runs.
 */
export let _testRenewerArgv: string[] | undefined;

/** Replace (or clear, with `undefined`) the renewer launch argv for the current test. */
export function setGuestRenewerArgvForTesting(argv: string[] | undefined): void {
    _testRenewerArgv = argv;
}

/**
 * `spur agent join` (G73 R2/R3, task 1081). Registers a guest occupant with a heartbeat
 * lease; the guest is never supervised and never a stage target. Expired guests are
 * retired first, so a stale record can never block a re-join with the same id.
 *
 * G75 R1/R2 (task 1279): the record carries the **agent** process fingerprint — never the
 * short-lived CLI pid — and a verified identity gets a detached lease renewer, so 90 seconds
 * of work with no inbox wait no longer lets the lease expire.
 */
export async function runAgentJoin(
    context: CliContext,
    flags: {
        role: string;
        id?: string;
        sessionId?: string;
        pid?: number;
        executor?: string;
        member?: string;
        json: boolean;
        enveloped?: boolean;
    },
): Promise<number> {
    // The renewer re-invokes this command (same bin, same argv) with the marker set. That
    // branch renews and exits; it never joins, so a renewer can never create a second guest.
    const renewerFor = context.env[GUEST_RENEWER_ENV];
    if (renewerFor !== undefined && renewerFor !== '') {
        return await runGuestRenewer(context, renewerFor);
    }

    const service = guestService(context);
    await service.expire();
    const reader = createPsProcessIdentityReader();
    const identity = await resolveGuestIdentity(flags, reader);
    const identityFields =
        identity !== null
            ? {
                  pid: identity.pid,
                  processStartedAt: identity.startedAt,
                  executable: identity.executable,
                  identity: 'verified' as const,
              }
            : { identity: 'unverified' as const };
    const sessionId = hostSessionId(context, flags.sessionId);
    const executorField = flags.executor !== undefined ? { executor: flags.executor } : {};
    if (flags.member !== undefined) {
        // G75 R3 (task 1281): bind a declared member instead of joining as a plain guest. The
        // service owns the fencing; the roster/capability proof arrives through its seams.
        const bound = await service.bindMember({
            memberId: flags.member,
            role: flags.role,
            ...(sessionId !== undefined ? { sessionId } : {}),
            ...identityFields,
            ...executorField,
        });
        if (!bound.ok) {
            return guestUsageError(context, flags, `${bound.code}: ${bound.message}`);
        }
        if (bound.guest.identity === 'verified') await ensureRenewer(context, bound.guest, reader);
        if (flags.json) {
            context.output.write(toEnvelopeJson({ guest: bound.guest }, { enveloped: flags.enveloped }));
        } else {
            const binding = bound.guest.memberBinding;
            context.output.write(
                `guest ${bound.guest.id} bound to member ${binding?.memberId ?? bound.guest.id} as ${bound.guest.role}` +
                    ` (occupancy ${binding?.occupancyGeneration ?? 0}, stage-eligible ${binding?.stageEligible === true})`,
            );
        }
        return 0;
    }
    const result = await service.join({
        role: flags.role,
        ...(flags.id !== undefined ? { id: flags.id } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...identityFields,
        ...executorField,
    });
    if (!result.ok) {
        return guestUsageError(context, flags, result.message);
    }
    const { guest } = result;
    if (guest.identity === 'verified') await ensureRenewer(context, guest, reader);
    if (flags.json) {
        context.output.write(toEnvelopeJson({ guest }, { enveloped: flags.enveloped }));
    } else {
        context.output.write(
            `guest ${guest.id} joined as ${guest.role}${guest.sessionId !== null ? ` (session ${guest.sessionId})` : ''}`,
        );
    }
    return 0;
}

/**
 * The guest's agent process: an explicitly supplied `--pid` (verified as-is) or the nearest
 * ancestor whose executable is the executor. Null means unverified — the record then holds
 * no pid at all, because a dead CLI pid would read as liveness that does not exist.
 */
async function resolveGuestIdentity(
    flags: { pid?: number; executor?: string },
    reader: ProcessIdentityReader,
): Promise<ProcessIdentity | null> {
    if (flags.pid !== undefined) return await reader.read(flags.pid);
    return await findAgentAncestor(
        process.ppid,
        reader,
        flags.executor !== undefined ? { executors: [flags.executor] } : {},
    );
}

/** Run the bounded renewal loop for one guest, then exit 0 — every stop reason is terminal. */
async function runGuestRenewer(context: CliContext, guestId: string): Promise<number> {
    const service = guestService(context);
    const record = await service.read(guestId);
    if (record === null) return 0;
    const reader = createPsProcessIdentityReader();
    // Claim the renewer slot with our own fingerprint: a rejoin then sees a live owner and
    // spawns no second renewer (R4), and a reused pid cannot pass for one.
    const self = await reader.read(process.pid);
    if (self !== null) await service.attachRenewer(guestId, { pid: self.pid, startedAt: self.startedAt });
    const renewer = new GuestLeaseRenewer({
        guests: service,
        identity: verifiedFingerprint(record),
        reader,
        intervalMs: GUEST_RENEWAL_INTERVAL_MS,
        onTickError: (error) => context.output.error(`guest ${guestId} renewal tick failed: ${String(error)}`),
    });
    const reason = await renewer.run(guestId);
    // A detached renewer's stderr is /dev/null; a foreground run (or a host that keeps it)
    // gets the one line that explains why renewal ended.
    context.output.error(`guest ${guestId} lease renewal stopped: ${reason}`);
    return 0;
}
/** The record's fingerprint when it claims a verified agent process, else null. */
function verifiedFingerprint(record: GuestRecord): { pid: number; startedAt: string } | null {
    if (record.identity !== 'verified' || record.pid === null || record.processStartedAt === undefined) return null;
    return { pid: record.pid, startedAt: record.processStartedAt };
}

/** Spawn the detached renewer unless one is already live for this guest (R4: one, not two). */
async function ensureRenewer(context: CliContext, guest: GuestRecord, reader: ProcessIdentityReader): Promise<void> {
    if (guest.renewerPid !== null) {
        const live = await reader.read(guest.renewerPid);
        const sameRenewer = live !== null && (guest.renewerStartedAt ?? live.startedAt) === live.startedAt;
        if (sameRenewer) return;
    }
    await spawnGuestRenewer(context, guest);
}

/**
 * Launch `spur agent join --role <role> --id <id>` detached with {@link GUEST_RENEWER_ENV}
 * set, reusing the async-workflow-worker precedent (`nohup` + ProcessExecutor, no direct
 * child_process.spawn). The renewer records its own pid, so no pid capture is needed here.
 * POSIX only: identity comes from `ps`, so a host without it never verifies — and a
 * detached launch on such a host would be unverifiable renewal, which is worse than none.
 */
async function spawnGuestRenewer(context: CliContext, guest: GuestRecord): Promise<void> {
    const argv = [...(_testRenewerArgv ?? resolveSpurArgv()), 'agent', 'join', '--role', guest.role, '--id', guest.id];
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(getEnvVars())) {
        if (value !== undefined) env[key] = value;
    }
    env[GUEST_RENEWER_ENV] = guest.id;
    await new NodeProcessExecutor().run({
        command: '/bin/sh',
        args: ['-c', `nohup ${argv.map(shQuote).join(' ')} </dev/null >/dev/null 2>&1 &`],
        cwd: context.cwd,
        env,
        forceBuffered: true,
        rejectOnError: false,
    });
}

/** Register `spur agent join`. */
export function registerAgentJoinCommand(agent: Command, context: CliContext): void {
    agent
        .command('join')
        .description('Join the fleet as a guest occupant (a live session that pulls its own work).')
        .requiredOption('--role <name>', 'Layer-1 role the guest occupies (scribe | coder | reviewer | planner)')
        .option('--id <id>', 'Guest id (defaults to <role>-g<n>)')
        .option('--session-id <sid>', 'Host session id (defaults to CLAUDE_CODE_SESSION_ID)')
        .option('--pid <n>', 'Agent process id to record (defaults to the matching agent ancestor)')
        .option('--executor <name>', 'Executor name to record (informational; a guest is never dispatched to)')
        .option(
            '--member <id>',
            'Bind a declared member instead of joining as a plain guest (fenced; refuses a live occupant)',
        )
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const code = await runAgentJoin(context, {
                role: options.role,
                ...(options.id !== undefined ? { id: options.id } : {}),
                ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
                ...(options.pid !== undefined ? { pid: Number(options.pid) } : {}),
                ...(options.executor !== undefined ? { executor: options.executor } : {}),
                ...(options.member !== undefined ? { member: options.member } : {}),
                json: options.json === true,
                enveloped: options.jsonEnvelope,
            });
            context.setExitCode(code);
        });
}
