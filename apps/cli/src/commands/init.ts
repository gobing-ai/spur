import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { ArtifactDao } from '@gobing-ai/spur-domain';
import { bundledRulesRoot, listBundledRuleFiles } from '@gobing-ai/ts-rule-engine';
import { CLI_CONFIG } from '../config';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Global user rules root, relative to the home directory (mirrors `rule.ts`). */
const GLOBAL_RULES_DIR = join('.config', 'spur', 'rules');

/** Local project scaffold templates written under `.spur/` unless `--minimal`. */
const LOCAL_RULES_DIR = join(CLI_CONFIG.configDir, 'rules');
const LOCAL_WORKFLOWS_DIR = join(CLI_CONFIG.configDir, 'workflows');

/** Recommended preset for the local layer — inherits the bundled categories. */
const RECOMMENDED_PRESET = `# Recommended preset — portable rule categories.
# Use with: spur rule run --preset recommended-pre-check
#
# Categories resolve from the bundled rules and ~/.config/spur/rules. Drop
# same-named files under .spur/rules/ to override an individual bundled rule.
name: recommended-pre-check
extends:
  - typescript
  - structure
  - quality
`;

/** Stricter development preset for the local layer. */
const SPUR_DEV_PRESET = `# Development preset — stricter rules for development workflow.
# Use with: spur rule run --preset recommended-post-check --rule coverage-gate --fail-on warning
name: recommended-post-check
extends:
  - typescript
  - quality/coverage-gate
`;

/**
 * Canonical implement → check → fix loop, authored for the
 * @gobing-ai/ts-dual-workflow-engine state-machine schema. Kept byte-for-byte in
 * sync with `.spur/workflows/basic.yaml`, which `workflow validate` exercises.
 */
const BASIC_WORKFLOW = `# Canonical basic workflow: implement -> check -> fix until the check passes or the
# iteration bound is exhausted. Authored for the @gobing-ai/ts-dual-workflow-engine
# state-machine schema (initialState / states[].id / onEnter / top-level transitions).
name: basic
kind: state-machine
description: The canonical implement-check-fix-until-pass loop
iterationBound: 2
initialState: implement
terminalStates:
  - done
  - failed
states:
  - id: implement
    description: Implement the requested task
    onEnter:
      - kind: note
        options:
          message: 'Implementing task: \${task}'

  - id: check
    description: Verify the implementation passes all checks
    onEnter:
      - kind: shell
        options:
          command: bun run check

  - id: fix
    description: Address failures from the check pass
    onEnter:
      - kind: note
        options:
          message: 'Please fix the issues found'

  - id: done
    description: Terminal — workflow completed successfully
  - id: failed
    description: Terminal — workflow failed

transitions:
  - from: implement
    to: check
    description: Hand the implemented task to the check pass

  - from: check
    to: done
    description: Check passed — finish successfully
    guard:
      kind: action-ok
  - from: check
    to: fix
    description: Check failed — route to a fix attempt

  - from: fix
    to: check
    description: Re-run the check after fixing
`;

/** Files created or skipped during a scaffold, reported in the result envelope. */
interface ScaffoldResult {
    created: string[];
    skipped: string[];
}

/** Resolve the global rules root, honoring `SPUR_GLOBAL_RULES_DIR` for test isolation. */
function globalRulesRoot(context: CliContext): string {
    const override = context.env.SPUR_GLOBAL_RULES_DIR;
    return override !== undefined && override.length > 0
        ? resolve(context.cwd, override)
        : join(homedir(), GLOBAL_RULES_DIR);
}

/** Write `content` at `path` unless it already exists (or `force`); record the outcome. */
async function writeIfNew(
    context: CliContext,
    path: string,
    content: string,
    force: boolean,
    result: ScaffoldResult,
): Promise<void> {
    if (!force && (await context.fs.exists(path))) {
        result.skipped.push(path);
        return;
    }
    await context.fs.writeFile(path, content);
    result.created.push(path);
}

/**
 * Copy the rule presets bundled with `@gobing-ai/ts-rule-engine` into the user's
 * global rules directory on first run. Existing files are never overwritten, so a
 * user's customizations and `--force` re-inits leave the global layer intact. This
 * is what makes `spur rule run --preset recommended-pre-check` resolve to a real ruleset
 * from any project, independent of the bundled fallback. Returns files written.
 */
async function seedGlobalRules(context: CliContext): Promise<number> {
    const source = bundledRulesRoot();
    if (source === null) return 0;
    const target = globalRulesRoot(context);
    let written = 0;
    for (const relPath of listBundledRuleFiles()) {
        const destination = join(target, relPath);
        if (await context.fs.exists(destination)) continue;
        await context.fs.ensureDir(join(target, ...relPath.split('/').slice(0, -1)));
        await context.fs.writeFile(destination, await context.fs.readFile(join(source, relPath)));
        written += 1;
    }
    return written;
}

/** Register `spur init` command. */
export function registerInitCommand(program: Command, context: CliContext): void {
    program
        .command('init')
        .summary('scaffold a local Spur project')
        .option('--name <name>', 'Project name (default: current directory name)')
        .option('--force', 'Recreate files that already exist')
        .option('--minimal', 'Only write the minimal .spur scaffold')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const json = options.json === true;
            const force = options.force === true;
            const minimal = options.minimal === true;
            const projectName = options.name ?? 'default';
            const configPath = join(context.cwd, CLI_CONFIG.configFile);

            // Re-init guard: a config that already exists is only overwritten with --force,
            // so a stray `spur init` cannot silently clobber a configured project.
            if (!force && (await context.fs.exists(configPath))) {
                const message = `Already initialized: ${CLI_CONFIG.configFile}. Use --force to overwrite.`;
                context.output.write(
                    json
                        ? toJson({ ok: false, reason: 'already-initialized', config: CLI_CONFIG.configFile })
                        : message,
                );
                context.setExitCode(1);
            }

            const result: ScaffoldResult = { created: [], skipped: [] };
            const config = {
                version: 1,
                project: projectName,
                database: CLI_CONFIG.databaseFile,
                generatedBy: '@gobing-ai/spur-cli',
            };

            await context.fs.ensureDir(join(context.cwd, CLI_CONFIG.configDir));
            await context.fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
            result.created.push(configPath);

            // Team-mode agent specs live under .spur/agents/; seed the directory with a
            // .gitkeep so it is tracked before any `spur agent create` writes a spec.
            const agentsDir = join(context.cwd, CLI_CONFIG.configDir, 'agents');
            await context.fs.ensureDir(agentsDir);
            await writeIfNew(context, join(agentsDir, '.gitkeep'), '', force, result);

            if (!minimal) {
                await context.fs.ensureDir(join(context.cwd, LOCAL_RULES_DIR));
                await context.fs.ensureDir(join(context.cwd, LOCAL_WORKFLOWS_DIR));
                await writeIfNew(
                    context,
                    join(context.cwd, LOCAL_RULES_DIR, 'recommended-pre-check.yaml'),
                    RECOMMENDED_PRESET,
                    force,
                    result,
                );
                await writeIfNew(
                    context,
                    join(context.cwd, LOCAL_RULES_DIR, 'recommended-post-check.yaml'),
                    SPUR_DEV_PRESET,
                    force,
                    result,
                );
                await writeIfNew(
                    context,
                    join(context.cwd, LOCAL_WORKFLOWS_DIR, 'basic.yaml'),
                    BASIC_WORKFLOW,
                    force,
                    result,
                );
            }

            const db = await context.getDb();
            await new ArtifactDao(db).record({ path: configPath, kind: 'config' });

            const seeded = await seedGlobalRules(context);

            if (json) {
                context.output.write(
                    toJson({
                        ok: true,
                        project: projectName,
                        config: CLI_CONFIG.configFile,
                        ...result,
                        globalRulesSeeded: seeded,
                    }),
                );
            }

            if (!json) {
                context.output.write(`Initialized ${CLI_CONFIG.configFile}`);
                for (const path of result.created) context.output.write(`  ✓ ${path}`);
                for (const path of result.skipped) context.output.write(`  - ${path} (exists)`);
                if (seeded > 0) {
                    context.output.write(`  ✓ seeded ${seeded} rule file(s) to ~/${GLOBAL_RULES_DIR}`);
                }
            }
        });
}
