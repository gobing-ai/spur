/**
 * Host-capability probe (G75 R2, task 1280; shipped as `spur agent doctor-hosts` by A94 1414).
 *
 * Reports what each host can PROVE on this machine, never what it might support: a wake value must
 * cite the probe command and the observed output that produced it, and anything unproven is
 * `pull-only` with an actionable reason. The probe reads each installed binary's `--help`; it never
 * launches a host — the guest-join E2E stays a repository fixture (`fleet-e2e --host-probe`), which
 * keeps this service inside the per-file coverage gate.
 *
 * It returns its report and the lines a transport renders; it never prints or exits.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getEnvVar } from '@gobing-ai/spur-config';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';

// ── Host capability probe (G75 R2, task 1280) ─────────────────────────────────────
//
// Reports what each host can PROVE on this machine, never what it might support: a wake value
// must cite the probe command and the observed output that produced it, and anything unproven is
// `pull-only` with an actionable reason. The default lane never launches a real host — it probes
// binaries and runs scripted fixture hosts through the durable inbox with hooks absent.

/** Where the capability report lands (the task's artifact, AC1). */

/** Hosts the probe reports on: one row each per mode. */
export const HOST_PROBE_AGENTS = ['codex', 'claude', 'pi'] as const;

/** The two modes a host is probed in; they have different wake surfaces. */
export const HOST_PROBE_MODES = ['interactive', 'headless'] as const;

/**
 * Budget for one `--version` / `--help` invocation. A diagnostic must degrade, never wait: an
 * installed binary can wedge for reasons this probe cannot see (a first-run Gatekeeper scan of a
 * 300 MB single-file release, an update check on a dead network, an uninterruptible lock). Unbounded
 * `spawnSync` let one such binary hang the whole verb — codex 0.171.0 on macOS did exactly that.
 */
export const HOST_PROBE_TIMEOUT_MS = 2500;

/** Where the capability report lands, relative to the project root. */
export const HOST_PROBE_REPORT_RELATIVE_PATH = join('docs', 'reports', 'fleet-host-capabilities.json');

/** Resolved report path for a project root (or an explicit `--out`). */
export function hostProbeReportPath(cwd: string, out?: string): string {
    return resolve(cwd, out ?? HOST_PROBE_REPORT_RELATIVE_PATH);
}

/** How a host can be woken; `pull-only` is the always-supported fallback. */
export type HostWake = 'hook' | 'rpc' | 'app-server' | 'pull-only';

/** Host mode the row describes. */
export type HostMode = (typeof HOST_PROBE_MODES)[number];

/** One host×mode capability row. */
export interface HostCapabilityRow {
    agent: string;
    mode: HostMode;
    binary: { path: string; version: string } | 'absent';
    wake: HostWake;
    evidence: { command: string; output: string } | null;
    reason?: string;
    e2e?: { status: 'passed' | 'failed'; detail: string };
}

/** The tracked capability report (AC1). */
export interface HostCapabilityReport {
    schemaVersion: 1;
    generatedAt: string;
    hosts: HostCapabilityRow[];
}

/** Redact secrets and the operator's home prefix from verbatim probe output. */
export function redactProbeOutput(text: string): string {
    const home = getEnvVar('HOME');
    return (
        text
            .replace(/(sk-|ghp_|gho_|xox[bp]-|AKIA)[A-Za-z0-9_-]{8,}/g, '[redacted]')
            // Home prefixes leak the operator identity on any POSIX machine, not just this runner's $HOME
            // (a mac-authored path survives a Linux runner whose HOME is /home/runner). Generic pattern
            // first so a longer neighbour name (/Users/robinathan) is not mangled by the $HOME split.
            .replace(/\/(?:Users|home)\/[A-Za-z0-9._-]+/g, '~')
            .split(home !== undefined && home !== '' ? home : '\u0000')
            .join('~')
    );
}

/**
 * Classify a host's wake channel from its installed `--help` surface. Headless mode never has a
 * host callback channel, so it is `pull-only` regardless of what the binary advertises.
 */
export function classifyHostWake(input: { mode: HostMode; helpText: string }): {
    wake: HostWake;
    reason?: string;
} {
    if (input.mode === 'headless') {
        return {
            wake: 'pull-only',
            reason: 'headless mode has no host callback channel — the durable inbox pull loop is the delivery path',
        };
    }
    const text = input.helpText.toLowerCase();
    // Precedence is specificity, not wording: a host that exposes a long-lived server endpoint can
    // be woken by a connection, which is a stronger channel than a flag that merely names hooks
    // (Codex advertises `--dangerously-bypass-hook-trust` while its wake channel is the App Server).
    if (/app[- ]server/.test(text)) return { wake: 'app-server' };
    if (/\bhooks?\b/.test(text)) return { wake: 'hook' };
    if (/\brpc\b/.test(text)) return { wake: 'rpc' };
    return {
        wake: 'pull-only',
        reason: 'installed help text names no hook, RPC or App Server surface',
    };
}

/**
 * Build one row. Two invariants live here rather than in prose: an absent binary can never claim a
 * wake channel, and a non-`pull-only` wake without recorded evidence is downgraded — an unprovable
 * capability is not a capability (R3).
 */
export function buildHostRow(input: {
    agent: string;
    mode: HostMode;
    binary: { path: string; version: string } | null;
    helpText: string;
    evidence: { command: string; output: string } | null;
    e2e?: { status: 'passed' | 'failed'; detail: string };
    /** Why the binary could not be probed (a deadline, not a missing surface) — overrides classification. */
    probeFailure?: string;
}): HostCapabilityRow {
    const e2e = input.e2e === undefined ? {} : { e2e: input.e2e };
    if (input.binary === null) {
        return {
            agent: input.agent,
            mode: input.mode,
            binary: 'absent',
            wake: 'pull-only',
            evidence: null,
            reason: `${input.agent} is not installed on PATH — pull-only until the binary is present`,
            ...e2e,
        };
    }
    const binary = { path: redactProbeOutput(input.binary.path), version: redactProbeOutput(input.binary.version) };
    if (input.probeFailure !== undefined) {
        return {
            agent: input.agent,
            mode: input.mode,
            binary,
            wake: 'pull-only',
            evidence: null,
            reason: input.probeFailure,
            ...e2e,
        };
    }
    const classified = classifyHostWake({ mode: input.mode, helpText: input.helpText });
    const evidence =
        input.evidence === null
            ? null
            : { command: redactProbeOutput(input.evidence.command), output: redactProbeOutput(input.evidence.output) };
    if (classified.wake !== 'pull-only' && evidence === null) {
        return {
            agent: input.agent,
            mode: input.mode,
            binary,
            wake: 'pull-only',
            evidence: null,
            reason: `help text suggests ${classified.wake} but no probe evidence was recorded — unproven, so pull-only`,
            ...e2e,
        };
    }
    return {
        agent: input.agent,
        mode: input.mode,
        binary,
        wake: classified.wake,
        evidence,
        ...(classified.reason === undefined ? {} : { reason: classified.reason }),
        ...e2e,
    };
}

/** Contract check over the whole report; returns the violations, empty when it holds. */
export function hostReportViolations(report: HostCapabilityReport): string[] {
    const violations: string[] = [];
    if (report.schemaVersion !== 1) violations.push('schemaVersion must be 1');
    const seen = new Set<string>();
    for (const row of report.hosts) {
        const key = `${row.agent}:${row.mode}`;
        if (seen.has(key)) violations.push(`duplicate row for ${key}`);
        seen.add(key);
        if (!(HOST_PROBE_AGENTS as readonly string[]).includes(row.agent))
            violations.push(`unknown agent "${row.agent}"`);
        if (!(HOST_PROBE_MODES as readonly string[]).includes(row.mode)) violations.push(`unknown mode "${row.mode}"`);
        if (row.wake !== 'pull-only' && row.evidence === null) {
            violations.push(`${key}: wake "${row.wake}" cites no probe evidence`);
        }
        if (row.binary === 'absent' && row.wake !== 'pull-only') {
            violations.push(`${key}: absent binary cannot advertise wake "${row.wake}"`);
        }
        if (row.binary === 'absent' && row.evidence !== null) {
            violations.push(`${key}: absent binary carries evidence`);
        }
        if (row.wake === 'pull-only' && row.binary !== 'absent' && row.reason === undefined) {
            violations.push(`${key}: pull-only needs an actionable reason`);
        }
    }
    for (const agent of HOST_PROBE_AGENTS) {
        for (const mode of HOST_PROBE_MODES) {
            if (!seen.has(`${agent}:${mode}`)) violations.push(`missing row for ${agent}:${mode}`);
        }
    }
    return violations;
}

/** Collapse whitespace and clamp, so one evidence line stays one line. */
function trimmed(text: string, max = 400): string {
    const flat = text.trim().replace(/\s+/g, ' ');
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** One-line error text for a probe failure detail. */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Run one host binary within its budget; a missing, failing or wedged binary reports as empty output. */
export async function runHostBinary(
    path: string,
    args: string[],
    timeoutMs = HOST_PROBE_TIMEOUT_MS,
): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
    try {
        const proc = await new NodeProcessExecutor({ defaultTimeout: timeoutMs }).run({ command: path, args });
        const stdout = proc.stdout ?? '';
        const stderr = proc.stderr ?? '';
        // Full text: the capability line can sit anywhere in a 200-line `--help`. The REPORT
        // records only the matched line, so this is not a size risk in the artifact.
        return { exitCode: proc.exitCode ?? 1, output: `${stdout}\n${stderr}`, timedOut: proc.outcome === 'timeout' };
    } catch (error) {
        return { exitCode: 1, output: trimmed(errorMessage(error), 200), timedOut: false };
    }
}

/**
 * The `--help` line that proves a wake channel, or null. The report cites this one line — the
 * observation a reader can re-run — instead of a truncated help dump.
 */
export function wakeEvidenceLine(helpText: string, wake: HostWake): string | null {
    const pattern =
        wake === 'hook' ? /\bhooks?\b/i : wake === 'rpc' ? /\brpc\b/i : wake === 'app-server' ? /app[- ]server/i : null;
    if (pattern === null) return null;
    const matches = helpText.split('\n').filter((line) => pattern.test(line));
    // Prefer a line that documents the surface over one that disables or bypasses it — `--bare
    // Minimal mode: skip hooks` proves hooks exist but says nothing about a wake channel.
    const positive = matches.find((line) => !/skip|bypass|disable|without|no-?hooks/i.test(line));
    const chosen = positive ?? matches[0];
    return chosen === undefined ? null : trimmed(chosen, 300);
}

/** One installed binary as the probe saw it: path, version line, help text, and any deadline failure. */
interface HostBinaryProbe {
    binary: { path: string; version: string } | null;
    helpText: string;
    helpCommand: string;
    failure?: string;
}

/** Probe one installed binary: path, version line, and the help text the wake class comes from. */
async function probeHostBinary(agent: string, which: (agent: string) => string | null): Promise<HostBinaryProbe> {
    const path = which(agent);
    if (path === null) return { binary: null, helpText: '', helpCommand: `${agent} --help` };
    const [version, help] = await Promise.all([runHostBinary(path, ['--version']), runHostBinary(path, ['--help'])]);
    const versionLine = version.output.split('\n')[0]?.trim() ?? '';
    return {
        binary: { path, version: versionLine === '' ? 'unknown' : versionLine },
        helpText: help.exitCode === 0 ? help.output : '',
        helpCommand: `${agent} --help`,
        // A wedged binary outweighs any classification: say why the row is unproven, not that its
        // (empty) help text names no channel.
        ...(help.timedOut
            ? { failure: `${agent} --help did not answer within ${HOST_PROBE_TIMEOUT_MS}ms — pull-only until it does` }
            : {}),
    };
}

/** Evidence for one host×mode row: the matched help line, or null when nothing proves a channel. */
function probeEvidence(probe: HostBinaryProbe, mode: HostMode): { command: string; output: string } | null {
    const { wake } = classifyHostWake({ mode, helpText: probe.helpText });
    const line = wakeEvidenceLine(probe.helpText, wake);
    return line === null ? null : { command: probe.helpCommand, output: line };
}

/** What one probe run produced. */
export interface HostProbeOutcome {
    ok: boolean;
    /** True when the request itself was rejected (unknown agent) — the transport exits 2. */
    usage: boolean;
    report: HostCapabilityReport | null;
    reportPath: string;
    /** Rendered report lines; the transport prints them. */
    lines: string[];
}

/** Options for {@link runHostProbe}. */
export interface HostProbeOptions {
    /** Project root: the report resolves against it. */
    cwd: string;
    /** Agents to probe (default {@link HOST_PROBE_AGENTS}). */
    agents?: readonly string[];
    /** Report destination relative to `cwd` (default `docs/reports/fleet-host-capabilities.json`). */
    out?: string;
    /**
     * Binary resolution seam (default {@link Bun.which}).
     *
     * WHY: Bun caches the probe's PATH at process start, so a test cannot point `Bun.which` at
     * fixture hosts by reassigning `process.env.PATH`. Without this seam the installed-binary
     * branch is covered only on machines that happen to have codex/claude/pi, and the per-file
     * coverage gate flips red as soon as the last one leaves CI's PATH.
     */
    which?: (agent: string) => string | null;
}

/**
 * Probe the requested hosts' binaries, classify what they prove, and write the report.
 *
 * No host is launched: every row is derived from the binary's version and `--help` text. The
 * guest-join E2E that used to run here lives in the repository's `fleet-e2e --host-probe` fixture.
 */
export async function runHostProbe(options: HostProbeOptions): Promise<HostProbeOutcome> {
    const { cwd } = options;
    const which = options.which ?? ((agent: string) => Bun.which(agent));
    const reportPath = hostProbeReportPath(cwd, options.out);
    const requested = [...(options.agents ?? HOST_PROBE_AGENTS)];
    const unknown = requested.filter((agent) => !(HOST_PROBE_AGENTS as readonly string[]).includes(agent));
    if (unknown.length > 0) {
        return {
            ok: false,
            usage: true,
            report: null,
            reportPath,
            lines: [`unknown agents: ${unknown.join(', ')} (known: ${HOST_PROBE_AGENTS.join(', ')})`],
        };
    }
    const rows: HostCapabilityRow[] = [];
    for (const agent of HOST_PROBE_AGENTS) {
        const probe = await probeHostBinary(agent, which);
        for (const mode of HOST_PROBE_MODES) {
            rows.push(
                buildHostRow({
                    agent,
                    mode,
                    binary: probe.binary,
                    helpText: probe.helpText,
                    evidence: probeEvidence(probe, mode),
                    ...(probe.failure === undefined ? {} : { probeFailure: probe.failure }),
                }),
            );
        }
    }
    const report: HostCapabilityReport = { schemaVersion: 1, generatedAt: new Date().toISOString(), hosts: rows };
    const violations = hostReportViolations(report);
    if (violations.length > 0) {
        return {
            ok: false,
            usage: false,
            report,
            reportPath,
            lines: [`host report violates its contract: ${violations.join('; ')}`],
        };
    }
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 4)}\n`);
    const lines = [`host-probe: ${reportPath}`];
    for (const row of report.hosts) {
        const binary = row.binary === 'absent' ? 'absent' : row.binary.version;
        lines.push(`  ${row.agent}/${row.mode}: wake=${row.wake} binary=${trimmed(binary, 40)}`);
    }
    return { ok: true, usage: false, report, reportPath, lines };
}
