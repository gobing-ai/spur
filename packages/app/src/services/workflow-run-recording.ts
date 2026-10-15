import type { DbAdapter } from '@gobing-ai/spur-domain';
import { RunDao, type RunDefinitionSource } from '@gobing-ai/spur-domain';
import type { WorkflowDef, WorkflowPersistenceAdapter } from '@gobing-ai/ts-dual-workflow-engine';

/**
 * Send SIGTERM to an async run's worker and the agent subprocess it spawned.
 *
 * The async launcher starts the worker as a **process-group leader** (a detached
 * child), so the recorded pid is also the group id. Signalling the negated pid
 * (`-pid`) delivers SIGTERM to the whole group — the worker AND the `agent.run`
 * grandchild (`claude`/`codex`) it spawned — which is the process an operator
 * actually wants to stop. We fall back to a plain `kill(pid)` if the group kill
 * fails (e.g. the pid is not a group leader, as for a sync run, or on a platform
 * without POSIX process groups), so a recorded pid is always signalled some way.
 *
 * Returns `true` if a signal was delivered by either path, `false` if the process
 * was already gone (ESRCH) or the signal could not be delivered. Best-effort
 * cleanup — callers treat the run record, not the process exit, as the source of
 * truth.
 */
export function signalSubprocess(pid: number): boolean {
    // Refuse self-kill and POSIX specials:
    // - pid <= 1: 0/-0 = own process group; 1/-1 = init / all processes
    // - process.pid / ppid: would tear down the CLI or test runner (CI SIGTERM 143)
    if (!Number.isInteger(pid) || pid <= 1) return false;
    if (pid === process.pid || pid === process.ppid) return false;

    // Group kill first: reaches the worker + its agent grandchild in one signal.
    try {
        process.kill(-pid, 'SIGTERM');
        return true;
    } catch {
        // No group (sync run / non-leader pid) or no POSIX groups — fall back to
        // signalling the single process directly.
    }
    try {
        process.kill(pid, 'SIGTERM');
        return true;
    } catch {
        // ESRCH (no such process) is the expected "already dead" case; any other
        // failure (EPERM, etc.) is also non-fatal — the run is finalized regardless.
        return false;
    }
}

/**
 * Wrap a persistence adapter so the current process stamps its own pid onto a run
 * row the instant the engine creates it (`createRun` / `createOrAttachRun`). Used
 * by the async **worker** so `spur workflow cancel` can signal the live process:
 * the worker self-records `process.pid` (the correct pid — the process actually
 * executing the run), eliminating the launcher-side race where the pid was written
 * before the run row existed. Every other persistence hook delegates unchanged.
 *
 * Implemented as a Proxy so the wide `WorkflowPersistenceAdapter` interface needs
 * no per-method boilerplate — only the two create hooks are intercepted; all reads
 * and other writes pass straight through to `inner`.
 */
export function withSelfPidRecording(inner: WorkflowPersistenceAdapter, db: DbAdapter): WorkflowPersistenceAdapter {
    // Best-effort: a DB predating the `pid` column must not abort the run.
    const stamp = async (runId: string): Promise<void> => {
        try {
            await new RunDao(db).setPid(runId, process.pid);
        } catch {
            // pid persistence is best-effort; the run proceeds regardless.
        }
    };
    return new Proxy(inner, {
        get(target, prop, receiver) {
            if (prop === 'createRun') {
                return async (record: Parameters<WorkflowPersistenceAdapter['createRun']>[0]): Promise<void> => {
                    await target.createRun(record);
                    await stamp(record.id);
                };
            }
            if (prop === 'createOrAttachRun') {
                return async (record: Parameters<WorkflowPersistenceAdapter['createOrAttachRun']>[0]) => {
                    const result = await target.createOrAttachRun(record);
                    await stamp(result.id);
                    return result;
                };
            }
            // 0901 R4: resume claims are the continue worker's creation moment —
            // stamp the pid at the actual resume mutation so `workflow cancel`
            // can reach the detached resumer. A stale pid on a crashed worker
            // row is tolerated by cancel's ESRCH handling, so no exit-clearing.
            if (prop === 'claimRunOwnership') {
                return async (
                    runId: string,
                    owner: Parameters<WorkflowPersistenceAdapter['claimRunOwnership']>[1],
                    expectedStatuses: Parameters<WorkflowPersistenceAdapter['claimRunOwnership']>[2],
                ) => {
                    const claimed = await target.claimRunOwnership(runId, owner, expectedStatuses);
                    if (claimed !== undefined) await stamp(runId);
                    return claimed;
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/**
 * The identity stamped onto every new run row at creation (0768 R1): the
 * canonical definition digest plus the definition's version literal (or `null`
 * for a known-unversioned definition). `source` (0784 R1) pins the resolved
 * launch file + layer + workdir so resume replays the launched definition
 * instead of re-deriving it from `workflow_name`.
 */
interface WorkflowRunIdentity {
    definitionDigest: string;
    workflowVersion: string | null;
    source?: RunDefinitionSource;
}

/**
 * Stamp workflow identity onto the run row at creation (tasks 0603/0768). The
 * digest + version literal are written in ONE json_set call so a row can never
 * be half-identified. Persistence is NOT best-effort (0768): a run that starts
 * without its identity would resume through the unguarded null-digest path and
 * read as pre-0768 legacy, so a failed identity merge fails run creation
 * before any action executes.
 */
export function withRunIdentityRecording(
    inner: WorkflowPersistenceAdapter,
    db: DbAdapter,
    identity: WorkflowRunIdentity,
): WorkflowPersistenceAdapter {
    const stamp = async (runId: string): Promise<void> => {
        // json_set (via stampRunIdentity), not json_patch: RFC-7396 merge patch
        // deletes keys whose value is null, which would erase a known-unversioned
        // workflowVersion instead of recording it. The DAO merge is conditional on
        // an absent digest, so identity is immutable once stamped (0784 R1).
        await new RunDao(db).stampRunIdentity(
            runId,
            identity.definitionDigest,
            identity.workflowVersion,
            identity.source,
        );
    };
    return new Proxy(inner, {
        get(target, prop, receiver) {
            if (prop === 'createRun') {
                return async (record: Parameters<WorkflowPersistenceAdapter['createRun']>[0]): Promise<void> => {
                    await target.createRun(record);
                    await stamp(record.id);
                };
            }
            if (prop === 'createOrAttachRun') {
                return async (record: Parameters<WorkflowPersistenceAdapter['createOrAttachRun']>[0]) => {
                    // 0784 R1: attaching an already-persisted run must retain its
                    // recorded identity (or its documented pre-0768 legacy absence) —
                    // stamp only a genuinely new row, never the attach target.
                    const existing = await new RunDao(db).traceRowById(record.id);
                    const result = await target.createOrAttachRun(record);
                    if (existing === undefined) await stamp(result.id);
                    return result;
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/**
 * A definition's public version identity (0768): the declared non-empty
 * `version` literal, or `null` for a known-unversioned definition. `undefined`
 * is reserved for pre-0768 rows with no recorded identity and is never derived
 * from a definition.
 */
export function workflowVersionLiteral(workflow: WorkflowDef): string | null {
    return typeof workflow.version === 'string' && workflow.version !== '' ? workflow.version : null;
}
