import { createHash } from 'node:crypto';
import { type ExecutorAvailability, normalizeExecutorAvailability } from '@gobing-ai/spur-config';
import { type CapabilityTier, isTierEligible } from '@gobing-ai/spur-domain';
import {
    type DoctorResult,
    type DoctorRunner,
    getAgentSessionCapability,
    type ModelHealthResult,
    resolveAgentName,
} from '@gobing-ai/ts-ai-runner';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { AgentRoleDefinition } from './agent-service';
import {
    type AgentExecutorConfig,
    cheapestEligibleExecutors,
    executorDisabled,
    getExecutorTier,
} from './executor-tier';

// --- Detection cache (B4/0683) ----------------------------------------------

export const DOCTOR_CACHE_REL = '.spur/run/agent-doctor.json';

const DOCTOR_CACHE_TTL_MS = 60_000;

/**
 * 0893 R2: a usage snapshot older than this renders `stale`. A constant because
 * nothing in the design varies it; promote to config only when a second consumer
 * needs a different threshold.
 */
const USAGE_SNAPSHOT_STALE_MS = 6 * 60 * 60 * 1000;

/** Parsed usage-snapshot view for doctor (0893 R2). Null when the snapshot is absent or unusable. */
export interface DoctorUsageInfo {
    /** RFC 3339 `captured_at` from the snapshot. */
    capturedAt: string;
    /** Milliseconds between capture and the doctor run's clock. */
    age: number;
    /** True when {@link age} reached {@link USAGE_SNAPSHOT_STALE_MS} (6 h). */
    stale: boolean;
}

/** Detection-cache provenance reported by `agent doctor` (hit, age, cache path). */
export interface DoctorCacheInfo {
    hit: boolean;
    ageMs: number | null;
    path: string;
}

interface DoctorCacheFile {
    schemaVersion: 1;
    fingerprint: string;
    capturedAt: string;
    results: DoctorResult[];
}

/**
 * Executor-set identity (R3): name-ascending `name|agent|model?|tier|disabled` lines hashed
 * with sha256. Sorting makes the key independent of config ordering; including tier
 * invalidates when inference changes; including the disabled flag (111 R5) invalidates
 * cached eligibility when an operator flips the kill-switch. Exported for direct unit pins.
 *
 * Stable fingerprint of the executor roster for the doctor cache; classifies
 * availability via {@link executorDisabled} so a quota disable invalidates the
 * cached roster instead of rendering as 'enabled' (0890 review remediation).
 */
export function executorFingerprint(executors: readonly AgentExecutorConfig[] | undefined): string {
    const lines = [...(executors ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
            (e) =>
                `${e.name}|${e.agent}|${e.model ?? ''}|${getExecutorTier(e)}|${executorDisabled(e) ? 'disabled' : 'enabled'}`,
        );
    return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Read the agent-usage snapshot for doctor (0893 R2). Absent or malformed → null
 * (R3: the producer is optional, so a missing snapshot is a silent `none`, never
 * a warning). Doctor only REPORTS the snapshot — it never derives an enable from
 * it (read-only, docs/design/session-pinned-dispatch.md §3.5).
 */
export function readUsageSnapshot(
    fileSystem: FileSystem,
    path: string | undefined,
    now: () => number,
): DoctorUsageInfo | null {
    if (path === undefined) return null;
    try {
        if (fileSystem.exists(path) !== true) return null;
        const parsed = JSON.parse(fileSystem.readFile(path) as string) as { captured_at?: unknown } | null;
        if (parsed === null || typeof parsed !== 'object' || typeof parsed.captured_at !== 'string') return null;
        const capturedMs = Date.parse(parsed.captured_at);
        if (!Number.isFinite(capturedMs)) return null;
        const age = Math.max(0, now() - capturedMs);
        return { capturedAt: parsed.captured_at, age, stale: age >= USAGE_SNAPSHOT_STALE_MS };
    } catch {
        return null;
    }
}

/** Fresh doctor-cache rows for `fingerprint`. Any read failure, malformed payload, wrong schema/fingerprint, or expired entry → miss (R6). */
export function readFreshDoctorCache(
    fileSystem: FileSystem,
    fingerprint: string,
    now: () => number,
): { results: DoctorResult[]; ageMs: number } | null {
    try {
        const path = fileSystem.resolve(DOCTOR_CACHE_REL);
        if (fileSystem.exists(path) !== true) return null;
        const parsed = JSON.parse(fileSystem.readFile(path) as string) as DoctorCacheFile;
        if (
            parsed === null ||
            typeof parsed !== 'object' ||
            parsed.schemaVersion !== 1 ||
            typeof parsed.fingerprint !== 'string' ||
            typeof parsed.capturedAt !== 'string' ||
            !Array.isArray(parsed.results)
        ) {
            return null;
        }
        if (parsed.fingerprint !== fingerprint) return null;
        const ageMs = now() - Date.parse(parsed.capturedAt);
        if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= DOCTOR_CACHE_TTL_MS) return null;
        return { results: parsed.results, ageMs };
    } catch {
        return null;
    }
}

/** Atomic write (temp + rename); returns an error note on failure — never throws out of the cache layer (R6). */
export async function writeDoctorCacheFile(
    fileSystem: FileSystem,
    fingerprint: string,
    results: readonly DoctorResult[],
    now: () => number,
): Promise<string | null> {
    try {
        const path = fileSystem.resolve(DOCTOR_CACHE_REL);
        const tmp = `${path}.tmp`;
        const body: DoctorCacheFile = {
            schemaVersion: 1,
            fingerprint,
            capturedAt: new Date(now()).toISOString(),
            results: [...results],
        };
        await fileSystem.writeFile(tmp, JSON.stringify(body));
        await fileSystem.rename(tmp, path);
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

/** A role selector is served only when every eligible executor has a cached row (R8). */
export function roleCoveredByCache(
    results: readonly DoctorResult[],
    executors: readonly AgentExecutorConfig[] | undefined,
    tier: CapabilityTier,
): boolean {
    const needed = cheapestEligibleExecutors(executors ?? [], tier).map((e) => e.name);
    return needed.every((name) => results.some((r) => r.agent === name));
}

/** Wraps cached rows in the DoctorRunner surface resolveRole/runAll consume — no probe, no write. */
export function cachedDoctorRunner(results: DoctorResult[]): DoctorRunner {
    const runAll = (): Promise<DoctorResult[]> => Promise.resolve([...results]);
    const runOne = (agent: string): Promise<DoctorResult> => {
        const row = results.find((r) => r.agent === agent);
        return Promise.resolve(
            row ??
                ({
                    agent,
                    usable: false,
                    tier: 3 as DoctorResult['tier'],
                    error: 'not covered by cache',
                } as DoctorResult),
        );
    };
    // SAFETY: runAll/runOne satisfy DoctorRunner structurally; row shape is
    // validated by the doctor cache builder, not expressible as a nominal type.
    return { runAll, runOne } as unknown as DoctorRunner;
}

/** Display row: DoctorResult joined with its executor config and role eligibility (B4/0681). */
export type DoctorRow = {
    /** Executor name — the cell always held this; the old column header said AGENT. */
    executor: string;
    /** Underlying binary from AgentExecutorConfig.agent; falls back to the row name. */
    agentBinary: string;
    usable: boolean;
    /** Support tier (1/2) — backs the exit code only; never rendered as TIER. */
    tier: number;
    capabilityTier: CapabilityTier;
    /** Pinned config model string; null when undeclared (never fabricated). */
    model: string | null;
    /** Tier-eligible role ids, usability-independent. */
    roles: string[];
    /** Role ids this executor is elected for (requires usable). */
    elected: string[];
    version: string | null;
    /** Probe error when unavailable — the ladder's per-row reason. */
    error: string | null;
    modelStatus?: ModelHealthResult | null;
    /** 111 R5: profile disabled by config — inventoried, never probed or elected. */
    disabled: boolean;
    /** B8 R3: runner-declared session capability for the row's agent binary; null when the binary is unknown to the runner. */
    capabilities: {
        supportsResumeById: boolean;
        supportsSessionDir: boolean;
        supportsPersistentStdin: boolean;
        supportsStructuredOutput: boolean;
        verifiedAgainst: string;
        note?: string;
    } | null;
    /** B8 R5: detected CLI version differs from the record's `verifiedAgainst`; null when fresh or unverifiable. */
    capabilityStale: { verifiedAgainst: string; detected: string } | null;
    /** 0893 R1: normalized availability ownership — the only shape rendering may read. */
    availability: ExecutorAvailability;
};

/**
 * Join raw doctor results with executor configs and the role table: eligibility
 * is a pure tier function computed regardless of usability; election walks
 * `cheapestEligibleExecutors` (the dispatch order) per role and takes the first
 * usable row. No extra probe is spawned — everything derives from the rows.
 */
export function buildDoctorRows(
    results: readonly DoctorResult[],
    executors: readonly AgentExecutorConfig[] | undefined,
    roles: ReadonlyMap<string, AgentRoleDefinition> | undefined,
): DoctorRow[] {
    const executorByName = new Map((executors ?? []).map((e) => [e.name, e]));
    const joined = results.map((result) => {
        // No matching executor entry (a bare binary, or no `agent.executors`
        // block) keeps the name-based inference rather than an absent tier.
        // Bare binaries are always enabled (no config profile to disable, 111).
        const executor = executorByName.get(result.agent) ?? {
            name: result.agent,
            agent: result.agent,
            disabled: false,
        };
        return {
            result,
            capabilityTier: getExecutorTier(executor),
            model: executor.model ?? (null as string | null),
            availability: normalizeExecutorAvailability(executor.disabled),
        };
    });
    // Election: roleId -> winning executor name. Usable lookup across all rows
    // so a role elects exactly one star carrier (no star when none usable).
    const usableByName = new Set(joined.filter((j) => j.result.usable).map((j) => j.result.agent));
    const elections = new Map<string, string>();
    if (roles !== undefined && executors !== undefined && executors.length > 0) {
        for (const [roleId, roleDef] of roles) {
            const winner = cheapestEligibleExecutors(executors, roleDef.tier).find((e) => usableByName.has(e.name));
            if (winner !== undefined) elections.set(roleId, winner.name);
        }
    }
    return joined.map(({ result, capabilityTier, model, availability }) => ({
        executor: result.agent,
        agentBinary: executorByName.get(result.agent)?.agent ?? result.agent,
        usable: result.usable,
        tier: result.tier,
        capabilityTier,
        model,
        disabled: executorDisabled(executorByName.get(result.agent)),
        availability,
        roles: roles ? [...roles].filter(([, rd]) => isTierEligible(capabilityTier, rd.tier)).map(([id]) => id) : [],
        elected: [...elections].filter(([, executorName]) => executorName === result.agent).map(([id]) => id),
        version: result.version,
        error: result.error,
        modelStatus: result.modelStatus,
        // B8 R3/R5: read (never re-declare) the runner's capability record for the
        // row's canonical agent binary; compare the detected version's extracted
        // core against `verifiedAgainst` (0899 R1 — branding is not drift).
        ...sessionCapabilityFor(result.version, executorByName.get(result.agent)?.agent ?? result.agent),
    }));
}

/**
 * 0899 R1: first semver-shaped token in a CLI version string; null when none.
 * Detected versions carry branding/build decorations (`2.1.274 (Claude Code)`,
 * `codex-cli 0.154.0`, `omp/18.2.3`, `OpenClaw 2026.6.11 (e085fa1)`); the record's
 * `verifiedAgainst` is the bare core, so staleness compares cores, not raw strings.
 */
export function versionCore(raw: string): string | null {
    const match = /\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/.exec(raw);
    return match === null ? null : match[0];
}

/** B8 R3/R5: capability record + staleness for a doctor row's agent binary. */
function sessionCapabilityFor(
    detectedVersion: string | null,
    agentBinary: string,
): Pick<DoctorRow, 'capabilities' | 'capabilityStale'> {
    const canonical = resolveAgentName(agentBinary);
    if (canonical === undefined) return { capabilities: null, capabilityStale: null };
    const capabilities = getAgentSessionCapability(canonical);
    // 0899 R1/R2: normalize-then-compare — branding suffix/prefix is not drift. No
    // extractable core on either side (e.g. record `unverified (CLI not installed)`)
    // is unverifiable, not stale: null, no warning (0899 R2).
    const detectedCore = detectedVersion === null ? null : versionCore(detectedVersion);
    const verifiedCore = versionCore(capabilities.verifiedAgainst);
    const stale =
        detectedVersion !== null && detectedCore !== null && verifiedCore !== null && detectedCore !== verifiedCore;
    const capabilityStale = stale ? { verifiedAgainst: capabilities.verifiedAgainst, detected: detectedVersion } : null;
    return { capabilities, capabilityStale };
}

/** ROLES cell: `—` when the executor can serve no role (or is unusable), starred ids otherwise. */
function renderRolesCell(row: DoctorRow): string {
    if (!row.usable || row.roles.length === 0) return '—';
    return row.roles.map((id) => (row.elected.includes(id) ? `${id}*` : id)).join(',');
}

/** 0893 R2: compact human age for the doctor table footer — minutes below an hour, hours above. */
function formatUsageAge(ageMs: number): string {
    if (ageMs < 60_000) return '<1m';
    if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m`;
    return `${Math.floor(ageMs / 3_600_000)}h`;
}

/**
 * 111 R5: a disabled profile is inventoried without any probe — the row is
 * synthesized (never run through install/liveness/auth checks) with usable
 * false so it can never be elected. Tier 2 keeps the support-tier exit-code
 * aggregation from reading an intentional disable as a health failure (R6).
 */
export function syntheticDisabledRows(executors: readonly AgentExecutorConfig[] | undefined): DoctorResult[] {
    return (executors ?? []).filter(executorDisabled).map((e) => ({
        agent: e.name,
        installed: false,
        version: null,
        authenticated: 'unknown' as const,
        usable: false,
        tier: 2 as const,
        channels: [],
        error: `disabled by config (agent.executors.${e.name}.disabled)`,
    }));
}

/** Append synthesized disabled rows that the probe/cached rowset does not already carry. */
export function withDisabledRows(
    probeResults: DoctorResult[],
    executors: readonly AgentExecutorConfig[] | undefined,
): DoctorResult[] {
    const have = new Set(probeResults.map((r) => r.agent));
    return [...probeResults, ...syntheticDisabledRows(executors).filter((r) => !have.has(r.agent))];
}

/**
 * B4/0682 R2: `authenticated` is a probe-only signal the surface no longer
 * carries — strip it explicitly from every `--json` spread so it cannot leak.
 */
export function withoutAuthenticated<T extends { authenticated?: unknown }>(row: T): Omit<T, 'authenticated'> {
    const { authenticated: _drop, ...rest } = row;
    void _drop;
    return rest;
}

/** CAPS cell flags: `r`esume/`d`ir/`s`tdin/`o`utput with ✓/✗; `—` when the binary is unknown to the runner. */
function renderCapsFlags(row: DoctorRow): string {
    if (row.capabilities === null) return '—';
    const caps = row.capabilities;
    return `r${caps.supportsResumeById ? '✓' : '✗'}d${caps.supportsSessionDir ? '✓' : '✗'}s${caps.supportsPersistentStdin ? '✓' : '✗'}o${caps.supportsStructuredOutput ? '✓' : '✗'}`;
}

function renderCapsCell(row: DoctorRow): string {
    return row.capabilityStale !== null && row.capabilities !== null
        ? `${renderCapsFlags(row)}⚠`
        : renderCapsFlags(row);
}

/** Render the `spur agent doctor` text output as an aligned table with a header,
 * a ✓/✗ state glyph, and a usage summary footer. `--json` output is unaffected
 * and keeps no auth field at all (0621 removed the column; 0682 dropped `authenticated`).
 * Columns (B4/0681): EXECUTOR holds the executor name, AGENT the underlying
 * binary, MODEL the pinned config model (`—` when undeclared), TIER the
 * capability tier, ROLES the eligible roles with `*` marking election. B8 R3:
 * CAPS renders the runner-declared session capability (`r`esume/`d`ir/`s`tdin/
 * `o`utput, ✓/✗), `—` when the binary is unknown to the runner, `⚠` appended
 * when the detected version is stale against `verifiedAgainst` (B8 R5).
 */
export function renderDoctorTable(results: DoctorRow[], usage?: DoctorUsageInfo | null): string {
    const dash = '—';
    const rows = results.map((result) => {
        const usable = result.usable;
        const availability = result.availability;
        return {
            glyph: usable ? '✓' : '✗',
            state: result.disabled ? 'disabled' : usable ? 'usable' : 'missing',
            executor: result.executor,
            agentBinary: result.agentBinary,
            model: result.model ?? dash,
            tier: String(result.capabilityTier),
            version: result.version ?? dash,
            caps: renderCapsCell(result),
            roles: renderRolesCell(result),
            // 0893 R1: ownership provenance renders on disabled rows only.
            owner: availability.disabled ? (availability.owner ?? dash) : dash,
            since: availability.disabled ? (availability.since ?? dash) : dash,
            reason: availability.disabled ? (availability.reason ?? dash) : dash,
        };
    });

    const header = {
        glyph: ' ',
        state: 'STATUS',
        executor: 'EXECUTOR',
        agentBinary: 'AGENT',
        model: 'MODEL',
        tier: 'TIER',
        version: 'VERSION',
        caps: 'CAPS',
        roles: 'ROLES',
        owner: 'OWNER',
        since: 'SINCE',
        reason: 'REASON',
    };
    const all = [header, ...rows];
    const width = (key: keyof typeof header) => Math.max(...all.map((row) => row[key].length));
    const wState = width('state');
    const wExecutor = width('executor');
    const wAgent = width('agentBinary');
    const wModel = width('model');
    const wTier = width('tier');
    const wVersion = width('version');
    const wCaps = width('caps');
    const wOwner = width('owner');
    const wSince = width('since');

    const line = (row: (typeof all)[number]) =>
        `${row.glyph} ${row.state.padEnd(wState)}  ${row.executor.padEnd(wExecutor)}  ${row.agentBinary.padEnd(wAgent)}  ${row.model.padEnd(wModel)}  ${row.tier.padEnd(wTier)}  ${row.version.padEnd(wVersion)}  ${row.caps.padEnd(wCaps)}  ${row.roles}  ${row.owner.padEnd(wOwner)}  ${row.since.padEnd(wSince)}  ${row.reason}`.trimEnd();

    const usableCount = rows.filter((row) => row.state === 'usable').length;
    // 111 R6: intentional disables are reported separately, not folded into the
    // missing/health-failure count — a healthy enabled fleet still prints a
    // plain success footer and exits 0.
    const disabledCount = rows.filter((row) => row.state === 'disabled').length;
    const missing = rows.length - usableCount - disabledCount;
    const usableFooter =
        disabledCount > 0
            ? `${usableCount} usable, ${missing} missing, ${disabledCount} disabled`
            : `${usableCount} usable, ${missing} missing`;
    const footerLines = [
        usableFooter,
        // 0893 R2/R3: snapshot provenance is always reported; a missing producer
        // snapshot is a plain `usage: none`, never a warning.
        `usage: ${usage === null || usage === undefined ? 'none' : `${usage.capturedAt} (${usage.stale ? 'stale' : formatUsageAge(usage.age)})`}`,
        ...(results.some((result) => result.elected.length > 0) ? ['(* = elected executor for that role)'] : []),
    ];

    return [line(header), ...rows.map(line), '', ...footerLines].join('\n');
}

/**
 * Render a role selector's full eligible ladder in resolution order
 * (`cheapestEligibleExecutors`): elected executor marked, per-row reason on
 * each non-usable entry, summary line reporting eligible/usable/elected.
 */
export function renderRoleLadder(
    role: string,
    roleTier: CapabilityTier,
    ladder: readonly DoctorRow[],
    electedExecutor: string | undefined,
): string {
    const lines = [`${role} (min tier ${roleTier}) — eligible ladder`, ''];
    if (ladder.length === 0) {
        lines.push('(no eligible executor)', '');
    }
    const wName = Math.max(...ladder.map((row) => row.executor.length));
    for (const row of ladder) {
        const glyph = row.usable ? '✓' : '✗';
        const status = row.disabled ? 'disabled' : row.usable ? 'usable' : 'missing';
        const note =
            row.executor === electedExecutor
                ? 'ELECTED'
                : row.disabled
                  ? 'disabled by config'
                  : row.usable
                    ? 'eligible'
                    : (row.error ?? 'not installed');
        lines.push(`${glyph} ${row.executor.padEnd(wName)}  ${status}${note.length > 0 ? `  ${note}` : ''}`);
    }
    const usableCount = ladder.filter((row) => row.usable).length;
    // 111 R5: disabled rows render appended for visibility but are not eligible.
    const eligibleCount = ladder.filter((row) => !row.disabled).length;
    lines.push('', `${eligibleCount} eligible, ${usableCount} usable, elected: ${electedExecutor ?? 'none'}`);
    return lines.join('\n');
}

/**
 * Render a single doctor result in detail mode — used when `spur agent doctor <name>`
 * is invoked for a specific executor. Shows the full model health status with
 * endpoint and detail fields, not just the compact table column.
 */
export function renderDoctorDetail(result: DoctorRow | null): string {
    if (result === null) return 'No result.';
    const lines: string[] = [];
    const glyph = result.usable ? '✓' : '✗';
    lines.push(`${glyph} ${result.executor}  (${result.capabilityTier})`);
    lines.push(`  agent:      ${result.agentBinary}`);
    lines.push(`  status:     ${result.disabled ? 'disabled by config' : result.usable ? 'usable' : 'missing'}`);
    lines.push(`  version:    ${result.version ?? '—'}`);
    // Pinned config model — distinct from the probed model health below.
    lines.push(`  pinned:     ${result.model ?? '—'}`);
    // B8 R3/R5: runner-declared session capability with provenance, plus a
    // staleness note when the detected CLI version drifted from the record.
    if (result.capabilities === null) {
        lines.push('  caps:       — (binary unknown to the runner; session capabilities unattested)');
    } else {
        const caps = result.capabilities;
        lines.push(`  caps:       ${renderCapsFlags(result)}`);
        lines.push(`  verified:   ${caps.verifiedAgainst}${caps.note !== undefined ? ` — ${caps.note}` : ''}`);
    }
    if (result.capabilityStale !== null) {
        lines.push(
            `  stale:      capability-declaration-stale — detects ${result.capabilityStale.detected}, record verified against ${result.capabilityStale.verifiedAgainst} (capability flags may have drifted)`,
        );
    }
    if (result.modelStatus) {
        lines.push(`  health:     ${result.modelStatus.status}`);
        lines.push(`  checked:    ${result.modelStatus.checkedAt}`);
        if (result.modelStatus.detail) {
            lines.push(`  detail:     ${result.modelStatus.detail}`);
        }
    }
    return lines.join('\n');
}
