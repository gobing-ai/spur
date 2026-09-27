/**
 * Guarded task-status transition — the shared application-layer gate (0966).
 *
 * Historically the done/testing gates lived only in the CLI
 * (`apps/cli/src/commands/task.ts`): the P3 backstop re-ran
 * `spur task check --as <status>` whenever the lifecycle FSM adapter was
 * absent, and the 0292 verdict gate consulted
 * `.spur/run/<wbs>-verdict.json` before any `done` transition. The server's
 * `task.transition` handler called `updateStatus` directly, so an agent could
 * reach `done` through oRPC carrying L3 errors and no verify verdict.
 *
 * This module is the single choke point both transports now call. It preserves
 * the CLI's gate ORDER exactly:
 *
 *   1. canonicalize `toStatus` (alias-tolerant; raw passthrough on unknown),
 *   2. structural check gate for `testing`/`done` when the caller supplies a
 *      `checkGate` (target-aware `--as <status>` semantics, F92 R3) —
 *      non-PASS denies with the same `Lifecycle transition blocked: …`
 *      GUARD_DENIED message the CLI always produced,
 *   3. verdict gate for every `done` transition (0292): `allow | deny | noop`,
 *      where a same-status `done → done` is a no-op result and a forced
 *      non-PASS override is remembered for the audit-trail write,
 *   4. `updateStatus`,
 *   5. best-effort `done_forced`/`done_reason` frontmatter audit fields.
 *
 * The CLI remains responsible for its operator-facing transport concerns
 * (adapter availability decision, stderr warnings, history-refresh trigger,
 * JSON envelopes); the server maps {@link GuardDeniedError} to its HTTP 409
 * GUARD_DENIED envelope. Missing WBS is a not-found error from
 * `tasks.show`/`updateStatus` (0966 Q&A) rather than a guard denial.
 */

import { normalizeTaskStatus } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { GuardDeniedError } from '../errors';
import { evaluateDoneTransition, readVerdictArtifact, type VerdictAggregate } from './done-transition-guard';
import type { TaskCheckService } from './task-check';
import type { TaskService } from './task-service';

/**
 * Structural check gate for `testing`/`done` transitions. The caller decides
 * whether one exists: the CLI builds it only when its lifecycle adapter is
 * unavailable (the adapter IS the FSM guard — the backstop must not double-run
 * it), while the server, which has no lifecycle port, always supplies one.
 */
export interface TransitionCheckGate {
    service: TaskCheckService;
    /** Per-finding severity overrides (e.g. `resolvePlanningFolders().severityOverrides`). */
    severityOverrides?: Record<string, 'error' | 'warning' | 'off'>;
}

/**
 * Everything {@link transitionTaskGuarded} reads and writes: the task service it
 * commits through, the filesystem holding the verdict artifact, that artifact's
 * directory, and the optional structural check gate.
 */
export interface GuardedTransitionDeps {
    /** Task service the transition is committed through. */
    tasks: Pick<TaskService, 'show' | 'updateStatus' | 'updateField'>;
    /** Filesystem rooted at the project — used to locate the verdict artifact. */
    fs: FileSystem;
    /** Directory holding `<wbs>-verdict.json` artifacts (`.spur/run` unless overridden). */
    runDir: string;
    /** Structural gate for `testing`/`done`; omit only when a lifecycle FSM runs the check. */
    checkGate?: TransitionCheckGate;
}

/**
 * One requested status transition: the target status plus the operator override
 * channel (`--force-done` / `--reason`).
 */
export interface GuardedTransitionInput {
    wbs: string;
    /** Target status; alias-normalized (`Done`/`DONE` → `done`) before gating. */
    toStatus: string;
    /** Actor identifier recorded on the write (default: `system`). */
    actor?: string;
    /** Override a non-PASS / missing verify verdict for `done` (records audit fields). */
    forceDone?: boolean;
    /** Rationale for a forced override (persisted as `done_reason`). */
    reason?: string;
}

/**
 * Outcome of a guarded transition: a same-status `noop` (nothing written), or the
 * committed `transitioned` write plus the forced-override record when a non-PASS
 * verdict was overridden.
 */
export type GuardedTransitionResult =
    | { kind: 'noop'; wbs: string; status: 'done'; message: string }
    | {
          kind: 'transitioned';
          result: Awaited<ReturnType<TaskService['updateStatus']>>;
          /** Present when the transition was a forced override of a non-PASS verdict. */
          forced?: { verdict: VerdictAggregate; auditError?: string };
      };

/**
 * Canonicalize a status argument, tolerating legacy aliases. Unknown strings
 * pass through raw so the downstream write surfaces a precise FSM/schema error
 * instead of a generic "invalid enum" one.
 *
 * Exported because the CLI needs the identical rule outside the transition path
 * (`spur task check --as <status>`), and two copies of an alias rule is how the
 * gate and the write drift apart.
 */
export function canonicalStatusOrRaw(raw: string): string {
    try {
        return normalizeTaskStatus(raw);
    } catch {
        return raw;
    }
}

/**
 * Run one guarded task-status transition: structural check gate (testing/done)
 * → verify-verdict gate (done) → status write → forced-override audit write.
 *
 * Throws {@link GuardDeniedError} when a gate denies; the transport maps that
 * to its own denial envelope (CLI exit 1 + GUARD_DENIED, HTTP 409).
 */
export async function transitionTaskGuarded(
    deps: GuardedTransitionDeps,
    input: GuardedTransitionInput,
): Promise<GuardedTransitionResult> {
    const { wbs } = input;
    // Alias-normalize BEFORE the `===` gate checks: the frontmatter schema
    // alias-normalizes legacy spellings (`Done`/`DONE` → `done`), so a
    // case/alias variant IS a `* → done` transition and must not slip past
    // the gated branches below.
    const status = canonicalStatusOrRaw(input.toStatus);

    // ── structural check gate (testing / done) ──
    // The lifecycle YAML runs `spur task check` as the wip→testing and
    // testing→done guard. Whenever the caller's FSM guard will NOT run, the
    // caller supplies this gate so the structural check is not silently lost
    // (P3 backstop, task 0130 retrospective). `--as <status>` evaluates the
    // transition TARGET, not the current status (F92 R3 / 0808 R3).
    let checkedTask: Awaited<ReturnType<TaskService['show']>> | undefined;
    if ((status === 'done' || status === 'testing') && deps.checkGate !== undefined) {
        checkedTask = await deps.tasks.show(wbs);
        const gate = await deps.checkGate.service.check(checkedTask.filePath, wbs, {
            strict: false,
            asStatus: status,
            severityOverrides: deps.checkGate.severityOverrides,
        });
        if (!gate.pass) {
            // 0808 R3: name the target-status probe (`--as <status>`) and list
            // its error findings — a bare "check failed" reads as a
            // contradiction when the plain current-status check passes.
            const errors = gate.findings.filter((f) => f.severity === 'error');
            const listed = (errors.length > 0 ? errors : gate.findings)
                .map((f) => `${f.code}${f.section === '' ? '' : ` [${f.section}]`}: ${f.message}`)
                .join('; ');
            throw new GuardDeniedError(
                `Lifecycle transition blocked: \`spur task check ${wbs} --as ${status}\` failed${listed === '' ? '' : ` — ${listed}`}. Fix the findings before transitioning to ${status}.`,
            );
        }
    }

    // ── done-transition verdict gate (task 0292) ──
    // Replaces the silent PARTIAL/FAIL → done slide. Runs for every `done`
    // transition. The guard reads the verify artifact
    // (`.spur/run/<wbs>-verdict.json` by default), recomputes the aggregate
    // for consistency (R10), and either allows, denies with an actionable
    // message, or reports a forced override. The guard returns
    // `allow | deny | noop`; a forced `allow` is remembered below so the
    // audit-trail frontmatter is written after the transition commits.
    let forced: { verdict: VerdictAggregate } | undefined;
    if (status === 'done') {
        const current = checkedTask ?? (await deps.tasks.show(wbs));
        const loaded = await readVerdictArtifact(deps.fs, deps.runDir, wbs);
        const guardOutcome = evaluateDoneTransition({
            wbs,
            taskFilePath: current.filePath,
            // Normalize the stored status too, so a legacy-cased `Done`
            // still short-circuits as the R9 no-op instead of mis-entering
            // the verdict-denial path.
            currentStatus: canonicalStatusOrRaw(String(current.frontmatter.status)),
            targetStatus: 'done',
            forced: input.forceDone === true,
            reason: input.reason,
            artifact: loaded.artifact,
        });
        if (guardOutcome.kind === 'noop') {
            // R9: same-status no-op. The transport exits success so scripts
            // and CI can idempotently re-run the transition.
            return { kind: 'noop', wbs, status: 'done', message: guardOutcome.message };
        }
        if (guardOutcome.kind === 'deny') {
            throw new GuardDeniedError(guardOutcome.message);
        }
        // `allow` — if it was a forced override (non-PASS or missing
        // artifact), remember it for the audit-trail write below.
        if (guardOutcome.reason === 'forced') {
            forced = { verdict: loaded.artifact?.verdict ?? 'UNKNOWN' };
        }
    }

    const result = await deps.tasks.updateStatus(wbs, status, input.actor);

    // R3 override audit-trail: persist done_forced + done_reason so a later
    // `spur task show` surfaces that this `done` was an operator override of
    // a non-PASS verdict. Best-effort — a write failure here leaves the task
    // at `done` without the audit fields; the transition itself is already
    // committed, so the failure is reported on the result instead of thrown.
    let auditError: string | undefined;
    if (forced !== undefined) {
        try {
            await deps.tasks.updateField(wbs, 'done_forced', 'true');
            if (input.reason !== undefined && input.reason.length > 0) {
                await deps.tasks.updateField(wbs, 'done_reason', input.reason);
            }
        } catch (auditErr) {
            auditError = String(auditErr);
        }
    }

    return {
        kind: 'transitioned',
        result,
        ...(forced !== undefined ? { forced: { ...forced, ...(auditError !== undefined ? { auditError } : {}) } } : {}),
    };
}
