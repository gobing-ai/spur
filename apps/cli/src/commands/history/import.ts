import type { Command } from '@commander-js/extra-typings';
import {
    DEFAULT_SOURCE_TIMEOUT_MS,
    type FanOutResult,
    type TimeoutPolicyMs,
    UnsafeHistoryImporterError,
} from '@gobing-ai/spur-app';
import { getEnvVars } from '@gobing-ai/spur-config';
import type { CapabilityOrigin } from '@gobing-ai/ts-llm-jsonl-importer';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import {
    makeHistoryService,
    parseCapabilityOriginSpec,
    resolveCliSourceTimeout,
    resolveImportProvenance,
} from './shared';

/** Register `spur history import`. */
export function registerHistoryImportCommand(noun: Command, context: CliContext): void {
    noun.command('import')
        .description(
            'Import agent conversation JSONL. `--source all` fans out across all sources with ' +
                'per-source failure isolation (task 0470). A single source is the n=1 case of ' +
                "the same contract — never two import paths. For one session's evidence, use " +
                '`--file`; a full replay can exceed the per-source budget.',
        )
        .option(...SHARED_OPTIONS.sourceHistory, 'all')
        .option(...SHARED_OPTIONS.fileHistoryJsonl)
        .option('--root <path>', 'Scan a history root')
        .option(...SHARED_OPTIONS.modeHistory)
        .option(...SHARED_OPTIONS.dryRunHistoryScan)
        .option(
            '--source-timeout <ms|none>',
            `Per-source timeout in milliseconds or 'none' (default ${DEFAULT_SOURCE_TIMEOUT_MS} = 10 min)`,
        )
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option(
            '--capability-origin <spec>',
            'Classify skill calls against a released artifact: ' +
                'source:skillName:artifactDigest:capabilityKind:originIdentity (repeatable).',
            (value: string, previous: string[]): string[] => [...previous, value],
            [],
        )
        .action(async (options) => {
            const source = options.source ?? 'all';

            // --file is single-source only — reject the contradictory combo up front.
            if (options.file && source === 'all') {
                context.output.write(
                    options.json
                        ? toEnvelopeJson(
                              { status: 'error', message: '--file requires a single --source, not "all".' },
                              {
                                  enveloped: options.jsonEnvelope,
                                  error: {
                                      code: 'INTERNAL_ERROR',
                                      message: '--file requires a single --source, not "all".',
                                      details: { cliCode: 'usage' },
                                  },
                              },
                          )
                        : 'spur history import: --file requires a single --source, not "all".',
                );
                context.setExitCode(1);
                return;
            }

            // Task 0813 R3: strict explicit-input validation BEFORE any service
            // construction or import — partial numbers, signs, zero, fractions, and
            // timer overflow are usage errors, and only 'none' disables the deadline.
            let sourceTimeout: TimeoutPolicyMs;
            try {
                sourceTimeout = resolveCliSourceTimeout(options.sourceTimeout, getEnvVars());
            } catch (e) {
                const timeoutMsg = `spur history import: ${e instanceof Error ? e.message : String(e)}`;
                context.output.write(
                    options.json
                        ? toEnvelopeJson(
                              { status: 'error', message: timeoutMsg },
                              {
                                  enveloped: options.jsonEnvelope,
                                  error: { code: 'INTERNAL_ERROR', message: timeoutMsg, details: { cliCode: 'usage' } },
                              },
                          )
                        : timeoutMsg,
                );
                context.setExitCode(1);
                return;
            }
            // Validate mode up-front — an invalid mode is a CLI usage error, not a per-source runtime failure.
            const mode = options.mode ?? (options.file ? 'force-file' : 'incremental');
            if (mode !== 'full' && mode !== 'incremental' && mode !== 'force-file') {
                const modeMsg = `Invalid history import mode "${mode}". Expected one of: full, incremental, force-file`;
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            { status: 'error', message: modeMsg },
                            {
                                enveloped: options.jsonEnvelope,
                                error: { code: 'INTERNAL_ERROR', message: modeMsg, details: { cliCode: 'usage' } },
                            },
                        ),
                    );
                } else {
                    context.output.error(modeMsg);
                }
                context.setExitCode(1);
                return;
            }

            // R2 (task 0506): reject the hazardous single-file full write BEFORE any DB access.
            // `--file <path> --mode full` without `--dry-run` makes the temporary file the
            // authoritative input for a full reconciliation of the real database. The exact
            // unsafe combination is deterministic — no threshold, config key, or confirmation
            // flag. Both alternatives are named so probes self-correct: add `--dry-run` to
            // preview, or use `--mode force-file` to import one file.
            if (options.file && mode === 'full' && options.dryRun !== true) {
                const unsafeMsg =
                    'spur history import: --file <path> --mode full without --dry-run is unsafe — full mode ' +
                    'treats the file as the authoritative source for reconciliation. Preview with --dry-run, ' +
                    'or import a single file with --mode force-file.';
                context.output.write(
                    options.json
                        ? toEnvelopeJson(
                              { status: 'error', message: unsafeMsg },
                              {
                                  enveloped: options.jsonEnvelope,
                                  error: { code: 'INTERNAL_ERROR', message: unsafeMsg, details: { cliCode: 'usage' } },
                              },
                          )
                        : unsafeMsg,
                );
                context.setExitCode(1);
                return;
            }

            // E93 1029: parse before any service work — malformed origins are usage errors.
            let capabilityOrigins: CapabilityOrigin[] | undefined;
            if (options.capabilityOrigin.length > 0) {
                try {
                    capabilityOrigins = options.capabilityOrigin.map(parseCapabilityOriginSpec);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    context.output.write(
                        options.json
                            ? toEnvelopeJson(
                                  { status: 'error', message },
                                  {
                                      enveloped: options.jsonEnvelope,
                                      error: { code: 'INTERNAL_ERROR', message, details: { cliCode: 'usage' } },
                                  },
                              )
                            : `spur history import: ${message}`,
                    );
                    context.setExitCode(1);
                    return;
                }
            }

            const svc = await makeHistoryService(context, capabilityOrigins);

            let fanOut: FanOutResult;
            try {
                fanOut = await svc.importAll({
                    sources: source === 'all' ? undefined : [source],
                    file: options.file || undefined,
                    root: options.root || undefined,
                    mode: mode,
                    dryRun: options.dryRun === true,
                    sourceTimeout,
                    // Task 1144 R1: the pre-start scope line is a diagnostic — stderr only,
                    // and it precedes the import so a disproportionate replay is visible
                    // before the budget is spent. `--json` stdout stays pure JSON.
                    onScope: (line) => context.output.error(line),
                });
            } catch (e) {
                // 0726 R1: the provenance guard rejects full pi imports on a known-destructive
                // importer before any DB access. Name the code, both versions, and the remedy.
                if (e instanceof UnsafeHistoryImporterError) {
                    const msg = `spur history import: ${e.code}: ${e.message}`;
                    context.output.write(
                        options.json
                            ? toEnvelopeJson(
                                  { status: 'error', message: msg },
                                  {
                                      enveloped: options.jsonEnvelope,
                                      error: {
                                          code: 'INTERNAL_ERROR',
                                          message: msg,
                                          details: {
                                              cliCode: e.code,
                                              installedVersion: e.installedVersion,
                                              minSafeVersion: e.minSafeVersion,
                                          },
                                      },
                                  },
                              )
                            : msg,
                    );
                    context.setExitCode(1);
                    return;
                }
                throw e;
            }

            // R4 (task 0504): record which binary and importer version actually ran. Printed
            // before the fan-out result in text mode; embedded in the JSON payload for --json.
            const provenance = await resolveImportProvenance(context.fs);
            context.output.write(
                options.json
                    ? toEnvelopeJson({ ...fanOut, provenance }, { enveloped: options.jsonEnvelope })
                    : `${formatProvenance(provenance)}\n${formatFanOutResult(fanOut)}`,
            );
            context.setExitCode(fanOut.exitCode);
        });
}

/** Render the provenance header line for text output (task 0504 R4). */
function formatProvenance(provenance: { binary: string; importer: string }): string {
    return `binary: ${provenance.binary}\nimporter: @gobing-ai/ts-llm-jsonl-importer@${provenance.importer}`;
}

function formatFanOutResult(r: FanOutResult): string {
    const lines: string[] = ['history import (fan-out)', 'sources:'];
    for (const e of r.entries) {
        lines.push(
            `  ${e.source}: ${e.status} (files=${e.files} scanned, new-messages=${e.messages}, tool-calls=${e.toolCalls})`,
        );
    }
    const a = r.attribution;
    lines.push(
        `attribution: sessions=${a.sessionsEvaluated} links-created=${a.linksCreated} ` +
            `links-present=${a.linksAlreadyPresent} skipped=${a.skippedEvidence} ambiguous=${a.ambiguousEvidence}`,
    );
    if (r.warnings.length > 0) {
        lines.push('warnings:');
        for (const w of r.warnings) {
            lines.push(`  [${w.code}] ${w.source ?? '-'}: ${w.detail}`);
        }
    }
    lines.push(`exit_code: ${r.exitCode}`);
    return lines.join('\n');
}
