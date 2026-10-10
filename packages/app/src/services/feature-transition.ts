/**
 * Guarded feature-status transition — the shared application-layer gate (1137 R2/R4).
 *
 * The CLI guards feature transitions through the spawning `LifecycleAdapter`; the
 * server has no lifecycle adapter (its `PlanningWriteService` falls back to the
 * permissive `SchemaLifecyclePort`), so before this module the HTTP
 * `feature.transition` handler applied any requested status with no graph
 * validation — `active → verifying` without the `feature check --as verifying`
 * guard, or edges the graph does not declare at all.
 *
 * This module is the in-process choke point the server routes through (the same
 * precedent as the task-side `transitionTaskGuarded`, 0966 R3). It:
 *
 *   1. resolves the `feature-lifecycle` state-machine project-first via
 *      `resolveWorkflowFile` (never the permissive port; a missing graph is a
 *      loud refusal naming the profile and the searched roots — R4),
 *   2. refuses an edge the graph does not declare,
 *   3. refuses a target state with `onEnter` actions (today: `verifying`, which
 *      spawns the nested feature-verification workflow — a server/Worker
 *      transport must not start it; ADR-021) with the CLI recovery message,
 *   4. runs the in-process `FeatureCheckService.check` for every edge whose YAML
 *      guard is `kind: shell`, mirroring the CLI shell guard exactly: the guard
 *      command's `--strict` becomes `strict: true`, and `runDir` + the run-store
 *      port let the D63 digest-chained completion-receipt gate fire at `--as
 *      done` (skipping those seams let a feature reach `done` over HTTP without
 *      the evidence the CLI enforces), denying on error findings,
 *   5. otherwise commits through `FeatureService.transition`, which owns the
 *      History append and the `feature.transitioned` event.
 *
 * Every refusal throws {@link GuardDeniedError}; the server error handler maps it
 * to HTTP 409 GUARD_DENIED. No refusal writes anything.
 */

import { loadWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { GuardDeniedError } from '../errors';
import type { FeatureReceiptRunPort } from '../workflow/feature-verification-receipt';
import { type ResolveWorkflowFileResult, resolveWorkflowFile } from '../workflow/workflow-resolver';
import type { FeatureCheckService } from './feature-check';
import type { FeatureService } from './feature-service';
import type { WriteResult } from './planning-write-service';

/** The lifecycle profile this guard validates against (R4 names it in refusals). */
export const FEATURE_LIFECYCLE_WORKFLOW = 'feature-lifecycle';

/** Everything {@link transitionFeatureGuarded} reads and writes. */
export interface GuardedFeatureTransitionDeps {
    /** Feature service the transition is committed through (and read for current status). */
    features: Pick<FeatureService, 'show' | 'transition'>;
    /** In-process check service standing in for the YAML `kind: shell` guards. */
    check: FeatureCheckService;
    /** Project root the lifecycle graph is resolved against (project tier first). */
    cwd: string;
    /** Feature folder, forwarded to the check so L3 corpus rules evaluate (0418). */
    featuresDir?: string;
    /** Registered task folders, forwarded to the check so L4 linked-task rules evaluate. */
    tasksDirs?: string[];
    /**
     * Directory holding the verdict artifacts and D63 completion receipts
     * (`.spur/run` unless overridden). Forced into the shell-guard check so the
     * `--as done` completion boundary validates the verification receipt the CLI
     * enforces — omitting it silently disabled the receipt gate (remediation P2).
     */
    runDir: string;
    /**
     * Read-only run-store ports for receipt validation (D63 task 0915): the
     * recording run's terminal status, persisted definition identity and artifact
     * registration. The server wires the same `RunDao`/`ArtifactDao` port the CLI
     * commands use (CLI wiring precedent: `apps/cli/src/commands/feature.ts`).
     */
    receiptRunPort?: FeatureReceiptRunPort;
    /**
     * Graph resolution seam (R4 test hook). Defaults to the shared project-first
     * `resolveWorkflowFile`; a test overrides it to simulate the graph being absent
     * from every layer.
     */
    resolveFile?: (cwd: string, file: string) => ResolveWorkflowFileResult;
}

/** One requested feature-status transition. */
export interface GuardedFeatureTransitionInput {
    id: string;
    /** Target status (must be a declared `to` of an edge from the current status). */
    to: string;
    /** Actor identifier recorded on the write (default: `system`). */
    actor?: string;
}

/**
 * Run one guarded feature-status transition: graph resolution → declared-edge
 * check → onEnter refusal → in-process shell-guard check → commit.
 *
 * Throws {@link GuardDeniedError} for every refusal; a missing feature surfaces
 * the write service's own not-found error (the guard does not invent one).
 */
export async function transitionFeatureGuarded(
    deps: GuardedFeatureTransitionDeps,
    input: GuardedFeatureTransitionInput,
): Promise<WriteResult> {
    // ── Step 1: resolve the graph (R4 — never fall back to the permissive port) ──
    const resolve = deps.resolveFile ?? resolveWorkflowFile;
    const resolved = resolve(deps.cwd, FEATURE_LIFECYCLE_WORKFLOW);
    if (resolved.path === null) {
        const searched = resolved.probed.filter((p): p is string => p !== null).join(', ');
        throw new GuardDeniedError(
            `Feature transition refused: the ${FEATURE_LIFECYCLE_WORKFLOW} graph could not be resolved ` +
                `(searched: ${searched === '' ? '(no roots)' : searched}). ` +
                'The server never falls back to the permissive lifecycle port; restore the workflow definition.',
        );
    }
    const def = await loadWorkflowDef(resolved.path, { validateSchema: false });
    if (def.kind !== 'state-machine') {
        throw new GuardDeniedError(
            `Feature transition refused: ${FEATURE_LIFECYCLE_WORKFLOW} at ${resolved.path} must be a ` +
                `state-machine workflow; got "${def.kind ?? 'unknown'}".`,
        );
    }

    const feature = await deps.features.show(input.id);
    if (feature === null) {
        // Preserve the write service's own not-found error rather than inventing a guard denial.
        return deps.features.transition(input.id, input.to, input.actor);
    }

    // ── Step 2: the edge must be declared ──
    const edge = def.transitions.find((t) => t.from === feature.status && t.to === input.to);
    if (edge === undefined) {
        const legal = def.transitions.filter((t) => t.from === feature.status).map((t) => t.to);
        throw new GuardDeniedError(
            `Feature transition refused: undeclared edge ${feature.status} → ${input.to} in the ` +
                `${FEATURE_LIFECYCLE_WORKFLOW} graph` +
                (legal.length > 0 ? `; legal target(s) from ${feature.status}: ${legal.join(', ')}` : '') +
                '.',
        );
    }

    // ── Step 3: onEnter targets are refused (the server does not run them) ──
    const target = def.states.find((s) => s.id === input.to);
    if (target !== undefined && target.onEnter !== undefined && target.onEnter.length > 0) {
        throw new GuardDeniedError(
            `Feature transition refused: entering \`${input.to}\` runs feature verification; ` +
                `use \`spur feature update ${input.id} ${input.to}\` from the CLI`,
        );
    }

    // ── Step 4: shell guards run as the in-process feature check (CLI parity) ──
    if (edge.guard?.kind === 'shell') {
        // The YAML guard command (`$spurBin feature check $featureId [--strict] --as
        // <to>`) is the SSOT for how the edge is validated. Read `--strict` off it so
        // the in-process check elevates warnings exactly where the CLI does (it would
        // over-deny other edges to pass it unconditionally), and forward `runDir` +
        // the run-store port so the D63 completion receipt fires at `--as done`.
        const command = edge.guard.options?.command;
        const strict = typeof command === 'string' && /(^|\s)--strict(\s|$)/.test(command);
        const result = await deps.check.check(feature.filePath, input.id, {
            asStatus: input.to,
            strict,
            ...(deps.featuresDir !== undefined ? { featuresDir: deps.featuresDir } : {}),
            ...(deps.tasksDirs !== undefined ? { tasksDirs: deps.tasksDirs } : {}),
            runDir: deps.runDir,
            ...(deps.receiptRunPort !== undefined ? { receiptRunPort: deps.receiptRunPort } : {}),
        });
        const errors = result.findings.filter((f) => f.severity === 'error');
        if (errors.length > 0) {
            const listed = errors
                .map((f) => `${f.code}${f.section === '' ? '' : ` [${f.section}]`}: ${f.message}`)
                .join('; ');
            throw new GuardDeniedError(
                `Feature transition ${feature.status} → ${input.to} denied: ` +
                    `\`spur feature check ${input.id} --as ${input.to}\` failed — ${listed}. ` +
                    'Fix the findings or run the guarded transition from the CLI.',
            );
        }
    }

    // ── Step 5: commit (History + event come from the write service) ──
    return deps.features.transition(input.id, input.to, input.actor);
}
