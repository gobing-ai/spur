import { setLoggerMuted } from '@gobing-ai/ts-infra';
import { configure, reset } from '@logtape/logtape';

// Polyfill AbortSignal.prototype.setMaxListeners for Bun on Linux where
// execa 9.6+ calls node:events setMaxListeners(n, controller.signal) and
// Bun's internal node:events types.isEventTarget(signal) returns false.
if (
    typeof AbortSignal !== 'undefined' &&
    typeof (AbortSignal.prototype as { setMaxListeners?: unknown }).setMaxListeners !== 'function'
) {
    (AbortSignal.prototype as { setMaxListeners?: (n?: number) => void }).setMaxListeners = (_n?: number): void => {};
}

// Gate the ts-infra logger adapter (per-instance).
setLoggerMuted(true);

// Configure LogTape engine directly — no sinks, fatal-only root level.
// This silences ALL log output regardless of which ts-infra instance
// created the LogTapeLogger adapter (four duplicate ts-infra@0.3.5
// instances exist in Bun's store, each with its own `muted` flag).
await reset();
await configure({
    sinks: {},
    loggers: [
        { category: ['app'], lowestLevel: 'fatal', sinks: [] },
        { category: ['logtape', 'meta'], lowestLevel: 'fatal', sinks: [] },
    ],
});

// Prevent tests from resolving the global ~/.config/spur/config.yaml fallback,
// ensuring they hit the direct (no-config) code path.
process.env.SPUR_SKIP_GLOBAL_CONFIG = 'true';
