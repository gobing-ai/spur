/**
 * `spur rule check-shims [--manifest <path>]` (A94 1412 R1) — the two-sided transition-shim ledger as
 * a shipped rule verb, so a downstream preset can run it without a repository script.
 *
 * Exit: 0 pass (including a missing manifest), 1 findings, 2 usage error.
 */
import type { Command } from '@commander-js/extra-typings';
import { type CheckShimsResult, checkShims } from '@gobing-ai/spur-app';
import { bootFree } from '../../boot-free-route';
import type { CliContext } from '../../context';
import { toEnvelopeJson, toJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** Register `spur rule check-shims`. */
export function registerRuleCheckShimsCommand(noun: Command, context: CliContext): void {
    bootFree(noun.command('check-shims'))
        .summary('validate the two-sided transition-shim ledger (markers ↔ manifest)')
        .option('--manifest <path>', 'ledger manifest, relative to the project root', 'config/transition-shims.json')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            let result: CheckShimsResult;
            try {
                result = checkShims({ cwd: context.cwd, manifest: options.manifest });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (options.json === true) {
                    context.output.write(toJson({ error: { code: 'usage', message } }));
                } else {
                    context.output.error(`check-shims: ${message}`);
                }
                context.setExitCode(2);
                return;
            }
            const findings = result.violations.map((violation) => ({
                kind: violation.kind,
                id: violation.id,
                detail: violation.message,
            }));
            if (options.json === true) {
                context.output.write(
                    toEnvelopeJson({ ok: result.ok, findings }, { enveloped: options.jsonEnvelope === true }),
                );
            } else {
                context.output.write(result.summary);
                for (const finding of findings)
                    context.output.error(`${finding.kind}\t${finding.id}\t${finding.detail}`);
            }
            if (!result.ok) context.setExitCode(1);
        });
}
