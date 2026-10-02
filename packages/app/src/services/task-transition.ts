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
import type { WriteResult } from './planning-write-service';
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
          result: WriteResult;
          /** Present when the transition was a forced override of a non-PASS verdict. */
          forced?: { verdict: VerdictAggregate; auditError?: string };
          /**
           * 1040 R2: unforced-close reconciliation failure (best-effort audit
           * fields after the status write). Reported, never thrown. Absent when
           * the reconciliation wrote cleanly. Separate from `forced` because a
           * present `forced` is printed as an operator override.
           */
          closeAuditError?: string;
      };

/**
 * Run one target-aware structural check gate (`spur task check --as <target>`
 * semantics) and throw {@link GuardDeniedError} on failure. Shared by
 * {@link transitionTaskGuarded} (`task update`) and `TaskService.record`
 * (0980): whenever the lifecycle FSM will NOT run its YAML guard — adapter
 * unavailable or `--no-lifecycle` — the caller supplies this gate so the
 * structural check is not silently lost (P3 backstop, task 0130).
 */
export async function runTransitionCheckGate(
    gate: TransitionCheckGate,
    wbs: string,
    filePath: string,
    target: string,
): Promise<void> {
    const result = await gate.service.check(filePath, wbs, {
        strict: false,
        asStatus: target,
        severityOverrides: gate.severityOverrides,
    });
    if (!result.pass) {
        // 0808 R3: name the target-status probe (`--as <status>`) and list
        // its error findings — a bare "check failed" reads as a
        // contradiction when the plain current-status check passes.
        const errors = result.findings.filter((f) => f.severity === 'error');
        const listed = (errors.length > 0 ? errors : result.findings)
            .map((f) => `${f.code}${f.section === '' ? '' : ` [${f.section}]`}: ${f.message}`)
            .join('; ');
        throw new GuardDeniedError(
            `Lifecycle transition blocked: \`spur task check ${wbs} --as ${target}\` failed${listed === '' ? '' : ` — ${listed}`}. Fix the findings before transitioning to ${target}.`,
        );
    }
}

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
 * 1040 R2: ONE close-audit reconciliation policy for both done-write paths
 * (`transitionTaskGuarded` and `TaskService.record`'s auto-walk). Runs ONLY
 * after a successful done write.
 *
 * Forced close → retain the operator-supplied reason and `done_forced: 'true'`
 * (existing behavior). Unforced close → clear any stale forced flag and write a
 * `done_reason` describing the artifact actually accepted on this close — never
 * a fabricated "all requirements MET".
 *
 * Best-effort: failures are returned as a string for the caller to report
 * (mirroring the forced-audit channel), never thrown — the status is already
 * committed.
 */
export async function reconcileDoneCloseAudit(
    tasks: Pick<TaskService, 'updateField'>,
    wbs: string,
    opts: { forced: boolean; reason?: string; passArtifactPath?: string },
): Promise<string | undefined> {
    try {
        if (opts.forced) {
            await tasks.updateField(wbs, 'done_forced', 'true');
            if (opts.reason !== undefined && opts.reason.length > 0) {
                await tasks.updateField(wbs, 'done_reason', opts.reason);
            }
            return undefined;
        }
        // Unforced close: the forced flag from any earlier override is stale.
        await tasks.updateField(wbs, 'done_forced', 'false');
        const described =
            opts.passArtifactPath !== undefined
                ? `unforced close; PASS artifact at ${opts.passArtifactPath}`
                : 'unforced close';
        await tasks.updateField(wbs, 'done_reason', described);
        return undefined;
    } catch (auditErr) {
        return String(auditErr);
    }
}

/**
 * Run one guarded task-status transition: structural check gate (testing/done)
 * → verify-verdict gate (done) → status write → close-audit reconciliation.
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
        await runTransitionCheckGate(deps.checkGate, wbs, checkedTask.filePath, status);
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
    // 1040 R2: the done-gate's selected artifact path feeds the unforced
    // close reason; kept undefined for non-done targets.
    let doneLoaded: { path: string } | undefined;
    if (status === 'done') {
        const current = checkedTask ?? (await deps.tasks.show(wbs));
        const loaded = await readVerdictArtifact(deps.fs, deps.runDir, wbs);
        doneLoaded = loaded;
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
            verdictPath: loaded.path,
            // 1042 R2: surface identity/parse read errors in the denial instead
            // of the misleading "missing verify verdict artifact" text.
            readError: loaded.readError,
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

    // 1040 R2 close-audit reconciliation: after EVERY successful done write.
    // Forced override retains the supplied reason + `done_forced: 'true'`; an
    // unforced close clears any stale forced flag and describes the accepted
    // PASS artifact. Best-effort — a write failure here leaves the task at
    // `done`; the error is reported on the result instead of thrown (the
    // transition itself is already committed). Noop / denied / failed-hop paths
    // return or throw above, so they never reconcile.
    let closeAuditError: string | undefined;
    if (status === 'done') {
        const doneArtifactPath = doneLoaded?.path;
        closeAuditError = await reconcileDoneCloseAudit(deps.tasks, wbs, {
            forced: forced !== undefined,
            ...(forced !== undefined ? { reason: input.reason } : {}),
            ...(forced === undefined && doneArtifactPath !== undefined ? { passArtifactPath: doneArtifactPath } : {}),
        });
    }

    return {
        kind: 'transitioned',
        result,
        ...(forced !== undefined
            ? { forced: { ...forced, ...(closeAuditError !== undefined ? { auditError: closeAuditError } : {}) } }
            : {}),
        ...(forced === undefined && closeAuditError !== undefined ? { closeAuditError } : {}),
    };
}
