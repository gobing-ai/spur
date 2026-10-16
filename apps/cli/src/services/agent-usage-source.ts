/**
 * Spawn-capable codexbar usage source + default snapshot location for the
 * `spur agent usage` command (B6 0892 R5). Lives in the CLI layer because
 * `packages/app` forbids process spawn and direct environment reads; the
 * producer receives both via dependency injection (0892 boundary remediation).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type UsageCapture, type UsageSource, UsageSourceError } from '@gobing-ai/spur-app';
import { getEnvVars } from '@gobing-ai/spur-config';
import { NodeProcessExecutor, type ProcessExecutor } from '@gobing-ai/ts-runtime';

/**
 * Default argv for the codexbar capture (machine-readable, operator-enabled
 * provider set). Deliberately NOT `--provider all` (2026-10-16): an all-provider
 * sweep fans out over every provider configured in CodexBar — 106 on this box,
 * 89 of them uncredentialed — and its wall time is the slowest of all of them.
 * Measured on the same host and hour: 6 s for the enabled set against 16-190 s
 * for `--provider all` across 140 scheduled runs (2026-10-13 -> 16), where 4
 * crossed the capture deadline and failed the job closed. Which providers are
 * enabled is codexbar's own operator setting, so this keeps the credential and
 * endpoint ownership boundary in the operator's hands; a provider that is
 * absent from the capture carries no observation and can never imply recovery
 * (0907), so the narrowing is fail-safe rather than fail-open.
 */
const CODEXBAR_ARGV = ['codexbar', 'usage', '--format', 'json'];

/**
 * Capture deadline (0908 R1). Raised from 180_000 on 2026-10-16, when the first
 * real distribution existed: 140 scheduled runs (2026-10-13 -> 16) measured
 * min 15 s / p50 51 s / p95 142 s / max 191 s, and 4 runs crossed 180 s and
 * failed closed. The original limit was headroom over a single ~113 s sample
 * (I31/0904), not a percentile, so it sat below p99. Operators trade latency
 * against a hang with {@link CAPTURE_TIMEOUT_ENV} instead of a rebuild.
 */
export const DEFAULT_CAPTURE_TIMEOUT_MS = 300_000;

/** Operator override for the capture deadline, in milliseconds (0908 R1 keeps this out of the CLI surface). */
export const CAPTURE_TIMEOUT_ENV = 'SPUR_AGENT_USAGE_TIMEOUT_MS';

/**
 * Resolve the capture deadline from an injected env: a positive whole number of
 * milliseconds is honored, anything else (missing, empty, non-numeric, zero,
 * negative, fractional, or beyond the timer range) falls back to the default so
 * a bad override cannot disable the deadline or crash the spawn.
 */
export function resolveCaptureTimeoutMs(env: Record<string, string | undefined> = getEnvVars()): number {
    const raw = env[CAPTURE_TIMEOUT_ENV];
    if (raw === undefined || raw.trim() === '') return DEFAULT_CAPTURE_TIMEOUT_MS;
    const parsed = Number(raw);
    const usable = Number.isInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647;
    return usable ? parsed : DEFAULT_CAPTURE_TIMEOUT_MS;
}

/**
 * Codexbar `UsageSource` implementation (B6 0892 R5): runs
 * `codexbar usage --format json` and returns the raw capture. `command` is
 * injectable so tests can exercise the missing-binary path without mocking
 * process internals; `timeoutMs` defaults to the env-resolved deadline
 * ({@link resolveCaptureTimeoutMs}) and is a test-only override of the same
 * boundary — invalid values (0/NaN/negative/Infinity) fall back to the default
 * so a test cannot accidentally disable the deadline (0908 R1).
 */
export class CodexbarUsageSource implements UsageSource {
    readonly name = 'codexbar';

    constructor(
        private readonly command: readonly string[] = CODEXBAR_ARGV,
        private readonly timeoutMs: number = resolveCaptureTimeoutMs(),
        // Seam for hermetic tests (2026-10-14: the real-spawn success case load-flaked at
        // 20s twice and 60s once on contended hosts; the deadline/non-zero cases below keep
        // the real-spawn integration coverage).
        private readonly executor: Pick<ProcessExecutor, 'run'> = new NodeProcessExecutor(),
    ) {
        if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) this.timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS;
    }

    async capture(): Promise<UsageCapture> {
        let result: Awaited<ReturnType<ProcessExecutor['run']>>;
        try {
            result = await this.executor.run({
                command: this.command[0] as string,
                args: this.command.slice(1),
                forceBuffered: true,
                rejectOnError: false,
                // Finite deadline activates the runtime's Unix group-owned
                // containment (SIGTERM → escalate → output settlement); no
                // caller-side watchdog (0908 Design).
                timeout: this.timeoutMs,
            });
        } catch (error) {
            const cause = error instanceof Error ? error.message : String(error);
            throw new UsageSourceError(
                `failed to launch \`${this.command.join(' ')}\`: ${cause} — install codexbar or fix PATH`,
            );
        }
        // 0908 R2: check the structured outcome before any exit-code/parsing
        // fallback — a timed-out capture is unusable even when its partial
        // stdout happens to be valid JSON, and must not read as an
        // installation problem.
        const outcome = result.outcome ?? 'exit';
        if (outcome === 'timeout' || outcome === 'cancelled') {
            throw new UsageSourceError(
                `\`${this.command.join(' ')}\` capture exceeded the ${this.timeoutMs} ms deadline and was terminated — ` +
                    `result is unusable (fail-closed); retry, raise ${CAPTURE_TIMEOUT_ENV}, or investigate the codexbar hang`,
            );
        }
        if (outcome === 'signal' || outcome === 'error') {
            throw new UsageSourceError(
                `\`${this.command.join(' ')}\` capture ended abnormally (${outcome}) — capture is unusable (fail-closed)`,
            );
        }
        const exitCode = result.exitCode;
        if (exitCode === null || exitCode === undefined) {
            throw new UsageSourceError(
                `\`${this.command.join(' ')}\` produced no exit code — capture is unusable (fail-closed)`,
            );
        }
        return { exitCode, stdout: result.stdout, stderr: result.stderr };
    }
}

/**
 * Snapshot location with an injected-env override (`SPUR_AGENT_USAGE_SNAPSHOT`),
 * so tests and sandboxes can pin it — bun's `homedir()` ignores `HOME` at runtime.
 */
export function defaultAgentUsageSnapshotPath(env: Record<string, string | undefined> = getEnvVars()): string {
    const override = env.SPUR_AGENT_USAGE_SNAPSHOT;
    if (override !== undefined && override.length > 0) return override;
    return join(homedir(), '.config', 'spur', 'agent-usage.json');
}
