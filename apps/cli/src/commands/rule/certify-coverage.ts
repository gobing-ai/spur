/**
 * `spur rule certify-coverage [--lcov <path>] -- <command…>` (A94 1412 R2, consent amendment 2) —
 * produce certified coverage provenance for any project, not only this repository's launcher.
 *
 * The verb owns the two-phase window in one call: fingerprint the tree, run the child against an
 * isolated coverage directory (`SPUR_COVERAGE_DIR`, `{coverageDir}` token), then certify and publish
 * when the child exited 0 and the tree is unchanged.
 *
 * Exit: the child's code when it fails (nothing certified), 1 when certification is refused, 0 when
 * certified, 2 when `--` or the command is missing.
 */
import type { Command } from '@commander-js/extra-typings';
import { CANONICAL_RECOVERY, certifyCommand } from '@gobing-ai/spur-app';
import { bootFree } from '../../boot-free-route';
import type { CliContext } from '../../context';
import { toEnvelopeJson, toJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** Register `spur rule certify-coverage`. */
export function registerRuleCertifyCoverageCommand(noun: Command, context: CliContext): void {
    bootFree(noun.command('certify-coverage'))
        .summary('run a command against an isolated coverage dir, then certify and publish its LCOV')
        .option('--lcov <path>', 'publish the certified tracefile here (default: .coverage/lcov.info)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        // `--` ends option parsing, so everything after it reaches the variadic operand verbatim.
        .argument('[command...]', 'command to run (after `--`); `{coverageDir}` expands to the run dir')
        .action(async (command: string[], options) => {
            const argv = command ?? [];
            if (argv.length === 0) {
                const message = 'certify-coverage: missing command — pass it after `--`';
                if (options.json === true) context.output.write(toJson({ error: { code: 'usage', message } }));
                else context.output.error(message);
                context.setExitCode(2);
                return;
            }
            const outcome = await certifyCommand({
                cwd: context.cwd,
                argv,
                ...(options.lcov !== undefined ? { lcov: options.lcov } : {}),
            });
            const emit = (payload: unknown): void => {
                context.output.write(toEnvelopeJson(payload, { enveloped: options.jsonEnvelope === true }));
            };
            if (outcome.kind === 'certified') {
                if (options.json === true) emit({ ok: true, certified: true });
                else context.output.write('coverage-cert: certified — the tracefile binds this tree.');
                return;
            }
            if (outcome.kind === 'child-failed') {
                if (options.json === true) emit({ ok: false, childExitCode: outcome.code });
                else context.output.error(`coverage-cert: the command exited ${outcome.code}; nothing certified`);
                context.setExitCode(outcome.code);
                return;
            }
            const detail = `coverage-certification: refused (${outcome.reason}) — ${outcome.message}`;
            if (options.json === true) {
                emit({ ok: false, findings: [{ kind: 'coverage-artifact', detail }] });
            } else {
                context.output.error(detail);
                context.output.error(`coverage-artifact: recovery — ${CANONICAL_RECOVERY}`);
            }
            context.setExitCode(1);
        });
}
