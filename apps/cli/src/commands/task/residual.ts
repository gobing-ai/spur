import type { Command } from '@commander-js/extra-typings';
import { acceptArtifactId } from '../../artifact-id';
import type { CliContext } from '../../context';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Strip the one trailing newline the residual line sinks carry (the output seam re-adds it). */
function line(text: string): string {
    return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** Register `spur task residual` — the F96 residual sweep (script-absorption PR-3). */
export function registerTaskResidualCommand(task: Command, context: CliContext): void {
    task.command('residual')
        .summary('Run one F96 residual-sweep step for a task.')
        .description(
            'Run one residual-sweep step for <wbs> over .spur/run/<wbs>-* artifacts:\n' +
                '  scan         classify residuals since the run base into <wbs>-residuals.json\n' +
                '  review-gate  rebuild the artifact from the Review table; exit 1 on an open P1-P3 finding\n' +
                '  fold         fold the residual-sweep check into the recorded verdict\n' +
                '  settle       file deferrable residuals as one follow-up task; clear staging residue\n' +
                '  report       write the recovery report when the residual sweep failed\n\n' +
                'Exit codes: 0 success, 1 review-gate blocking findings, 2 usage error.',
        )
        .argument('<wbs>', 'Task WBS number')
        .argument('<step>', 'Step: scan | review-gate | fold | settle | report')
        .option('--root <dir>', 'Repository root holding .spur/run (default: cwd)')
        .option('--tmp-dir <dir>', 'Staging directory scanned for <wbs>-* residue (default: OS tmpdir)')
        .option(...SHARED_OPTIONS.folderTasks)
        .action(async (wbs, step, options) => {
            if (!acceptArtifactId(wbs, 'task WBS', context)) return;
            const { residualScanMain } = await import('@gobing-ai/spur-app/residual-scan-run');
            const argv = [step, wbs];
            if (options.root !== undefined) argv.push('--root', options.root);
            if (options.tmpDir !== undefined) argv.push('--tmp-dir', options.tmpDir);
            const code = await residualScanMain(argv, {
                cwd: context.cwd,
                io: {
                    out: (text) => context.output.write(line(text)),
                    err: (text) => context.output.error(line(text)),
                },
                tasks: {
                    show: async (target) => {
                        const svc = await makeService(context, options.folder);
                        const result = await svc.show(target);
                        const featureId = result.frontmatter.feature_id;
                        return { content: result.content, featureId: typeof featureId === 'string' ? featureId : '' };
                    },
                    create: async (title) => {
                        const svc = await makeService(context, options.folder);
                        return (await svc.create({ title })).ref.id;
                    },
                    updateSection: async (target, section, fromFile) => {
                        const svc = await makeService(context, options.folder);
                        await svc.updateSection(target, section, fromFile, false);
                    },
                },
            });
            context.setExitCode(code);
        });
}
