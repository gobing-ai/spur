import { echo, echoError } from '@gobing-ai/ts-utils';
import { type FinalizeIdeaHandoffResult, finalizeIdeaHandoff } from './idea-handoff';

/**
 * Environment slice the idea-handoff entrypoint reads.
 *
 * Taken as a parameter rather than off `process.env` directly so the entrypoint is
 * testable without mutating global state — the previous revision ran its logic at
 * module top level, which is why it shipped untested and was removed in `596e9f64`.
 */
export interface IdeaHandoffCliEnv {
    /** Pipeline run identifier (`__runId` workflow var). */
    __runId?: string;
    /** Feature identifier produced earlier in the idea pipeline. */
    featureId?: string;
    /** PATH-independent spur invocation resolved by the CLI at run start. */
    spurBin?: string;
}

/** Outcome of one entrypoint invocation: the process exit code plus the underlying result. */
export interface IdeaHandoffCliOutcome {
    /** Process exit code — 0 on success, 1 on any failure. */
    exitCode: number;
    /** Underlying finalization result; absent when required env vars were missing. */
    result?: FinalizeIdeaHandoffResult;
}

/**
 * Run the deterministic idea handoff finalization for one pipeline run.
 *
 * This is the monorepo writer the `idea-pipeline.yaml` `handoff-finalize` state prefers;
 * seeded projects fall back to the portable shell program in the same state, which
 * implements the identical contract (0604 Q&A).
 *
 * @param env - Environment slice carrying the run id, feature id, and spur invocation.
 * @param run - Finalization implementation; injectable for tests.
 * @returns The exit code and, when finalization ran, its result.
 */
export async function runIdeaHandoffCli(
    env: IdeaHandoffCliEnv,
    run: typeof finalizeIdeaHandoff = finalizeIdeaHandoff,
): Promise<IdeaHandoffCliOutcome> {
    const runId = env.__runId ?? '';
    const featureId = env.featureId ?? '';
    if (runId === '' || featureId === '') {
        echoError('idea-handoff: __runId and featureId env vars are required');
        return { exitCode: 1 };
    }

    const result = await run({ runId, featureId, spurBin: env.spurBin ?? 'spur' });
    if (!result.ok) {
        echoError(`idea-handoff: ${result.error ?? 'failed'}`);
        return { exitCode: 1, result };
    }

    echo(`idea-handoff: wrote ${result.reportPath} (${result.wbsList.length} task(s))`);
    echo(`idea-handoff: next -> ${result.nextCommand}`);
    return { exitCode: 0, result };
}

/* c8 ignore start -- process-level wiring, exercised by the pipeline rather than unit tests */
if (import.meta.main) {
    const outcome = await runIdeaHandoffCli(process.env as IdeaHandoffCliEnv);
    process.exit(outcome.exitCode);
}
/* c8 ignore stop */
