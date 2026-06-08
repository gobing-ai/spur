import { setLoggerMuted } from '@gobing-ai/ts-infra';
import { configure, reset } from '@logtape/logtape';

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
