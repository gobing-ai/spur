import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { PlanningWriteService, type SectionMatrix, TaskCheckService, TaskService } from '@gobing-ai/spur-app';
import { bundledConfigRoot } from '@gobing-ai/spur-config';
import { parse as parseYaml } from 'yaml';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Register the `spur task` command and its subcommands on the CLI program. */
export function registerTaskCommand(program: Command, context: CliContext): void {
    const task = program.command('task').summary('manage tasks');

    // ── create ──
    task.command('create')
        .summary('Create a new task with race-safe WBS allocation.')
        .argument('<title>', 'Task title')
        .option('--feature <id>', 'Feature ID for traceability and Goal→Background derivation')
        .option('--parent <wbs>', 'Parent WBS for sub-task grouping')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (title, options) => {
            const svc = makeService(context, options.folder);
            try {
                const result = await svc.create({
                    title,
                    featureId: options.feature,
                    parentWbs: options.parent,
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
            const svc = makeService(context, options.folder);
            try {
                const result = await svc.show(wbs);
                if (options.json) {
                    const { frontmatter, ...rest } = result;
                    context.output.write(toJson({ ...rest, frontmatter }));
                } else {
                    context.output.write(result.content);
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
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, status, options) => {
            const svc = makeService(context, options.folder);
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
                        context.output.write(`Updated section '${options.section}' in task ${result.ref.id}`);
                    }
                } else if (status !== undefined) {
                    const result = await svc.updateStatus(wbs, status);
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        context.output.write(`${result.ref.id}: ${result.fromStatus} → ${result.toStatus}`);
                    }
                } else {
                    context.output.error('Either <status> or --section/--from-file is required');
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
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const svc = makeService(context, options.folder);
            try {
                const tasks = await svc.list({
                    status: options.status,
                    phase: options.phase,
                    parentWbs: options.parent,
                });
                if (options.json) {
                    context.output.write(toJson(tasks));
                } else {
                    if (tasks.length === 0) {
                        context.output.write('(no tasks)');
                    }
                    for (const t of tasks) {
                        context.output.write(`${t.wbs}  ${t.status.padEnd(9)}  ${t.name}`);
                    }
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });
    // ── refresh ──
    task.command('refresh')
        .summary('Regenerate kanban.md from the task corpus (pure function, deterministic).')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const svc = makeService(context, options.folder);
            try {
                const kanban = await svc.refresh();
                if (options.json) {
                    context.output.write(toJson({ kanban_path: `${options.folder ?? 'docs/tasks'}/kanban.md` }));
                } else {
                    context.output.write(`kanban.md regenerated (${kanban.split('\n').length} lines)`);
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
            const svc = makeService(context, options.folder);
            try {
                const results = await svc.batchCreate(options.file);
                if (options.json) {
                    const ids = results.map((r) => r.ref.id);
                    context.output.write(toJson({ created: results.length, wbs: ids }));
                } else {
                    context.output.write(`Created ${results.length} task(s)`);
                    for (const r of results) {
                        context.output.write(`  ${r.ref.id}  ${r.ref.filePath}`);
                    }
                }
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            }
        });

    // ── check ──
    task.command('check')
        .summary('Validate a task file through the four-layer check (design §3).')
        .argument('[wbs]', 'Task WBS number (validates all tasks in the folder when omitted)')
        .option('--strict', 'Elevate warnings to failures')
        .option('--folder <path>', 'Custom tasks folder')
        .option('--json', 'Output machine-readable JSON')
        .action(async (wbs, options) => {
            const svc = makeCheckService(context);
            const json = options.json === true;
            const strict = options.strict === true;
            try {
                const tasksDir = options.folder ?? context.fs.resolve('docs', 'tasks');
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
        .option('--json', 'Output machine-readable JSON')
        .action(async (filePath, options) => {
            const svc = makeService(context, options.folder);
            try {
                const result = await svc.resolve(filePath);
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
}

function makeService(context: CliContext, folderOverride?: string): TaskService {
    const tasksDir = folderOverride ?? context.fs.resolve('docs', 'tasks');
    const writeService = new PlanningWriteService({ fs: context.fs });
    return new TaskService({ fs: context.fs, tasksDir, writeService });
}

function makeCheckService(context: CliContext): TaskCheckService {
    return new TaskCheckService(context.fs, loadSectionMatrix());
}

/**
 * Load the Section-Status-Matrix (design §3.2, R2). Reads the bundled
 * `config/tasks/section-matrix.yaml` — the single source of truth, so tightening
 * the matrix is a config edit, not a code change. Falls back to a minimal
 * permissive built-in only when the bundled file is unreachable (e.g. a
 * `bun build --compile` single binary with no sibling files).
 */
function loadSectionMatrix(): SectionMatrix {
    const root = bundledConfigRoot();
    if (root !== null) {
        const matrixPath = join(root, 'tasks', 'section-matrix.yaml');
        if (existsSync(matrixPath)) {
            const parsed = parseYaml(readFileSync(matrixPath, 'utf8')) as SectionMatrix | undefined;
            if (parsed?.variants !== undefined) return parsed;
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
