import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { LifecycleAdapter, type LifecycleProfile } from '@gobing-ai/spur-app';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import { TaskRunLinkDao } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context';
import { resolveSpurBin } from './resolve-spur-bin';

/** `~/.config/spur` relative to the home directory (mirrors GLOBAL_CONFIG_DIR in commands/init.ts). */
const GLOBAL_CONFIG_DIR = join('.config', 'spur');

/**
 * Resolve the global config root (`~/.config/spur`), honoring `SPUR_GLOBAL_RULES_DIR`
 * for test isolation — the same override `commands/init.ts` and `RuleService` use for
 * the sibling `rules/` tree, so overriding it in a test redirects workflows too.
 */
function globalConfigRoot(context: CliContext): string {
    const override = context.env.SPUR_GLOBAL_RULES_DIR;
    return override !== undefined && override.length > 0
        ? resolve(context.cwd, override)
        : join(homedir(), GLOBAL_CONFIG_DIR);
}

/**
 * Resolve the workflow YAML path for a given profile, in priority order:
 *   1. Bundled config root  (`config/workflows/<name>.yaml` in source / npm package)
 *   2. Project-local path   (`.spur/workflows/<name>.yaml` seeded by `spur init`)
 *   3. Global seeded config (`~/.config/spur/workflows/<name>.yaml` seeded by `spur init`)
 *
 * The project-local fallback handles the case where the running binary has no
 * sibling `config/` directory (e.g. a compiled single-file binary, or a globally-
 * installed release) but the project was initialised with `spur init` and carries
 * its own copy of the workflow YAML under `.spur/workflows/`. The global fallback
 * (0071 R5) covers the common case: a compiled binary (no bundled root) running in a
 * project whose `.spur/workflows/` predates a lifecycle-workflow addition or was
 * never fully seeded, but whose `~/.config/spur/workflows/` — seeded once by any
 * `spur init` — already has the file. Without this layer, `RuleService`'s rule
 * lookup already checks the global tier (priority 10) but the lifecycle adapter did
 * not, so the two subsystems silently disagreed about what "installed" means and the
 * adapter fell back to the degraded inline `spur task check` gate (task 0071/F5).
 * Returns `null` only when none of the three locations exist — callers fall back to
 * the schema-only port.
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
    // 3. Global seeded config (~/.config/spur/workflows/ — seeded by `spur init`, same
    //    tier RuleService already treats as authoritative for rules).
    const globalPath = join(globalConfigRoot(context), 'workflows', `${profile.workflowName}.yaml`);
    if (existsSync(globalPath)) return globalPath;
    return null;
}

/**
 * Build the engine-backed lifecycle port (0055) for a given profile. Status
 * transitions then go through the profile's state-machine with real guard
 * enforcement (`spur task check` / `spur feature check`) and file-wins
 * rehydration (DD-04).
 *
 * The workflow YAML is resolved by {@link resolveWorkflowPath}: bundled config
 * root first, then project-local `.spur/workflows/`, then global
 * `~/.config/spur/workflows/` (all seeded by `spur init`).
 * Returns `undefined` only when none of the three locations contain the YAML —
 * callers fall back to the schema-only port (P3 backstop, task 0130).
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
