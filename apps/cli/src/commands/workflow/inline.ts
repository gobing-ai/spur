/**
 * `spur workflow inline <op>` — the installed-CLI transport for the host-inline run lifecycle
 * (script-absorption PR-4, docs/plans/2026-10-14-spur-script-absorption.md §3.4/§4). It replaces
 * `plugins/sp/scripts/inline-run-setup.ts`, `inline-run-dispatch.ts` and `persist-out-check.ts`;
 * `apps/cli/tests/workflow-inline-parity.test.ts` pins it to their frozen golden output.
 *
 * Thin Commander adapter: argv validation, the run-id refusal and dispatch. Every mode body lives
 * in `@gobing-ai/spur-app` (`runInlineRun*`, `recordInlineRunAttribution`, `runPersistCheck`).
 * Exit codes are the scripts': 0 ok · 1 fail closed · 2 usage (Commander parse errors included).
 */
import { type Command, CommanderError } from '@commander-js/extra-typings';
import { writeCloseSummary } from '@gobing-ai/spur-app/close-summary';
import { runPersistCheck } from '@gobing-ai/spur-app/persist-check';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { EMBEDDED_SPUR_SCHEMAS } from '../../config/embedded-schemas';
import type { CliContext } from '../../context';
import { errorMessage } from '../../errors';
import { resolveSpurArgv } from '../../workflow/resolve-spur-bin';
import { SHARED_OPTIONS } from '../shared-options';

/** Run ids become filenames under `.spur/run/` — single safe component only (0804 R8). */
const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type InlineContext = Pick<CliContext, 'cwd' | 'env' | 'output' | 'setExitCode'>;

/** Seams for {@link registerWorkflowInlineCommand}; the defaults are the live process. */
export interface WorkflowInlineDeps {
    /**
     * The merged config for `decide` / `dispatch-failure` (ADR-082: loaded once at the composition
     * root and threaded in). The early-dispatch root passes the real loader; without one the
     * context's already-loaded config is used.
     */
    loadConfig?: (cwd: string) => Promise<SpurConfig>;
    /** Launch argv of this spur build (the `begin` inventory reader); defaults to {@link resolveSpurArgv}. */
    selfArgv?: readonly string[];
    /** The app barrel; injectable so command tests can stub the DB-backed runners. */
    loadApp?: () => Promise<InlineApp>;
}

type InlineApp = Pick<
    typeof import('@gobing-ai/spur-app'),
    | 'readInstalledInventory'
    | 'recordInlineRunAttribution'
    | 'runInlineRunDecide'
    | 'runInlineRunDispatchFailure'
    | 'runInlineRunFingerprint'
    | 'runInlineRunPersistOut'
    | 'runInlineRunSetup'
    | 'runInlineRunTraceMode'
    | 'writeInlineRunOutcome'
>;

const collect = (value: string, previous: string[]): string[] => [...previous, value];

/** Commander parse errors (unknown option, missing value) are usage errors: exit 2, like the scripts. */
function usageExit(err: CommanderError): never {
    if (err.exitCode === 0) throw err;
    throw new CommanderError(2, err.code, err.message);
}

/**
 * Register `spur workflow inline <op>` under `workflow`.
 *
 * `context.cwd` anchors the in-CLI work; the app runners use the process cwd, which is the same
 * directory for every real invocation (tests that drive them in-process chdir first).
 */
export function registerWorkflowInlineCommand(
    workflow: Command,
    context: InlineContext & { spurConfig?: SpurConfig },
    deps: WorkflowInlineDeps = {},
): void {
    const inline = workflow
        .command('inline')
        .summary('host-inline run lifecycle: begin, trace, close, decide, persist-out/check, dispatch')
        .description(
            [
                'Installed-CLI transport for a host-inline workflow run (the inline pipeline driver).',
                'Exit codes: 0 ok, 1 fail closed (the driver must stop), 2 usage error.',
            ].join('\n'),
        )
        .exitOverride(usageExit);
    const app = deps.loadApp ?? (() => import('@gobing-ai/spur-app'));
    const loadConfig = deps.loadConfig ?? (async () => context.spurConfig ?? ({} as SpurConfig));
    const fail = (code: number): void => context.setExitCode(code);
    const usage = (cmd: { helpInformation(): string }): void => {
        context.output.error(cmd.helpInformation().trimEnd());
        fail(2);
    };
    /** The loud refusal for an unsafe id: two stderr lines, exit 1, before any file work. */
    const refuseRunId = (runId: string): void => {
        context.output.error(`inline-run-setup: refusing unsafe run id: ${runId}`);
        context.output.error(
            '  The run id must be a single safe filename component (alphanumeric/._-, no leading dot, no path separators, interpolation or traversal; same class as the task-pipeline route-reason guard, task 0804 R8). Allocate a fresh run id (uuid or timestamp slug) and retry.',
        );
        fail(1);
    };
    /** A thrown runner failure: the scripts' `<script>: FAIL — <message>` line and exit 1. */
    const guarded = async (label: string, run: () => Promise<number | undefined>): Promise<void> => {
        try {
            const code = await run();
            if (code !== undefined) fail(code);
        } catch (error) {
            context.output.error(`${label}: FAIL — ${errorMessage(error)}`);
            fail(1);
        }
    };

    const begin = inline
        .command('begin')
        .description('Create or idempotently attach the authoritative run row and the two-file run record')
        .option(...SHARED_OPTIONS.runIdInline)
        .option('--file <definition>', 'Workflow definition file or name to resolve')
        .option('--spur-bin <path>', 'Spur invocation that resolves the definition (default: SPUR_BIN, then this CLI)')
        .action(async (options) => {
            const runId = options.runId ?? '';
            const file = options.file ?? '';
            if (runId.trim() === '' || file.trim() === '') return usage(begin);
            if (!SAFE_RUN_ID_RE.test(runId)) return refuseRunId(runId);
            await guarded('inline-run-setup', async () => {
                const lib = await app();
                const spurBin = options.spurBin ?? context.env.SPUR_BIN ?? '';
                let inventory: unknown;
                try {
                    inventory = await lib.readInstalledInventory({
                        file,
                        spurBin,
                        localCli: '',
                        launchArgv: deps.selfArgv ?? resolveSpurArgv(),
                    });
                } catch (error) {
                    const message = `could not resolve the workflow definition: ${errorMessage(error)}`;
                    lib.writeInlineRunOutcome(runId, { ok: false, runId, error: message });
                    throw new Error(message);
                }
                return lib.runInlineRunSetup({ runId, file, inventory, embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });
            });
        });

    const fingerprint = inline
        .command('fingerprint')
        .description("Print the engine's proof-input digest for the given spec files; create nothing")
        .option('--task-file <path>', 'Task spec file (required)')
        .option('--feature-file <path>', 'Feature spec file')
        .action(async (options) => {
            const taskFile = options.taskFile ?? '';
            if (taskFile.trim() === '') return usage(fingerprint);
            await guarded('inline-run-setup', async () =>
                (await app()).runInlineRunFingerprint({ taskFile, featureFile: options.featureFile ?? '' }),
            );
        });

    /** The four ADR-117 trace modes share one app dispatcher; its `2` is a usage error. */
    const trace = async (
        cmd: { helpInformation(): string },
        mode: 'action' | 'close' | 'node-enter' | 'actions-file',
        options: {
            runId?: string;
            node?: string;
            kind?: string;
            status?: string;
            reason?: string;
            ok?: string;
            durationMs?: string;
            file?: string;
            projectRoot?: string;
            estimated?: boolean;
            summary?: boolean;
        },
    ): Promise<void> => {
        const runId = options.runId ?? '';
        if (!SAFE_RUN_ID_RE.test(runId)) return refuseRunId(runId);
        const noSummary = options.summary === false;
        let code = 0;
        await guarded('inline-run-setup', async () => {
            code = await (await app()).runInlineRunTraceMode({
                mode,
                runId,
                node: options.node ?? '',
                kind: options.kind ?? '',
                status: options.status ?? '',
                reason: options.reason ?? '',
                ok: options.ok ?? '',
                durationMs: options.durationMs ?? '',
                actionsFile: options.file ?? '',
                projectRoot: options.projectRoot ?? '',
                estimated: options.estimated === true,
                noSummary,
                ...(noSummary
                    ? {}
                    : { summarize: async (run) => writeCloseSummary(run, { env: context.env, cwd: process.cwd() }) }),
            });
            return code === 2 ? undefined : code;
        });
        if (code === 2) usage(cmd);
    };

    const action = inline
        .command('action')
        .description('Record one action boundary as an action_runs row (ADR-117)')
        .option(...SHARED_OPTIONS.runIdInline)
        .option('--node <state>', 'State the action ran in')
        .option('--kind <kind>', 'Action kind (shell, agent.run, …)')
        .option('--status <status>', 'done | failed')
        .option('--ok <bool>', 'true | false (required, exact)')
        .option('--duration-ms <n>', 'Host-measured duration; omitted, it is measured from `node-enter`')
        .option('--estimated', 'The duration was host-reported, not timed around the action')
        .option('--project-root <path>', 'Tree that owns the run row (default: the cwd tree)')
        .action((options) => trace(action, 'action', options));

    const nodeEnter = inline
        .command('node-enter')
        .description('Stamp the enter time of a node (the clock `action` measures from)')
        .option(...SHARED_OPTIONS.runIdInline)
        .option('--node <state>', 'State being entered')
        .option('--project-root <path>', 'Tree that owns the run row (default: the cwd tree)')
        .action((options) => trace(nodeEnter, 'node-enter', options));

    const actions = inline
        .command('actions')
        .description('Record a batch of action rows from a JSON array file (validated before any write)')
        .option(...SHARED_OPTIONS.runIdInline)
        .option('--file <json>', 'JSON array of {node, kind, status, ok, durationMs} rows')
        .option('--project-root <path>', 'Tree that owns the run row (default: the cwd tree)')
        .action((options) => trace(actions, 'actions-file', options));

    const close = inline
        .command('close')
        .description('Finalize the run row; writes .spur/run/<run-id>-summary.md unless --no-summary')
        .option(...SHARED_OPTIONS.runIdInline)
        .option('--status <status>', 'done | failed | paused')
        .option('--reason <terminal-reason>', 'Closed enum; required with --status failed')
        .option('--no-summary', 'Skip the measured execution summary')
        .option('--project-root <path>', 'Tree that owns the run row (default: the cwd tree)')
        .action((options) => trace(close, 'close', options));

    const decide = inline
        .command('decide')
        .description('Execute a non-pausing decide action and record its trace row')
        .option(...SHARED_OPTIONS.runIdInline)
        .option('--node <state>', 'State the decision belongs to')
        .option('--options-json <file>', 'Decide options JSON file')
        .action(async (options) => {
            const runId = options.runId ?? '';
            const node = options.node ?? '';
            const optionsFile = options.optionsJson ?? '';
            if (runId.trim() === '' || node.trim() === '' || optionsFile.trim() === '') return usage(decide);
            if (!SAFE_RUN_ID_RE.test(runId)) return refuseRunId(runId);
            try {
                const lib = await app();
                const spurConfig = await loadConfig(context.cwd);
                const enabled = spurConfig.workflows?.decideDecisionMaker === true;
                fail(await lib.runInlineRunDecide({ runId, node, optionsFile, enabled, spurConfig }));
            } catch (error) {
                context.output.write(JSON.stringify({ ok: false, runId, error: errorMessage(error) }));
                fail(1);
            }
        });

    const persistOut = inline
        .command('persist-out')
        .description("Copy a worktree's inline-run provenance and owned evidence into this tree (fail closed)")
        .option('--from <worktree>', 'Source worktree')
        .option(
            '--task-file <path>',
            'Merged task file whose cited/owned evidence rides along (repeatable)',
            collect,
            [],
        )
        .action(async (options) => {
            const from = options.from ?? '';
            const taskFiles = options.taskFile;
            if (from.trim() === '' || taskFiles.some((taskFile) => taskFile.trim() === '')) return usage(persistOut);
            await guarded('inline-run-setup', async () => (await app()).runInlineRunPersistOut({ from, taskFiles }));
        });

    inline
        .command('persist-check')
        .description('WT-4: assert the worktree owns no unpersisted durable evidence before removal')
        .option('--from <worktree>', 'Worktree about to be removed')
        .option('--task-file <path>', 'Task file whose <wbs>- evidence the worktree owns (repeatable)', collect, [])
        .option('--run-id <id>', 'Run id whose <run-id>- evidence the worktree owns (repeatable)', collect, [])
        .option('--root <invoke-tree>', 'Invoking (main) tree (default: the git common dir parent)')
        .option('--success-json <path>', 'persist-out result to read skips from')
        .action((options) => {
            const result = runPersistCheck({
                from: options.from ?? '',
                taskFiles: options.taskFile,
                runIds: options.runId,
                ...(options.root === undefined ? {} : { root: options.root }),
                ...(options.successJson === undefined ? {} : { successJson: options.successJson }),
                cwd: context.cwd,
            });
            for (const line of result.stdout) context.output.write(line);
            for (const line of result.stderr) context.output.error(line);
            fail(result.exitCode);
        });

    const identity = (options: { executor?: string; agent?: string; model?: string }) => ({
        executor: (options.executor ?? '').trim() === '' ? null : (options.executor as string),
        agent: (options.agent ?? '').trim() === '' ? null : (options.agent as string),
        ...((options.model ?? '').trim() === '' ? {} : { model: options.model as string }),
    });

    const attribution = inline
        .command('attribution')
        .description('Append the executor identity an inline stage used to .spur/run/<run-id>-attribution.jsonl')
        .option(...SHARED_OPTIONS.runIdInline)
        .option('--stage <state>', 'Inline stage')
        .option('--executor <name>', 'Executor used; omitted records the explicit no-attribution marker')
        .option('--agent <name>', 'Agent used')
        .option('--model <m>', 'Model used')
        .action(async (options) => {
            const runId = options.runId ?? '';
            const stage = options.stage ?? '';
            if (runId.trim() === '' || stage.trim() === '' || !SAFE_RUN_ID_RE.test(runId)) return usage(attribution);
            await guarded('inline-run-dispatch', async () => {
                (await app()).recordInlineRunAttribution(context.cwd, runId, {
                    stage,
                    ...identity(options),
                    observedAt: new Date().toISOString(),
                });
                context.output.write(JSON.stringify({ ok: true, runId, stage }));
                return 0;
            });
        });

    const dispatchFailure = inline
        .command('dispatch-failure')
        .description('Classify a failed inline dispatch and write .spur/run/<run-id>-dispatch-fallback.json')
        .option(...SHARED_OPTIONS.runIdInline)
        .option('--stage <state>', 'Inline stage whose dispatch failed')
        .option('--decision <decision>', 'escalate | stop | host-inline')
        .option('--text <record>', 'Bounded failure record')
        .option('--text-file <path>', 'File holding the failure record')
        .option('--executor <name>', 'Executor that failed; omitted records the explicit no-attribution marker')
        .option('--agent <name>', 'Agent that failed')
        .option('--model <m>', 'Model that failed')
        .action(async (options) => {
            const runId = options.runId ?? '';
            const stage = options.stage ?? '';
            const decision = options.decision ?? '';
            const text = options.text ?? '';
            const textFile = options.textFile ?? '';
            if (runId.trim() === '' || stage.trim() === '' || !SAFE_RUN_ID_RE.test(runId))
                return usage(dispatchFailure);
            if (decision.trim() === '' || (text === '') === (textFile === '')) return usage(dispatchFailure);
            await guarded('inline-run-dispatch', async () => {
                const lib = await app();
                const spurConfig = await loadConfig(context.cwd);
                return lib.runInlineRunDispatchFailure({
                    runId,
                    stage,
                    decision: decision as 'escalate' | 'stop' | 'host-inline',
                    ...(text === '' ? { textFile } : { text }),
                    ...identity(options),
                    spurConfig,
                });
            });
        });
}
