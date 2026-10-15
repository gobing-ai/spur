import type { Command } from '@commander-js/extra-typings';
import { canonicalStatusOrRaw, resolvePlanningFolders, runCorpusCheck, TaskLocator } from '@gobing-ai/spur-app';
import { countToolCallArgsRaw, TASK_STATUSES } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeCheckService, makeTaskLocator } from './shared';

/** Register `spur task check`. */
export function registerTaskCheckCommand(task: Command, context: CliContext): void {
    // ── check ──
    task.command('check')
        .summary('Validate a task file through the four-layer check (design §3).')
        .argument('[wbs]', 'Task WBS number (validates all tasks in the folder when omitted)')
        .option('--corpus', 'Explicit unsuppressed audit of active tasks and features; warnings are advisory')
        .option(
            '--precheck',
            'Also run the implement-readiness prechecks (size, evidence channel); failures are errors.',
        )
        .option('--since <ref>', 'Scope the corpus fog comparison to changes since a git ref (requires --corpus)')
        .option(...SHARED_OPTIONS.strictTaskAll)
        .option(
            '--strict-core',
            'Compatibility alias (F92 R2): historically the done-gate label; kept so installed plugins/workflows that call it keep working. No longer meaningful on its own — target-state selection (`--as`) supplies the real done semantics.',
        )
        .option(...SHARED_OPTIONS.asTaskF92)
        .option(
            '--fix',
            "repair structural findings in place (heading presence/level/order; adds missing R-item checkbox markers — flipping verified boxes is task record's job, not --fix)",
        )
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, options) => {
            const json = options.json === true;
            // `--strict` elevates every advisory; `--strict-core` is the done-gate
            // variant — the hard-core L3 rules (Solution file:line, Review P1–P4)
            // and gate:true required-section misses are already errors, so it runs
            // the default severity computation (no blanket elevation). The flag
            // exists so the testing→done lifecycle guard has a real, stable verb.
            const strict = options.strict === true;
            // 1002 R1: the prechecks gate ONE task's readiness — they need a WBS and are
            // meaningless for the corpus fog audit.
            if (options.precheck === true && (options.corpus || !wbs)) {
                writeJsonError(
                    context.output,
                    options,
                    '--precheck requires a <wbs> argument and cannot be combined with --corpus',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            if (
                (options.since !== undefined && !options.corpus) ||
                (options.corpus &&
                    (wbs || options.as || options.fix || options.folder || strict || options.strictCore)) ||
                options.since?.startsWith('-')
            ) {
                writeJsonError(
                    context.output,
                    options,
                    '--corpus accepts only --since and JSON output options; --since requires --corpus and a git ref',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            if (options.corpus) {
                try {
                    const result = await runCorpusCheck(
                        context.cwd,
                        options.since,
                        context.output.error.bind(context.output),
                    );
                    if (json) {
                        context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                    } else {
                        context.output.write(
                            `corpus-check: ${result.newErrors.length} errors, ${result.newWarnings.length} warnings; no suppressions. Use --json for full findings.`,
                        );
                        for (const finding of result.newErrors) {
                            writeJsonError(
                                context.output,
                                options,
                                `${finding.kind}:${finding.id}:${finding.code}: ${finding.message}`,
                            );
                        }
                    }
                    if (!result.ok) context.setExitCode(1);
                } catch (err) {
                    writeJsonError(context.output, options, String(err));
                    context.setExitCode(1);
                }
                return;
            }
            // F92 R2: `--as <status>` — a target status projection. Validate against
            // canonical task statuses; reject contradictory combinations explicitly.
            const asStatus = options.as === undefined ? undefined : canonicalStatusOrRaw(options.as);
            if (options.as !== undefined && !(TASK_STATUSES as readonly string[]).includes(asStatus ?? '')) {
                writeJsonError(
                    context.output,
                    options,
                    `invalid --as status "${options.as}" (canonical: ${TASK_STATUSES.join(', ')})`,
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            try {
                const svc = await makeCheckService(context);
                const planningFolders = await resolvePlanningFolders(context.fs);
                const activeFolder = planningFolders.foldersConfig.active_folder;
                // Normalize every explicit override so relative and absolute spellings of the
                // same folder are identical downstream (project-root derivation, line anchors) —
                // 0522 R2.
                const tasksDir = context.fs.resolve(options.folder ?? activeFolder);
                const printResult = (result: Awaited<ReturnType<typeof svc.check>>) => {
                    if (json) return;
                    if (result.repairs !== undefined && result.repairs.length > 0) {
                        for (const r of result.repairs) {
                            context.output.write(`  [FIX] ${r.kind} ${r.section}: ${r.detail}`);
                        }
                    }
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
                        writeJsonError(context.output, options, `Task ${wbs} not found`, 'NOT_FOUND');
                        context.setExitCode(1);
                        return;
                    } else {
                        const result = await svc.check(hit.filePath, wbs, {
                            strict,
                            asStatus,
                            severityOverrides: planningFolders.severityOverrides,
                            fix: options.fix === true,
                            ...(options.precheck === true
                                ? {
                                      precheck: true,
                                      // 1002 R3: the domain reader owns the SQL; reader errors
                                      // (missing DB/table) become null → fail closed.
                                      countArgsRaw: async (source: string) => {
                                          try {
                                              return await countToolCallArgsRaw(await context.getDb(), source);
                                          } catch {
                                              return null;
                                          }
                                      },
                                  }
                                : {}),
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
                            writeJsonError(context.output, options, `Task ${w} not found`, 'NOT_FOUND');
                            context.setExitCode(1);
                            continue;
                        }
                        const result = await svc.check(`${tasksDir}/${fileName}`, w, {
                            strict,
                            asStatus,
                            severityOverrides: planningFolders.severityOverrides,
                            fix: options.fix === true,
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
                        results.push({ wbs: first.wbs, pass: false, status: 'duplicate', findings: [msg] });
                        if (!json) {
                            context.output.error(msg);
                        }
                    }
                }

                if (json) {
                    context.output.write(toEnvelopeJson(results, { enveloped: options.jsonEnvelope, kind: 'list' }));
                }

                const hasError = results.some((r) => !r.pass);
                if (hasError) context.setExitCode(1);
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
