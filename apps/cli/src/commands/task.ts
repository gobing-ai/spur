import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    aggregateBatchVerdicts,
    anchorQualify,
    CorpusMigrator,
    DependencyMutationError,
    DuplicateFollowUpError,
    type EntityRef,
    ensurePipelineRunLink,
    evaluateDoneTransition,
    loadAcceptedFindings,
    type MigrationReport,
    PlanningWriteService,
    readVerdictArtifact,
    resolveFogRange,
    resolvePlanningFolders,
    runCorpusCheck,
    type SectionMatrix,
    SectionMutationError,
    TASK_LIFECYCLE_PROFILE,
    TaskCheckService,
    TaskLocator,
    TaskService,
    type TaskSummary,
    type VerdictAggregate,
    WbsCollisionError,
} from '@gobing-ai/spur-app';
import { bundledConfigRoot, loadStructuredSpurConfig } from '@gobing-ai/spur-config/loader';
import {
    extractTemplateBodies,
    normalizeTaskStatus,
    TASK_STATUSES,
    TASK_VARIANTS,
    type TaskSection,
    taskStatusIcon,
    UNIVERSAL_SECTIONS,
} from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { type Colorize, makeColorize, shouldColor } from '../colors';
import { EMBEDDED_SPUR_SCHEMAS } from '../config/embedded-schemas';
import type { CliContext } from '../context';
import { maybeTriggerHistoryRefresh } from '../history-refresh';
import { toJson } from '../output';
import { makePlanningEmitter } from '../planning-emitter';
import { makeLifecycleAdapter } from '../workflow/make-lifecycle-adapter';

/** Per-status column title for the human-readable board. */
const STATUS_TITLE: Record<(typeof TASK_STATUSES)[number], string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    wip: 'WIP',
    testing: 'Testing',
    blocked: 'Blocked',
    done: 'Done',
    cancelled: 'Canceled',
};

/**
 * Render the task list as a status-grouped board for the terminal.
 *
 * Built dynamically from the live `svc.list()` result — NOT coupled to the
 * `kanban.md` file artifact (which `spur task refresh` owns). `columns` selects
 * which status sections render: all of {@link TASK_STATUSES} for the full board,
 * or a single status when the caller passed `--status`/`--phase` (so a filtered
 * view shows only the matching section, not seven mostly-empty ones).
 *
 * Tasks within a section keep `list()` ordering and render as a plain bullet list
 * (`•`) — a checkbox would falsely imply every task is incomplete. The board title
 * is blue and section headers are cyan, so the hierarchy reads at a glance (no
 * markdown/glow dependency); `color` is the identity colorizer when the stream is
 * not a TTY, so piped output and tests stay plain text.
 */
/**
 * Alias-normalize a status string (task 0292 fix pass): `Done`/`DONE`/legacy
 * aliases → canonical lowercase, so gate matches on `'done'` cannot be slipped
 * past with a case variant. Unknown values pass through unchanged — downstream
 * Zod validation owns the clear error for those.
 */
function canonicalStatusOrRaw(raw: string): string {
    try {
        return normalizeTaskStatus(raw);
    } catch {
        return raw;
    }
}

function renderTaskBoard(
    tasks: TaskSummary[],
    boardTitle: string,
    color: Colorize,
    columns: readonly (typeof TASK_STATUSES)[number][],
): string {
    const lines: string[] = ['', `  ${color.blue(`Kanban Board — ${boardTitle}`)}`, ''];
    for (const status of columns) {
        const rows = tasks.filter((t) => t.status === status);
        lines.push(`  ${color.cyan(`${taskStatusIcon(status)} ${STATUS_TITLE[status]}`)}`);
        for (const t of rows) {
            lines.push(`  • ${t.wbs}  ${t.name}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

const MIGRATION_RULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'] as const;

function renderMigrationReport(report: MigrationReport, dryRun: boolean, corpusDir: string): string {
    const lines = [
        `Task corpus migration ${dryRun ? 'dry-run' : 'apply'} complete`,
        `Corpus: ${corpusDir}`,
        `Files scanned: ${report.filesScanned}`,
        `Files modified: ${report.filesModified}`,
        `Files skipped: ${report.filesSkipped}`,
        '',
        'Rule flag counts:',
    ];
    for (const rule of MIGRATION_RULE_IDS) {
        const count = report.flags.filter((flag) => flag.rule === rule).length;
        lines.push(`  ${rule}: ${count}`);
    }
    lines.push('', 'Per-file changes:');
    const changed = report.fileReports.filter((file) => file.modified || file.validationError !== undefined);
    if (changed.length === 0) {
        lines.push('  none');
    } else {
        for (const file of changed) {
            const state = file.validationError !== undefined ? `skipped (${file.validationError})` : 'modified';
            const flags = file.flags.length > 0 ? `; flags=${file.flags.map((flag) => flag.rule).join(',')}` : '';
            lines.push(`  ${file.wbs}: ${state} — ${file.path}${flags}`);
        }
    }
    return lines.join('\n');
}

/** Register the `spur task` command and its subcommands on the CLI program. */
export function registerTaskCommand(program: Command, context: CliContext): void {
    const task = program.command('task').summary('manage tasks');

    // ── create ──
    task.command('create')
        .summary('Create a new task with race-safe WBS allocation.')
        .argument('<title>', 'Task title')
        .option('--feature <id>', 'Feature ID for traceability and Goal→Background derivation')
        .option('--parent <wbs>', 'Parent WBS for sub-task grouping')
        .option('--template <variant>', `Template variant (${TASK_VARIANTS.join('|')})`)
        .option('--folder <path>', 'Custom tasks folder')
        .option(
            '--dedupe-within <seconds>',
            'Override the default dedup window (seconds). Guard is on (300s) by default when --feature is set.',
            Number,
        )
        .option('--allow-duplicate-name', 'Disable the dedup guard entirely (creates anyway)')
        .option('--json', 'Output machine-readable JSON')
        .action(async (title, options) => {
            if (options.template !== undefined && !(TASK_VARIANTS as readonly string[]).includes(options.template)) {
                context.output.error(
                    `Unknown template variant "${options.template}". Valid: ${TASK_VARIANTS.join(', ')}`,
                );
                context.setExitCode(2);
                return;
            }
            if (
                options.dedupeWithin !== undefined &&
                (!Number.isInteger(options.dedupeWithin) || options.dedupeWithin <= 0)
            ) {
                context.output.error('--dedupe-within must be a positive integer');
                context.setExitCode(2);
                return;
            }
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.create({
                    title,
                    featureId: options.feature,
                    parentWbs: options.parent,
                    template: options.template,
                    // Dedup guard: default 300s window for every create (feature-scoped
                    // or unscoped). Explicit --dedupe-within overrides the window.
                    // --allow-duplicate-name disables the guard entirely. Unscoped
                    // tasks have their own collision scope (no feature_id).
                    dedupeWithinSec: options.allowDuplicateName ? null : options.dedupeWithin,
                });
                if (options.json) {
                    // Additive top-level `wbs`/`filePath` mirror `ref.id`/`ref.filePath`
                    // (task 0510 post-mortem): the envelope's WBS lives under `ref.id`,
                    // which differs from `task list/show --json` (`wbs`), and a script
                    // projecting `wbs` saw nulls and misread success as failure.
                    context.output.write(toJson({ ...result, wbs: result.ref.id, filePath: result.ref.filePath }));
                } else {
                    context.output.write(`Created task ${result.ref.id}: ${result.ref.filePath}`);
                }
            } catch (err) {
                if (err instanceof WbsCollisionError) {
                    if (options.json) {
                        context.output.write(
                            toJson({
                                ok: false,
                                error: {
                                    code: 'wbs-collision',
                                    message: err.message,
                                    wbs: err.wbs,
                                    existingPath: err.existingPath,
                                    attemptedPath: err.attemptedPath,
                                },
                            }),
                        );
                    } else {
                        context.output.error(err.message);
                    }
                    context.setExitCode(3);
                } else if (err instanceof DuplicateFollowUpError) {
                    if (options.json) {
                        context.output.write(
                            toJson({
                                ok: false,
                                error: {
                                    code: 'duplicate-follow-up',
                                    message: err.message,
                                    existingWbs: err.existingWbs,
                                    existingName: err.existingName,
                                    attemptedName: err.attemptedName,
                                },
                            }),
                        );
                    } else {
                        context.output.error(err.message);
                    }
                    context.setExitCode(3);
                } else {
                    context.output.error(String(err));
                    context.setExitCode(1);
                }
            }
        });

    // ── show ──
    task.command('show')
        // `get` alias (0534 R1): agents reach for `get` (6 live invocations in feature A
        // forensics); Commander's lexical suggester cannot bridge get→show (edit distance),
        // so an alias is the only close. One help entry, one code path.
        .alias('get')
        .summary('Show a task by WBS.')
        .argument('<wbs>', 'Task WBS number')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.show(wbs);
                if (options.json) {
                    const { frontmatter, ...rest } = result;
                    context.output.write(toJson({ ...rest, frontmatter }));
                } else {
                    context.output.write(
                        `${taskStatusIcon(result.status)} ${result.status.toUpperCase()} — ${result.wbs}\n\n${result.content}`,
                    );
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── update ──
    task.command('update')
        .summary('Update a task status or replace a section.')
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
                '`SPUR_PROVENANCE_OVERRIDE=1 spur task update <wbs> done --force-done --reason "…"`.',
                'See the gate checklist (spur-dev/references/gate-checklists.md).',
                'Valid section names (no failed write): `spur task sections <wbs> list`.',
            ].join('\n'),
        )
        .option('--section <name>', 'Section name to replace')
        .option('--from-file <path>', 'File to read section body from (requires --section)')
        .option('--feature <id>', 'Set the feature_id frontmatter field (traceability edge)')
        .option('--priority <p>', 'Set the priority frontmatter field (P0–P3)')
        .option(
            '--ac-numbering <mode>',
            'Set the ac_numbering frontmatter field (task-local) — opts the task into the Requirements↔AC coverage check',
        )
        .option(
            '--no-lifecycle',
            'Suppress lifecycle workflow run creation (use during pipeline runs to avoid orphaned lifecycle runs)',
        )
        .option(
            '--force-done',
            'Allow transitioning to `done` even when the verify verdict is not PASS; records an override (task 0292). Waives the verdict only — the FSM path still applies, so from an earlier status walk the hops first: `todo` → `wip` → `testing` → `done` (each hop runs the structural `spur task check`)',
        )
        .option(
            '--reason <text>',
            'Rationale for a forced-done override (paired with --force-done; persisted as done_reason)',
        )
        .option('--verdict-dir <path>', 'Directory holding <wbs>-verdict.json artifacts (default: .spur/run)')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, status, options) => {
            const svc = await makeService(context, options.folder, options.lifecycle === false);
            try {
                if (options.section !== undefined) {
                    if (options.fromFile === undefined) {
                        context.output.error('--from-file is required with --section');
                        context.setExitCode(2);
                        return;
                    }
                    const result = await svc.updateSection(wbs, options.section, options.fromFile);
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        for (const warning of result.warnings ?? []) {
                            context.output.error(warning);
                        }
                        context.output.write(`Updated section '${options.section}' in task ${result.ref.id}`);
                    }
                } else if (
                    options.feature !== undefined ||
                    options.priority !== undefined ||
                    options.acNumbering !== undefined
                ) {
                    const key =
                        options.feature !== undefined
                            ? 'feature_id'
                            : options.priority !== undefined
                              ? 'priority'
                              : 'ac_numbering';
                    const value = options.feature ?? options.priority ?? options.acNumbering ?? '';
                    const result = await svc.updateField(wbs, key, value);
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        context.output.write(`Set ${key}=${value} on task ${result.ref.id}`);
                    }
                } else if (status !== undefined) {
                    // Canonicalize the target before any gate matches: the frontmatter
                    // schema alias-normalizes legacy spellings (`Done`/`DONE` → `done`),
                    // so a case/alias variant IS a `* → done` transition and must not
                    // slip past the `=== 'done'` checks below (verdict gate + P3
                    // backstop).
                    status = canonicalStatusOrRaw(status);
                    // P3 backstop (task 0130 retrospective): the lifecycle YAML runs
                    // `spur task check` as the wip→testing and testing→done guard. Whenever
                    // that FSM guard will NOT run, re-run the gate inline so the structural
                    // check is not silently lost.
                    //
                    // Two ways the FSM guard goes missing, and BOTH must be covered:
                    //   1. the bundled task-lifecycle workflow can't be resolved (adapter
                    //      undefined) — the SchemaLifecyclePort fallback permits silently;
                    //   2. `--no-lifecycle` was passed — no adapter is built at all.
                    //
                    // Case 2 used to disable this backstop via `options.lifecycle !== false`,
                    // which made the flag that suppresses the lifecycle RUN RECORD also
                    // suppress ENFORCEMENT. That coupling let `--no-lifecycle --force-done`
                    // walk a task from wip to done carrying L3 errors. `--no-lifecycle` is
                    // bookkeeping ("the pipeline is already a run; a nested lifecycle run
                    // would orphan"), never a guard bypass — so the gate now runs regardless.
                    // In-process (TaskCheckService), so this costs no subprocess.
                    if (status === 'done' || status === 'testing') {
                        const adapter =
                            options.lifecycle === false
                                ? undefined
                                : makeLifecycleAdapter(context, TASK_LIFECYCLE_PROFILE);
                        if (adapter === undefined) {
                            if (options.lifecycle !== false) {
                                context.output.error(
                                    `warning: lifecycle adapter unavailable — running \`spur task check\` inline as the ${status} gate. ` +
                                        'Restore the bundled task-lifecycle workflow to re-enable the real guard.',
                                );
                            }
                            const ok = await runDoneGateCheck(context, wbs, options.folder, status);
                            if (!ok) {
                                context.output.error(
                                    `Lifecycle transition blocked: \`spur task check ${wbs}\` failed. Fix the findings before transitioning to ${status}.`,
                                );
                                context.setExitCode(1);
                                return;
                            }
                        }
                    }
                    // ── done-transition verdict gate (task 0292) ──
                    // Replaces the silent PARTIAL/FAIL → done slide. Runs for every `done`
                    // transition regardless of --no-lifecycle (covers the SchemaLifecyclePort
                    // fallback that the P3 backstop at line 234 does not cover). The guard
                    // reads the verify artifact (`.spur/run/<wbs>-verdict.json` by default),
                    // recomputes the aggregate for consistency (R10), and either allows,
                    // denies with an actionable message, or records an override.
                    // The guard returns `allow | deny | noop`. We separately track whether the
                    // allow was an operator override (R3) so the post-transition block can record
                    // the `done_forced` audit-trail frontmatter.
                    let forcedDone = false;
                    let forcedDoneReason: string | undefined;
                    let forcedDoneVerdict: VerdictAggregate | undefined;
                    if (status === 'done') {
                        const current = await svc.show(wbs);
                        const verdictDir = options.verdictDir ?? join(context.cwd, '.spur', 'run');
                        const loaded = await readVerdictArtifact(context.fs, verdictDir, wbs);
                        const guardOutcome = evaluateDoneTransition({
                            wbs,
                            taskFilePath: current.filePath,
                            // Normalize the stored status too, so a legacy-cased
                            // `Done` still short-circuits as the R9 no-op instead of
                            // mis-entering the verdict-denial path.
                            currentStatus: canonicalStatusOrRaw(String(current.frontmatter.status)),
                            targetStatus: 'done',
                            forced: options.forceDone === true,
                            reason: options.reason,
                            artifact: loaded.artifact,
                        });
                        if (guardOutcome.kind === 'noop') {
                            // R9: same-status no-op. Exit 0 so scripts/CI can idempotently re-run.
                            if (options.json) {
                                context.output.write(toJson({ ok: true, noop: true, wbs, status: 'done' }));
                            } else {
                                context.output.write(guardOutcome.message);
                            }
                            return;
                        }
                        if (guardOutcome.kind === 'deny') {
                            context.output.error(guardOutcome.message);
                            context.setExitCode(1);
                            return;
                        }
                        // `allow` — if it was a forced override (non-PASS or missing artifact),
                        // record state for the audit-trail write below.
                        if (guardOutcome.reason === 'forced') {
                            forcedDone = true;
                            forcedDoneReason = options.reason;
                            forcedDoneVerdict = loaded.artifact?.verdict ?? 'UNKNOWN';
                        }
                    }
                    const result = await svc.updateStatus(wbs, status);
                    // Completion trigger (task 0549 R1): task → done enqueues a coalesced
                    // history refresh — off the critical path, opt-in via
                    // `history.refresh.on_completion`. Best-effort; never changes the
                    // transition's exit code.
                    if (status === 'done') {
                        await maybeTriggerHistoryRefresh(context, 'task-done', wbs);
                    }
                    // R3 override audit-trail: persist done_forced + done_reason so a later
                    // `spur task show` surfaces that this `done` was an operator override of a
                    // non-PASS verdict. Best-effort — a write failure here leaves the task at
                    // `done` without the audit fields; the transition itself is already committed.
                    if (forcedDone) {
                        try {
                            await svc.updateField(wbs, 'done_forced', 'true');
                            if (forcedDoneReason !== undefined && forcedDoneReason.length > 0) {
                                await svc.updateField(wbs, 'done_reason', forcedDoneReason);
                            }
                        } catch (auditErr) {
                            context.output.error(
                                `warning: failed to record done-forced audit fields: ${String(auditErr)}`,
                            );
                        }
                    }
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        context.output.write(`${result.ref.id}: ${result.fromStatus} → ${result.toStatus}`);
                        if (forcedDone && forcedDoneVerdict !== undefined) {
                            context.output.write(
                                `ⓘ  Override recorded: task advanced to done despite ${forcedDoneVerdict} verdict (done_forced=true).`,
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
                    context.output.error('Either <status>, --section/--from-file, or --feature/--priority is required');
                    context.setExitCode(2);
                }
            } catch (err) {
                if (err instanceof SectionMutationError) {
                    context.output.error(`[${err.code}] ${err.message}`);
                    context.setExitCode(err.code === 'usage' ? 2 : 3);
                } else {
                    context.output.error(String(err));
                    context.setExitCode(1);
                }
            }
        });

    // ── deps (task 0303 — CLI-safe dependencies[] mutation) ──
    task.command('deps')
        .summary('Mutate the dependencies[] frontmatter array on a task.')
        .description(
            'Mutate the `dependencies[]` array on an existing task. Operations:\n' +
                '  set <wbs...>     — replace the array with the given WBS values\n' +
                '  add <wbs...>     — append the given values (deduped)\n' +
                '  remove <wbs...>  — drop the given values\n' +
                '  clear            — empty the array\n\n' +
                'Validation: WBS format, existence, self-edge, duplicates, and cycle detection\n' +
                'all run BEFORE any write (atomic — R2). Exit codes: 0 success, 1 generic error,\n' +
                '2 usage error, 3 validation error.',
        )
        .argument('<wbs>', 'Task WBS number to mutate')
        .argument('<op>', 'Operation: set | add | remove | clear')
        .argument('[values...]', 'WBS values (required for set/add/remove; forbidden for clear)')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, op, values, options) => {
            const allowedOps = ['set', 'add', 'remove', 'clear'] as const;
            if (!allowedOps.includes(op as (typeof allowedOps)[number])) {
                context.output.error(`Unknown op "${op}". Allowed: ${allowedOps.join(', ')}.`);
                context.setExitCode(2);
                return;
            }
            const typedOp = op as (typeof allowedOps)[number];
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.mutateDependencies(wbs, typedOp, values);
                if (options.json) {
                    context.output.write(toJson(result));
                } else {
                    const list = result.dependencies.length > 0 ? result.dependencies.join(', ') : '(none)';
                    context.output.write(`Set dependencies on task ${result.ref.id}: [${list}]`);
                }
            } catch (err) {
                if (err instanceof DependencyMutationError) {
                    context.output.error(`[${err.code}] ${err.message}`);
                    // usage → 2, all other validation codes → 3
                    context.setExitCode(err.code === 'usage' ? 2 : 3);
                } else {
                    context.output.error(String(err));
                    context.setExitCode(1);
                }
            }
        });

    // ── sections (task 0304 — CLI-safe canonical section mutation) ──
    task.command('sections')
        .summary('Initialize, add, or list canonical task sections (matrix-enforced).')
        .description(
            'CLI-safe mutation of canonical task sections. Operations:\n' +
                "  init             — add every required section for the task's current status\n" +
                '                    that is not already present (idempotent)\n' +
                '  add <name>       — add a single canonical section (rejects unknown/forbidden;\n' +
                '                    idempotent if already present)\n' +
                '  list             — read-only: resolve the matrix entry for variant + status\n' +
                '                    and return required/optional/forbidden, present, missing\n\n' +
                'Section names are validated against TASK_CANONICAL_SECTIONS (closed-world) and\n' +
                'against the variant/status matrix entry. Universal sections\n' +
                // Interpolated from the domain constant so the help text cannot drift out of
                // sync with the runtime relaxation (tsc cannot type-check a prose literal).
                `(${UNIVERSAL_SECTIONS.join(', ')}) are always allowed. All writes go through the\n` +
                'existing planning-write-service.updateSection pipeline — phantom-section guards,\n' +
                'atomic writes, history, and timestamps are inherited. Exit codes: 0 success,\n' +
                '1 generic error, 2 usage error, 3 validation error.',
        )
        .argument('<wbs>', 'Task WBS number to mutate')
        .argument('<op>', 'Operation: init | add | list')
        .argument('[name]', 'Canonical section name (required for add; forbidden for init/list)')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, op, name, options) => {
            const allowedOps = ['init', 'add', 'list'] as const;
            if (!allowedOps.includes(op as (typeof allowedOps)[number])) {
                context.output.error(`Unknown op "${op}". Allowed: ${allowedOps.join(', ')}.`);
                context.setExitCode(2);
                return;
            }
            const typedOp = op as (typeof allowedOps)[number];
            if (typedOp === 'add' && typeof name !== 'string') {
                context.output.error('op "add" requires a section name argument.');
                context.setExitCode(2);
                return;
            }
            if ((typedOp === 'init' || typedOp === 'list') && name !== undefined) {
                context.output.error(`op "${typedOp}" takes no section name argument.`);
                context.setExitCode(2);
                return;
            }
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.mutateSections(wbs, typedOp, name);
                if (options.json) {
                    context.output.write(toJson(result));
                } else if (result.op === 'list') {
                    const m = result.matrix ?? { required: [], optional: [], forbidden: [] };
                    const present = result.present ?? [];
                    const missing = result.missing ?? [];
                    context.output.write(
                        `Task ${result.ref.id} (${result.variant}/${result.status})\n` +
                            `  required:  ${m.required.join(', ') || '(none)'}\n` +
                            `  optional:  ${m.optional.join(', ') || '(none)'}\n` +
                            `  forbidden: ${m.forbidden.join(', ') || '(none)'}\n` +
                            `  present:   ${present.join(', ') || '(none)'}\n` +
                            `  missing:   ${missing.join(', ') || '(none)'}`,
                    );
                } else {
                    const added = result.added.length > 0 ? result.added.join(', ') : '(none)';
                    context.output.write(`${result.op} on task ${result.ref.id}: added [${added}]`);
                }
            } catch (err) {
                if (err instanceof SectionMutationError) {
                    context.output.error(`[${err.code}] ${err.message}`);
                    context.setExitCode(err.code === 'usage' ? 2 : 3);
                } else {
                    context.output.error(String(err));
                    context.setExitCode(1);
                }
            }
        });

    // ── list ──
    task.command('list')
        .summary('List tasks with optional filtering.')
        .option('--status <s>', 'Filter by status')
        .option('--phase <p>', 'Filter by phase (legacy alias for --status)')
        .option('--parent <wbs>', 'Filter by parent WBS')
        .option('--feature <id>', 'Filter by linked feature ID (feature_id edge)')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const svc = await makeService(context, options.folder);
            try {
                const tasks = await svc.list({
                    status: options.status,
                    phase: options.phase,
                    parentWbs: options.parent,
                    featureId: options.feature,
                });
                if (options.json) {
                    context.output.write(toJson(tasks));
                } else if (tasks.length === 0) {
                    context.output.write('(no tasks)');
                } else {
                    const { foldersConfig } = await resolvePlanningFolders(context.fs);
                    const folderPath = options.folder ?? foldersConfig.active_folder;
                    const label = foldersConfig.folders[folderPath]?.label;
                    const boardTitle = label ? `${label} (${folderPath})` : folderPath;
                    const color = makeColorize(shouldColor(context.env, process.stdout));
                    // A status filter collapses the board to just the matching section;
                    // an unfiltered (or non-canonical filter) view shows all columns.
                    const requested = options.status ?? options.phase;
                    const columns =
                        requested !== undefined && (TASK_STATUSES as readonly string[]).includes(requested)
                            ? [requested as (typeof TASK_STATUSES)[number]]
                            : TASK_STATUSES;
                    context.output.write(renderTaskBoard(tasks, boardTitle, color, columns));
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });
    // ── refresh ──
    task.command('refresh')
        .summary('Re-scan the task corpus and report counts (kanban.md retired — A17 cutover).')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.refresh();
                if (options.json) {
                    context.output.write(toJson(result));
                } else {
                    context.output.write(`Corpus scanned — ${result.tasks} tasks across ${result.folders} folder(s)`);
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── migrate ──
    task.command('migrate')
        .summary('Run the one-time A17 task corpus normalization pass.')
        .option('--dry-run', 'Produce the full report without writing files')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            try {
                const foldersConfig = (await resolvePlanningFolders(context.fs)).foldersConfig;
                const activeFolder = context.fs.resolve(foldersConfig.active_folder);
                const corpusDir = options.folder ?? activeFolder;
                const dryRun = options.dryRun === true;
                const migrator = new CorpusMigrator({ fs: context.fs, corpusDir });
                const report = await migrator.migrate({ dryRun });
                if (options.json) {
                    context.output.write(toJson({ ok: true, dryRun, corpusDir, ...report }));
                } else {
                    context.output.write(renderMigrationReport(report, dryRun, corpusDir));
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── migrate-anchors ──
    task.command('migrate-anchors')
        .summary('Qualify in-repo evidence anchors to repo-relative paths (0583 R1–R3).')
        .option('--dry-run', 'Produce the full report without writing files')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            try {
                const dryRun = options.dryRun === true;
                const report = await anchorQualify(context.fs, {
                    dryRun,
                    // Scope the tracked-file index to THIS invocation's project rather
                    // than letting it fall back to `process.cwd()`.
                    projectRoot: context.cwd,
                    write: async (filePath, wbs, section, newBody) => {
                        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: dirname(filePath) };
                        const ws = new PlanningWriteService({ fs: context.fs, emitter: makePlanningEmitter(context) });
                        await ws.updateSection(ref, section, newBody);
                    },
                });
                const qualified = report.fileReports.flatMap((r) =>
                    r.qualified.map((q) => `${r.wbs}: \`${q.raw}\` → \`${q.newPath}:${q.lineSpec}\``),
                );
                const ambiguous = report.fileReports.flatMap((r) =>
                    r.ambiguous.map((a) => `${r.wbs}: ${a.cited} → candidates: ${a.candidates.join(', ')}`),
                );
                const skipped = report.fileReports
                    .filter((r) => r.skipped !== undefined)
                    .map((r) => `${r.wbs}: ${r.skipped}`);
                if (options.json) {
                    context.output.write(toJson({ ok: true, dryRun, qualified, ambiguous, skipped, ...report }));
                } else if (dryRun) {
                    const lines = [
                        `Anchor qualification ${dryRun ? 'dry-run' : 'apply'} complete`,
                        '',
                        `Files scanned: ${report.filesScanned}`,
                        `Files modified (${dryRun ? 'would be' : ''}): ${report.filesModified}`,
                        '',
                        'Rewrites:',
                        ...(qualified.length ? qualified : ['  none']),
                        '',
                        'Ambiguous (reported, not rewritten):',
                        ...(ambiguous.length ? ambiguous : ['  none']),
                        '',
                        'Skipped (unwritable — frontmatter predates the current schema):',
                        ...(skipped.length ? skipped : ['  none']),
                    ];
                    context.output.write(lines.join('\n'));
                } else {
                    context.output.write(
                        `Anchor qualification apply complete — ${report.filesModified} file(s) modified` +
                            (skipped.length
                                ? `, ${skipped.length} skipped (unwritable):\n  ${skipped.join('\n  ')}`
                                : '.'),
                    );
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── refresh-roster ──
    task.command('refresh-roster')
        .summary("Regenerate a parent task's sub-task roster block in its ## Plan (0121 roll-up gate's generator).")
        .argument('<wbs>', 'Parent task WBS number')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.refreshRoster(wbs);
                if (options.json) {
                    context.output.write(toJson(result));
                } else if (!result.written) {
                    context.output.write(`Task ${wbs} has no sub-tasks — nothing to roster.`);
                } else {
                    context.output.write(`Roster refreshed for ${wbs} (${result.childCount} sub-task(s)).`);
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── batch-create ──
    task.command('batch-create')
        .summary('Create many tasks from a validated JSON file — all-or-nothing (LLM→CLI gate).')
        .requiredOption('--file <path>', 'Path to the batch JSON file validated against task-batch.schema.json')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const svc = await makeService(context, options.folder);
            try {
                const { children, parentsWired } = await svc.batchCreate(options.file);
                if (options.json) {
                    const ids = children.map((r) => r.ref.id);
                    context.output.write(toJson({ created: children.length, wbs: ids, parentsWired }));
                } else {
                    context.output.write(`Created ${children.length} task(s)`);
                    for (const r of children) {
                        context.output.write(`  ${r.ref.id}  ${r.ref.filePath}`);
                    }
                    if (parentsWired.length > 0) {
                        context.output.write(`Wired ${parentsWired.length} parent(s):`);
                        for (const p of parentsWired) {
                            const txLine = p.transitionedTo ? ` → ${p.transitionedTo}` : '';
                            const errLine = p.errors.length > 0 ? ` (errors: ${p.errors.join('; ')})` : '';
                            context.output.write(`  ${p.wbs}  rostered=${p.rostered}${txLine}${errLine}`);
                        }
                    }
                }
            } catch (err) {
                if (err instanceof WbsCollisionError) {
                    if (options.json) {
                        context.output.write(
                            toJson({
                                ok: false,
                                error: {
                                    code: 'wbs-collision',
                                    message: err.message,
                                    wbs: err.wbs,
                                    existingPath: err.existingPath,
                                    attemptedPath: err.attemptedPath,
                                },
                            }),
                        );
                    } else {
                        context.output.error(err.message);
                    }
                    context.setExitCode(3);
                } else {
                    context.output.error(String(err));
                    context.setExitCode(1);
                }
            }
        });

    // ── record ──
    task.command('record')
        .summary('Record pipeline results into the task file — Testing, Review, and optional Solution backfill.')
        .argument('<wbs>', 'Task WBS number')
        .option('--verdict-file <path>', 'Path to verdict JSON (default: .spur/run/<wbs>-verdict.json)')
        .option('--solution-from-diff', 'Backfill Solution from git diff when bare')
        .option('--transition <status>', 'Optional lifecycle transition (e.g. testing)')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.record(wbs, {
                    verdictFile: options.verdictFile,
                    solutionFromDiff: options.solutionFromDiff === true,
                    transition: options.transition,
                });
                if (options.json) {
                    context.output.write(toJson(result));
                } else {
                    const parts: string[] = [];
                    if (result.testingWritten) parts.push('Testing written');
                    if (result.reviewWritten) parts.push('Review written');
                    if (result.solutionBackfilled) parts.push('Solution backfilled');
                    if (result.transitionedTo) parts.push(`${wbs} → ${result.transitionedTo}`);
                    context.output.write(parts.join(', ') || 'no changes');
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── verdict ──
    task.command('verdict')
        .summary('Derive PASS/PARTIAL/FAIL/UNKNOWN verdict from verify answer text (replaces pipeline grep/shell).')
        .argument('<wbs>', 'Task WBS number')
        .option('--from-answer <path>', 'Path to verify answer text file')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, options) => {
            // Lazy-import to keep the barrel clean for typecheck.
            const { deriveVerdict, verdictRowsMatchScenarios } = await import('@gobing-ai/spur-app');
            const answerPath = options.fromAnswer ?? `.spur/run/${wbs}-verify-answer.txt`;
            let answerText: string;
            try {
                answerText = await context.fs.readFile(context.fs.resolve(answerPath));
            } catch {
                context.output.error(`Answer file not found: ${answerPath}`);
                context.setExitCode(1);
                return;
            }

            // Derive verdict from answer text. The pipeline's verify→record
            // transition already gates on task check independently, so the
            // answer text is the sole input here.
            const taskCheckPassed = true; // Pipeline runs its own check guard
            const result = deriveVerdict(answerText, taskCheckPassed);

            // Dogfood 2026-08-15 (feature I3): rows keyed by bare R1-style ids
            // parse and derive a verdict but are credited by NO feature scenario
            // at the L4 verifying→done gate — surfacing only as opaque
            // L4.scenario-unverified findings there. Warn early and actionable.
            try {
                const svc = await makeService(context, options.folder);
                const task = await svc.show(wbs);
                const featureId = task.frontmatter.feature_id;
                if (typeof featureId === 'string' && featureId.length > 0) {
                    const resolved = await resolvePlanningFolders(context.fs);
                    const names = await context.fs.readDir(context.fs.resolve(resolved.featuresDir));
                    const name = names.find((n) => n.startsWith(`${featureId}_`) && n.endsWith('.md'));
                    if (name !== undefined) {
                        const raw = await context.fs.readFile(context.fs.resolve(`${resolved.featuresDir}/${name}`));
                        if (!verdictRowsMatchScenarios(result.requirements, raw)) {
                            context.output.error(
                                `warning: no verdict row matches any scenario in feature ${featureId} — key rows by scenario title or AC-N alias, or the feature done gate reports L4.scenario-unverified`,
                            );
                        }
                    }
                }
            } catch {
                // Diagnostic only — never fail the verdict on lookup problems.
            }

            // Emit verdict artifact.
            const jsonOut = JSON.stringify({ wbs, ...result, source: 'spur-task-verdict' }, null, 2);
            await context.fs.ensureDir('.spur/run');
            await context.fs.writeFile(`.spur/run/${wbs}-verdict.json`, `${jsonOut}\n`);

            if (options.json) {
                context.output.write(jsonOut);
            } else {
                context.output.write(
                    `Verdict: ${result.verdict} (${result.requirements.length} requirements, ${result.checks.length} checks)`,
                );
            }

            if (result.verdict !== 'PASS') {
                context.setExitCode(1);
            }
        });

    // ── verifyall-aggregate ──
    task.command('verifyall-aggregate')
        .summary('Aggregate per-task verify outcomes into a deterministic batch verdict (verifyall).')
        .description(
            'Reads a JSON array of per-task outcomes ({wbs,outcome}) and emits the batch ' +
                'verdict with NOT-STARTED tasks excluded from the rollup. Replaces agent-discretion ' +
                'rollup prose (dev-operations.md §3a) with deterministic code (task 0341).',
        )
        .option('--from-file <path>', 'Path to JSON array of {wbs,outcome[,reason]} rows')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const inputPath = options.fromFile ?? '.spur/run/verifyall-batch-input.json';
            let raw: string;
            try {
                raw = await context.fs.readFile(context.fs.resolve(inputPath));
            } catch {
                context.output.error(`Batch input file not found: ${inputPath}`);
                context.setExitCode(1);
                return;
            }

            let rows: Array<{ wbs: string; outcome: string; reason?: string }>;
            try {
                const parsed: unknown = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                    throw new Error('expected a JSON array');
                }
                rows = parsed;
            } catch (err) {
                context.output.error(`Invalid batch input JSON: ${String(err)}`);
                context.setExitCode(1);
                return;
            }

            const results = rows.map((r) => {
                const outcome = r.outcome.toUpperCase();
                if (!['PASS', 'PARTIAL', 'FAIL', 'NOT-STARTED', 'UNKNOWN'].includes(outcome)) {
                    throw new Error(`Invalid outcome for ${r.wbs}: ${r.outcome}`);
                }
                return {
                    wbs: r.wbs,
                    outcome: outcome as 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT-STARTED' | 'UNKNOWN',
                    reason: r.reason,
                };
            });

            const aggregation = aggregateBatchVerdicts(results);

            if (options.json) {
                context.output.write(JSON.stringify(aggregation, null, 2));
            } else {
                context.output.write(`Batch verdict: ${aggregation.verdict}`);
                context.output.write(aggregation.summary);
                if (aggregation.notStarted.length > 0) {
                    context.output.write(
                        `NOT-STARTED (excluded from rollup): ${aggregation.notStarted.map((r) => r.wbs).join(', ')}`,
                    );
                }
            }

            if (aggregation.verdict === 'FAIL') {
                context.setExitCode(1);
            }
        });

    // ── check ──
    task.command('check')
        .summary('Validate a task file through the four-layer check (design §3).')
        .argument('[wbs]', 'Task WBS number (validates all tasks in the folder when omitted)')
        .option('--strict', 'Elevate ALL warnings to failures')
        .option(
            '--strict-core',
            'Compatibility alias (F92 R2): historically the done-gate label; kept so installed plugins/workflows that call it keep working. No longer meaningful on its own — target-state selection (`--as`) supplies the real done semantics.',
        )
        .option(
            '--as <status>',
            'Evaluate the task AS if it were in <status> (F92 R2): the lifecycle guards pass the transition target so testing→done checks the done row. Validate against canonical task statuses. Omitted → current-status diagnostics.',
        )
        .option('--corpus', 'Sweep every task and feature against config/corpus-baseline.json')
        .option('--since <ref>', 'Scope the corpus fog check to changes since a git ref (requires --corpus)')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, options) => {
            const json = options.json === true;
            // `--strict` elevates every advisory; `--strict-core` is the done-gate
            // variant — the hard-core L3 rules (Solution file:line, Review P1–P4)
            // and gate:true required-section misses are already errors, so it runs
            // the default severity computation (no blanket elevation). The flag
            // exists so the testing→done lifecycle guard has a real, stable verb.
            const strict = options.strict === true;
            // F92 R2: `--as <status>` — a target status projection. Validate against
            // canonical task statuses; reject contradictory combinations explicitly.
            const asStatus = options.as === undefined ? undefined : canonicalStatusOrRaw(options.as);
            if (options.as !== undefined && !(TASK_STATUSES as readonly string[]).includes(asStatus ?? '')) {
                context.output.error(`invalid --as status "${options.as}" (canonical: ${TASK_STATUSES.join(', ')})`);
                context.setExitCode(2);
                return;
            }
            if (asStatus !== undefined && options.corpus === true) {
                context.output.error(
                    '--as <status> is a single-task target projection and cannot be combined with --corpus',
                );
                context.setExitCode(2);
                return;
            }
            try {
                if (options.corpus === true) {
                    if (wbs !== undefined) {
                        context.output.error('--corpus validates the whole corpus and cannot be combined with a WBS');
                        context.setExitCode(2);
                        return;
                    }
                    if (String(options.since ?? '').startsWith('-')) {
                        // Commander eats a following flag as a missing option's value
                        // (`--since --json` → since='--json'); reject flag-like values
                        // instead of silently running an unscoped sweep (R3 parity with
                        // the deleted spur-dev throw at scripts/spur-dev.ts:102). A
                        // truly absent value already throws "option '--since <ref>'
                        // argument missing" via exitOverride.
                        context.output.error('--since requires a git ref value (e.g. --since HEAD~1)');
                        context.setExitCode(2);
                        return;
                    }
                    if (options.since !== undefined) {
                        // Restore the spur-dev-era visible SKIPPED diagnostic (P3): an
                        // explicitly supplied but unresolvable ref skips the fog half of
                        // the sweep; the runCorpusCheck result cannot carry the reason
                        // (frozen JSON shape), so the transport surfaces it on stderr.
                        const fogRange = await resolveFogRange(context.cwd, options.since);
                        if ('skip' in fogRange) {
                            context.output.error(
                                `corpus-check: fog check SKIPPED (${fogRange.skip}) — range ${fogRange.spec} was not evaluated.`,
                            );
                        }
                    }
                    const result = await runCorpusCheck(context.cwd, options.since);
                    if (json) {
                        context.output.write(toJson(result));
                    } else {
                        const e = result.bySeverity.error;
                        const w = result.bySeverity.warning;
                        context.output.write(
                            `corpus-check: swept tasks + features — errors ${e.observed} observed, ` +
                                `${e.baselined} baselined, ${e.newCount} new, ${e.staleCount} stale; ` +
                                `warnings ${w.observed} observed, ${w.baselined} baselined, ` +
                                `${w.newCount} new, ${w.staleCount} stale.`,
                        );
                        for (const error of result.newErrors) {
                            context.output.error(
                                `  NEW    [error]   ${error.kind} ${error.id}: ${error.code} — ${error.message}`,
                            );
                        }
                        for (const warning of result.newWarnings) {
                            context.output.error(
                                `  NEW    [warning] ${warning.kind} ${warning.id}: ${warning.code} — ${warning.message}`,
                            );
                        }
                        for (const entry of result.staleEntries) {
                            context.output.error(
                                `  STALE  ${entry.kind} ${entry.id}: ${entry.code} — fixed; remove this baseline entry`,
                            );
                        }
                        for (const dup of result.duplicateKeys) {
                            context.output.error(
                                `  DUP    ${dup.key} — ${dup.count} entries for one key; reconciliation is key-addressed, ` +
                                    'so the extras over-cover and hide a partial reduction. Keep one entry per key.',
                            );
                        }
                        context.output.write(
                            result.ok
                                ? 'corpus-check OK — no corpus errors or warnings outside the accepted baseline.'
                                : 'corpus-check FAILED — reconcile new, stale, and duplicate entries in config/corpus-baseline.json.',
                        );
                    }
                    if (!result.ok) context.setExitCode(1);
                    return;
                }
                if (options.since !== undefined) {
                    context.output.error('--since requires --corpus');
                    context.setExitCode(2);
                    return;
                }

                const svc = await makeCheckService(context);
                const planningFolders = await resolvePlanningFolders(context.fs);
                const accepted = await loadAcceptedFindings(context.cwd);
                const activeFolder = planningFolders.foldersConfig.active_folder;
                // Normalize every explicit override so relative and absolute spellings of the
                // same folder are identical downstream (project-root derivation, line anchors) —
                // 0522 R2.
                const tasksDir = context.fs.resolve(options.folder ?? activeFolder);
                const printResult = (result: Awaited<ReturnType<typeof svc.check>>) => {
                    if (json) return;
                    context.output.write(`\n${result.wbs} (${result.status}): ${result.pass ? 'PASS' : 'FAIL'}`);
                    for (const f of result.findings) {
                        const tag = f.severity === 'error' ? 'ERR' : 'WARN';
                        context.output.write(`  [${tag}] ${f.layer} ${f.section}: ${f.message}`);
                    }
                    if (result.missingSections.length > 0) {
                        context.output.write(`  Missing: ${result.missingSections.join(', ')}`);
                    }
                };

                const results = [];
                if (wbs) {
                    // WBS-targeted check: locate through the configured folder set (or the
                    // single explicit --folder) — same resolution as task show/path/update
                    // (0522 R1). Unscoped scans below remain active-folder-only (R3).
                    const locator =
                        options.folder !== undefined
                            ? TaskLocator.forSingleDir(context.fs, tasksDir)
                            : await makeTaskLocator(context);
                    const hit = await locator.findByWbs(wbs);
                    if (hit === null) {
                        context.output.error(`Task ${wbs} not found`);
                        context.setExitCode(1);
                    } else {
                        const result = await svc.check(hit.filePath, wbs, {
                            strict,
                            asStatus,
                            severityOverrides: planningFolders.severityOverrides,
                            accepted,
                        });
                        results.push(result);
                        printResult(result);
                    }
                } else {
                    const entries = await context.fs.readDir(tasksDir);
                    const wbsPattern: string[] = entries
                        .filter((n) => /^\d{4}_.+\.md$/.test(n))
                        .map((n) => n.match(/^(\d{4})_/)?.[1])
                        .filter((n): n is string => n !== undefined);

                    for (const w of wbsPattern) {
                        const fileName = entries.find((n) => n.startsWith(`${w}_`) && n.endsWith('.md'));
                        if (!fileName) {
                            context.output.error(`Task ${w} not found`);
                            context.setExitCode(1);
                            continue;
                        }
                        const result = await svc.check(`${tasksDir}/${fileName}`, w, {
                            strict,
                            asStatus,
                            severityOverrides: planningFolders.severityOverrides,
                            accepted,
                        });
                        results.push(result);
                        printResult(result);
                    }
                }

                // Duplicate-WBS detection (task 0416 R6): when scanning the
                // full corpus (no specific WBS), flag any WBS prefix that
                // appears in more than one file across all configured folders.
                if (!wbs) {
                    const locator = await makeTaskLocator(context);
                    const duplicates = await locator.findDuplicateWbs();
                    for (const dup of duplicates) {
                        const [first] = dup;
                        if (first === undefined) continue;
                        const msg =
                            `Duplicate WBS ${first.wbs} found in ${dup.length} files:\n` +
                            dup.map((h) => `  ${h.filePath}`).join('\n');
                        if (json) {
                            results.push({ wbs: first.wbs, pass: false, status: 'duplicate', findings: [msg] });
                        } else {
                            context.output.error(msg);
                        }
                    }
                }

                if (json) {
                    context.output.write(toJson(results));
                }

                const hasError = results.some((r) => !r.pass);
                if (hasError) context.setExitCode(1);
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });
    // ── resolve ──
    task.command('resolve')
        .summary('Resolve a file path to its owning task WBS.')
        .argument('<file-path>', 'File path to resolve')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--strict', 'Match only the exact corpus path (no basename-WBS fallback)')
        .option('--json', 'Output machine-readable JSON')
        .action(async (filePath, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.resolve(filePath, { strict: options.strict === true });
                if (result) {
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        context.output.write(`${result.wbs}  ${result.filePath}`);
                    }
                } else {
                    context.output.error(`No owning task found for ${filePath}`);
                    context.setExitCode(1);
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── path ──
    task.command('path')
        .summary('Resolve a WBS to its absolute task file path.')
        .argument('<wbs>', 'Task WBS number')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const filePath = await svc.getFilePath(wbs);
                if (filePath !== null) {
                    if (options.json) {
                        context.output.write(toJson({ wbs, filePath }));
                    } else {
                        context.output.write(filePath);
                    }
                } else {
                    context.output.error(`Task ${wbs} not found`);
                    context.setExitCode(1);
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── run-link ──
    task.command('run-link')
        .summary(
            'Record a pipeline provenance link for a task (used by --next auto chains to satisfy testing→done guard).',
        )
        .argument('<wbs>', 'Task WBS number')
        .option('--source <source>', 'Link source identifier (e.g. next-auto)', 'chain')
        .option('--run-id <id>', 'Explicit run_id (auto-generated when omitted)')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, options) => {
            try {
                const db = await context.getDb();
                // Shared helper with TaskService.record (task 0436 residual — single owner).
                const ensured = await ensurePipelineRunLink(db, wbs, {
                    runId: options.runId ?? `chain:${options.source}:${wbs}:${Date.now()}`,
                });
                const result = {
                    id: ensured.id,
                    wbs: ensured.wbs,
                    runId: ensured.runId,
                    kind: ensured.kind,
                    existed: !ensured.created,
                };
                if (options.json) {
                    context.output.write(toJson(result));
                } else if (ensured.created) {
                    context.output.write(
                        `Recorded pipeline run-link ${ensured.id} for task ${wbs} (source: ${options.source})`,
                    );
                } else {
                    context.output.write(`Pipeline run-link already exists for ${wbs} (${ensured.id}). Skipped.`);
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── scaffold-tests ──
    task.command('scaffold-tests')
        .summary('Generate BDD test stubs from task Acceptance Criteria.')
        .argument('<wbs>', 'Task WBS number')
        .option('--file <path>', 'Custom target test file path')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, options) => {
            const { TaskScaffoldService, resolvePlanningFolders } = await import('@gobing-ai/spur-app');
            const foldersConfig = (await resolvePlanningFolders(context.fs)).foldersConfig;
            const tasksDir = options.folder ?? context.fs.resolve(foldersConfig.active_folder);
            const scaffoldSvc = new TaskScaffoldService({
                fs: context.fs,
                tasksDir,
                foldersConfig,
            });

            try {
                const result = await scaffoldSvc.scaffoldTests(wbs, {
                    targetFile: options.file,
                });
                if (options.json) {
                    context.output.write(toJson(result));
                } else {
                    context.output.write(
                        `Scaffolded tests for ${wbs} -> ${result.targetFile} (created: ${result.created}, skipped: ${result.skipped}, drifted: ${result.drifted})`,
                    );
                    for (const w of result.warnings) {
                        context.output.write(`  [WARN] ${w}`);
                    }
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });
}

async function makeService(context: CliContext, folderOverride?: string, noLifecycle = false): Promise<TaskService> {
    const foldersConfig = (await resolvePlanningFolders(context.fs)).foldersConfig;
    // Normalize the override: relative and absolute spellings are the same folder (0522 R2).
    const tasksDir = context.fs.resolve(folderOverride ?? foldersConfig.active_folder);
    const lifecycle = noLifecycle ? undefined : makeLifecycleAdapter(context, TASK_LIFECYCLE_PROFILE);
    const writeService = new PlanningWriteService({
        fs: context.fs,
        ...(lifecycle ? { lifecycle } : {}),
        emitter: makePlanningEmitter(context),
    });
    return new TaskService({
        fs: context.fs,
        tasksDir,
        writeService,
        getDb: () => context.getDb(),
        sectionMatrix: await loadSectionMatrix(context.cwd),
        resolveTemplateBodies: (variant: string) => loadTemplateBodies(context.cwd, variant),
        foldersConfig,
    });
}

/** Cache of per-variant template bodies (read once per process from bundled config). */
const templateBodiesCache = new Map<string, Partial<Record<TaskSection, string>>>();

/**
 * Read a variant's scaffold template and extract its per-section bodies
 * (e.g. `review`'s P1–P4 table). Resolution order:
 *   1. `.spur/templates/task/<variant>.md` (project-local, seeded by `spur init`)
 *   2. bundled template fallback (`templates/task/<variant>.md`)
 * Returns `{}` when neither source is reachable — creation then falls back to
 * matrix + guidance only. Results are cached per process.
 */
function loadTemplateBodies(projectRoot: string, variant: string): Partial<Record<TaskSection, string>> {
    const cached = templateBodiesCache.get(variant);
    if (cached !== undefined) return cached;
    let bodies: Partial<Record<TaskSection, string>> = {};

    // 1. Project-local: .spur/templates/task/<variant>.md
    const localPath = join(projectRoot, '.spur', 'tasks', 'templates', `${variant}.md`);
    if (existsSync(localPath)) {
        bodies = extractTemplateBodies(readFileSync(localPath, 'utf8'));
    } else {
        // 2. Bundled fallback: templates/task/<variant>.md
        const root = bundledConfigRoot();
        if (root !== null) {
            const templatePath = join(root, 'templates', 'task', `${variant}.md`);
            if (existsSync(templatePath)) {
                bodies = extractTemplateBodies(readFileSync(templatePath, 'utf8'));
            }
        }
    }

    templateBodiesCache.set(variant, bodies);
    return bodies;
}

/**
 * Locator over every registered task folder. The L4 edge checks (parent, deps,
 * child rollup) resolve related tasks through it, so a corpus spanning several
 * folders no longer reports cross-folder dependencies as missing.
 */
async function makeTaskLocator(context: CliContext): Promise<TaskLocator> {
    const { foldersConfig } = await resolvePlanningFolders(context.fs);
    return new TaskLocator({
        fs: context.fs,
        tasksDir: context.fs.resolve(foldersConfig.active_folder),
        foldersConfig,
    });
}

async function makeCheckService(context: CliContext): Promise<TaskCheckService> {
    return new TaskCheckService(context.fs, await loadSectionMatrix(context.cwd), await makeTaskLocator(context));
}

/**
 * Inline lifecycle-gate backstop (P3, task 0130 retrospective). Runs the same
 * `spur task check` guard the lifecycle YAML runs, used ONLY when the lifecycle
 * adapter is unavailable and the transition targets a guarded state (`testing`
 * or `done`). Returns `true` iff the check passes.
 *
 * Target-aware (F92 R3): the check is evaluated AS the transition target —
 *   - wip→testing: `spur task check <wbs> --as testing`
 *   - testing→done: `spur task check <wbs> --as done`
 * so the matrix and status-dependent rules see the target status, matching the
 * lifecycle FSM exactly. Both use default severity (no blanket warning elevation).
 *
 * Bug fixed (0147): the original implementation passed `strict: status === 'done'`, which
 * elevated ALL warnings to errors for the done gate — stricter than the real FSM guard.
 * Previous fix: always pass `strict: false`. (--strict-core never added blanket elevation.)
 */
async function runDoneGateCheck(
    context: CliContext,
    wbs: string,
    folderOverride: string | undefined,
    targetStatus: string,
): Promise<boolean> {
    const planningFolders = await resolvePlanningFolders(context.fs);
    const foldersConfig = planningFolders.foldersConfig;
    const tasksDir = folderOverride ?? context.fs.resolve(foldersConfig.active_folder);
    const hit = await new TaskLocator({ fs: context.fs, tasksDir, foldersConfig }).findByWbs(wbs);
    if (!hit) {
        return false; // missing task — let updateStatus throw the real error
    }
    const svc = new TaskCheckService(context.fs, await loadSectionMatrix(context.cwd), await makeTaskLocator(context));
    const accepted = await loadAcceptedFindings(context.cwd);
    // Default severity (not --strict, not --strict-core) — hard-core L3/L2-gate
    // errors are already errors in the base computation. Never pass strict:true.
    const result = await svc.check(hit.filePath, wbs, {
        strict: false,
        asStatus: targetStatus,
        severityOverrides: planningFolders.severityOverrides,
        accepted,
    });
    return result.pass;
}
/**
 * Load the Section-Status-Matrix (design §3.2, R2) — the SOLE section authority
 * for both creation and check (F92 R1). Resolution order:
 *   1. `.spur/tasks/section-matrix.yaml` (project-local, seeded by `spur init`)
 *   2. bundled / packaged `tasks/section-matrix.yaml` (data copied/generated from
 *      the canonical build-time matrix asset under the repo `config` `tasks` tree)
 * Fails loudly with the attempted paths when neither asset is reachable — there
 * is NO hand-maintained permissive built-in (one would make the same task
 * validate/render differently by installation layout).
 */
const sectionMatrixCache = new Map<string, Promise<SectionMatrix>>();

async function loadSectionMatrix(projectRoot: string): Promise<SectionMatrix> {
    const cached = sectionMatrixCache.get(projectRoot);
    if (cached !== undefined) return cached;

    const promise = loadSectionMatrixUncached(projectRoot);
    sectionMatrixCache.set(projectRoot, promise);
    promise.catch(() => sectionMatrixCache.delete(projectRoot));
    return promise;
}

async function loadSectionMatrixUncached(projectRoot: string): Promise<SectionMatrix> {
    const fs = createNodeFileSystem(projectRoot);
    // 1. Project-local: .spur/tasks/section-matrix.yaml
    const localPath = fs.resolve('.spur', 'tasks', 'section-matrix.yaml');
    if (await fs.exists(localPath)) {
        const data = await loadStructuredSpurConfig(localPath, {
            validateJsonSchema: true,
            embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
        });
        return data as unknown as SectionMatrix;
    }
    // 2. Bundled / packaged fallback: tasks/section-matrix.yaml
    const root = bundledConfigRoot();
    if (root !== null) {
        const matrixPath = join(root, 'tasks', 'section-matrix.yaml');
        if (await fs.exists(matrixPath)) {
            const data = await loadStructuredSpurConfig(matrixPath, {
                validateJsonSchema: true,
                embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
            });
            return data as unknown as SectionMatrix;
        }
    }
    // No hand-maintained fallback (F92 R1): the matrix is the sole section
    // authority. A permissive built-in here would make the same task validate /
    // render differently by installation layout. Fail loudly with the paths tried.
    throw new Error(
        `no canonical section-matrix found for task section authority (F92 R1); tried:\n` +
            `  - ${localPath}\n` +
            (root !== null ? `  - ${join(root, 'tasks', 'section-matrix.yaml')}\n` : '') +
            'copy/generate section-matrix.yaml from the canonical build-time matrix asset (repo `config` `tasks` tree) into one of those paths',
    );
}
