/**
 * `spur rule check-coverage-cert [--lcov <path>]` (A94 1412 R3) — the coverage-provenance
 * precondition as a shipped verb: the certification marker must bind the CURRENT lcov bytes and the
 * CURRENT tree before any per-file coverage rule may run.
 *
 * Exit: 0 certified, 1 stale/byte-mismatched/missing, 2 usage error.
 */
import type { Command } from '@commander-js/extra-typings';
import { CANONICAL_RECOVERY, validateCoverageCertification } from '@gobing-ai/spur-app';
import { bootFree } from '../../boot-free-route';
import type { CliContext } from '../../context';
import { toEnvelopeJson, toJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** Register `spur rule check-coverage-cert`. */
export function registerRuleCheckCoverageCertCommand(noun: Command, context: CliContext): void {
    bootFree(noun.command('check-coverage-cert'))
        .summary('refuse uncertified, stale or byte-mismatched coverage evidence before per-file rules')
        .option('--lcov <path>', 'tracefile the certification must bind (default: .coverage/lcov.info)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            // `--lcov` is accepted for parity with the certification verb; validation always binds the
            // canonical artifact, which is what the marker records.
            if (options.lcov !== undefined && options.lcov.trim() === '') {
                const message = 'check-coverage-cert: --lcov needs a path';
                if (options.json === true) context.output.write(toJson({ error: { code: 'usage', message } }));
                else context.output.error(message);
                context.setExitCode(2);
                return;
            }
            const result = await validateCoverageCertification(context.cwd);
            if (result.ok) {
                if (options.json === true) {
                    context.output.write(
                        toEnvelopeJson({ ok: true, findings: [] }, { enveloped: options.jsonEnvelope === true }),
                    );
                } else {
                    context.output.write('coverage-cert: certified — evidence binds this tree and tracefile.');
                }
                return;
            }
            const findings = [{ kind: 'coverage-artifact', detail: `${result.reason} — ${result.message}` }];
            if (options.json === true) {
                context.output.write(
                    toEnvelopeJson({ ok: false, findings }, { enveloped: options.jsonEnvelope === true }),
                );
            } else {
                for (const finding of findings) context.output.error(`coverage-artifact: ${finding.detail}`);
                context.output.error(`coverage-artifact: recovery — ${CANONICAL_RECOVERY}`);
            }
            context.setExitCode(1);
        });
}
