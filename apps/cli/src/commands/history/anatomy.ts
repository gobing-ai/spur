/**
 * `spur history anatomy <op>` — the history-anatomy report cache ops (feature I8, ADR-079):
 * digest, check, paths, assert-clean, probe, stamp, refresh, publish. Absorbed from the retired
 * `plugins/sp/scripts/history-anatomy-cache.ts` (script-absorption PR-6). Thin adapter over
 * `@gobing-ai/spur-app/history-anatomy-cli`: the op keeps its own argv grammar and exit codes.
 */
import type { Command } from '@commander-js/extra-typings';
import { acceptArtifactId } from '../../artifact-id';
import type { CliContext } from '../../context';
import { writeStepText } from '../task/step-output';

/** The running spur entry: the logic identity `paths` records as `HA_HELPER` (cache invalidation). */
export function spurEntryPath(argv: readonly string[] = process.argv, execPath = process.execPath): string {
    const entry = argv[1];
    return entry !== undefined && /\.(?:[cm]?[jt]s)$/.test(entry) ? entry : execPath;
}

/** Register `spur history anatomy` — pass-through to the absorbed cache ops. */
export function registerHistoryAnatomyCommand(history: Command, context: CliContext): void {
    history
        .command('anatomy')
        .summary(
            'history-anatomy report cache ops (digest | check | paths | assert-clean | probe | stamp | refresh | publish)',
        )
        .description(
            [
                'Deterministic cache ops behind the history-anatomy workflow (ADR-079):',
                '  digest <artifact.json>                 semantic artifact digest',
                '  check <report.md>                      report-contract structure gate (PASS/FAIL)',
                '  paths --out <env> [--skill-dir d] ...  resolve the run paths into an env file',
                '  assert-clean --baseline <porcelain>    fail on undeclared writes (--expect=<path>)',
                '  probe --artifact a --target t ...      cache disposition + provenance',
                '  stamp --candidate c --provenance p --out o   stamp provenance frontmatter',
                '  refresh --report r --out o             refresh a cache-hit report',
                '  publish <candidate.md> <target.md>     atomic publish',
                'Exit: 0 ok, 1 usage or op failure.',
            ].join('\n'),
        )
        .allowUnknownOption(true)
        .allowExcessArguments(true)
        .argument('[argv...]', 'op and its flags (see description)')
        .action(async (argv: string[]) => {
            for (let i = 0; i < argv.length; i++) {
                if (argv[i] === '--run-id' && !acceptArtifactId(argv[i + 1] ?? '', 'run id', context)) return;
            }
            const { runCacheCli } = await import('@gobing-ai/spur-app/history-anatomy-cli');
            const result = runCacheCli(argv, {
                helper: spurEntryPath(),
                cwd: context.cwd,
                ...(context.env.HOME !== undefined ? { home: context.env.HOME } : {}),
            });
            writeStepText(context.output, 'stdout', result.stdout);
            writeStepText(context.output, 'stderr', result.stderr);
            context.setExitCode(result.exitCode);
        });
}
