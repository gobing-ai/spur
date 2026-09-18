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
 * Codexbar `UsageSource` implementation (B6 0892 R5): runs
 * `codexbar usage --format json --provider all` and returns the raw capture.
 * `command` is injectable so tests can exercise the missing-binary path
 * without mocking process internals.
 */
export class CodexbarUsageSource implements UsageSource {
    readonly name = 'codexbar';

    constructor(private readonly command: readonly string[] = CODEXBAR_ARGV) {}

    async capture(): Promise<UsageCapture> {
        let result: Awaited<ReturnType<NodeProcessExecutor['run']>>;
        try {
            result = await new NodeProcessExecutor().run({
                command: this.command[0] as string,
                args: this.command.slice(1),
                forceBuffered: true,
                rejectOnError: false,
            });
        } catch (error) {
            const cause = error instanceof Error ? error.message : String(error);
            throw new UsageSourceError(
                `failed to launch \`${this.command.join(' ')}\`: ${cause} — install codexbar or fix PATH`,
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
