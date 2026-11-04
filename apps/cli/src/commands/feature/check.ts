import type { Command } from '@commander-js/extra-typings';
import { FeatureCheckService, isFeatureFile, resolvePlanningFolders } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeReceiptRunPort, makeService } from './shared';

/** Register `spur feature check`. */
export function registerFeatureCheckCommand(feature: Command, context: CliContext): void {
    // ── check ──
    feature
        .command('check')
        .summary('Validate feature file(s) through the four-layer check (design §3).')
        .argument('[id]', 'Feature ID (validates all features in the folder when omitted)')
        .option(...SHARED_OPTIONS.strictFeature)
        .option(...SHARED_OPTIONS.asFeature0418)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option('--fix', 'repair structural findings in place (heading presence/level/order, R-item checkboxes)')
        .option(
            '--inventory <report>',
            'Cross-check the report requirement inventory against the AC covers lines (errors on uncovered items)',
        )
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            const resolved = await resolvePlanningFolders(context.fs);
            const featuresDir = options.folder ?? context.fs.resolve(resolved.featuresDir);
            const tasksDir = context.fs.resolve(resolved.tasksDir);
            // Scan every registered phase folder for feature_id edges (parity with feature sync).
            const tasksDirs = Object.keys(resolved.foldersConfig.folders).map((p) => context.fs.resolve(p));
            if (!tasksDirs.includes(tasksDir)) tasksDirs.unshift(tasksDir);
            const svc = new FeatureCheckService(context.fs);
            const json = options.json === true;
            const strict = options.strict === true;
            // 1004 R1: read the inventory report once; an unreadable/absent file is an
            // empty report, which the coverage rule fails closed on (missing section).
            // fs.readFile is `string | Promise<string>` — normalize before .catch so a
            // missing/unreadable report degrades to '' (the coverage rule fails closed).
            const inventoryText =
                typeof options.inventory === 'string'
                    ? await Promise.resolve(context.fs.readFile(context.fs.resolve(options.inventory))).catch(() => '')
                    : undefined;
            try {
                const entries = await context.fs.readDir(featuresDir);
                const ids: string[] = id
                    ? [id]
                    : entries
                          .map((n) => n.match(/^([A-Z][1-9]*)_.+\.md$/)?.[1])
                          .filter((n): n is string => n !== undefined);

                const results = [];
                for (const fid of ids) {
                    const fileName = entries.find((n) => isFeatureFile(n, fid));
                    if (!fileName) {
                        writeJsonError(context.output, options, `Feature ${fid} not found`, 'NOT_FOUND');
                        context.setExitCode(1);
                        return;
                    }
                    const result = await svc.check(`${featuresDir}/${fileName}`, fid, {
                        strict,
                        featuresDir,
                        tasksDir,
                        tasksDirs,
                        // Verdict SSOT is always <cwd>/.spur/run (not docs/.spur/run).
                        runDir: context.fs.resolve('.spur/run'),
                        // Receipt validation (0915) needs the run store: terminal
                        // recording-run status, persisted definition identity and
                        // artifact registration.
                        receiptRunPort: await makeReceiptRunPort(context),
                        severityOverrides: resolved.severityOverrides,
                        asStatus: options.as,
                        fix: options.fix === true,
                        inventory: inventoryText,
                        transitionPort:
                            options.fix === true
                                ? async (targetId: string, to: string) => {
                                      const featureSvc = await makeService(context, options.folder);
                                      return featureSvc.transition(targetId, to);
                                  }
                                : undefined,
                    });
                    results.push(result);
                    if (!json) {
                        if (result.repairs !== undefined && result.repairs.length > 0) {
                            for (const r of result.repairs) {
                                context.output.write(`  [FIX] ${r.kind} ${r.section}: ${r.detail}`);
                            }
                        }
                        context.output.write(`\n${result.id} (${result.status}): ${result.pass ? 'PASS' : 'FAIL'}`);
                        for (const f of result.findings) {
                            const tag = f.severity === 'error' ? 'ERR' : 'WARN';
                            context.output.write(`  [${tag}] ${f.layer} ${f.section}: ${f.message}`);
                        }
                    }
                }
                if (json) {
                    context.output.write(toEnvelopeJson(results, { enveloped: options.jsonEnvelope, kind: 'list' }));
                }
                if (results.some((r) => !r.pass)) context.setExitCode(1);
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
