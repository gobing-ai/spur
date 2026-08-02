/**
 * Task 0412 migration: normalize dev-*.md command files to the Argument Flags contract.
 *
 * Contract (gate (e)):
 *   - argument-hint is syntax-only (no Markdown links).
 *   - Body contains exactly ONE glossary reference: the footer line. No inline
 *     glossary links in table cells or descriptions.
 *   - ## Argument Flags section has a single table with columns
 *     `| Flag | Description | Default |`.
 *   - Flag cells: backtick-wrapped tokens (`--flag`, `<positional>`), value
 *     placeholders kept as `<...>` for parity. No brackets/parentheses wrapping.
 *   - Bidirectional hint ↔ table parity on `--flag` and `<positional>` literals.
 *   - Table-only flags must either appear in the hint OR be marked
 *     alias/compat/no-op/deprecated in their Description cell.
 *
 * Idempotent: files already migrated are left unchanged.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMANDS_DIR = join(import.meta.dir, '..', 'commands');
const GLOSSARY_REF_LINE =
    'For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).';

interface FlagRow {
    /** Flag cell, backtick-wrapped tokens only. e.g. `` `<wbs>` ``, `` `--auto` ``, `` `--mode` `<full|implement>` `` */
    flag: string;
    description: string;
    default: string;
}

/** Curated per-command Argument Flags table rows — clean backtick tokens, no inline glossary links. */
const TABLES: Record<string, FlagRow[]> = {
    'dev-arch': [
        {
            flag: '`[<module-path>]`',
            description: 'Module path to scope the architecture survey.',
            default: 'omitted (whole repo)',
        },
        {
            flag: '`--scope` `<all|<path>>`',
            description: 'Limit the survey to a path or expand to the whole repo.',
            default: 'all',
        },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing survey work.',
            default: 'inline',
        },
        { flag: '`--json`', description: 'Emit structured JSON instead of markdown.', default: 'off' },
    ],
    'dev-brainstorm': [
        { flag: '`<topic>`', description: 'Topic or problem statement to explore.', default: 'required' },
        {
            flag: '`--depth` `<basic|detailed|comprehensive>`',
            description: 'Breadth vs. depth of the exploration.',
            default: 'detailed',
        },
        { flag: '`--options` `<n>`', description: 'Number of solution options to generate.', default: '3' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing ideation.',
            default: 'inline',
        },
        {
            flag: '`--skip-discovery`',
            description: 'Skip the discovery interview; ideate immediately.',
            default: 'off',
        },
        { flag: '`--wayfind`', description: 'Spawn a wayfinder feature for multi-session routing.', default: 'off' },
        {
            flag: '`--task` `[<feature-id>]`',
            description: 'Create a tracking task under a feature.',
            default: 'omitted',
        },
        {
            flag: '`--feature` `[<parent-id>]`',
            description: 'Attach the result to a parent feature.',
            default: 'omitted',
        },
        { flag: '`--next`', description: 'Hand off to the next-router on success.', default: 'off' },
    ],
    'dev-changelog': [
        { flag: '`--since` `<tag|commit>`', description: 'Start of the commit range.', default: 'latest tag' },
        { flag: '`--until` `<tag|commit>`', description: 'End of the commit range.', default: 'HEAD' },
        { flag: '`--version` `<version>`', description: 'Override the detected release version.', default: 'detected' },
    ],
    'dev-daily': [
        { flag: '`--date` `<YYYY-MM-DD>`', description: 'Report date.', default: 'today' },
        { flag: '`--dry-run`', description: 'Render without writing files.', default: 'off' },
        { flag: '`--output` `<path>`', description: 'Output directory for the report.', default: 'configured' },
        { flag: '`--no-git`', description: 'Skip git-history aggregation.', default: 'off' },
        { flag: '`--no-ccusage`', description: 'Skip ccusage aggregation.', default: 'off' },
    ],
    'dev-debug': [
        {
            flag: '`"<symptom | failing command>"`',
            description: 'Symptom or failing command to diagnose.',
            default: 'required',
        },
        { flag: '`--scope` `<path>`', description: 'Scope the reproduction/isolation to a path.', default: 'cwd' },
        { flag: '`--task` `[<wbs>]`', description: 'Attach findings to a task.', default: 'omitted' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing diagnosis.',
            default: 'inline',
        },
    ],
    'dev-dogfood': [
        { flag: '`<testee>`', description: 'Skill / command / CLI to exercise end-to-end.', default: 'required' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing dogfood work.',
            default: 'inline',
        },
        { flag: '`--max-retry` `<n>`', description: 'Max auto-fix retries per stage.', default: '3' },
        {
            flag: '`--save`',
            description: 'Compatibility no-op; saving is now default. Retained until evidenced retirement.',
            default: 'off',
        },
        { flag: '`--task`', description: 'Record outcomes against a task.', default: 'omitted' },
        { flag: '`--chain-follow`', description: "Follow the testee's chained follow-ups.", default: 'off' },
        { flag: '`--full`', description: 'Full report verbosity (all sections).', default: 'off' },
    ],
    'dev-featurechange': [
        { flag: '`--map` `<path>`', description: 'Feature-restructure mapping file.', default: 'configured' },
        { flag: '`--dry-run`', description: 'Plan only; write nothing.', default: 'off' },
        { flag: '`--apply`', description: 'Apply the planned restructure.', default: 'off' },
        { flag: '`--limit` `<old-id>`', description: 'Restrict to a single old feature id.', default: 'omitted' },
        { flag: '`--wave` `<1|2|3|all>`', description: 'Migration wave to execute.', default: 'all' },
        { flag: '`--yes`', description: 'Skip confirmation prompts.', default: 'off' },
    ],
    'dev-findissue': [
        { flag: '`[<topic>]`', description: 'Narrow the analysis to a topic.', default: 'omitted' },
        { flag: '`--sessions` `<glob>`', description: 'Session log glob to scan.', default: 'recent' },
        {
            flag: '`--source` `<auto|omp|claude|codex|gemini|opencode|antigravity|openclaw|pi>`',
            description: 'Agent source to scan.',
            default: 'auto',
        },
        { flag: '`--feature` `<id>`', description: 'Attach findings to a feature.', default: 'omitted' },
        { flag: '`--template` `<meta|issue|standard>`', description: 'Output template shape.', default: 'standard' },
        { flag: '`--priority` `<P0|P1|P2|P3>`', description: 'Filter / assign priority.', default: 'omitted' },
        { flag: '`--severity` `<S0|S1|S2>`', description: 'Filter / assign severity.', default: 'omitted' },
        { flag: '`--category` `<list>`', description: 'Comma list of categories to keep.', default: 'all' },
        { flag: '`--since` `<iso>`', description: 'Start of the scan window.', default: 'configured' },
        { flag: '`--until` `<iso>`', description: 'End of the scan window.', default: 'now' },
        { flag: '`--top` `<n>`', description: 'Limit to top N findings.', default: 'omitted' },
        { flag: '`--min-cost` `<duration>`', description: 'Minimum wasted duration to report.', default: 'omitted' },
        { flag: '`--strict-topic`', description: 'Drop findings off-topic.', default: 'off' },
        { flag: '`--use-history`', description: 'Incorporate indexed history.', default: 'off' },
        { flag: '`--no-task`', description: 'Do not create a task for findings.', default: 'off' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing analysis.',
            default: 'inline',
        },
        { flag: '`--json`', description: 'Emit structured JSON.', default: 'off' },
    ],
    'dev-fixall': [
        {
            flag: '`[<validation-command>]`',
            description: 'Validation command to iterate against.',
            default: 'project gate',
        },
        { flag: '`--max-retry` `<n>`', description: 'Max fix iterations.', default: '3' },
        { flag: '`--scope` `<path>`', description: 'Scope fixes to a path.', default: 'cwd' },
    ],
    'dev-gitmsg': [
        { flag: '`--commit`', description: 'Stage and commit with the generated message.', default: 'off' },
        { flag: '`--squash`', description: 'Squash staged changes into one commit.', default: 'off' },
        { flag: '`--scope` `<path>`', description: 'Scope the diff to a path.', default: 'cwd' },
    ],
    'dev-handover': [
        {
            flag: '`"<blocker description>"`',
            description: 'Free-text description of the current blocker.',
            default: 'required',
        },
    ],
    'dev-idea': [
        {
            flag: '`"<idea>"`',
            description: 'Vague idea to turn into a feature with AC and tasks.',
            default: 'required',
        },
        { flag: '`--auto`', description: 'Skip objective HITL gates only (taste gates still pause).', default: 'off' },
        { flag: '`--skip-design`', description: 'Omit system-design and per-task Design.', default: 'off' },
        {
            flag: '`--approve-taste`',
            description:
                'With `--auto`: set idea_approved + design_approved so idea-eval / design-approval do not pause.',
            default: 'off',
        },
        {
            flag: '`--idea-approved`',
            description: 'Compatibility alias for idea_approved=true (subset of --approve-taste).',
            default: 'off',
        },
        {
            flag: '`--design-approved`',
            description: 'Compatibility alias for design_approved=true (subset of --approve-taste).',
            default: 'off',
        },
    ],
    'dev-next': [
        { flag: '`[<wbs|feature-id>]`', description: 'Task WBS or feature id to advance.', default: 'active' },
        { flag: '`--dry-run`', description: 'Resolve and print the next step without executing.', default: 'off' },
        { flag: '`--once`', description: 'Resolve exactly one step and stop.', default: 'off' },
        { flag: '`--auto`', description: 'Skip objective HITL gates in the dispatched step.', default: 'off' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the dispatched model-bearing step.',
            default: 'inline',
        },
        { flag: '`--full`', description: 'Print the full routing trace.', default: 'off' },
    ],
    'dev-parallel': [
        { flag: '`--tasks` `<selector>`', description: 'Task selector to fan out.', default: 'required' },
        { flag: '`--feature` `<id>`', description: 'Restrict the selector to a feature.', default: 'omitted' },
        {
            flag: '`--mode` `<fan-out|review-panel|investigation>`',
            description: 'Fan-out pattern.',
            default: 'fan-out',
        },
        { flag: '`--agent` `<inline|auto|name>`', description: 'Who runs each dispatched slice.', default: 'inline' },
        { flag: '`--json`', description: 'Emit structured JSON.', default: 'off' },
    ],
    'dev-plan': [
        { flag: '`"<description>"`', description: 'Feature description to plan.', default: 'required' },
        { flag: '`--feature` `<id>`', description: 'Attach to an existing feature.', default: 'omitted' },
        { flag: '`--parent` `<feature-id>`', description: 'Create under a parent feature.', default: 'omitted' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing planning.',
            default: 'inline',
        },
        { flag: '`--skip-design`', description: 'Omit the system-design hop.', default: 'off' },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
        { flag: '`--approve-taste`', description: 'With --auto: skip design-approval pause.', default: 'off' },
    ],
    'dev-refine': [
        { flag: '`<wbs>`', description: 'Task WBS to refine.', default: 'required' },
        { flag: '`--focus` `<mode>`', description: 'Refinement focus mode.', default: 'omitted' },
        { flag: '`--description` `<text>`', description: 'Override the task description.', default: 'omitted' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing refinement.',
            default: 'inline',
        },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
        { flag: '`--next`', description: 'Hand off to the next-router on success.', default: 'off' },
    ],
    'dev-refineall': [
        { flag: '`--feature` `<id>`', description: 'Refine all tasks in a feature.', default: 'see usage' },
        {
            flag: '`--tasks` `<selector>`',
            description: 'Task selector to refine (alternative to --feature).',
            default: 'see usage',
        },
        { flag: '`--focus` `<mode>`', description: 'Refinement focus mode.', default: 'omitted' },
        { flag: '`--description` `<text>`', description: 'Override description for each task.', default: 'omitted' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing refinement.',
            default: 'inline',
        },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
        { flag: '`--keep-going`', description: 'Continue past per-task failures.', default: 'off' },
        { flag: '`--status` `<s>`', description: 'Only refine tasks in a status.', default: 'omitted' },
        { flag: '`--json`', description: 'Emit structured JSON.', default: 'off' },
    ],
    'dev-refresh': [
        { flag: '`[<feature-id|wbs>]`', description: 'Feature id or task WBS to refresh.', default: 'active' },
        { flag: '`--all`', description: 'Refresh every feature.', default: 'off' },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing refresh.',
            default: 'inline',
        },
    ],
    'dev-reverse': [
        { flag: '`[<path>]`', description: 'Path to reverse-engineer.', default: 'cwd' },
        {
            flag: '`--mode` `<briefing|structure|architecture|design|full>`',
            description: 'Depth of the report.',
            default: 'structure',
        },
        {
            flag: '`--focus` `<all|stack|dependencies|data|flows|api|security|quality|performance>`',
            description: 'Analysis lens.',
            default: 'all',
        },
        { flag: '`--format` `<markdown|json|both>`', description: 'Output format.', default: 'markdown' },
        { flag: '`--output` `<file>`', description: 'Write to a file instead of stdout.', default: 'stdout' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing analysis.',
            default: 'inline',
        },
    ],
    'dev-review': [
        { flag: '`[<wbs|path>]`', description: 'Task WBS or source path to review.', default: 'cwd' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing review.',
            default: 'inline',
        },
        {
            flag: '`--focus` `<dims>`',
            description: 'Review dimensions (functional / SECUA / architecture).',
            default: 'all',
        },
        {
            flag: '`--fix`',
            description: 'Deprecated no-op + warning; route remediation to /sp:dev-verify --fix.',
            default: 'off',
        },
    ],
    'dev-run': [
        { flag: '`<wbs>`', description: 'Task WBS to run.', default: 'required' },
        {
            flag: '`--mode` `<full|implement>`',
            description: 'Full pipeline or single implement step.',
            default: 'full',
        },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing stages.',
            default: 'inline',
        },
        { flag: '`--auto`', description: 'Skip objective HITL confirmations.', default: 'off' },
        { flag: '`--next`', description: 'Chain-to-completion via the next-router.', default: 'off' },
        { flag: '`--wrap`', description: 'Run the wrap hop after the main step.', default: 'off' },
        { flag: '`--continue`', description: 'Resume an interrupted task from its checkpoint.', default: 'off' },
    ],
    'dev-runall': [
        { flag: '`--tasks` `<selector>`', description: 'Task selector to run.', default: 'required' },
        { flag: '`--feature` `<id>`', description: 'Restrict to a feature.', default: 'omitted' },
        { flag: '`--mode` `<sequential|parallel>`', description: 'Batch execution order.', default: 'sequential' },
        { flag: '`--keep-going`', description: 'Continue past per-task failures.', default: 'off' },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
        { flag: '`--agent` `<inline|auto|name>`', description: 'Who runs each task.', default: 'inline' },
        { flag: '`--json`', description: 'Emit structured JSON.', default: 'off' },
        { flag: '`--wrap`', description: 'Run the wrap hop per task.', default: 'off' },
        { flag: '`--next`', description: 'Chain-to-completion via the next-router.', default: 'off' },
        { flag: '`--continue`', description: 'Resume an interrupted batch.', default: 'off' },
    ],
    'dev-simplify': [
        { flag: '`[<path-or-scope>]`', description: 'Path or scope to simplify.', default: 'recent' },
        {
            flag: '`--scope` `<recent|all|<path>>`',
            description: 'Scope of the simplification pass.',
            default: 'recent',
        },
        { flag: '`--check` `<cmd>`', description: 'Validation command to iterate against.', default: 'project gate' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing simplification.',
            default: 'inline',
        },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
    ],
    'dev-unit': [
        { flag: '`<target>`', description: 'File / module / path to generate tests for.', default: 'required' },
        { flag: '`--coverage` `<n>`', description: 'Coverage percentage target.', default: 'configured' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing test work.',
            default: 'inline',
        },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
    ],
    'dev-verify': [
        { flag: '`<wbs>`', description: 'Task WBS to verify.', default: 'required' },
        {
            flag: '`--agent` `<inline|auto|name>`',
            description: 'Who runs the model-bearing verification.',
            default: 'inline',
        },
        { flag: '`--fix` `<none|blockers-first|all>`', description: 'Auto-fix policy on findings.', default: 'none' },
        { flag: '`--focus` `<lens>`', description: 'Verification lens.', default: 'omitted' },
        { flag: '`--bdd`', description: 'Run BDD scenarios.', default: 'off' },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
        { flag: '`--force`', description: 'Re-run even if already verified.', default: 'off' },
        { flag: '`--next`', description: 'Hand off to the next-router on success.', default: 'off' },
        {
            flag: '`--skip-shippable`',
            description: 'Compatibility alias for --skip-shipable; skip the shippable gate.',
            default: 'off',
        },
    ],
    'dev-verifyall': [
        { flag: '`--tasks` `<selector>`', description: 'Task selector to verify.', default: 'required' },
        { flag: '`--feature` `<id>`', description: 'Restrict to a feature.', default: 'omitted' },
        { flag: '`--agent` `<inline|auto|name>`', description: 'Who runs each verification.', default: 'inline' },
        { flag: '`--fix` `<none|blockers-first|all>`', description: 'Auto-fix policy on findings.', default: 'none' },
        { flag: '`--focus` `<lens>`', description: 'Verification lens.', default: 'omitted' },
        { flag: '`--bdd`', description: 'Run BDD scenarios.', default: 'off' },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
        { flag: '`--force`', description: 'Re-run even if already verified.', default: 'off' },
        { flag: '`--next`', description: 'Hand off to the next-router on success.', default: 'off' },
        { flag: '`--json`', description: 'Emit structured JSON.', default: 'off' },
        {
            flag: '`--skip-shippable`',
            description: 'Compatibility alias for --skip-shipable; skip the shippable gate.',
            default: 'off',
        },
    ],
    'dev-wrap': [
        { flag: '`<wbs>`', description: 'Task WBS to wrap.', default: 'required' },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
        { flag: '`--merge`', description: 'Merge the wrap branch.', default: 'off' },
        { flag: '`--dry-run`', description: 'Render the wrap without writing.', default: 'off' },
    ],
    'dev-wrapall': [
        { flag: '`--since` `<iso-date>`', description: 'Wrap tasks completed since a date.', default: 'configured' },
        { flag: '`--feature` `<id>`', description: 'Wrap tasks in a feature.', default: 'omitted' },
        { flag: '`--status` `<s>`', description: 'Only wrap tasks in a status.', default: 'omitted' },
        { flag: '`--auto`', description: 'Skip objective HITL gates.', default: 'off' },
        { flag: '`--merge`', description: 'Merge wrap branches.', default: 'off' },
        { flag: '`--dry-run`', description: 'Render wraps without writing.', default: 'off' },
    ],
};

/** Strip Markdown links from a hint, preserving the literal text. */
function stripLinks(hint: string): string {
    return hint.replace(/\[`([^\]]+)`\]\([^)]+\)/g, '$1');
}

/** Render the Argument Flags table block for a command. */
function renderFlagsSection(rows: FlagRow[]): string {
    const lines = ['## Argument Flags', '', '| Flag | Description | Default |', '| --- | --- | --- |'];
    for (const r of rows) {
        lines.push(`| ${r.flag} | ${r.description} | ${r.default} |`);
    }
    lines.push('');
    lines.push(GLOSSARY_REF_LINE);
    return lines.join('\n');
}

/** Remove ad-hoc flag tables (any markdown table whose header first cell is 'Flag' but is not the canonical header). */
function removeAdHocFlagTables(body: string): string {
    const lines = body.split('\n');
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (/^\| Flag \|/.test(line.trim())) {
            const canonical = '| Flag | Description | Default |';
            if (line.trim() === canonical) {
                out.push(line);
                i++;
                continue;
            }
            // Ad-hoc table: skip header + separator + data rows + trailing blank.
            i++;
            if (i < lines.length && /^\|\s*[-:]/.test(lines[i].trim())) i++;
            while (i < lines.length && /^\|/.test(lines[i].trim())) i++;
            if (i < lines.length && lines[i].trim() === '') i++;
            continue;
        }
        out.push(line);
        i++;
    }
    return out.join('\n');
}

/**
 * Transform a single command file. Returns new content, or null if already migrated / unknown.
 */
function migrateContent(name: string, raw: string): string | null {
    const rows = TABLES[name];
    if (!rows) return null;
    if (/^## Argument Flags$/m.test(raw)) return null;

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const fm = fmMatch[1];
    const body = raw.slice(fmMatch[0].length);

    // 1. Strip links from argument-hint.
    const hintRe = /^(argument-hint:\s*)(.+)$/m;
    const hintM = fm.match(hintRe);
    let newFm = fm;
    if (hintM) {
        newFm = newFm.replace(hintRe, `$1${stripLinks(hintM[2])}`);
    }

    let newBody = body;

    // Remove legacy "**Flags:**" tables and their following blank line.
    newBody = newBody.replace(/\n\*\*Flags:\*\*\n(\|[^\n]+\|\n)+\n/g, '\n');

    // Remove ad-hoc flag tables that aren't canonical.
    newBody = removeAdHocFlagTables(newBody);

    // Insert the Argument Flags section immediately before ## Usage.
    const flagsSection = renderFlagsSection(rows);
    newBody = newBody.replace(/^## Usage$/m, `${flagsSection}\n\n## Usage`);

    return `---\n${newFm}\n---${newBody}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const files = readdirSync(COMMANDS_DIR)
    .filter((f) => f.startsWith('dev-') && f.endsWith('.md'))
    .sort();

let migrated = 0;
let skipped = 0;
let missing = 0;

for (const file of files) {
    const name = file.replace(/\.md$/, '');
    const path = join(COMMANDS_DIR, file);
    const raw = readFileSync(path, 'utf8');
    if (!TABLES[name]) {
        console.warn(`[SKIP] ${name}: no curated table — add to TABLES`);
        missing++;
        continue;
    }
    const next = migrateContent(name, raw);
    if (next === null) {
        skipped++;
        continue;
    }
    writeFileSync(path, next);
    migrated++;
    console.log(`[OK]   ${name}`);
}

console.log(`\nMigrated: ${migrated}, Skipped (already done): ${skipped}, Missing tables: ${missing}`);
