import type { Command } from '@commander-js/extra-typings';
import { SectionMutationError } from '@gobing-ai/spur-app';
import { UNIVERSAL_SECTIONS } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur task sections`. */
export function registerTaskSectionsCommand(task: Command, context: CliContext): void {
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
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, op, name, options) => {
            const allowedOps = ['init', 'add', 'list'] as const;
            if (!allowedOps.includes(op as (typeof allowedOps)[number])) {
                writeJsonError(
                    context.output,
                    options,
                    `Unknown op "${op}". Allowed: ${allowedOps.join(', ')}.`,
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            const typedOp = op as (typeof allowedOps)[number];
            if (typedOp === 'add' && typeof name !== 'string') {
                writeJsonError(
                    context.output,
                    options,
                    'op "add" requires a section name argument.',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            if ((typedOp === 'init' || typedOp === 'list') && name !== undefined) {
                writeJsonError(
                    context.output,
                    options,
                    `op "${typedOp}" takes no section name argument.`,
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.mutateSections(wbs, typedOp, name);
                if (options.json) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
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
                    writeJsonError(context.output, options, `[${err.code}] ${err.message}`, 'INTERNAL_ERROR');
                    context.setExitCode(err.code === 'usage' ? 2 : 3);
                } else {
                    writeJsonError(context.output, options, String(err));
                    context.setExitCode(1);
                }
            }
        });
}
