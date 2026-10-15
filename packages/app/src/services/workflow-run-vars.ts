import { AGENT_ROLE_NAMES, type SpurConfig } from '@gobing-ai/spur-config';
import { resolveAgentName } from '@gobing-ai/ts-ai-runner';

/**
 * Overlay caller `--vars` on a workflow's declared defaults (0948 R2).
 *
 * Omitted keys keep the definition default. An explicit empty string for a key
 * the definition already set to a non-empty value is a blanking override and is
 * rejected by name — a partial map must not silently empty `spurBin` or any
 * other declared var. Non-string declared values are ignored; workflow vars are
 * `Record<string, string>`.
 */
export function mergeWorkflowRunVars(
    declared: Record<string, unknown> | undefined,
    overrides: Record<string, string> | undefined,
): Record<string, string> {
    const base: Record<string, string> = {};
    if (declared !== undefined) {
        for (const [key, value] of Object.entries(declared)) {
            if (typeof value === 'string') base[key] = value;
        }
    }
    const user = overrides ?? {};
    const blanked = Object.keys(user).filter((key) => user[key] === '' && (base[key] ?? '') !== '');
    if (blanked.length > 0) {
        throw new Error(`--vars leaves declared vars unset: ${blanked.sort().join(', ')}`);
    }
    return { ...base, ...user };
}

/**
 * `--agent fleet` selects the fleet executor surface (task 0942, ADR-126). 'fleet' is
 * a surface, not an agent binary — left in `agent` it would never survive dispatch
 * resolution, so it maps to the `executor` run var and is dropped from the agent
 * ladder: the configured default executor then governs review/verify/implement if a
 * declared fallback (`executorFallback: traditional`) runs. Any other `--agent`
 * value, and explicit `--vars` `executor`, passes through untouched.
 */
export function mapFleetExecutorVar(callerVars: Record<string, string> | undefined): Record<string, string> {
    if (callerVars?.agent !== 'fleet') return callerVars ?? {};
    const { agent: _agent, ...rest } = callerVars;
    return { ...rest, executor: 'fleet' };
}

/**
 * Resolve the `agent` / `implementAgent` run vars from `.spur/config.yaml`
 * `agent.default`, so the configured default executor reaches a workflow's
 * `agent.run` steps — including the implement hop, which previously read only the
 * pipeline's literal `implementAgent` (task 0485 R2).
 *
 * Returns an empty object — leaving the YAML default in force — when the caller
 * already chose both agents, when no `agent.default` is configured, or when config
 * cannot be read. Each key is injected independently: a caller-set `agent` does not
 * suppress `implementAgent`. When the configured default names none of a Layer-1 role,
 * a configured executor, or a canonical agent binary, one warning is emitted and nothing is
 * injected, so a stale `agent.default` (e.g. a commented-out executor) never fails
 * dispatch (AC3) — the pipeline YAML literal governs instead.
 *
 * Precedence, per var (task 0487 R4): caller `vars.implementAgent` > caller
 * `vars.agent` > `agent.default` > YAML literal. `--vars '{"agent":"claude"}'`
 * previously reached review/verify/test-fix but NOT the implement hop, which kept
 * getting `agent.default` — an operator who explicitly picked an executor watched
 * the run dispatch a different one (run `e8cb00e7`). The caller's choice is the
 * strongest signal, so it also seeds `implementAgent`; it is not validated against
 * config here because an explicit `--vars` agent is the operator's own assertion
 * (a bad one fails loudly at dispatch), unlike a stale config default.
 */
/**
 * Resolve default agent vars from the threaded config (A5/ADR-082) and caller
 * vars. Sync & pure: a load failure is already surfaced once at the composition
 * root; `config === null` degrades to empty (today's defaults).
 */
export function resolveDefaultAgentVar(
    config: SpurConfig | null,
    callerVars: Record<string, string> | undefined,
    warn: (message: string) => void,
): Record<string, string> {
    const result: Record<string, string> = {};
    if (callerVars?.implementAgent === undefined && callerVars?.agent !== undefined) {
        result.implementAgent = callerVars.agent;
    }
    const configured = config?.agent?.default;
    if (typeof configured !== 'string' || configured.length === 0) {
        return result;
    }
    // Validate before injecting (AC3): accept iff the default names a Layer-1 role,
    // a configured executor, or a canonical agent binary. On mismatch, warn once and
    // inject nothing so the pipeline YAML literal governs instead of a dispatch-time
    // "Unknown agent" failure.
    //
    // The role branch is what task 0542 moved the value domain to: `config.example.yaml`
    // ships `agent.default: coder`, and `spur agent run --agent <role>` resolves
    // role -> tier -> cheapest usable executor. Without it, the recommended config value
    // was rejected here and every engine-driven `agent.run` silently fell back to the
    // pipeline YAML literal, defeating the whole role ladder.
    const valid =
        (AGENT_ROLE_NAMES as readonly string[]).includes(configured) ||
        config?.agent?.executors?.some((e) => e.name === configured) === true ||
        resolveAgentName(configured) !== undefined;
    if (!valid) {
        warn(
            `agent.default "${configured}" does not name a Layer-1 role, a configured executor, or an agent binary; leaving the pipeline's literal agent in force`,
        );
        return result;
    }
    if (callerVars?.agent === undefined) result.agent = configured;
    // Only when the caller pinned neither var does `agent.default` reach implement.
    if (result.implementAgent === undefined && callerVars?.implementAgent === undefined) {
        result.implementAgent = configured;
    }
    return result;
}
