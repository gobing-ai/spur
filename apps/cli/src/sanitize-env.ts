/**
 * proto's tool shim marks shim-launched processes with `PROTO_SHIM_*` / `PROTO_INTERNAL_*`
 * env vars. When such a process (or any descendant) invokes a shimmed binary from a directory
 * without `.prototools`, the shim falls back to the global install and misreads the inherited
 * markers as a recursive loop (`proto::commands::run::fallback_loop`). These markers are
 * shim-internal launch state and must never propagate — delete them at CLI start so every
 * downstream spawn (workflow shell steps, guards, agents, nested spur runs) is clean.
 * (Reproduced via kk-daily-ai-voice → surfdash `publishing.yaml`, 2026-09-04.)
 */
for (const key of Object.keys(process.env)) {
    if (/^PROTO_(SHIM|INTERNAL)_/.test(key)) delete process.env[key];
}
