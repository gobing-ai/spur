import { dirname } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { anchorQualify, type EntityRef, PlanningWriteService } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { makePlanningEmitter } from '../../planning-emitter';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur task migrate-anchors`. */
export function registerTaskMigrateAnchorsCommand(task: Command, context: CliContext): void {
    // ── migrate-anchors ──
    task.command('migrate-anchors')
        .summary('Qualify in-repo evidence anchors to repo-relative paths (0583 R1–R3).')
        .option(...SHARED_OPTIONS.dryRunTaskReport)
        .option('--wbs <wbs>', 'Scope the pass to one task file (unknown wbs fails without writing)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const dryRun = options.dryRun === true;
                const wbs = typeof options.wbs === 'string' && options.wbs.length > 0 ? options.wbs : undefined;
                let scopedFiles: string[] | undefined;
                if (wbs !== undefined) {
                    // 1109 R2: resolve the scope through the task locator so an unknown wbs
                    // fails BEFORE the pass runs (the qualifier never has to infer "nothing
                    // matched" from an empty report) and the pass is scoped to the exact
                    // file, not to a filename pattern.
                    // `migrate-anchors` has no `--folder` option: the locator resolves
                    // through the same configured task folders the unscoped pass walks.
                    const locator = await makeService(context, undefined);
                    const resolved = await locator.getFilePath(wbs);
                    if (resolved === null) {
                        writeJsonError(
                            context.output,
                            options,
                            `Task ${wbs} not found — \`spur task migrate-anchors --wbs\` scopes an existing task file; run without --wbs for the corpus-wide pass`,
                            'NOT_FOUND',
                        );
                        context.setExitCode(1);
                        return;
                    }
                    scopedFiles = [resolved];
                }
                const report = await anchorQualify(context.fs, {
                    dryRun,
                    ...(scopedFiles === undefined ? {} : { files: scopedFiles }),
                    // Scope the tracked-file index to THIS invocation's project rather
                    // than letting it fall back to `process.cwd()`.
                    projectRoot: context.cwd,
                    write: async (filePath, wbs, section, newBody) => {
                        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: dirname(filePath) };
                        const ws = new PlanningWriteService({ fs: context.fs, emitter: makePlanningEmitter(context) });
                        await ws.updateSection(ref, section, newBody);
                    },
                    // 1089 R3: the `done_reason` rule writes frontmatter, not a body
                    // section, so it needs the sibling write path.
                    writeField: async (filePath, wbs, key, value) => {
                        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: dirname(filePath) };
                        const ws = new PlanningWriteService({ fs: context.fs, emitter: makePlanningEmitter(context) });
                        await ws.updateFrontmatter(ref, key, value);
                    },
                });
                const qualified = report.fileReports.flatMap((r) =>
                    r.qualified.map((q) => `${r.wbs}: \`${q.raw}\` → \`${q.newPath}:${q.lineSpec}\``),
                );
                const reasons = report.fileReports.flatMap((r) =>
                    r.doneReasons.map((d) => `${r.wbs}: [${d.kind}] "${d.from}" → "${d.to}"`),
                );
                // 1140 R2/R3: a pointer with neither a durable copy nor a non-empty Testing
                // section is reported, never rewritten — surface it beside the rewrites.
                const unresolvedReasons = report.fileReports
                    .filter((r) => r.doneReasonUnresolved !== undefined)
                    .map((r) => `${r.wbs}: ${r.doneReasonUnresolved} (no durable copy, empty Testing)`);
                const ambiguous = report.fileReports.flatMap((r) =>
                    r.ambiguous.map((a) => `${r.wbs}: ${a.cited} → candidates: ${a.candidates.join(', ')}`),
                );
                const skipped = report.fileReports
                    .filter((r) => r.skipped !== undefined)
                    .map((r) => `${r.wbs}: ${r.skipped}`);
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            {
                                ok: true,
                                dryRun,
                                ...(wbs === undefined ? {} : { wbs }),
                                qualified,
                                reasons,
                                unresolvedReasons,
                                ambiguous,
                                skipped,
                                ...report,
                            },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
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
                        'Done-reason rewrites (scratch/absolute → durable evidence):',
                        ...(reasons.length ? reasons : ['  none']),
                        '',
                        'Done-reason pointers with no durable owner (reported, not rewritten):',
                        ...(unresolvedReasons.length ? unresolvedReasons : ['  none']),
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
                            (reasons.length ? `, ${reasons.length} done_reason rewrite(s)` : '') +
                            (skipped.length
                                ? `, ${skipped.length} skipped (unwritable):\n  ${skipped.join('\n  ')}`
                                : '.'),
                    );
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
