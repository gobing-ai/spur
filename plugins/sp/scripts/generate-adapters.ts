/**
 * generate-adapters — generate/validate Claude Code `/sp:dev-*` slash and
 * Codex `$sp-dev-*` skill wrappers from the shared command registry
 * (feature O wave-2, task 0308; spec ticket 0283 R4/R7/R8).
 *
 * Every wrapper is a pure function of its {@link COMMANDS} entry: frontmatter
 * + invocation syntax + the delegation line, nothing else (0283 R4). The
 * byte-exact regeneration match is the no-prose drift gate (0283 R8c); the
 * embedded `snapshot:` marker versions each wrapper against the registry so a
 * stale (hand-edited in-session) wrapper is detectable and a fresh session is
 * required before dogfooding it (0283 R7).
 *
 * CLI usage:
 *   bun plugins/sp/scripts/generate-adapters.ts            # regenerate all 56 wrappers
 *   bun plugins/sp/scripts/generate-adapters.ts --check    # drift check only (exit 1 on stale/missing)
 *   bun plugins/sp/scripts/generate-adapters.ts --help
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { COMMANDS, type CommandMeta } from './command-registry';

/** Bump when the wrapper template changes; invalidates every snapshot hash. */
export const TEMPLATE_VERSION = 1;

export const COMMANDS_DIR = 'plugins/sp/commands';
export const CODEX_DIR = 'plugins/sp/adapters/codex';

/** Repo-relative path of the Claude Code slash wrapper for a command. */
export function claudeRelPath(meta: CommandMeta): string {
    return `${COMMANDS_DIR}/${meta.name}.md`;
}

/** Repo-relative path of the Codex dollar-skill wrapper for a command. */
export function codexRelPath(meta: CommandMeta): string {
    return `${CODEX_DIR}/sp-${meta.name}.md`;
}

/**
 * Content-hash of a registry entry + template version (first 12 hex chars of
 * sha256). Embedded in every generated wrapper as the snapshot version (R7):
 * a wrapper whose marker disagrees with a fresh render is stale.
 */
export function snapshotHash(meta: CommandMeta): string {
    const canonical = JSON.stringify({ v: TEMPLATE_VERSION, ...meta });
    return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

/** YAML scalar for frontmatter description — double-quoted only when it contains a quote. */
function yamlDescription(value: string): string {
    return value.includes('"') ? `"${value.replaceAll('"', '\\"')}"` : value;
}

/** YAML double-quoted scalar for argument-hint (always quoted in the legacy style). */
function yamlHint(value: string): string {
    return `"${value.replaceAll('"', '\\"')}"`;
}

/** YAML flow list for allowed-tools (`["Bash", "Read"]`). */
function yamlTools(tools: readonly string[]): string {
    return `[${tools.map((t) => `"${t}"`).join(', ')}]`;
}

/** The one-line "Wraps ..." statement — names the semantics owner, nothing more. */
export function wrapsLine(meta: CommandMeta, platform: 'claude' | 'codex' = 'claude'): string {
    const t = meta.target;
    switch (t.kind) {
        case 'skill': {
            const skills = [...new Set(t.dispatches.map((d) => `**${d.skill}**`))];
            return `Wraps the ${skills.join(' and ')} ${skills.length === 1 ? 'skill' : 'skills'}.`;
        }
        case 'workflow':
            return `Wraps the **${t.workflow}** workflow.`;
        case 'procedure':
            return `Implements an inline procedure — see [dev-operations.md](${skillsLinkBase(platform)}${t.referenceFile}#${t.anchor}) for the authoritative reference.`;
        case 'composite':
            return 'Wraps **spur init** (deterministic scaffold) + **sp:doc-evolve** (project customization).';
    }
}

/**
 * Link base from each wrapper's directory to `plugins/sp/skills/`. Claude
 * wrappers live in `plugins/sp/commands/`; Codex wrappers one level deeper in
 * `plugins/sp/adapters/codex/`.
 */
function skillsLinkBase(platform: 'claude' | 'codex'): string {
    return platform === 'claude' ? '../skills/' : '../../skills/';
}

/** Delegation lines for the Claude Code wrapper (`Skill()` call syntax). */
export function claudeDelegation(meta: CommandMeta): string[] {
    const t = meta.target;
    switch (t.kind) {
        case 'skill':
            return t.dispatches.map((d) => {
                const call = `\`Skill(skill="${d.skill}", args="${d.args}")\``;
                return d.when ? `- ${d.when}: ${call}` : `- ${call}`;
            });
        case 'workflow':
            return ['```bash', t.invocation, '```'];
        case 'procedure':
            return [
                `Follow the inline procedure in [dev-operations.md](${skillsLinkBase('claude')}${t.referenceFile}#${t.anchor}) (${t.label}).`,
            ];
        case 'composite':
            return [
                '```bash',
                t.cli,
                '```',
                ...t.dispatches.map((d) => {
                    const call = `\`Skill(skill="${d.skill}", args="${d.args}")\``;
                    return d.when ? `- ${d.when}: ${call}` : `- ${call}`;
                }),
            ];
    }
}

/**
 * Delegation lines for the Codex wrapper. `Skill()` is Claude-specific, so
 * skill dispatches render as an explicit skill-invocation instruction; the
 * workflow / procedure / CLI lines are platform-portable and stay identical.
 */
export function codexDelegation(meta: CommandMeta): string[] {
    const t = meta.target;
    switch (t.kind) {
        case 'skill':
            return t.dispatches.map((d) => {
                const invoke = `Invoke the **${d.skill}** skill with args \`${d.args}\`.`;
                return d.when ? `- ${d.when}: ${invoke}` : `- ${invoke}`;
            });
        case 'workflow':
            return ['```bash', t.invocation, '```'];
        case 'procedure':
            return [
                `Follow the inline procedure in [dev-operations.md](${skillsLinkBase('codex')}${t.referenceFile}#${t.anchor}) (${t.label}).`,
            ];
        case 'composite':
            return [
                '```bash',
                t.cli,
                '```',
                ...t.dispatches.map((d) => {
                    const invoke = `Invoke the **${d.skill}** skill with args \`${d.args}\`.`;
                    return d.when ? `- ${d.when}: ${invoke}` : `- ${invoke}`;
                }),
            ];
    }
}

/** Snapshot/version marker shared by both wrapper kinds (R7). */
export function markerLine(meta: CommandMeta): string {
    return (
        `<!-- adapter:generated v${TEMPLATE_VERSION} snapshot:${snapshotHash(meta)} — ` +
        'regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; ' +
        'a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->'
    );
}

/** Render the Claude Code slash wrapper (`plugins/sp/commands/<name>.md`). */
export function renderClaudeWrapper(meta: CommandMeta): string {
    return [
        '---',
        `description: ${yamlDescription(meta.description)}`,
        `argument-hint: ${yamlHint(meta.argumentHint)}`,
        `allowed-tools: ${yamlTools(meta.allowedTools)}`,
        '---',
        '',
        `# ${meta.title}`,
        '',
        wrapsLine(meta, 'claude'),
        '',
        '## Usage',
        '',
        `/sp:${meta.name} ${meta.argumentHint}`,
        '',
        '## Implementation',
        '',
        ...claudeDelegation(meta),
        '',
        markerLine(meta),
        '',
    ].join('\n');
}

/** Render the Codex dollar-skill wrapper (`plugins/sp/adapters/codex/sp-<name>.md`). */
export function renderCodexWrapper(meta: CommandMeta): string {
    return [
        '---',
        `name: sp-${meta.name}`,
        `description: ${yamlDescription(meta.description)}`,
        'disable-model-invocation: true',
        '---',
        '',
        `# ${meta.title}`,
        '',
        wrapsLine(meta, 'codex'),
        '',
        '## Usage',
        '',
        `$sp-${meta.name} ${meta.argumentHint}`,
        '',
        '## Implementation',
        '',
        ...codexDelegation(meta),
        '',
        markerLine(meta),
        '',
    ].join('\n');
}

/** One stale or missing wrapper. */
export interface DriftEntry {
    readonly path: string;
    readonly reason: 'missing' | 'stale';
}

/**
 * Compare every registry entry's two wrappers on disk against fresh renders.
 * Byte-exact equality is the drift contract: any hand edit, stale snapshot,
 * or missing file is reported. `root` defaults to the repo cwd.
 */
export function checkAdapters(root: string = process.cwd()): DriftEntry[] {
    const drift: DriftEntry[] = [];
    for (const meta of COMMANDS) {
        const expected: ReadonlyArray<readonly [string, string]> = [
            [claudeRelPath(meta), renderClaudeWrapper(meta)],
            [codexRelPath(meta), renderCodexWrapper(meta)],
        ];
        for (const [rel, content] of expected) {
            const abs = join(root, rel);
            if (!existsSync(abs)) {
                drift.push({ path: rel, reason: 'missing' });
            } else if (readFileSync(abs, 'utf8') !== content) {
                drift.push({ path: rel, reason: 'stale' });
            }
        }
    }
    return drift;
}

/** (Re)generate every wrapper from the registry. Returns the written repo-relative paths. */
export function writeAdapters(root: string = process.cwd()): string[] {
    const written: string[] = [];
    for (const meta of COMMANDS) {
        const outputs: ReadonlyArray<readonly [string, string]> = [
            [claudeRelPath(meta), renderClaudeWrapper(meta)],
            [codexRelPath(meta), renderCodexWrapper(meta)],
        ];
        for (const [rel, content] of outputs) {
            const abs = join(root, rel);
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, content);
            written.push(rel);
        }
    }
    return written;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

export interface CliArgs {
    readonly check: boolean;
    readonly help: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
    return {
        check: argv.includes('--check'),
        help: argv.includes('--help') || argv.includes('-h'),
    };
}

export function renderHelp(): string {
    return [
        'generate-adapters — render/validate slash + dollar-skill wrappers from the command registry',
        '',
        'Usage:',
        '  bun plugins/sp/scripts/generate-adapters.ts            regenerate all wrappers',
        '  bun plugins/sp/scripts/generate-adapters.ts --check    drift check (exit 1 on stale/missing)',
        '  bun plugins/sp/scripts/generate-adapters.ts --help',
        '',
    ].join('\n');
}

export interface CliResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
}

export function runCli(
    argv: string[],
    opts?: { check?: (root: string) => DriftEntry[]; write?: (root: string) => string[] },
): CliResult {
    const parsed = parseCliArgs(argv);
    if (parsed.help) {
        return { exitCode: 0, stdout: renderHelp(), stderr: '' };
    }
    const check = opts?.check ?? checkAdapters;
    const write = opts?.write ?? writeAdapters;
    if (parsed.check) {
        const drift = check(process.cwd());
        if (drift.length === 0) {
            return {
                exitCode: 0,
                stdout: `all adapters in sync (${COMMANDS.size === 0 ? 0 : COMMANDS.length * 2} files, registry v${TEMPLATE_VERSION})\n`,
                stderr: '',
            };
        }
        const lines = drift.map((d) => `${d.reason}\t${d.path}`);
        return {
            exitCode: 1,
            stdout: '',
            stderr: `adapter drift detected (${drift.length}):\n${lines.join('\n')}\nregenerate: bun plugins/sp/scripts/generate-adapters.ts\n`,
        };
    }
    const written = write(process.cwd());
    return {
        exitCode: 0,
        stdout: `generated ${written.length} wrappers from ${COMMANDS.length} commands\n`,
        stderr: '',
    };
}

/**
 * Entry-point boot — runs the CLI using process.argv. Tests inject `run` /
 * `exit` / stream spies instead of spawning a subprocess (which would not
 * contribute to the test isolate's V8 coverage counters).
 */
export function bootMain(
    argv: string[] = process.argv,
    opts?: {
        run?: (a: string[]) => CliResult;
        exit?: (code: number) => void;
        stdout?: { write: (data: string) => void };
        stderr?: { write: (data: string) => void };
    },
): void {
    const cliRunner = opts?.run ?? runCli;
    const doExit = opts?.exit ?? process.exit;
    const stdout = opts?.stdout ?? process.stdout;
    const stderr = opts?.stderr ?? process.stderr;
    const result = cliRunner(argv);
    if (result.stdout) stdout.write(result.stdout);
    if (result.stderr) stderr.write(result.stderr);
    doExit(result.exitCode);
}

if (import.meta.main) {
    bootMain();
}
