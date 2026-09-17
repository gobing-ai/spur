#!/usr/bin/env bun

import { getEnvVars } from '@gobing-ai/ts-utils';

/**
 * idea-handoff — portable entrypoint for the idea-pipeline finalization (task 0824, feature I21).
 *
 * ADR-065 standard plugin script: the workflow wrapper prefers the monorepo writer
 * (`bun packages/app/src/workflow/idea-handoff-cli.ts`) and falls back to this script's
 * registered `.mjs` twin under bare `node`, so a seeded project with no monorepo checkout
 * still finalizes the handoff (run-scoped report + task-deps ordering + roster refresh) and
 * fails closed (exit 1) when neither writer resolves.
 *
 * The behavior lives in the generated bundle `../lib/idea-handoff.generated.mjs`, produced by
 * `bun run build:plugin-lib` from `packages/app/src/workflow/idea-handoff-cli.ts` — the same
 * source the monorepo branch executes, so both branches share one contract (0604/0824).
 * Declarations: `../lib/idea-handoff.generated.d.mts`. The bundle is imported by computed URL
 * on purpose: `superskill script convert` must NOT inline it (its tree carries one
 * `Bun.spawn` site in a ts-runtime streaming path this workflow never exercises), so the
 * twin stays a thin node-runnable loader over the committed runtime asset.
 *
 * Environment: `__runId`, `featureId`, optional `spurBin`. Missing required vars exit 1
 * (mis-invocation is failed-closed, never a silent skip).
 */

const libUrl = new URL('../lib/idea-handoff.generated.mjs', import.meta.url).href;

export async function loadHandoffLib(): Promise<typeof import('../lib/idea-handoff.generated.mjs')> {
    return (await import(libUrl)) as typeof import('../lib/idea-handoff.generated.mjs');
}

export const IDEA_HANDOFF_USAGE =
    'usage: idea-handoff.ts  (env: __runId, featureId, optional spurBin) — no subcommands';

export async function main(argv: string[], env: NodeJS.ProcessEnv = getEnvVars()): Promise<number> {
    if (argv.length > 0) {
        process.stderr.write(`${IDEA_HANDOFF_USAGE}\n`);
        return 2;
    }
    const { runIdeaHandoffCli } = await loadHandoffLib();
    const outcome = await runIdeaHandoffCli(env as { __runId?: string; featureId?: string; spurBin?: string });
    return outcome.exitCode;
}

if (import.meta.main) {
    process.exit(await main(process.argv.slice(2)));
}
