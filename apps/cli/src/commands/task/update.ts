import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    AgentCoordinationService,
    type AgentQuotaEventBus,
    type CoordinationEventBus,
    canonicalStatusOrRaw,
    GuardDeniedError,
    type GuardedTransitionResult,
    loadSectionMatrix,
    ParentFeatureStatusError,
    resolvePlanningFolders,
    SectionMutationError,
    type SystemEventBus,
    TASK_LIFECYCLE_PROFILE,
    TaskCheckService,
    type TaskService,
    type TransitionCheckGate,
    transitionTaskGuarded,
} from '@gobing-ai/spur-app';
import { AGENT_ID_REGEX } from '@gobing-ai/spur-config';
import { EventBus } from '@gobing-ai/ts-infra';
import { attachAgentQuotaPersistence } from '../../agent-quota-persistence';
import { EMBEDDED_SPUR_SCHEMAS } from '../../config/embedded-schemas';
import type { CliContext } from '../../context';
import { maybeTriggerHistoryRefresh } from '../../history-refresh';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { attachSystemEventLedger } from '../../system-event-ledger';
import { makeLifecycleAdapter } from '../../workflow/make-lifecycle-adapter';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService, makeTaskLocator, writeCreateJsonError } from './shared';

/** `task update --assignee`: assign through a CLI ledger so `task.assigned` reaches system_events without serve (0371 R6; renamed by 0860 R2). */
async function assignTaskWithLedger(
    wbs: string,
    agentId: string,
    context: CliContext,
    tasks: Pick<TaskService, 'assign'>,
): Promise<void> {
    const bus = new EventBus() as SystemEventBus;
    const ledger = await attachSystemEventLedger(bus, context);
    // SAFETY: one structural ts-infra EventBus behind the nominal names (ADR-044).
    const quotaPersistence = attachAgentQuotaPersistence(bus as unknown as AgentQuotaEventBus, context);
    const svc = new AgentCoordinationService({
        ...context,
        eventBus: bus as unknown as CoordinationEventBus,
        roles: context.agentRoles,
        reloadAgentConfig: () => context.loadAgentConfig(context.cwd),
        // 1078 R2: the frontmatter write goes through TaskService, so the task file keeps exactly
        // one writer.
        tasks,
    });
    try {
        await svc.assignTask(wbs, agentId);
        context.output.write(`assigned ${wbs} → ${agentId}`);
    } finally {
        await ledger.flush();
        ledger.unsubscribe();
        await quotaPersistence.flush();
        quotaPersistence.unsubscribe();
    }
}

/** Register `spur task update`. */
export function registerTaskUpdateCommand(task: Command, context: CliContext): void {
    // ── update ──
    task.command('update')
        .summary('Update a task status or write a section.')
        .argument('<wbs>', 'Task WBS number')
        .argument('[status]', 'New status (for lifecycle transition)')
        .addHelpText(
            'after',
            [
                'Lifecycle: `task update <wbs> <status>` moves a task through',
                'backlog → todo → wip → testing → done, running the lifecycle guards on',
                '`wip → testing` (`spur task check --as testing`) and `testing → done`',
                '(`spur task check --as done`) — each guard evaluates the transition target (F92 R3).',
                'A GuardDeniedError on `testing → done` means no pipeline run is recorded for the',
                'task: run `/sp:dev-verify <wbs> --next` to PASS it, or record the audited bypass with',
                '`spur task update <wbs> done --force-done --provenance-bypass --reason "…"`.',
                'See the gate checklist (spur-dev/references/gate-checklists.md).',
                'Valid section names (no failed write): `spur task sections <wbs> list`.',
                'Requirements body: one `- [ ] R1. <text>` per line. Acceptance Criteria body: `- [ ] AC1 — <feature',
                'scenario title>` bullets or `Scenario: AC1 — <title>` blocks (AC<n> is task-local, never R<n>);',
                '`(req: R<n>)` binds a requirement; `ac_altitude: task-local` exempts task-only AC.',
                'Sections replace, with one exception: `--section "Q&A"` APPENDS a timestamped',
                '`#### Q&A entry — <ISO>` block. Start the body with `<!-- qa:replace -->` to replace it wholesale.',
                'Extend instead of replace: `--append` with `--section` writes the new body after the existing',
                'section content (existing bytes preserved; an empty/missing section is created) — the bounded',
                'way to extend a populated Review/Testing section without destroying it (task 1057).',
            ].join('\n'),
        )
        .option(...SHARED_OPTIONS.section)
        .option(...SHARED_OPTIONS.fromFile)
        .option(
            '--append',
            'With --section: write the new body after the existing section content (existing content + one blank line + new body; surrounding whitespace trimmed) instead of replacing it wholesale. Requires --section; an empty/missing section is created. Section names are case-sensitive (see `spur task sections <wbs> list`).',
            false,
        )
        .option(...SHARED_OPTIONS.featureFrontmatter)
        .option(...SHARED_OPTIONS.prioritySet)
        .option(
            '--ac-numbering <mode>',
            'Set the ac_numbering frontmatter field (task-local) — opts the task into the Requirements↔AC coverage check',
        )
        .option(
            '--ac-altitude <mode>',
            'Set the ac_altitude frontmatter field. Valid: `graduating` (default; feature-AC subset rule enforced) or `task-local` (skip the DD-09 subset rule — task scenarios are intentionally not feature ship criteria). Mirrors the L1 schema enum (packages/domain/src/planning/schema.ts:304).',
        )
        .option(
            '--estimate-hours <n>',
            'Set the estimate_hours frontmatter field (positive number) — decomposition size estimate; the inline pipeline driver dispatches no subagent at/below its floor',
        )
        .option(
            '--no-lifecycle',
            'Suppress lifecycle workflow run creation (use during pipeline runs to avoid orphaned lifecycle runs)',
        )
        .option('--no-reopen', "Do not reopen a 'verifying' parent feature to 'active'")
        .option('--assignee <spec-id>', 'Set the assignee frontmatter field to an agent spec id')
        .option(
            '--add-tag <tag>',
            'Add a tag to the tags list (repeatable; idempotent). `fleet:auto` authorizes GTD fleet dispatch',
            (value: string, previous: string[] = []) => [...previous, value],
        )
        .option(
            '--remove-tag <tag>',
            'Remove a tag from the tags list (repeatable; absent tags are a no-op)',
            (value: string, previous: string[] = []) => [...previous, value],
        )
        .option(
            '--force-done',
            'Allow transitioning to `done` even when the verify verdict is not PASS; records an override (task 0292). Waives the verdict only — the FSM path still applies, so from an earlier status walk the hops first: `todo` → `wip` → `testing` → `done` (each hop runs the structural `spur task check`)',
        )
        .option(
            '--reason <text>',
            'Rationale for a forced-done override (paired with --force-done; persisted as done_reason)',
        )
        .option(
            '--provenance-bypass',
            'Record an audited provenance-bypass link when no pipeline run exists (replaces the SPUR_PROVENANCE_OVERRIDE env var; pair with --force-done)',
            false,
        )
        .option('--verdict-dir <path>', 'Directory holding <wbs>-verdict.json artifacts (default: .spur/run)')
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, status, options) => {
            const svc = await makeService(
                context,
                options.folder,
                options.lifecycle === false,
                options.provenanceBypass === true,
            );
            try {
                // `--append` only means something with a section target (task 1057).
                if (options.append === true && options.section === undefined) {
                    writeJsonError(context.output, options, '--append requires --section', 'VALIDATION_FAILED');
                    context.setExitCode(2);
                    return;
                }
                // `--assignee` runs AgentCoordinationService.assignTask (frontmatter write +
                // task.assigned ledger event), validated at this boundary
                // against the agent-id format and the on-disk spec set.
                if (options.assignee !== undefined) {
                    if (options.section !== undefined) {
                        writeJsonError(
                            context.output,
                            options,
                            '--assignee cannot be combined with --section',
                            'VALIDATION_FAILED',
                        );
                        context.setExitCode(2);
                        return;
                    }
                    if (!AGENT_ID_REGEX.test(options.assignee)) {
                        writeJsonError(
                            context.output,
                            options,
                            `Invalid agent spec id '${options.assignee}' — must match ${AGENT_ID_REGEX.toString()}`,
                            'VALIDATION_FAILED',
                        );
                        context.setExitCode(2);
                        return;
                    }
                    const specs = await new AgentCoordinationService(context).listAgentSpecs();
                    if (!specs.some((spec) => spec.id === options.assignee)) {
                        writeJsonError(
                            context.output,
                            options,
                            `Unknown agent spec '${options.assignee}' — no spec resolves under .spur/agents/`,
                            'VALIDATION_FAILED',
                        );
                        context.setExitCode(2);
                        return;
                    }
                    // 1078 R2: reuse the handler's TaskService — the same writer every other
                    // `task update` field goes through, so construction happens once.
                    await assignTaskWithLedger(wbs, options.assignee, context, svc);
                    return;
                }
                if (options.section !== undefined) {
                    if (options.fromFile === undefined) {
                        writeJsonError(
                            context.output,
                            options,
                            '--from-file is required with --section',
                            'VALIDATION_FAILED',
                        );
                        context.setExitCode(2);
                        return;
                    }
                    const result = await svc.updateSection(
                        wbs,
                        options.section,
                        options.fromFile,
                        options.append === true,
                    );
                    if (options.json) {
                        context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                    } else {
                        for (const warning of result.warnings ?? []) {
                            context.output.error(warning);
                        }
                        context.output.write(`Updated section '${options.section}' in task ${result.ref.id}`);
                    }
                } else if (options.addTag !== undefined || options.removeTag !== undefined) {
                    const result = await svc.updateTags(wbs, options.addTag ?? [], options.removeTag ?? []);
                    if (options.json) {
                        context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                    } else {
                        context.output.write(`Set tags=[${result.tags.join(', ')}] on task ${result.ref.id}`);
                    }
                } else if (
                    options.feature !== undefined ||
                    options.priority !== undefined ||
                    options.acNumbering !== undefined ||
                    options.acAltitude !== undefined ||
                    options.estimateHours !== undefined
                ) {
                    // Every supplied field flag is applied; each write re-validates the task.
                    const candidates: [string, string | undefined][] = [
                        ['feature_id', options.feature],
                        ['priority', options.priority],
                        ['ac_numbering', options.acNumbering],
                        ['ac_altitude', options.acAltitude],
                        ['estimate_hours', options.estimateHours],
                    ];
                    const fields = candidates.filter((f): f is [string, string] => f[1] !== undefined);
                    const warnings: string[] = [];
                    let result: Awaited<ReturnType<typeof svc.updateField>> | undefined;
                    for (const [key, value] of fields) {
                        result = await svc.updateField(wbs, key, value, options.reopen === false);
                        warnings.push(...(result.warnings ?? []));
                    }
                    if (result === undefined) return;
                    if (options.json) {
                        const merged = warnings.length > 0 ? { ...result, warnings } : result;
                        context.output.write(toEnvelopeJson(merged, { enveloped: options.jsonEnvelope }));
                    } else {
                        for (const warning of warnings) {
                            context.output.error(warning);
                        }
                        for (const [key, value] of fields) {
                            context.output.write(`Set ${key}=${value} on task ${result.ref.id}`);
                        }
                    }
                } else if (status !== undefined) {
                    // Canonicalize the target before any gate matches: the frontmatter
                    // schema alias-normalizes legacy spellings (`Done`/`DONE` → `done`),
                    // so a case/alias variant IS a `* → done` transition and must not
                    // slip past the `=== 'done'` checks below (verdict gate + P3
                    // backstop).
                    status = canonicalStatusOrRaw(status);
                    // ── guarded transition (task 0966) ──
                    // The done/testing structural check gate and the done-verdict gate
                    // (task 0292) now live ONCE, in `@gobing-ai/spur-app`'s
                    // `transitionTaskGuarded` — the server's `task.transition` handler
                    // routes through the same function, so one gate guards both
                    // transports. The CLI keeps only its transport concerns here: the
                    // lifecycle-adapter availability decision (and its stderr warning),
                    // the history-refresh trigger, the stdout/envelope text and exit
                    // codes.
                    //
                    // P3 backstop (task 0130 retrospective): the lifecycle YAML runs
                    // `spur task check` as the wip→testing and testing→done guard.
                    // Whenever that FSM guard will NOT run, the structural gate is
                    // supplied inline so the check is not silently lost.
                    //
                    // Two ways the FSM guard goes missing, and BOTH must be covered:
                    //   1. the bundled task-lifecycle workflow can't be resolved (adapter
                    //      undefined) — the SchemaLifecyclePort fallback permits silently;
                    //   2. `--no-lifecycle` was passed — no adapter is built at all.
                    //
                    // `--no-lifecycle` is bookkeeping ("the pipeline is already a run; a
                    // nested lifecycle run would orphan"), never a guard bypass — so the
                    // gate runs regardless. In-process (TaskCheckService), so this costs
                    // no subprocess.
                    const adapter =
                        options.lifecycle === false ? undefined : makeLifecycleAdapter(context, TASK_LIFECYCLE_PROFILE);
                    let checkGate: TransitionCheckGate | undefined;
                    if (adapter === undefined) {
                        if (options.lifecycle !== false) {
                            context.output.error(
                                `warning: lifecycle adapter unavailable — running \`spur task check\` inline as the ${status} gate. ` +
                                    'Restore the bundled task-lifecycle workflow to re-enable the real guard.',
                            );
                        }
                        const planningFolders = await resolvePlanningFolders(context.fs);
                        checkGate = {
                            service: new TaskCheckService(
                                context.fs,
                                await loadSectionMatrix(context.cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS }),
                                await makeTaskLocator(context),
                            ),
                            ...(planningFolders.severityOverrides !== undefined
                                ? { severityOverrides: planningFolders.severityOverrides }
                                : {}),
                        };
                    }
                    let outcome: GuardedTransitionResult;
                    try {
                        outcome = await transitionTaskGuarded(
                            {
                                tasks: svc,
                                fs: context.fs,
                                runDir: options.verdictDir ?? join(context.cwd, '.spur', 'run'),
                                ...(checkGate !== undefined ? { checkGate } : {}),
                            },
                            { wbs, toStatus: status, forceDone: options.forceDone === true, reason: options.reason },
                        );
                    } catch (err) {
                        // The shared gate denied: identical message + envelope + exit
                        // code as the pre-0966 inline gate.
                        if (err instanceof GuardDeniedError) {
                            writeJsonError(context.output, options, err.message, 'GUARD_DENIED');
                            context.setExitCode(1);
                            return;
                        }
                        throw err;
                    }
                    if (outcome.kind === 'noop') {
                        // R9: same-status no-op. Exit 0 so scripts/CI can idempotently re-run.
                        if (options.json) {
                            context.output.write(
                                toEnvelopeJson(
                                    { ok: true, noop: true, wbs, status: 'done' },
                                    { enveloped: options.jsonEnvelope },
                                ),
                            );
                        } else {
                            context.output.write(outcome.message);
                        }
                        return;
                    }
                    const result = outcome.result;
                    // Completion trigger (task 0549 R1): task → done enqueues a coalesced
                    // history refresh — off the critical path, opt-in via
                    // `history.refresh.on_completion`. Best-effort; never changes the
                    // transition's exit code.
                    if (status === 'done') {
                        await maybeTriggerHistoryRefresh(context, 'task-done', wbs);
                    }
                    // R3 override audit-trail: the shared gate persists
                    // `done_forced`/`done_reason` itself. A write failure there leaves
                    // the task at `done` without the audit fields — the transition is
                    // already committed, so it is reported, not thrown.
                    if (outcome.forced?.auditError !== undefined) {
                        context.output.error(
                            `warning: failed to record done-forced audit fields: ${outcome.forced.auditError}`,
                        );
                    }
                    // 1040 R2: unforced close reconciliation failure — same
                    // best-effort channel, kept separate from `forced` so a
                    // present `forced` never implies an override happened.
                    else if (outcome.closeAuditError !== undefined) {
                        context.output.error(
                            `warning: failed to record done close audit fields: ${outcome.closeAuditError}`,
                        );
                    }
                    // 1047 R3: bookkeeping reconciliation failure after the committed
                    // write — reported (exit stays 0), replayable via the same terminal
                    // transition. Independent of the audit channels above.
                    if (result.bookkeepingError !== undefined) {
                        context.output.error(
                            `warning: failed to reconcile task-lifecycle bookkeeping row: ${result.bookkeepingError} ` +
                                '(task file is committed; replay the same terminal transition to repair)',
                        );
                    }
                    if (options.json) {
                        context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                    } else {
                        context.output.write(`${result.ref.id}: ${result.fromStatus} → ${result.toStatus}`);
                        if (outcome.forced !== undefined) {
                            context.output.write(
                                `ⓘ  Override recorded: task advanced to done despite ${outcome.forced.verdict} verdict (done_forced=true).`,
                            );
                        }
                    }

                    // ── done-transition feature_id nudge (human output only) ──
                    // feature_id is intentionally deferred at create time. When a task
                    // reaches `done`, surface a visible reminder if it's still missing —
                    // advisory only; the transition is already committed. Under --json,
                    // the consumer already has the L4 warning from `spur task check`.
                    if (status === 'done' && !options.json) {
                        const task = await svc.show(wbs);
                        const featureId = task.frontmatter.feature_id as string | undefined;
                        if (!featureId || featureId.length === 0) {
                            context.output.write(
                                `ⓘ  Task ${wbs} is now done but has no feature_id.\n` +
                                    `   Link it with: spur task update ${wbs} --feature <id>\n` +
                                    '   (Advisory only — the task is already done.)',
                            );
                        }
                    }
                } else {
                    context.output.error(
                        'Either <status>, --section/--from-file, or a field flag (--feature/--priority/--ac-numbering/--ac-altitude/--estimate-hours/--add-tag/--remove-tag) is required',
                    );
                    context.setExitCode(2);
                }
            } catch (err) {
                if (err instanceof SectionMutationError) {
                    writeJsonError(context.output, options, `[${err.code}] ${err.message}`, 'INTERNAL_ERROR');
                    context.setExitCode(err.code === 'usage' ? 2 : 3);
                } else if (err instanceof ParentFeatureStatusError) {
                    // Same structured payload as `task create` (1132 review residual v): raw `--json`
                    // must not leave stdout empty with prose on stderr.
                    writeCreateJsonError(context, options, 'parent-feature-status', err.message, {
                        featureId: err.featureId,
                        status: err.status,
                        activeSiblings: err.activeSiblings,
                    });
                    context.setExitCode(1);
                } else {
                    writeJsonError(context.output, options, String(err));
                    context.setExitCode(1);
                }
            }
        });
}
