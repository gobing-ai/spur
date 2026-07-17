import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    CorpusMigrator,
    type MigrationReport,
    PlanningWriteService,
    resolvePlanningFolders,
    type SectionMatrix,
    TASK_LIFECYCLE_PROFILE,
    TaskCheckService,
    TaskService,
    type TaskSummary,
} from '@gobing-ai/spur-app';
import { bundledConfigRoot, loadStructuredSpurConfig } from '@gobing-ai/spur-config/loader';
import {
    createId,
    extractTemplateBodies,
    TASK_STATUSES,
    TASK_VARIANTS,
    TaskRunLinkDao,
    type TaskSection,
    taskStatusIcon,
} from '@gobing-ai/spur-domain';
import { type Colorize, makeColorize, shouldColor } from '../colors';
import { EMBEDDED_SPUR_SCHEMAS } from '../config/embedded-schemas';
import type { CliContext } from '../context';
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
        .option('--json', 'Output machine-readable JSON')
        .action(async (title, options) => {
            if (options.template !== undefined && !(TASK_VARIANTS as readonly string[]).includes(options.template)) {
                context.output.error(
                    `Unknown template variant "${options.template}". Valid: ${TASK_VARIANTS.join(', ')}`,
                );
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
                });
                if (options.json) {
                    context.output.write(toJson(result));
                } else {
                    context.output.write(`Created task ${result.ref.id}: ${result.ref.filePath}`);
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── show ──
    task.command('show')
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
        .option('--section <name>', 'Section name to replace')
        .option('--from-file <path>', 'File to read section body from (requires --section)')
        .option('--feature <id>', 'Set the feature_id frontmatter field (traceability edge)')
        .option('--priority <p>', 'Set the priority frontmatter field (P0–P3)')
        .option(
            '--no-lifecycle',
            'Suppress lifecycle workflow run creation (use during pipeline runs to avoid orphaned lifecycle runs)',
        )
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
                } else if (options.feature !== undefined || options.priority !== undefined) {
                    const key = options.feature !== undefined ? 'feature_id' : 'priority';
                    const value = options.feature ?? options.priority ?? '';
                    const result = await svc.updateField(wbs, key, value);
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        context.output.write(`Set ${key}=${value} on task ${result.ref.id}`);
                    }
                } else if (status !== undefined) {
                    // P3 backstop (task 0130 retrospective): the lifecycle YAML runs
                    // `spur task check` as the wip→testing and testing→done guard. When the
                    // lifecycle adapter is unavailable (--no-lifecycle, or the bundled
                    // task-lifecycle workflow can't be resolved), the fallback
                    // (SchemaLifecyclePort) silently permits the transition — so a task can
                    // slide to `done` with L3 errors via raw CLI. Re-run the gate inline for
                    // the two guarded terminal entries when the adapter is absent.
                    if (options.lifecycle !== false && (status === 'done' || status === 'testing')) {
                        const adapter = makeLifecycleAdapter(context, TASK_LIFECYCLE_PROFILE);
                        if (adapter === undefined) {
                            context.output.error(
                                `warning: lifecycle adapter unavailable — running \`spur task check\` inline as the ${status} gate. ` +
                                    'Restore the bundled task-lifecycle workflow to re-enable the real guard.',
                            );
                            const ok = await runDoneGateCheck(context, wbs, options.folder);
                            if (!ok) {
                                context.output.error(
                                    `Lifecycle transition blocked: \`spur task check ${wbs}\` failed. Fix the findings before transitioning to ${status}.`,
                                );
                                context.setExitCode(1);
                                return;
                            }
                        }
                    }
                    const result = await svc.updateStatus(wbs, status);
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        context.output.write(`${result.ref.id}: ${result.fromStatus} → ${result.toStatus}`);
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
                context.output.error(String(err));
                context.setExitCode(1);
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
                context.output.error(String(err));
                context.setExitCode(1);
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
            const { deriveVerdict } = await import('@gobing-ai/spur-app');
            const answerPath = options.fromAnswer ?? `.spur/run/${wbs}-verify-answer.txt`;
            let answerText: string;
            try {
                answerText = readFileSync(answerPath, 'utf-8');
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

            // Emit verdict artifact.
            const jsonOut = JSON.stringify({ wbs, ...result, source: 'spur-task-verdict' }, null, 2);
            const { mkdirSync, writeFileSync } = await import('node:fs');
            mkdirSync('.spur/run', { recursive: true });
            writeFileSync(`.spur/run/${wbs}-verdict.json`, `${jsonOut}\n`);

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

    // ── check ──
    task.command('check')
        .summary('Validate a task file through the four-layer check (design §3).')
        .argument('[wbs]', 'Task WBS number (validates all tasks in the folder when omitted)')
        .option('--strict', 'Elevate ALL warnings to failures')
        .option('--strict-core', 'Gate variant: fail only on hard-core errors (the testing→done guard)')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, options) => {
            const svc = await makeCheckService(context);
            const json = options.json === true;
            // `--strict` elevates every advisory; `--strict-core` is the done-gate
            // variant — the hard-core L3 rules (Solution file:line, Review P1–P4)
            // and gate:true required-section misses are already errors, so it runs
            // the default severity computation (no blanket elevation). The flag
            // exists so the testing→done lifecycle guard has a real, stable verb.
            const strict = options.strict === true;
            try {
                const activeFolder = (await resolvePlanningFolders(context.fs)).foldersConfig.active_folder;
                const tasksDir = options.folder ?? context.fs.resolve(activeFolder);
                const entries = await context.fs.readDir(tasksDir);
                const wbsPattern: string[] = wbs
                    ? [wbs]
                    : entries
                          .filter((n) => /^\d{4}_.+\.md$/.test(n))
                          .map((n) => n.match(/^(\d{4})_/)?.[1])
                          .filter((n): n is string => n !== undefined);

                const results = [];
                for (const w of wbsPattern) {
                    const fileName = entries.find((n) => n.startsWith(`${w}_`) && n.endsWith('.md'));
                    if (!fileName) {
                        context.output.error(`Task ${w} not found`);
                        context.setExitCode(1);
                        continue;
                    }
                    const result = await svc.check(`${tasksDir}/${fileName}`, w, { strict });
                    results.push(result);

                    if (!json) {
                        context.output.write(`\n${result.wbs} (${result.status}): ${result.pass ? 'PASS' : 'FAIL'}`);
                        for (const f of result.findings) {
                            const tag = f.severity === 'error' ? 'ERR' : 'WARN';
                            context.output.write(`  [${tag}] ${f.layer} ${f.section}: ${f.message}`);
                        }
                        if (result.missingSections.length > 0) {
                            context.output.write(`  Missing: ${result.missingSections.join(', ')}`);
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
                const dao = new TaskRunLinkDao(db);
                // Idempotent: skip if any pipeline link already exists for this WBS.
                const existing = await dao.listByWbs(wbs, 20);
                if (existing.some((row) => row.kind === 'pipeline')) {
                    const entry = existing.find((row) => row.kind === 'pipeline');
                    if (!entry) {
                        context.output.error(`Pipeline link lookup inconsistent for ${wbs}`);
                        context.setExitCode(1);
                        return;
                    }
                    const result = {
                        id: entry.id,
                        wbs: entry.wbs,
                        runId: entry.run_id,
                        kind: entry.kind,
                        existed: true,
                    };
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        context.output.write(`Pipeline run-link already exists for ${wbs} (${entry.id}). Skipped.`);
                    }
                    return;
                }
                const id = createId('trl');
                const runId = options.runId ?? `chain:${options.source}:${wbs}:${Date.now()}`;
                await dao.insert({ id, wbs, run_id: runId, kind: 'pipeline', created_at: new Date().toISOString() });
                const result = { id, wbs, runId, kind: 'pipeline' };
                if (options.json) {
                    context.output.write(toJson(result));
                } else {
                    context.output.write(
                        `Recorded pipeline run-link ${id} for task ${wbs} (source: ${options.source})`,
                    );
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });
}

async function makeService(context: CliContext, folderOverride?: string, noLifecycle = false): Promise<TaskService> {
    const foldersConfig = (await resolvePlanningFolders(context.fs)).foldersConfig;
    const tasksDir = folderOverride ?? context.fs.resolve(foldersConfig.active_folder);
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
        sectionMatrix: await loadSectionMatrix(context.cwd),
        resolveTemplate: (variant: string) => loadTemplateContent(context.cwd, variant),
        resolveTemplateBodies: (variant: string) => loadTemplateBodies(context.cwd, variant),
        foldersConfig,
    });
}

/** Cache of per-variant raw template content (read once per process). */
const templateContentCache = new Map<string, string>();
/** Variants we've already checked and confirmed have no template file. */
const templateMissSet = new Set<string>();

/**
 * Read a variant's template file and return its raw markdown content.
 * Resolution order:
 *   1. `.spur/templates/task/<variant>.md` (project-local, seeded by `spur init`)
 *   2. bundled template fallback (`templates/task/<variant>.md`)
 * Returns the raw file content (with `{{ PLACEHOLDERS }}` intact) so
 * `renderTaskTemplate` can substitute real values. Returns `undefined`
 * when no template file is found — callers fall back to the legacy
 * `buildTaskSkeleton` path.
 */
function loadTemplateContent(projectRoot: string, variant: string): string | undefined {
    if (templateContentCache.has(variant)) return templateContentCache.get(variant);
    if (templateMissSet.has(variant)) return undefined;

    // 1. Project-local
    const localPath = join(projectRoot, '.spur', 'tasks', 'templates', `${variant}.md`);
    if (existsSync(localPath)) {
        const content = readFileSync(localPath, 'utf8');
        templateContentCache.set(variant, content);
        return content;
    }

    // 2. Bundled fallback
    const root = bundledConfigRoot();
    if (root !== null) {
        const templatePath = join(root, 'templates', 'task', `${variant}.md`);
        if (existsSync(templatePath)) {
            const content = readFileSync(templatePath, 'utf8');
            templateContentCache.set(variant, content);
            return content;
        }
    }

    templateMissSet.add(variant);
    return undefined;
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

async function makeCheckService(context: CliContext): Promise<TaskCheckService> {
    return new TaskCheckService(context.fs, await loadSectionMatrix(context.cwd));
}

/**
 * Inline lifecycle-gate backstop (P3, task 0130 retrospective). Runs the same
 * `spur task check` the lifecycle YAML guard runs, used ONLY when the lifecycle
 * adapter is unavailable and the transition targets a guarded state (`testing`
 * or `done`). Returns `true` iff the check passes.
 *
 * Both guarded transitions use default severity (no blanket warning elevation):
 *   - wip→testing: `spur task check <wbs>` (plain default)
 *   - testing→done: `spur task check <wbs> --strict-core` (same as default — hard-core
 *     L3/L2-gate errors are already errors; `--strict-core` adds no blanket elevation)
 *
 * Bug fixed (0147): the original implementation passed `strict: status === 'done'`, which
 * elevated ALL warnings to errors for the done gate — stricter than the real FSM guard
 * that uses `--strict-core` (no blanket elevation). The fix: always pass `strict: false`.
 */
async function runDoneGateCheck(
    context: CliContext,
    wbs: string,
    folderOverride: string | undefined,
): Promise<boolean> {
    const foldersConfig = (await resolvePlanningFolders(context.fs)).foldersConfig;
    const tasksDir = folderOverride ?? context.fs.resolve(foldersConfig.active_folder);
    const entries = await context.fs.readDir(tasksDir);
    const fileName = entries.find((n) => n.startsWith(`${wbs}_`) && n.endsWith('.md'));
    if (!fileName) {
        return false; // missing task — let updateStatus throw the real error
    }
    const svc = new TaskCheckService(context.fs, await loadSectionMatrix(context.cwd));
    // Both the wip→testing and testing→done guards use default severity (not --strict, not
    // --strict-core — both are equivalent here: hard-core L3/L2-gate errors are already
    // errors in the base computation). Never pass strict:true here — that would block a
    // `pass:True`-with-warnings task that the real FSM guard would allow through.
    const result = await svc.check(`${tasksDir}/${fileName}`, wbs, { strict: false });
    return result.pass;
}
/**
 * Load the Section-Status-Matrix (design §3.2, R2). Resolution order:
 *   1. `.spur/tasks/section-matrix.yaml` (project-local, seeded by `spur init`)
 *   2. bundled section-matrix fallback (`tasks/section-matrix.yaml`)
 * Falls back to a minimal permissive built-in only when both sources are
 * unreachable (e.g. a `bun build --compile` single binary with no project-local seed).
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
    // 1. Project-local: .spur/tasks/section-matrix.yaml
    const localPath = join(projectRoot, '.spur', 'tasks', 'section-matrix.yaml');
    if (existsSync(localPath)) {
        const data = await loadStructuredSpurConfig(localPath, {
            validateJsonSchema: true,
            embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
        });
        return data as unknown as SectionMatrix;
    }
    // 2. Bundled fallback: tasks/section-matrix.yaml
    const root = bundledConfigRoot();
    if (root !== null) {
        const matrixPath = join(root, 'tasks', 'section-matrix.yaml');
        if (existsSync(matrixPath)) {
            const data = await loadStructuredSpurConfig(matrixPath, {
                validateJsonSchema: true,
                embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
            });
            return data as unknown as SectionMatrix;
        }
    }
    return FALLBACK_MATRIX;
}

/** Minimal permissive matrix used only when the bundled YAML is unreachable. */
const FALLBACK_MATRIX: SectionMatrix = {
    variants: {
        standard: {
            backlog: { required: ['Background'], forbidden: ['Solution', 'Review', 'Testing'] },
            done: { required: ['Solution', 'Testing', 'Review'], gate: true },
        },
    },
};
