import { LifecycleAdapter, type LifecycleProfile, resolveWorkflowFile } from '@gobing-ai/spur-app';
import { TaskRunLinkDao } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context.js';
import { resolveSpurBin } from './resolve-spur-bin.js';

/**
 * Build the engine-backed lifecycle port (0055) for a given profile. Status
 * transitions then go through the profile's state-machine with real guard
 * enforcement (`spur task check` / `spur feature check`) and file-wins
 * rehydration (DD-04).
 *
 * The workflow YAML is resolved by the shared {@link resolveWorkflowFile} seam:
 * project-first on every surface (task 0752 / R4). Returns `undefined` only when
 * neither tier contains the YAML — callers fall back to the schema-only port
 * (P3 backstop, task 0130).
 */
export function makeLifecycleAdapter(context: CliContext, profile: LifecycleProfile): LifecycleAdapter | undefined {
    const resolved = resolveWorkflowFile(context.cwd, profile.workflowName);
    if (resolved.path === null) return undefined;
    const workflowPath = resolved.path;
    // Resolve the spur binary to avoid PATH ambiguity — the `spur` on PATH may be
    // a different version (or compiled without `task`/`feature` commands). Shared
    // with the `workflow run` path so both resolve the binary identically.
    const spurBin = resolveSpurBin();
    return new LifecycleAdapter({
        profile,
        getDb: () => context.getDb(),
        taskRunLinkDao: (db) => new TaskRunLinkDao(db),
        workflowPath,
        cwd: context.cwd,
        spurBin,
    });
}
