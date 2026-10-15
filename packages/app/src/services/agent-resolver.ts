import {
    type CapabilityTier,
    getCanonicalStage,
    getNextFallback,
    isTierEligible,
    type ObjectiveEscalationSignal,
    type StageRecord,
    TIER_RANK,
} from '@gobing-ai/spur-domain';
import { type AgentName, type DoctorRunner, resolveAgentName, TIER1_PRIORITY } from '@gobing-ai/ts-ai-runner';
import { stringFlag } from './agent-run-flags';
import type { AgentResolveResult, AgentResolveSource, AgentServiceContext, AgentServiceOutput } from './agent-service';
import {
    type AgentExecutorConfig,
    cheapestEligibleExecutors,
    executorDisabled,
    getExecutorTier,
} from './executor-tier';

/** `--agent` values already warned as bare binary names (warn once per process — 0536 R3). */
const warnedBareBinary = new Set<string>();

/**
 * One-time transition warning for a bare coding-agent binary name passed to
 * `--agent` (no matching executor entry). Reuses a module-level set so a retry
 * / escalation loop cannot spam the operator. Only the explicit `--agent`
 * surface warns — `agent.default` migration is owned by task 0542.
 */
// @transition-shim(agent-bare-binary-name) — a bare coding-agent binary name (`codex`, `omp`, `claude`
// with no matching executor entry) remains a valid --agent value during the role transition, warned
// once; removal: no bare-binary --agent value remains in docs/, .spur/workflows/, or plugins/sp/
function warnBareBinaryOnce(selector: string, output: AgentServiceOutput): void {
    if (warnedBareBinary.has(selector)) return;
    warnedBareBinary.add(selector);
    output.error(
        `Warning: --agent "${selector}" is a bare coding-agent binary name, not a role or a configured executor. It keeps working during the transition; prefer a role (scribe, coder, reviewer, planner) or an executor name (config/transition-shims.json: agent-bare-binary-name).`,
    );
}

/**
 * Actionable error for an `agent.default` that names a configured executor. The value domain is
 * roles since 0542; the transition fallback that kept executor names working is gone.
 */
function agentDefaultExecutorMessage(selector: string, roles: ReadonlyMap<string, unknown> | undefined): string {
    const roleNames =
        roles !== undefined && roles.size > 0 ? [...roles.keys()].join(', ') : 'scribe, coder, reviewer, planner';
    return (
        `agent.default '${selector}' names a configured executor, but agent.default takes a role (${roleNames}). ` +
        `Fix: set agent.default to a role such as 'coder' in .spur/config.yaml, and pin '${selector}' explicitly ` +
        `with --agent ${selector} where you need that executor.`
    );
}

/**
 * Reset the process-global warn-once markers. Test seam: `bun test` batches
 * several test files per worker process, so a marker consumed by one file is
 * invisible to another on some platforms/schedules — assertions on first-warn
 * behavior must reset first.
 */
export function _resetAgentServiceShimsForTest(): void {
    warnedBareBinary.clear();
}

/**
 * Agent resolution for {@link AgentService}: the `--agent` / stage / phase / role / priority funnel,
 * stage model-policy and executor-selector resolution, and the transient fresh-roster override
 * (B7 R6). Owns the per-service unreachable-tier warn-once set.
 */
export class AgentResolver {
    constructor(private readonly ctx: AgentServiceContext) {}

    private readonly unreachableTierWarnings = new Set<string>();

    /**
     * Transient executors override for a fresh-roster re-resolve (B7 R6 /
     * task 0895). Set only inside {@link withRosterOverride}; never persisted.
     */
    private rosterOverride?: AgentExecutorConfig[];

    /**
     * Run `fn` with the executors roster temporarily replaced by `executors`.
     * Scoped + always restored, so no other dispatch on this service instance
     * observes the override.
     */
    async withRosterOverride<T>(executors: AgentExecutorConfig[] | undefined, fn: () => Promise<T>): Promise<T> {
        const prev = this.rosterOverride;
        this.rosterOverride = executors;
        try {
            return await fn();
        } finally {
            this.rosterOverride = prev;
        }
    }

    // -------------------------------------------------------------------------
    // Private: agent resolution
    // -------------------------------------------------------------------------

    async resolveAgent(
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
        exclude?: ReadonlySet<string>,
    ): Promise<AgentResolveResult> {
        // 0687 R1: `inline` is the default selector; omission and explicit
        // `inline` resolve identically.
        const raw = stringFlag(flags, 'agent', 'inline');
        if (raw === 'auto') return this.resolveAgentAuto(flags, doctorRunner, exclude);
        // 0687 R3: the retired G5 headless rejection — an `inline` request that
        // reaches AgentService IS on a dispatch surface (a host-session inline
        // never gets here), so resolve through the tier chain and warn once
        // naming the substitution; never fail the dispatch over the selector.
        if (raw === 'inline') {
            const res = await this.resolveAgentAuto(flags, doctorRunner, exclude);
            if (res.ok) {
                const target =
                    res.role !== undefined
                        ? `${res.executor ?? res.agent} via role/${res.tier ?? res.role}`
                        : (res.executor ?? res.agent);
                this.ctx.output.error(
                    `--agent inline requested on a headless surface (no host session); resolved ${target} — substituted tier resolution`,
                );
            }
            return res;
        }
        // Executor-aware (0346): explicit `--agent <name>` reuses the same
        // executor-first lookup as `agent.default`; a role (0536 R1) is matched
        // first inside resolveExecutorSelector. No phase map is consulted
        // for the *starting* pick (R8: --agent wins; default-by-phase removed
        // 0452; prompt-regex phase removed 0536 R4). The pin chooses where a run
        // starts; it must not disable the escalation ladder (0482 R1) — see
        // resolvePinned.
        return this.resolvePinned(raw, flags, doctorRunner, exclude);
    }

    /**
     * Resolve a pinned executor (0482 R1). The pin decides which executor a run
     * *starts* on; it must not silently opt the run out of the resource-exhaustion
     * escalation ladder (the 0407 mechanism was unreachable because a pinned
     * dispatch resolved with no stage, so `currentStage`/`maxEscalations` were 0).
     * Two cases:
     *  - Escalation hop (`signal` present): the pin already chose the failed
     *    starting executor — route through the phase-resolved stage's model_policy
     *    so the fallback tier chain can move to the next eligible executor.
     *  - Initial pick: resolve the concrete pinned executor, then attach the
     *    phase-resolved stage context (policy only) so executeRun's escalation
     *    loop is reachable with `currentStage` populated.
     */
    private async resolvePinned(
        selector: string,
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
        exclude?: ReadonlySet<string>,
    ): Promise<AgentResolveResult> {
        if (stringFlag(flags, 'signal', '') !== '') {
            const stageRecord = this.resolveCanonicalStage(flags);
            if (stageRecord !== undefined) {
                const stageRes = await this.resolveStageModelPolicy(stageRecord, flags, doctorRunner, exclude);
                if (stageRes !== undefined) return stageRes;
            }
        }
        const base = await this.resolveExecutorSelector(selector, doctorRunner, 'explicit', undefined, flags);
        if (!base.ok) return base;
        // Role attribution (0538 R2 / 0551 R2): the pin beats role routing, but a
        // declared role is still recorded on the resolution so the --json envelope
        // carries both values (0536 R2) — the reason survives removing the pin
        // later. With nothing declared, the run inherits the dispatcher's role
        // (0551) — recorded as roleOrigin: 'inherited'; the pin still wins routing.
        // `base.role === undefined` guards the `--agent <role>` selector, which
        // already resolved through the role and carries its own origin.
        const declaredRole = stringFlag(flags, 'role', '');
        let attributed = base;
        if (declaredRole !== '') {
            attributed = { ...base, role: declaredRole, roleOrigin: 'declared' };
        } else if (base.role === undefined) {
            const inherited = this.inheritedRole();
            if (inherited !== undefined && this.ctx.roles?.get(inherited) !== undefined) {
                attributed = { ...base, role: inherited, roleOrigin: 'inherited' };
            } else if (inherited !== undefined) {
                // Mirror the auto path's warning (0551 R3): a stale SPUR_ROLE under
                // a pin must not vanish silently — attribution is dropped but the
                // observation stays visible. Routing is unaffected (the pin wins).
                this.ctx.output.error(
                    `Warning: ignoring inherited role '${inherited}' — not in ${this.roleVocabulary()}`,
                );
            }
        }
        const stageRecord = this.resolveCanonicalStage(flags);
        // Role-resolved selectors carry the winning executor in `base.executor`;
        // the pin-attach below assumes the selector IS the executor name, so it
        // applies only to executor/binary pins (0536 R1).
        if (stageRecord !== undefined && base.source !== 'role') {
            const executors = this.ctx.agentConfig?.executors;
            const pinned = executors?.find((e) => e.name === selector);
            const tier = pinned !== undefined ? getExecutorTier(pinned) : stageRecord.model_policy.min_tier;
            return {
                ...attributed,
                stage: {
                    stageId: stageRecord.id,
                    policy: stageRecord.model_policy,
                    executorName: selector,
                    executorTier: tier,
                },
            };
        }
        return attributed;
    }

    /**
     * Resolve the canonical stage for this dispatch: an explicit `stage` flag when
     * one is supplied, otherwise the stage folded by the **declared role**.
     *
     * The role fallback is what makes stage routing reachable at all. Prompt-text
     * phase derivation was removed in 0536 R4 and `default-by-phase` in 0452, which
     * left the explicit flag as the only input — and no caller sets it: not the CLI
     * (`spur agent run` has no such option), not the workflow `agent.run` action,
     * not the server. So `model_policy`, the fallback tier chain, and
     * resource-exhaustion failover were unreachable outside tests, including the
     * 0482 R1 repair of exactly that condition. Roles are the input production
     * actually carries: every pipeline `agent.run` step declares one (0538 R2) and
     * the action forwards it as `flags.role`.
     *
     * Picking the role's highest-`min_tier` stage (ties → declaration order) keeps
     * the starting executor identical to plain role routing — roles.md R4 pins the
     * role's tier at that same floor — so this widens what the ladder can do
     * without moving where a run begins.
     */
    private resolveCanonicalStage(flags: Record<string, string | boolean>): StageRecord | undefined {
        const stageFlag = stringFlag(flags, 'stage', '');
        if (stageFlag !== '') return getCanonicalStage(stageFlag);

        const declared = stringFlag(flags, 'role', '') || this.inheritedRole() || '';
        if (declared === '') return undefined;
        return this.stageForRole(declared);
    }

    /**
     * The stage a role routes through: the folded stage with the highest
     * `min_tier`, ties broken by declaration order. Undefined when the role is
     * unknown, folds no stage, or names a stage absent from the registry.
     */
    private stageForRole(role: string): StageRecord | undefined {
        const stages = this.ctx.roles?.get(role)?.stages ?? [];
        let best: StageRecord | undefined;
        for (const id of stages) {
            const record = getCanonicalStage(id);
            if (record === undefined) continue;
            if (best === undefined || TIER_RANK[record.model_policy.min_tier] > TIER_RANK[best.model_policy.min_tier]) {
                best = record;
            }
        }
        return best;
    }

    /**
     * Resolve `--agent auto` using stage-registry model routing (R1/R2/R3):
     *  1. Resolve canonical `stage_id` from the explicit `--stage` flag.
     *  2. If stage found, consume `model_policy` and start on the cheapest eligible executor.
     *     Objective escalation signals (`--signal`) trigger fallback entries.
     *  3. No stage falls through to `agent.default` selector, then Tier-1 priority.
     * (`default-by-phase` removed in task 0452; prompt-regex phase removed in 0536 R4 —
     * stage model_policy is the only adaptive path, gated on the explicit flag.)
     */
    private async resolveAgentAuto(
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
        exclude?: ReadonlySet<string>,
    ): Promise<AgentResolveResult> {
        const config = this.ctx.agentConfig;

        // Escalation hop (`signal` present): the role already chose the executor that
        // failed, so re-resolving through the role would return it again and the loop
        // would read that as an exhausted chain. Route through the stage's
        // `model_policy` instead so the fallback tier can advance — the same carve-out
        // `resolvePinned` makes for pins (0482 R1). Initial dispatches carry no signal
        // and are unaffected.
        if (stringFlag(flags, 'signal', '') !== '') {
            const hopStage = this.resolveCanonicalStage(flags);
            if (hopStage !== undefined) {
                const hopRes = await this.resolveStageModelPolicy(hopStage, flags, doctorRunner, exclude);
                if (hopRes !== undefined) return hopRes;
            }
        }

        // Declared role (0538 R1/R2): `--agent auto` means "use the role the caller
        // declared" (command frontmatter or workflow step). The declared role picks
        // the starting tier; with nothing declared it falls to `agent.default`
        // (0542) then priority. Unknown declared role fails loudly — a stale
        // declaration must not silently route as a bare binary name.
        const declaredRole = stringFlag(flags, 'role', '');
        if (declaredRole !== '') {
            const roleTier = this.ctx.roles?.get(declaredRole)?.tier;
            if (roleTier === undefined) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `Unknown declared role: '${declaredRole}'. Accepted: ${this.roleVocabulary()}.`,
                };
            }
            return this.resolveRole(declaredRole, roleTier, doctorRunner, 'declared');
        }

        // Stage-registry adaptive model routing (R1/R2/R3). Explicit flag only:
        // a role-derived stage must not preempt the inherited-role branch below,
        // which owns `roleOrigin: 'inherited'` attribution (0551 R2). Role
        // dispatches still carry stage context — `resolveRole` attaches it.
        const stageRecord = stringFlag(flags, 'stage', '') !== '' ? this.resolveCanonicalStage(flags) : undefined;
        if (stageRecord !== undefined) {
            const stageRes = await this.resolveStageModelPolicy(stageRecord, flags, doctorRunner, exclude);
            if (stageRes !== undefined) {
                return stageRes;
            }
        }

        // Inherited role (0551 R2): nothing declared and no explicit stage — a
        // fan-out subagent inherits the dispatcher's effective role via SPUR_ROLE
        // and resolves through that role's tier. An unknown inherited role (stale
        // env) warns once and falls through to default/priority — inheritance
        // must never hard-fail a dispatch.
        const inherited = this.inheritedRole();
        if (inherited !== undefined) {
            const inheritedTier = this.ctx.roles?.get(inherited)?.tier;
            if (inheritedTier === undefined) {
                this.ctx.output.error(
                    `Warning: ignoring inherited role '${inherited}' — not in ${this.roleVocabulary()}`,
                );
            } else {
                return this.resolveRole(inherited, inheritedTier, doctorRunner, 'inherited');
            }
        }

        // No phase/stage mapping: try the default executor selector, then priority.
        if (config?.default !== undefined) {
            const viaDefault = await this.resolveExecutorSelector(
                config.default,
                doctorRunner,
                'default',
                undefined,
                flags,
            );
            if (viaDefault.ok) return viaDefault;
            // R2 (0542): agent.default's value domain is roles — an unknown value
            // must fail loudly naming both accepted sets, never silently fall to
            // Tier-1 priority (the old legacy-agent fallthrough is retired).
            if (viaDefault.exitCode === 2) return viaDefault;
        }

        return this.resolveAgentPriority(doctorRunner);
    }

    /**
     * Consume `model_policy` for a canonical stage and pick starting/fallback executor.
     */
    private async resolveStageModelPolicy(
        stageRecord: StageRecord,
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
        exclude?: ReadonlySet<string>,
    ): Promise<AgentResolveResult | undefined> {
        const executors = this.ctx.agentConfig?.executors;
        if (!executors || executors.length === 0) {
            return undefined;
        }

        const policy = stageRecord.model_policy;
        const signalRaw = stringFlag(flags, 'signal', '');
        const signal = signalRaw.length > 0 ? (signalRaw as ObjectiveEscalationSignal) : undefined;
        const fromExecutor = stringFlag(flags, 'from-executor', '') || undefined;

        // R4 — sideways availability failover. A `resource-exhaustion` signal means
        // *this account/binary is dead right now* (a 5-hour usage limit), so the
        // answer is an availability failover onto a same-tier executor on a DIFFERENT
        // agent binary, not a quality escalation up-tier (which would land on another
        // executor sharing the same dead binary — 9 of 13 executors share `omp`).
        // Try same-tier, different-binary, not-yet-attempted executors in array order
        // first; only when none is usable fall through to the fallback-tier path.
        if (signal === 'resource-exhaustion' && fromExecutor !== undefined) {
            const failed = executors.find((e) => e.name === fromExecutor);
            if (failed !== undefined) {
                const failedTier = getExecutorTier(failed);
                const failedCanonical = resolveAgentName(failed.agent);
                // An exhaustion signal invalidates the underlying binary/account,
                // not only one executor alias. Derive every exhausted binary from
                // the run-scoped attempted set so the ladder never bounces back to
                // another model entry backed by the same dead account.
                const exhaustedAgents = new Set(
                    executors
                        .filter((executor) => executor.name === fromExecutor || (exclude?.has(executor.name) ?? false))
                        .map((executor) => resolveAgentName(executor.agent))
                        .filter((agent): agent is AgentName => agent !== undefined),
                );
                const sideways = executors.filter((e) => {
                    const canonical = resolveAgentName(e.agent);
                    return (
                        !executorDisabled(e) &&
                        e.name !== fromExecutor &&
                        getExecutorTier(e) === failedTier &&
                        canonical !== failedCanonical &&
                        (canonical === undefined || !exhaustedAgents.has(canonical)) &&
                        !(exclude?.has(e.name) ?? false)
                    );
                });
                for (const executor of sideways) {
                    const canonical = resolveAgentName(executor.agent);
                    if (canonical === undefined) {
                        return {
                            ok: false,
                            exitCode: 2,
                            message: `Executor '${executor.name}' for stage '${stageRecord.id}' maps to unknown agent '${executor.agent}'`,
                        };
                    }
                    const usable = await this.checkUsable(canonical, doctorRunner);
                    if (usable.ok) {
                        this.ctx.output.error(
                            `Failover: ${fromExecutor} (tier ${failedTier}) exhausted; using same-tier ${executor.name} on a different binary`,
                        );
                        return {
                            ok: true,
                            agent: canonical,
                            model: executor.model,
                            source: 'stage',
                            executor: executor.name,
                            stage: {
                                stageId: stageRecord.id,
                                policy,
                                executorName: executor.name,
                                executorTier: getExecutorTier(executor),
                            },
                        };
                    }
                }
                // Sideways list empty or none usable — fall through to fallback tier.
            }
        }

        let targetTier: CapabilityTier = policy.min_tier;

        if (signal !== undefined) {
            const currentExec = executors.find((e) => e.name === fromExecutor);
            const currentTier = currentExec ? getExecutorTier(currentExec) : undefined;
            const fallback = getNextFallback(policy, signal, currentTier);
            if (fallback) {
                targetTier = fallback.tier;
                if (fromExecutor) {
                    this.ctx.output.error(
                        `Stage escalation: stage=${stageRecord.id} signal=${signal} from=${fromExecutor} to tier=${targetTier}`,
                    );
                }
            }
        }

        // 0540 R3 — a tier with no configured executor is unreachable, not a
        // failed rung: a gap in the operator's tier ladder (e.g. `capable-2`
        // commented out) must be distinguished from exhaustion. The eligible
        // walk below continues from the next reachable tier (>= targetTier), so
        // the run proceeds instead of terminating as exhausted.
        if (!executors.some((e) => getExecutorTier(e) === targetTier)) {
            // Once per stage+tier per service instance (review 0540 minor:
            // the per-dispatch repetition made every run through a gap noisy
            // without adding information — the first warning carries it all).
            const warnKey = `${stageRecord.id}:${targetTier}`;
            if (!this.unreachableTierWarnings.has(warnKey)) {
                this.unreachableTierWarnings.add(warnKey);
                this.ctx.output.error(
                    `Stage '${stageRecord.id}': tier ${targetTier} is unreachable — no executor configured at this tier; continuing from the next reachable tier`,
                );
            }
        }

        // Filter candidate executors whose capability meets targetTier (R3: never
        // re-select an executor already attempted this run — exclusion empties the
        // list, resolveStageModelPolicy returns undefined, and the caller reports
        // "chain exhausted" instead of re-dispatching the same dead executor).
        const exhaustedAgents =
            signal === 'resource-exhaustion'
                ? new Set(
                      executors
                          .filter((executor) => exclude?.has(executor.name) ?? false)
                          .map((executor) => resolveAgentName(executor.agent))
                          .filter((agent): agent is AgentName => agent !== undefined),
                  )
                : undefined;
        // 0982 R2: the shared funnel owns the disable filter and the ascending tier order;
        // the resource-exhaustion exclusions (excluded names, exhausted agents) stay local.
        const eligible = cheapestEligibleExecutors(executors, targetTier).filter((e) => {
            const canonical = resolveAgentName(e.agent);
            return (
                !(exclude?.has(e.name) ?? false) &&
                (canonical === undefined || !(exhaustedAgents?.has(canonical) ?? false))
            );
        });
        if (eligible.length === 0) {
            return undefined;
        }

        for (const executor of eligible) {
            const canonical = resolveAgentName(executor.agent);
            if (canonical === undefined) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `Executor '${executor.name}' for stage '${stageRecord.id}' maps to unknown agent '${executor.agent}'`,
                };
            }
            const usable = await this.checkUsable(canonical, doctorRunner);
            if (usable.ok) {
                return {
                    ok: true,
                    agent: canonical,
                    model: executor.model,
                    source: 'stage',
                    executor: executor.name,
                    stage: {
                        stageId: stageRecord.id,
                        policy,
                        executorName: executor.name,
                        executorTier: getExecutorTier(executor),
                    },
                };
            }
        }

        return undefined;
    }

    /** Legacy static Tier-1 priority resolution (preserved fallback). */
    private async resolveAgentPriority(doctorRunner: DoctorRunner): Promise<AgentResolveResult> {
        const results = await doctorRunner.runAll();
        for (const name of TIER1_PRIORITY) {
            const match = results.find((r) => r.agent === name);
            if (match?.usable) return { ok: true, agent: name, source: 'priority' };
        }
        return { ok: false, exitCode: 1, message: 'No usable Tier-1 agent found' };
    }

    /**
     * Resolve an executor selector to an execution profile. Sources:
     *  - `phase` — legacy source tag (default-by-phase removed 0452).
     *  - `default` — from `agent.default`; falls through to legacy agent name.
     *  - `explicit` — from `--agent <name>` (0346); executor-first then binary (R8).
     *
     * Collision precedence (R3): when an executor and an agent binary share a
     * name, the executor wins. To reach a bare binary whose name is shadowed
     * by an executor entry, the user must remove or rename the executor.
     */
    private async resolveExecutorSelector(
        selector: string,
        doctorRunner: DoctorRunner,
        source: 'phase' | 'default' | 'explicit',
        phase?: string,
        // Dispatch flags ride down so the precheck pin marker (0894 R1) reaches
        // the executor branch and skips the per-stage usability probe.
        flags: Record<string, string | boolean> = {},
    ): Promise<AgentResolveResult> {
        // Role branch (0536 R1): a role selects the *starting* tier and resolution
        // starts from that tier's cheapest eligible executor. Role-first match —
        // 0537's collision guard proves roles and executor names pairwise disjoint.
        const roleTier = this.ctx.roles?.get(selector)?.tier;
        if (roleTier !== undefined) {
            return this.resolveRole(
                selector,
                roleTier,
                doctorRunner,
                // `--agent <role>` (explicit) is a declaration; `agent.default`
                // routing through a role value is config, not a declaration.
                source === 'explicit' ? 'declared' : undefined,
                // 0545 R1: a default-routed role is a *defaulted* selection, not a
                // declared role resolution — the four selection sources (role /
                // pin / default / escalated) must stay distinct in attribution.
                source === 'default' ? 'default' : 'role',
            );
        }

        const executor = this.ctx.agentConfig?.executors?.find((e) => e.name === selector);
        const phaseSuffix = phase !== undefined ? ` for phase '${phase}'` : '';

        if (executor !== undefined) {
            // R2 (0542): agent.default takes a role id. The executor-name fallback
            // (shim agent-default-executor) was removed, so an executor name fails loudly.
            if (source === 'default') {
                return {
                    ok: false,
                    exitCode: 2,
                    message: agentDefaultExecutorMessage(selector, this.ctx.roles),
                };
            }
            // 111 R3/R4: a pinned (or default-named, or phase-mapped) disabled
            // profile is never silently substituted — routing fails naming the
            // profile and the fix, before any probe or spawn.
            if (executorDisabled(executor)) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `Executor '${executor.name}'${phaseSuffix} is disabled (agent.executors.${executor.name}.disabled) — enable it or select another executor`,
                };
            }
            const canonical = resolveAgentName(executor.agent);
            if (canonical === undefined) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `Executor '${executor.name}'${phaseSuffix} maps to unknown agent '${executor.agent}'`,
                };
            }
            // B7 R1 (task 0894): a run-scoped pin was resolved by the precheck/start
            // doctor walk, which already established usability for this run. The
            // marker skips the per-stage probe — without it the pin would save
            // nothing: every stage would re-run the same doctor call.
            const pinPreresolved = stringFlag(flags, 'pinResolved', '') === 'true';
            if (!pinPreresolved) {
                const usable = await this.checkUsable(canonical, doctorRunner);
                if (!usable.ok) {
                    // A configured phase mapping must fail fast (R7); a default-path miss falls through.
                    if (phase !== undefined) {
                        return {
                            ok: false,
                            exitCode: 1,
                            message: `Executor '${executor.name}'${phaseSuffix} agent '${canonical}' is not usable — ${usable.reason} (spur agent doctor)`,
                        };
                    }
                    return usable.result;
                }
            }
            // R2 (0536): an explicit executor name is a permanent pin, not a shim —
            // no deprecation warning. The name is carried for the --json envelope,
            // and the executor's capability tier rides the result so routing
            // attribution (0545 R1) records the resolved tier for explicit/default
            // selections too (not only role/stage resolutions).
            return {
                ok: true,
                agent: canonical,
                model: executor.model,
                source,
                executor: executor.name,
                tier: getExecutorTier(executor),
            };
        }

        // No configured executor by this name.
        if (phase !== undefined) {
            // R7: an explicitly-mapped phase naming a missing executor exits 2.
            return {
                ok: false,
                exitCode: 2,
                message: `Unknown executor '${selector}'${phaseSuffix} — define it under agent.executors`,
            };
        }

        // R2 (0542): agent.default is a role; any other value fails naming the
        // accepted roles — it must not silently resolve as a legacy direct agent name.
        if (source === 'default') {
            const roleNames = this.ctx.roles !== undefined ? [...this.ctx.roles.keys()].join(', ') : '';
            const roleList = roleNames !== '' ? `a role (${roleNames})` : 'a role';
            return {
                ok: false,
                exitCode: 2,
                message: `Unknown agent.default value: '${selector}'. Accepted: ${roleList}, e.g. agent.default: coder.`,
            };
        }

        // Default/explicit path: treat the selector as a legacy direct agent name.
        const canonical = resolveAgentName(selector);
        if (canonical === undefined) {
            // Task 0413 (R8) / 0536 (R3): surface the accepted sets so a typo does
            // not look like an opaque failure. The agent-name space is open, so
            // name the closed role vocabulary and the configured executors.
            const roleNames = this.ctx.roles !== undefined ? [...this.ctx.roles.keys()].join(', ') : '';
            const names = this.ctx.agentConfig?.executors?.map((e) => e.name) ?? [];
            const roleList = roleNames !== '' ? `role (${roleNames})` : 'a role';
            const executorList =
                names.length > 0 ? `configured executor (${names.join(', ')})` : 'a configured executor';
            return {
                ok: false,
                exitCode: 2,
                message: `Unknown agent: '${selector}'. Accepted: ${roleList}, ${executorList}, 'inline', or 'auto'.`,
            };
        }
        // R3 (0536): a bare coding-agent binary name (no matching executor entry)
        // keeps working during the transition, under a registered shim — warn once.
        // Only the explicit `--agent` surface warns: the `agent.default` value
        // domain migration is task 0542's own three-way branch and shim.
        if (source === 'explicit') {
            warnBareBinaryOnce(selector, this.ctx.output);
        }
        const usable = await this.checkUsable(canonical, doctorRunner);
        if (!usable.ok) return usable.result;
        return { ok: true, agent: canonical, source };
    }

    /**
     * Resolve a role selector (0536 R1): role → tier → cheapest eligible executor.
     * Mirrors the stage-policy walk — eligible executors (tier at or above the
     * role's tier) sorted by tier ascending, first usable wins. No stage context
     * is attached: a role picks the *starting* tier; escalation stays
     * stage-policy-driven (0348). `role`/`tier`/`executor` ride the result for
     * the `--json` envelope (R1), along with `roleOrigin` when `origin` is set
     * (0551).
     */
    async resolveRole(
        role: string,
        roleTier: CapabilityTier,
        doctorRunner: DoctorRunner,
        origin?: 'declared' | 'inherited',
        // 0545 R1: 'role' for declared/inherited role resolutions; 'default'
        // when the selector came from `agent.default` so the selection source
        // stays distinguishable in attribution.
        source: AgentResolveSource = 'role',
    ): Promise<AgentResolveResult> {
        // B7 R6 (task 0895): a fresh-roster re-resolve temporarily overrides the
        // construction-time executors so the eligibility walk sees a mid-run
        // disable; see {@link withRosterOverride}.
        const executors = this.rosterOverride ?? this.ctx.agentConfig?.executors;
        if (executors === undefined || executors.length === 0) {
            return {
                ok: false,
                exitCode: 1,
                message: `No executors configured to serve role '${role}' (tier ${roleTier}) — define executors under agent.executors`,
            };
        }
        const eligible = cheapestEligibleExecutors(executors, roleTier);
        for (const executor of eligible) {
            const canonical = resolveAgentName(executor.agent);
            if (canonical === undefined) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `Executor '${executor.name}' for role '${role}' maps to unknown agent '${executor.agent}'`,
                };
            }
            const usable = await this.checkUsable(canonical, doctorRunner);
            if (usable.ok) {
                // Attach the role's stage context (0482 R1 did the same for pins):
                // without it `executeRun` sees no `currentStage`, `maxEscalations`
                // is 0, and the fallback ladder cannot run. The stage only supplies
                // the policy — the executor and tier above are already chosen, so
                // this widens what a failure can do without moving where the run starts.
                const stageRecord = this.stageForRole(role);
                return {
                    ok: true,
                    agent: canonical,
                    model: executor.model,
                    source,
                    role,
                    ...(origin !== undefined ? { roleOrigin: origin } : {}),
                    tier: roleTier,
                    executor: executor.name,
                    ...(stageRecord !== undefined
                        ? {
                              stage: {
                                  stageId: stageRecord.id,
                                  policy: stageRecord.model_policy,
                                  executorName: executor.name,
                                  executorTier: roleTier,
                              },
                          }
                        : {}),
                };
            }
        }
        let tried = eligible.length > 0 ? eligible.map((e) => e.name).join(', ') : 'none eligible';
        // 111 R6: an all-disabled candidate set names the disabled profiles so
        // the fix (re-enable one) is actionable instead of "none eligible".
        if (eligible.length === 0 && executors !== undefined) {
            const disabledEligible = executors
                .filter((e) => executorDisabled(e) && isTierEligible(getExecutorTier(e), roleTier))
                .map((e) => e.name);
            if (disabledEligible.length > 0) tried = `disabled: ${disabledEligible.join(', ')}`;
        }
        return {
            ok: false,
            exitCode: 1,
            message: `No usable executor for role '${role}' (tier ${roleTier}) — tried: ${tried} (spur agent doctor)`,
        };
    }

    /**
     * The dispatcher's effective role, threaded through SPUR_ROLE (0551 R2).
     * Absent/empty → undefined (top-level dispatch, no inheritance).
     */
    private inheritedRole(): string | undefined {
        const raw = this.ctx.env.SPUR_ROLE;
        return raw !== undefined && raw !== '' ? raw : undefined;
    }

    /**
     * Comma-joined Layer-1 role vocabulary for error messages. Falls back to the
     * frozen four ids when no role table was threaded (0536 R3 fallback list).
     */
    private roleVocabulary(): string {
        if (this.ctx.roles !== undefined && this.ctx.roles.size > 0) {
            return [...this.ctx.roles.keys()].join(', ');
        }
        return 'scribe, coder, reviewer, planner';
    }

    /**
     * Liveness-only readiness gate (P0-a): usable = installed && version !== null.
     * Auth is NOT consulted — a logged-out agent is runnable and fails at runtime
     * with its own error. Fails fast before any long-running stage burns the timeout.
     */
    private async checkUsable(
        canonical: AgentName,
        doctorRunner: DoctorRunner,
    ): Promise<{ ok: true } | { ok: false; reason: string; result: AgentResolveResult }> {
        const result = await doctorRunner.runOne(canonical);
        if (!result.installed) {
            const message = `Agent '${canonical}' is not installed or not runnable — install it or select another agent (spur agent doctor)`;
            return { ok: false, reason: 'not installed', result: { ok: false, exitCode: 1, message } };
        }
        if (!result.usable) {
            const message = `Agent '${canonical}' is installed but not runnable (no version detected) — reinstall or select another agent (spur agent doctor)`;
            return { ok: false, reason: 'no version detected', result: { ok: false, exitCode: 1, message } };
        }
        return { ok: true };
    }
}
