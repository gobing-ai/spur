import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LifecycleAdapter, type LifecycleProfile } from '@gobing-ai/spur-app';
import { bundledConfigRoot } from '@gobing-ai/spur-config';
import { TaskRunLinkDao } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context';

/**
 * Build the engine-backed lifecycle port (0055) for a given profile. Status
 * transitions then go through the profile's state-machine with real guard
 * enforcement (`spur task check` / `spur feature check`) and file-wins
 * rehydration (DD-04).
 *
 * The bundled workflow YAML is resolved by convention from `profile.workflowName`
 * (`task-lifecycle` → `config/workflows/task-lifecycle.yaml`). Returns `undefined`
 * when that YAML is unreachable (e.g. a `--compile` single binary with no sibling
 * config) — `PlanningWriteService` then falls back to the schema-only port.
 */
export function makeLifecycleAdapter(context: CliContext, profile: LifecycleProfile): LifecycleAdapter | undefined {
    const root = bundledConfigRoot();
    if (root === null) return undefined;
    const workflowPath = join(root, 'workflows', `${profile.workflowName}.yaml`);
    if (!existsSync(workflowPath)) return undefined;
    // Resolve the spur binary to avoid PATH ambiguity — the `spur` on PATH may be
    // a different version (or compiled without `task`/`feature` commands). Using
    // the project's own Bun entry point ensures guard commands (`spur task check`,
    // `spur feature check`) always invoke the correct binary.
    const spurBin = `${process.execPath} run ${join(context.cwd, 'apps', 'cli', 'src', 'index.ts')}`;
    return new LifecycleAdapter({
        profile,
        getDb: () => context.getDb(),
        taskRunLinkDao: (db) => new TaskRunLinkDao(db),
        workflowPath,
        cwd: context.cwd,
        spurBin,
    });
}
