/**
 * Proto shim recursion markers (`PROTO_SHIM_*` / `PROTO_INTERNAL_*`) are set by the proto
 * tool-version shim on every shim-launched process. When a spawned child invokes a shimmed
 * binary from a directory without `.prototools`, the shim falls back to the global install
 * and misreads the inherited markers as a recursive loop (`proto::commands::run::fallback_loop`).
 * Strip the internal markers from spawned children — the shim re-derives them per launch.
 * (Reproduced via `kk-daily-ai-voice` → surfdash `publishing.yaml` nested run, 2026-09-04.)
 */
const SHIM_INTERNAL_ENV = /^PROTO_(SHIM|INTERNAL)_/;

/**
 * Build the environment for a spawned workflow child: the parent env with `vars` merged over it, and
 * proto's shim-internal markers blanked to `''` rather than removed.
 */
export function childProcessEnv(vars?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...vars })) {
        // Blank (never delete) shim-internal markers: executor env merging re-adds deleted keys
        // from the parent env, while an explicit empty string wins the merge and the shim treats
        // it as unset (proto fallback_loop guard passes on '').
        if (value !== undefined) env[key] = SHIM_INTERNAL_ENV.test(key) ? '' : value;
    }
    return env;
}
