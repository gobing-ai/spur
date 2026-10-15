import { loadAgentSpecs } from '@gobing-ai/ts-ai-runner';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { booleanFlag, numberFlag, stringFlag } from './agent-run-flags';
import type { AgentServiceContext } from './agent-service';
import { parseRequiresCapabilities, type RequiresCapabilities } from './capability-attestation';
import { FleetService, mergeAgentSpecs } from './fleet-service';

/** Outcome of {@link agentRunPreflight}: an exit-2 refusal, or the validated launch values. */
export type AgentRunPreflight =
    | { ok: false; exitCode: number; message: string }
    | {
          ok: true;
          requestMessageIds: string[];
          mode: string;
          cwd: string;
          timeoutMs: number | undefined;
          continueFlag: boolean;
      };

/**
 * Pre-dispatch launch checks for {@link AgentRunExecutor.executeRun}, in their original order: the
 * request-message correlation ids (computed before the fleet guard so a drained run is
 * admitted, G71 R1), the fleet launch ground-truth guard for a `--spec-id` launch, then
 * `--mode`, `--cwd`, `--timeout` and the prompt requirement. A failure is returned (exit 2),
 * never thrown; nothing has been spawned or persisted yet.
 */
export async function agentRunPreflight(
    ctx: AgentServiceContext,
    prompt: string | undefined,
    flags: Record<string, string | boolean>,
): Promise<AgentRunPreflight> {
    // Originating request message ids (0833 R1): the CLI drain path writes the
    // claimed inbox message ids as a comma-joined list (dual-spelling flag per
    // the sessionDir convention). Never inferred from the recipient or the most
    // recent queued row — absent flag means an empty correlation list (R7).
    // Computed BEFORE the fleet guard: a drained run carries ids and must be admitted (G71 R1).
    const requestMessageIds = (stringFlag(flags, 'requestMessage', '') || stringFlag(flags, 'request-message', ''))
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');

    const launchSpecId = stringFlag(flags, 'spec-id', '');
    if (launchSpecId !== '') {
        const fs = ctx.fs ?? createNodeFileSystem(ctx.cwd);
        const fleet = new FleetService({
            fs,
            ...(ctx.reloadAgentConfig !== undefined ? { reloadAgentConfig: ctx.reloadAgentConfig } : {}),
            openDb: ctx.getDb,
        });
        if ((await fleet.load(ctx.cwd)) !== null) {
            await fleet.assertLaunchGroundTruth(ctx.cwd);
            // G72 R2: the declared fleet members come from `agent.fleet` (nothing is written
            // to `.spur/agents/` any more), so the launch lookup is the same merged list the
            // rest of the runtime addresses — hand-authored specs plus declared members.
            const spec = (
                await mergeAgentSpecs(await loadAgentSpecs(fs.resolve('.spur/agents')), await fleet.specs(ctx.cwd))
                    .specs
            ).find((s) => s.id === launchSpecId);
            if (spec === undefined) return { ok: false, exitCode: 2, message: `Missing fleet spec: ${launchSpecId}` };
            await fleet.assertLaunchGroundTruth(spec.workspace);
            await fleet.assertLaunchGroundTruth(stringFlag(flags, 'cwd', ctx.cwd));
            // G71 R2: the `beforeDispatch` refusal is GONE. Operator resume is an inbox
            // message to the member (`spur message send --to <member> "/sp:dev-run <wbs>
            // --continue"`), and a drained run physically cannot carry `beforeDispatch` — the
            // guard made every fleet member unaddressable by the operator. The spec lookup
            // and the ground-truth assertions above stay: they are the launch safety, not the
            // dispatch-authorization rule.
        }
    }

    // validate --mode
    const mode = stringFlag(flags, 'mode', 'text');
    if (mode !== 'text' && mode !== 'json') {
        return { ok: false, exitCode: 2, message: `Invalid mode: ${mode} (must be text or json)` };
    }

    // validate --cwd
    const cwd = stringFlag(flags, 'cwd', '');
    if (cwd !== '') {
        const cwdStat = await statCwd(ctx, cwd);
        if (!cwdStat) {
            return { ok: false, exitCode: 2, message: `Invalid --cwd: ${cwd} does not exist` };
        }
        if (!cwdStat.isDirectory()) {
            return { ok: false, exitCode: 2, message: `Invalid --cwd: ${cwd} is not a directory` };
        }
    }

    // extract --timeout
    const timeoutMs = numberFlag(flags, 'timeout');
    if (timeoutMs === undefined && typeof flags.timeout === 'string') {
        return { ok: false, exitCode: 2, message: `Invalid --timeout=${flags.timeout}: must be a number` };
    }

    // require prompt (except codex --continue)
    const continueFlag = booleanFlag(flags, 'continue');
    if (prompt === undefined && !continueFlag) {
        return { ok: false, exitCode: 2, message: 'Prompt is required' };
    }

    return { ok: true, requestMessageIds, mode, cwd, timeoutMs, continueFlag };
}

/** `stat` the `--cwd` target relative to the project root; `null` when it does not exist. */
async function statCwd(ctx: AgentServiceContext, cwd: string) {
    try {
        return await createNodeFileSystem(ctx.cwd).stat(cwd);
    } catch {
        return null;
    }
}

/**
 * Parse the `requiresCapabilities` / `requires-capabilities` flag (0706 R4): the JSON-serialized
 * axis → minimum-state requirements a workflow action attaches to its dispatch. Absent → no
 * requirements; malformed JSON or an invalid shape fails closed with exit 2.
 */
export function parseRequiresCapabilitiesFlag(
    flags: Record<string, string | boolean>,
):
    | { ok: false; exitCode: number; message: string }
    | { ok: true; requiresCapabilities: Partial<RequiresCapabilities> | undefined } {
    // Capability gate input (0706 R4): JSON-serialized axis → minimum-state
    // requirements from the workflow action. Parsed+validated once here;
    // invalid shapes fail closed (exit 2) before any resolution/spawn.
    const requiresCapabilitiesRaw =
        stringFlag(flags, 'requiresCapabilities', '') || stringFlag(flags, 'requires-capabilities', '');
    let requiresCapabilities: Partial<RequiresCapabilities> | undefined;
    if (requiresCapabilitiesRaw !== '') {
        let parsedJson: unknown;
        try {
            parsedJson = JSON.parse(requiresCapabilitiesRaw);
        } catch (error) {
            return {
                ok: false,
                exitCode: 2,
                message: `agent.run: invalid requiresCapabilities JSON — ${error instanceof Error ? error.message : String(error)}`,
            };
        }
        const parsed = parseRequiresCapabilities(parsedJson);
        if (!parsed.ok) {
            return { ok: false, exitCode: 2, message: `agent.run: ${parsed.error}` };
        }
        requiresCapabilities = parsed.requires;
    }
    return { ok: true, requiresCapabilities };
}
