import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    PlanningWriteService,
    type SectionMatrix,
    TASK_LIFECYCLE_PROFILE,
    TaskCheckService,
    type TaskFoldersConfig,
    TaskService,
} from '@gobing-ai/spur-app';
import { bundledConfigRoot, spurConfigSchema, tasksConfigSchema } from '@gobing-ai/spur-config';
import { extractTemplateBodies, TASK_VARIANTS, type TaskSection, taskStatusIcon } from '@gobing-ai/spur-domain';
import { loadSpurConfig } from '../config/loader';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { makeLifecycleAdapter } from '../workflow/make-lifecycle-adapter';

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
                    const result = await svc.updateStatus(wbs, status);
                    if (options.json) {
                        context.output.write(toJson(result));
                    } else {
                        context.output.write(`${result.ref.id}: ${result.fromStatus} → ${result.toStatus}`);
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
                } else {
                    if (tasks.length === 0) {
                        context.output.write('(no tasks)');
                    }
                    for (const t of tasks) {
                        context.output.write(`${t.wbs}  ${taskStatusIcon(t.status)} ${t.status.padEnd(9)}  ${t.name}`);
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
            const svc = await makeService(context, options.folder);
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

            if (result.verdict === 'UNKNOWN') {
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
            const svc = await makeService(context, options.folder);
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
}
const DEFAULT_TASKS_DIR = 'docs/tasks';

/** Default folders config used when `.spur/config.yaml` has no `tasks:` block. */
const DEFAULT_FOLDERS_CONFIG: TaskFoldersConfig = {
    active_folder: DEFAULT_TASKS_DIR,
    folders: { [DEFAULT_TASKS_DIR]: { base_counter: 0 } },
};

/**
 * Load task-folder configuration from the `tasks:` block in `.spur/config.yaml`
 * (the single project-config surface — ADR-017). Returns sensible defaults when
 * the file is absent, the `tasks:` block is missing, or the config is malformed.
 *
 * Maps the root-schema's camelCase keys (`active`, `baseCounter`) to the
 * snake_case shape {@link TaskFoldersConfig} consumes (`active_folder`, `base_counter`).
 */
async function loadTaskFoldersConfig(projectRoot: string): Promise<TaskFoldersConfig> {
    const configPath = join(projectRoot, '.spur', 'config.yaml');
    try {
        if (!existsSync(configPath)) return DEFAULT_FOLDERS_CONFIG;
        const spurConfig = spurConfigSchema.parse(
            await loadSpurConfig(configPath, { validateSchema: process.env.NODE_ENV !== 'test' }),
        );
        if (!spurConfig.tasks) return DEFAULT_FOLDERS_CONFIG;
        const tasks = tasksConfigSchema.parse(spurConfig.tasks);
        const folders: Record<string, { base_counter: number; label?: string }> = {};
        for (const [path, fc] of Object.entries(tasks.folders)) {
            folders[path] = { base_counter: fc.baseCounter, label: fc.label };
        }
        return {
            active_folder: tasks.active,
            folders: Object.keys(folders).length > 0 ? folders : DEFAULT_FOLDERS_CONFIG.folders,
        };
    } catch {
        /* malformed config — use defaults */
    }
    return DEFAULT_FOLDERS_CONFIG;
}

async function makeService(context: CliContext, folderOverride?: string, noLifecycle = false): Promise<TaskService> {
    const foldersConfig = await loadTaskFoldersConfig(context.cwd);
    const tasksDir = folderOverride ?? context.fs.resolve(foldersConfig.active_folder);
    const lifecycle = noLifecycle ? undefined : makeLifecycleAdapter(context, TASK_LIFECYCLE_PROFILE);
    const writeService = new PlanningWriteService({
        fs: context.fs,
        ...(lifecycle ? { lifecycle } : {}),
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
 *   1. `.spur/tasks/templates/<variant>.md` (project-local, seeded by `spur init`)
 *   2. `config/templates/task/<variant>.md` (bundled fallback)
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
 *   1. `.spur/tasks/templates/<variant>.md` (project-local, seeded by `spur init`)
 *   2. `config/templates/task/<variant>.md` (bundled fallback)
 * Returns `{}` when neither source is reachable — creation then falls back to
 * matrix + guidance only. Results are cached per process.
 */
function loadTemplateBodies(projectRoot: string, variant: string): Partial<Record<TaskSection, string>> {
    const cached = templateBodiesCache.get(variant);
    if (cached !== undefined) return cached;
    let bodies: Partial<Record<TaskSection, string>> = {};

    // 1. Project-local: .spur/tasks/templates/<variant>.md
    const localPath = join(projectRoot, '.spur', 'tasks', 'templates', `${variant}.md`);
    if (existsSync(localPath)) {
        bodies = extractTemplateBodies(readFileSync(localPath, 'utf8'));
    } else {
        // 2. Bundled fallback: config/templates/task/<variant>.md
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
 * Load the Section-Status-Matrix (design §3.2, R2). Resolution order:
 *   1. `.spur/tasks/section-matrix.yaml` (project-local, seeded by `spur init`)
 *   2. `config/tasks/section-matrix.yaml` (bundled fallback)
 * Falls back to a minimal permissive built-in only when both sources are
 * unreachable (e.g. a `bun build --compile` single binary with no project-local seed).
 */
async function loadSectionMatrix(projectRoot: string): Promise<SectionMatrix> {
    // 1. Project-local: .spur/tasks/section-matrix.yaml
    const localPath = join(projectRoot, '.spur', 'tasks', 'section-matrix.yaml');
    if (existsSync(localPath)) {
        const data = await loadSpurConfig(localPath, { validateSchema: true });
        return data as unknown as SectionMatrix;
    }
    // 2. Bundled fallback: config/tasks/section-matrix.yaml
    const root = bundledConfigRoot();
    if (root !== null) {
        const matrixPath = join(root, 'tasks', 'section-matrix.yaml');
        if (existsSync(matrixPath)) {
            const data = await loadSpurConfig(matrixPath, { validateSchema: true });
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
