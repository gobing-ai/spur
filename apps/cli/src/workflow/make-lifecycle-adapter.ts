import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LifecycleAdapter, type LifecycleProfile } from '@gobing-ai/spur-app';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import { TaskRunLinkDao } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context';
import { resolveSpurBin } from './resolve-spur-bin';

/**
 * Resolve the workflow YAML path for a given profile, in priority order:
 *   1. Bundled config root  (`config/workflows/<name>.yaml` in source / npm package)
 *   2. Project-local path   (`.spur/workflows/<name>.yaml` seeded by `spur init`)
 *
 * The project-local fallback handles the case where the running binary has no
 * sibling `config/` directory (e.g. a compiled single-file binary, or a globally-
 * installed release) but the project was initialised with `spur init` and carries
 * its own copy of the workflow YAML under `.spur/workflows/`. Returns `null` when
 * neither location exists — callers fall back to the schema-only port.
 */
function resolveWorkflowPath(context: CliContext, profile: LifecycleProfile): string | null {
    // 1. Bundled config root (source / npm install — works regardless of cwd)
    const bundledRoot = bundledConfigRoot();
    if (bundledRoot !== null) {
        const bundledPath = join(bundledRoot, 'workflows', `${profile.workflowName}.yaml`);
        if (existsSync(bundledPath)) return bundledPath;
    }
    // 2. Project-local (.spur/workflows/ seeded by `spur init` — cwd is the project root)
    const projectPath = join(context.cwd, '.spur', 'workflows', `${profile.workflowName}.yaml`);
    if (existsSync(projectPath)) return projectPath;
    return null;
}

/**
 * Build the engine-backed lifecycle port (0055) for a given profile. Status
 * transitions then go through the profile's state-machine with real guard
 * enforcement (`spur task check` / `spur feature check`) and file-wins
 * rehydration (DD-04).
 *
 * The workflow YAML is resolved by {@link resolveWorkflowPath}: bundled config
 * root first, then project-local `.spur/workflows/` (seeded by `spur init`).
 * Returns `undefined` only when neither location contains the YAML — callers
 * fall back to the schema-only port (P3 backstop, task 0130).
 */
export function makeLifecycleAdapter(context: CliContext, profile: LifecycleProfile): LifecycleAdapter | undefined {
    const workflowPath = resolveWorkflowPath(context, profile);
    if (workflowPath === null) return undefined;
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
