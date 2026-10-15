import type { Command } from '@commander-js/extra-typings';
import { resolvePlanningFolders, type TaskSummary } from '@gobing-ai/spur-app';
import { normalizeTaskStatus, TASK_STATUSES, taskStatusIcon } from '@gobing-ai/spur-domain';
import { type Colorize, makeColorize, shouldColor } from '../../colors';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Per-status column title for the human-readable board. */
const STATUS_TITLE: Record<(typeof TASK_STATUSES)[number], string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    wip: 'WIP',
    testing: 'Testing',
    blocked: 'Blocked',
    done: 'Done',
    cancelled: 'Canceled',
    deprecated: 'Deprecated',
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

/** Register `spur task list`. */
export function registerTaskListCommand(task: Command, context: CliContext): void {
    // ── list ──
    task.command('list')
        .summary('List tasks with optional filtering.')
        .option(...SHARED_OPTIONS.statusFilter)
        .option('--phase <p>', 'Filter by phase (legacy alias for --status)')
        .option('--parent <wbs>', 'Filter by parent WBS')
        .option(...SHARED_OPTIONS.featureFilterEdge)
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
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
                    context.output.write(toEnvelopeJson(tasks, { enveloped: options.jsonEnvelope, kind: 'list' }));
                } else if (tasks.length === 0) {
                    context.output.write('(no tasks)');
                } else {
                    const { foldersConfig } = await resolvePlanningFolders(context.fs);
                    const folderPath = options.folder ?? foldersConfig.active_folder;
                    const label = foldersConfig.folders[folderPath]?.label;
                    const boardTitle = label ? `${label} (${folderPath})` : folderPath;
                    const color = makeColorize(shouldColor(context.env, process.stdout));
                    // A status filter collapses the board to the normalized column.
                    const requested = options.status ?? options.phase;
                    const columns = requested === undefined ? TASK_STATUSES : [normalizeTaskStatus(requested)];
                    context.output.write(renderTaskBoard(tasks, boardTitle, color, columns));
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
