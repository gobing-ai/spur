import type { Command } from '@commander-js/extra-typings';
import { taskStatusIcon } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** `--section` collector: commander repeatable-option value array (1325 P1). */
function collectSection(value: string, previous: string[] = []): string[] {
    return [...previous, value];
}

/** Split a `--sections` CSV into trimmed, non-empty section names (1325 P1). */
function parseCsvSections(csv: string | undefined): string[] {
    if (csv === undefined) return [];
    return csv
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '');
}

/** Register `spur task show`. */
export function registerTaskShowCommand(task: Command, context: CliContext): void {
    // ── show ──
    task.command('show')
        // `get` alias (0534 R1): agents reach for `get` (6 live invocations in feature A
        // forensics); Commander's lexical suggester cannot bridge get→show (edit distance),
        // so an alias is the only close. One help entry, one code path.
        .alias('get')
        .summary('Show a task by WBS.')
        .argument('<wbs>', 'Task WBS number')
        .option(...SHARED_OPTIONS.folderTasks)
        // 1325 P1: filtered read — only the named sections' byte-exact bodies plus
        // frontmatter metadata. `--section` is repeatable; `--sections` takes a CSV.
        .option(...SHARED_OPTIONS.sectionShowFilter, collectSection, [])
        .option(
            '--sections <csv>',
            'Comma-separated section names to show (e.g. "Background,Plan"); combined with --section',
        )
        // 1325 P2: summary read — metadata + section index with byte counts, no bodies.
        .option(
            '--summary',
            'Print frontmatter metadata plus a section index (name, heading, byte count) and total file size — no section bodies',
            false,
        )
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, options) => {
            const requested = [...(options.section ?? []), ...parseCsvSections(options.sections)];
            if (options.summary === true && requested.length > 0) {
                writeJsonError(
                    context.output,
                    options,
                    '--summary cannot be combined with --section/--sections',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            const svc = await makeService(context, options.folder);
            try {
                const result =
                    options.summary === true
                        ? await svc.showSummary(wbs)
                        : requested.length > 0
                          ? await svc.showSections(wbs, requested)
                          : await svc.show(wbs);
                if (options.json) {
                    const { frontmatter, ...rest } = result;
                    context.output.write(toEnvelopeJson({ ...rest, frontmatter }, { enveloped: options.jsonEnvelope }));
                } else if ('sections' in result) {
                    // Filtered/summary human output (1325): header + per-section lines;
                    // filtered mode prints the byte-exact section content verbatim.
                    const header = `${taskStatusIcon(result.status)} ${result.status.toUpperCase()} — ${result.wbs}`;
                    if (result.sections.every((entry) => entry.content === undefined)) {
                        const lines = result.sections.map(
                            (entry) => `  ${entry.headingLine} — ${entry.byteCount} bytes`,
                        );
                        context.output.write(
                            [`${header} — summary`, ...lines, `  total: ${result.totalBytes} bytes`].join('\n'),
                        );
                    } else {
                        context.output.write([header, ...result.sections.map((entry) => entry.content ?? '')].join(''));
                    }
                } else {
                    context.output.write(
                        `${taskStatusIcon(result.status)} ${result.status.toUpperCase()} — ${result.wbs}\n\n${result.content}`,
                    );
                }
            } catch (err) {
                const cliCode = (err as { cliCode?: string } | null)?.cliCode;
                writeJsonError(
                    context.output,
                    options,
                    String(err),
                    'INTERNAL_ERROR',
                    cliCode !== undefined ? { cliCode } : undefined,
                );
                // Unknown section names are a validation error (1325 P1), not an
                // internal fault: exit 3 mirrors `task sections`' unknown-section code.
                context.setExitCode(cliCode === 'VALIDATION_FAILED' ? 3 : 1);
            }
        });
}
