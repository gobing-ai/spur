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
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';

/** Default argv for the codexbar capture (machine-readable, all providers). */
const CODEXBAR_ARGV = ['codexbar', 'usage', '--format', 'json', '--provider', 'all'];

/**
 * Capture deadline (0908 R1): bounded headroom above the ~113 s all-provider
 * capture measured in I31/0904 — a chosen limit, not a measured percentile.
 * A hanging capture must never pin `spur agent usage` or an upstream schedule.
 */
export const DEFAULT_CAPTURE_TIMEOUT_MS = 180_000;

/**
 * Codexbar `UsageSource` implementation (B6 0892 R5): runs
 * `codexbar usage --format json --provider all` and returns the raw capture.
 * `command` is injectable so tests can exercise the missing-binary path
 * without mocking process internals; `timeoutMs` is a test-only override of
 * the same boundary — invalid values (0/NaN/negative/Infinity) fall back to
 * the default so a test cannot accidentally disable the deadline (0908 R1).
 */
export class CodexbarUsageSource implements UsageSource {
    readonly name = 'codexbar';

    constructor(
        private readonly command: readonly string[] = CODEXBAR_ARGV,
        private readonly timeoutMs: number = DEFAULT_CAPTURE_TIMEOUT_MS,
    ) {
        if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) this.timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS;
    }

    async capture(): Promise<UsageCapture> {
        let result: Awaited<ReturnType<NodeProcessExecutor['run']>>;
        try {
            result = await new NodeProcessExecutor().run({
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
                    'result is unusable (fail-closed); retry or investigate the codexbar hang',
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
