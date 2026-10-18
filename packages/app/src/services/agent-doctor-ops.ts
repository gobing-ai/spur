import { isTierEligible } from '@gobing-ai/spur-domain';
import { type DoctorResult, DoctorRunner } from '@gobing-ai/ts-ai-runner';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { toEnvelopeJson } from '../output/envelope';
import type { DoctorCacheInfo, DoctorRow, DoctorUsageInfo } from './agent-doctor-report';
import {
    buildDoctorRows,
    cachedDoctorRunner,
    DOCTOR_CACHE_REL,
    executorFingerprint,
    readFreshDoctorCache,
    readUsageSnapshot,
    renderDoctorDetail,
    renderDoctorTable,
    renderRoleLadder,
    roleCoveredByCache,
    syntheticDisabledRows,
    versionCore,
    withDisabledRows,
    withoutAuthenticated,
    writeDoctorCacheFile,
} from './agent-doctor-report';
import { readObservationRefreshStatus } from './agent-quota-refresh';
import type { AgentResolver } from './agent-resolver';
import type { AgentRunDeps, AgentServiceContext } from './agent-service';
import {
    type AgentExecutorConfig,
    cheapestEligibleExecutors,
    executorDisabled,
    getExecutorTier,
} from './executor-tier';

/**
 * `spur agent doctor` for {@link AgentService}: detection + health probing, usage/capability
 * annotations and the human/JSON report rendering.
 */
export class AgentDoctorOps {
    constructor(
        private readonly ctx: AgentServiceContext,
        private readonly resolver: AgentResolver,
    ) {}

    /** Implementation of {@link AgentService.doctor} (see its doc comment for the contract). */
    async doctor(
        args: {
            json: boolean;
            /** ADR-091 opt-in envelope decision threaded from `--json-envelope` (undefined → env). */
            enveloped?: boolean;
            agent?: string;
            /** B4/0683 R1: opt into model health probing; without it no probe fires. */
            probeHealth?: boolean;
            /** B4/0683 R5: bypass the detection cache, re-run, rewrite it. */
            forceRefresh?: boolean;
            /** 0893 R2: absolute path of the agent-usage snapshot to report; absent → `usage: none`. */
            usageSnapshotPath?: string;
        },
        deps?: AgentRunDeps,
    ): Promise<number> {
        const executors = this.ctx.agentConfig?.executors;
        const now = deps?.now ?? ((): number => Date.now());
        const fileSystem = deps?.fileSystem ?? createNodeFileSystem(this.ctx.cwd);
        // 0893 R2: report-only read of the usage snapshot — age/staleness are rendered,
        // never turned into an availability mutation (doctor is read-only by design).
        const usage = readUsageSnapshot(fileSystem, args.usageSnapshotPath, now);
        // R1 (0622 F2/F4 residue): a Layer-1 role (`coder`, `planner`, …) is not an
        // executor. Resolve it through the SAME ranked doctor-walk dispatch uses
        // (`resolveRole`): cheapest eligible → most expensive, checking each until
        // one is usable. Never probe the literal role name (that fabricates
        // `{usable:false}`) and never stop at the first eligible without a
        // usability check (a quota-exhausted or missing executor must fall through
        // to the next rung, exactly as dispatch would).
        if (this.ctx.rolesSource === 'fallback' && !args.json) {
            this.ctx.output.error(
                'agent.roles: no config layer defines a table — built-in DEFAULT_AGENT_ROLES fallback in effect',
            );
        }
        // R1: DoctorRunner probes iff `executor.model` is set (doctor-runner.js:75/:89),
        // so handing it a model-stripped copy suppresses probing without touching the
        // runner. renderDoctor keeps reading the UNMODIFIED config array (R2).
        // 111 R5: disabled profiles are stripped too — they get synthesized rows
        // (no install/liveness/auth probe) instead of real ones.
        const enabledExecutors = executors?.filter((e) => !executorDisabled(e));
        const runnerExecutors = args.probeHealth
            ? enabledExecutors
            : enabledExecutors?.map(({ name, agent }) => ({ name, agent }));
        const fingerprint = executorFingerprint(executors);
        let cacheInfo: DoctorCacheInfo = { hit: false, ageMs: null, path: DOCTOR_CACHE_REL };
        // Cache is active by default in production; an injected doctorRunner WITHOUT an
        // fs seam opts out (existing unit tests assert fresh stubbed runs and must not
        // see disk-cached rows), while an explicitly provided fileSystem always opts in
        // regardless of injections.
        // R7: --probe-health results are never cached and a set flag neither reads nor writes.
        // R5: --force-refresh skips the read too (re-runs and rewrites).
        const cacheOn = deps?.fileSystem !== undefined || deps?.doctorRunner === undefined;
        const serveCached =
            cacheOn && !args.probeHealth && !args.forceRefresh
                ? readFreshDoctorCache(fileSystem, fingerprint, now)
                : null;
        let doctorRunner =
            deps?.doctorRunner ?? new DoctorRunner({ env: this.ctx.env, executors: runnerExecutors, probeAuth: false });
        if (args.agent === undefined) {
            if (serveCached !== null) {
                cacheInfo = { hit: true, ageMs: serveCached.ageMs, path: DOCTOR_CACHE_REL };
                return this.renderDoctor(
                    serveCached.results,
                    executors,
                    args.json,
                    undefined,
                    cacheInfo,
                    args.enveloped,
                    usage,
                );
            }
            // The runner reads an empty executor list as "none configured" and probes every host
            // agent; a config whose executors are all disabled must probe nothing instead.
            const allDisabled = (executors?.length ?? 0) > 0 && enabledExecutors?.length === 0;
            const probeResults = allDisabled ? [] : await doctorRunner.runAll();
            const results = withDisabledRows(probeResults, executors);
            if (cacheOn && !args.probeHealth) {
                // R5: a forced refresh rewrites the file so capturedAt advances.
                const writeErr = await writeDoctorCacheFile(fileSystem, fingerprint, results, now);
                if (writeErr !== null) {
                    this.ctx.output.error(`Warning: could not update ${DOCTOR_CACHE_REL}: ${writeErr}`);
                }
            }
            return this.renderDoctor(results, executors, args.json, undefined, cacheInfo, args.enveloped, usage);
        }
        const roleDef = this.ctx.roles?.get(args.agent);
        if (roleDef !== undefined) {
            // R8: a role selector is served from a fresh, fingerprint-matching cache
            // covering every eligible executor; a miss runs what it needs and writes
            // nothing (a partial/full-but-unrequested rowset must not be persisted).
            if (serveCached !== null && roleCoveredByCache(serveCached.results, executors, roleDef.tier)) {
                cacheInfo = { hit: true, ageMs: serveCached.ageMs, path: DOCTOR_CACHE_REL };
                doctorRunner = cachedDoctorRunner(serveCached.results);
            }
            // R4: the role selector renders the FULL eligible ladder. One runAll()
            // returns every executor row; resolveRole picks the elected one via the
            // same doctor-walk dispatch uses. R8: resolveRole itself is untouched.
            const resolved = await this.resolver.resolveRole(args.agent, roleDef.tier, doctorRunner);
            // 111 R5: disabled profiles stay visible in the ladder (appended after
            // the enabled rungs) — merged into the rowset without a probe.
            const results = withDisabledRows(await doctorRunner.runAll(), executors);
            const rows = buildDoctorRows(results, executors, this.ctx.roles);
            const rowByName = new Map(rows.map((row) => [row.executor, row]));
            // Ladder rows in resolution order (cheapest eligible first); disabled
            // tier-eligible profiles are appended after the enabled rungs.
            const executorsConfigured = this.ctx.agentConfig?.executors ?? [];
            const disabledLadderRows = executorsConfigured
                .filter((e) => executorDisabled(e) && isTierEligible(getExecutorTier(e), roleDef.tier))
                .map((e) => rowByName.get(e.name))
                .filter((row): row is DoctorRow => row !== undefined);
            const ladderRows = [
                ...cheapestEligibleExecutors(executorsConfigured, roleDef.tier)
                    .map((e) => rowByName.get(e.name))
                    .filter((row): row is DoctorRow => row !== undefined),
                ...disabledLadderRows,
            ];
            if (!resolved.ok) {
                // R5: the full tried ladder renders BEFORE the failure return —
                // per-row reasons supersede resolveRole's single joined `tried:`
                // line. Text surface only: --json stays stderr-clean (machine
                // consumers parse the single error envelope, R5 0609).
                if (args.json) {
                    this.ctx.output.write(
                        toEnvelopeJson(
                            { error: { code: 'agent-resolution', message: resolved.message } },
                            {
                                enveloped: args.enveloped,
                                error: {
                                    code: 'INTERNAL_ERROR',
                                    message: resolved.message,
                                    details: { cliCode: 'agent-resolution' },
                                },
                            },
                        ),
                    );
                } else {
                    this.warnCapabilityStale(ladderRows);
                    this.ctx.output.error(renderRoleLadder(args.agent, roleDef.tier, ladderRows, undefined));
                }
                return resolved.exitCode;
            }
            const electedName = resolved.executor ?? resolved.agent;
            if (args.json) {
                // R7: agents[0] is the elected executor, then the remainder in
                // resolution order — doctor-probe.ts reads `.agents[0].agent`.
                const ordered = [
                    ...ladderRows.filter((row) => row.executor === electedName),
                    ...ladderRows.filter((row) => row.executor !== electedName),
                ];
                const entries = ordered.map((row) => {
                    const result = results.find((r) => r.agent === row.executor) as DoctorResult;
                    return {
                        ...withoutAuthenticated(result),
                        capabilityTier: row.capabilityTier,
                        model: row.model,
                        roles: row.roles,
                        elected: row.elected,
                        disabled: row.disabled,
                        // B8 R3/R5: runner-declared session capability + staleness.
                        capabilities: row.capabilities,
                        capabilityStale: row.capabilityStale,
                    };
                });
                this.ctx.output.write(
                    toEnvelopeJson(
                        { agents: entries, rolesSource: this.ctx.rolesSource ?? 'config', cache: cacheInfo },
                        { enveloped: args.enveloped },
                    ),
                );
                return 0;
            }
            this.warnCapabilityStale(ladderRows);
            this.ctx.output.write(renderRoleLadder(args.agent, roleDef.tier, ladderRows, electedName));
            this.appendCacheNote(cacheInfo, args.json);
            return 0;
        }
        // R8: single-executor selector — served from a fresh matching cache when one
        // covers the name; on a miss run only what the selector needs and write nothing.
        // 111 R6: a targeted check of a disabled profile fails (exit 1) without probing —
        // before the cache/runner paths so the disable is authoritative.
        const disabledEntry = (executors ?? []).find((e) => e.name === args.agent && executorDisabled(e));
        if (disabledEntry !== undefined) {
            this.renderDoctor(
                syntheticDisabledRows([disabledEntry]),
                executors,
                args.json,
                args.agent,
                cacheInfo,
                args.enveloped,
                usage,
            );
            return 1;
        }
        const cachedSelectorRow = serveCached?.results.find((r) => r.agent === args.agent);
        if (cachedSelectorRow !== undefined) {
            cacheInfo = { hit: true, ageMs: serveCached?.ageMs ?? null, path: DOCTOR_CACHE_REL };
            return this.renderDoctor(
                [cachedSelectorRow],
                executors,
                args.json,
                args.agent,
                cacheInfo,
                args.enveloped,
                usage,
            );
        }
        const results = [await doctorRunner.runOne(args.agent)];
        return this.renderDoctor(results, executors, args.json, args.agent, cacheInfo, args.enveloped, usage);
    }

    /** R4: a cache hit prints its age — text surfaces get a trailing line, JSON carries it structurally. */
    private appendCacheNote(cache: DoctorCacheInfo, json: boolean): void {
        if (json || !cache.hit || cache.ageMs === null) return;
        this.ctx.output.write(
            `· cached ${Math.round(cache.ageMs / 1000)}s ago (${cache.path}) — --force-refresh to re-detect`,
        );
    }

    /**
     * B8 R5: warn once per executor (one row per executor in every rowset passed
     * here) whose detected CLI version core differs from the capability record's
     * `verifiedAgainst` core (0899 R1 — branding decorations are not drift). Text
     * surfaces only — JSON carries the same fact structurally as `capabilityStale`
     * and must stay stderr-clean. 0899 R2: raw values are quoted and the
     * normalized cores are named so suffix-only differences never read as
     * adjacent duplicates.
     */
    private warnCapabilityStale(rows: readonly DoctorRow[]): void {
        for (const row of rows) {
            if (row.capabilityStale === null) continue;
            const detectedCore = versionCore(row.capabilityStale.detected) ?? 'unparseable';
            const verifiedCore = versionCore(row.capabilityStale.verifiedAgainst) ?? 'unparseable';
            this.ctx.output.error(
                `Warning: capability-declaration-stale: executor ${row.executor} (${row.agentBinary}) detects version "${row.capabilityStale.detected}" (core ${detectedCore}), but the runner record was verified against "${row.capabilityStale.verifiedAgainst}" (core ${verifiedCore}) — session capability flags may have drifted.`,
            );
        }
    }

    private renderDoctor(
        results: Awaited<ReturnType<DoctorRunner['runAll']>>,
        executors: readonly AgentExecutorConfig[] | undefined,
        json: boolean,
        agent?: string,
        cache?: DoctorCacheInfo,
        /** ADR-091 opt-in envelope decision threaded from `--json-envelope` (undefined → env). */
        enveloped?: boolean,
        /** 0893 R2: parsed usage snapshot; null → `usage: none` (the producer is optional, R3). */
        usage?: DoctorUsageInfo | null,
    ): number {
        // R6/AC5: warn (not block) when an executor's model is quota_exhausted or unavailable.
        const modelByExecutor = new Map(
            (executors ?? []).filter((e) => e.model !== undefined).map((e) => [e.name, e.model as string]),
        );
        for (const result of results) {
            if (
                result.modelStatus &&
                (result.modelStatus.status === 'quota_exhausted' || result.modelStatus.status === 'unavailable')
            ) {
                const model = modelByExecutor.get(result.agent) ?? '(unknown)';
                this.ctx.output.error(
                    `Warning: executor ${result.agent} (model ${model}) reports ${result.modelStatus.status}. Consider \`--agent <alt>\` or check token quota.`,
                );
            }
        }
        if (json) {
            // R3 (task 0487): expose the executor's *capability* tier so out-of-process
            // callers (the pipeline size precheck) can gate a large task on executor
            // strength without re-implementing the inference regex. Distinct from the
            // row's existing `tier`, which is the agent's support tier (1/2/3).
            // B4/0681 adds the routing fields the text view shows: model/roles/elected.
            const rows = buildDoctorRows(results, executors, this.ctx.roles);
            const entries = rows.map((row, i) => {
                const result = results[i] as DoctorResult;
                return {
                    ...withoutAuthenticated(result),
                    capabilityTier: row.capabilityTier,
                    model: row.model,
                    roles: row.roles,
                    elected: row.elected,
                    disabled: row.disabled,
                    // B8 R3/R5: runner-declared session capability + staleness.
                    capabilities: row.capabilities,
                    capabilityStale: row.capabilityStale,
                    // 0893 R1: the normalized availability object — owner/since/reason
                    // survive even for a bare-boolean `disabled: true` (owner `operator`).
                    availability: {
                        disabled: row.availability.disabled,
                        owner: row.availability.owner ?? null,
                        since: row.availability.since ?? null,
                        reason: row.availability.reason ?? null,
                    },
                };
            });
            const cacheField: DoctorCacheInfo = cache ?? { hit: false, ageMs: null, path: DOCTOR_CACHE_REL };
            this.ctx.output.write(
                toEnvelopeJson(
                    {
                        agents: entries,
                        rolesSource: this.ctx.rolesSource ?? 'config',
                        cache: cacheField,
                        usage: usage ?? null,
                        // 1134 R6: can fail-fast actually fire? The scheduled observation-refresh
                        // job's last run (null when it never ran).
                        inlineFailFast: {
                            refreshJob: readObservationRefreshStatus(this.ctx.cwd),
                        },
                    },
                    { enveloped },
                ),
            );
        } else {
            const rows = buildDoctorRows(results, executors, this.ctx.roles);
            this.warnCapabilityStale(rows);
            // Single-executor mode keeps the detail view; full mode renders the table.
            this.ctx.output.write(
                agent !== undefined ? renderDoctorDetail(rows[0] ?? null) : renderDoctorTable(rows, usage),
            );
            this.appendCacheNote(cache ?? { hit: false, ageMs: null, path: DOCTOR_CACHE_REL }, false);
        }
        return results.some((result) => !result.usable && result.tier === 1) ? 1 : 0;
    }
}
