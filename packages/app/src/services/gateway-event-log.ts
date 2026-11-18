import type { FileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import type { GatewayEvent } from './project-gateway';

/** Default cap before rotation: 5 MiB (task 1384 R2). */
export const GATEWAY_EVENT_LOG_MAX_BYTES = 5 * 1024 * 1024;

// ponytail: single rotation file; add retention if one file is too short

/**
 * Append-only JSONL sink for gateway events (feature K42, task 1384).
 *
 * The gateway handler stays IO-free (ADR-151): `apps/cli/src/commands/serve.ts` composes this sink
 * as `GatewayDeps.onEvent` — `~/Library/Logs/spur/gateway.events.jsonl` on darwin, next to the
 * launchd logs, and `~/.config/spur/logs/gateway.events.jsonl` elsewhere. Before each write the
 * active file is statted; when the next line would cross `maxBytes`, the active file rotates to
 * `<path>.1`, overwriting any earlier `.1`. A sink failure never fails the gateway request: it is
 * reported once on stderr, then further events are dropped.
 */
export function createJsonlEventSink(opts: {
    path: string;
    maxBytes?: number;
    fs: Pick<FileSystem, 'stat' | 'appendFile' | 'rename' | 'ensureDir'>;
}): (event: GatewayEvent) => void {
    const maxBytes = opts.maxBytes ?? GATEWAY_EVENT_LOG_MAX_BYTES;
    const dir = opts.path.slice(0, opts.path.lastIndexOf('/'));
    const encoder = new TextEncoder();
    let dirReady = false;
    let warned = false;
    // Serialize the stat→rotate→append chains: concurrent events must not all stat a size the
    // previous append has not landed yet (that would starve rotation).
    let tail: Promise<void> = Promise.resolve();
    return (event) => {
        tail = tail.then(async () => {
            try {
                const line = `${JSON.stringify(event)}\n`;
                const stat = await opts.fs.stat(opts.path);
                if (stat !== null && stat.size + encoder.encode(line).length > maxBytes) {
                    await opts.fs.rename(opts.path, `${opts.path}.1`);
                }
                if (!dirReady) {
                    await opts.fs.ensureDir(dir);
                    dirReady = true;
                }
                await opts.fs.appendFile(opts.path, line);
            } catch (err) {
                if (warned) return;
                warned = true;
                const message = err instanceof Error ? err.message : String(err);
                echoError(
                    `[spur gateway] event log write failed (${opts.path}); dropping further event-log writes: ${message}`,
                );
            }
        });
    };
}
