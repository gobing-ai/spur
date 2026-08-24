import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LifecycleAdapter, type LifecycleProfile } from '@gobing-ai/spur-app';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import { TaskRunLinkDao } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context';
import { resolveSpurBin } from './resolve-spur-bin';

/**
 * Resolve the workflow YAML for a given profile across the two tiers.
 *
 * 1. Bundled config root (built npm or repo root bundled workflows tree in dev).
 * 2. Project-local `.spur/workflows/<name>.yaml`.
 *
 * The `~/.config/spur/workflows/` global tier was dropped (task 0648): it existed
 * solely for the compiled-binary case (task 0071 R5/F5), and that case is not a
 * shipping target and already lacks bundled rules/templates. Removing it deletes
 * the staleness problem instead of managing it — `~/.config/spur/` stays
 * authoritative for rules (`RuleService` priority 10) and `config.yaml` (the A4
 * layered loader), but its `workflows/` subtree is no longer read by anything.
 * Returns `null` only when neither tier exists — callers fall back to the
 * schema-only port.
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
 * root first, then project-local `.spur/workflows/` (task 0648 — the global
 * `~/.config/spur/workflows/` tier was removed). Returns `undefined` only when
 * neither tier contains the YAML — callers fall back to the schema-only port
 * (P3 backstop, task 0130).
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
