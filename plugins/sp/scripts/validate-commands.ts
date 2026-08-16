/**
 * validate-commands — thin-wrapper contract validator for plugin sp commands
 * (feature O, task 0309; ADR-032).
 *
 * Validates each plugins/sp/commands/<name>.md directly against the
 * thin-wrapper contract — no registry, no generation. The .md files are the
 * hand-editable SSOT; superskill owns per-platform emission.
 *
 * Gates:
 *  (a) heading whitelist — H1 title + the per-contract ordered section headings
 *  (b) frontmatter schema — description, argument-hint, allowed-tools; dev-only extras;
 *      real-YAML re-parse so malformed blocks cannot ship an empty description
 *  (c) target resolution — sp:<skill> refs, workflow files, procedure anchors
 *  (d) allowed-tools coherence — Skill present iff body contains Skill() call
 *  (e) dev-command argument contract — syntax-only hint, Argument Flags table columns,
 *      single glossary reference, and bidirectional hint↔table parity
 *
 * Exit non-zero listing every violation on stderr.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Violation {
    /** Command basename without extension (dev-run). */
    readonly command: string;
    /** Gate tag (a|b|c|d). */
    readonly gate: 'a' | 'b' | 'c' | 'd' | 'e';
    /** Human-readable description of the violation. */
    readonly message: string;
}

export interface ValidationResult {
    readonly violations: readonly Violation[];
    readonly fileCount: number;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/** GitHub-style heading slug for anchor resolution. */
function slugify(heading: string): string {
    return heading
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number} -]/gu, '')
        .replaceAll(' ', '-');
}

interface ParsedCommand {
    readonly name: string;
    readonly title: string;
    readonly headings: readonly string[];
    readonly description: string | undefined;
    readonly argumentHint: string | undefined;
    readonly allowedTools: string[] | undefined;
    /** Set when the frontmatter fails a real YAML parse or yields an empty description. */
    readonly frontmatterYamlProblem: string | undefined;
    readonly body: string;
}

function parseCommand(filePath: string, name: string): ParsedCommand {
    const raw = readFileSync(filePath, 'utf8');

    // Extract frontmatter between --- delimiters
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw;
    const fm = fmMatch ? fmMatch[1] : '';

    const description = extractYamlField(fm, 'description');
    const argumentHint = extractYamlField(fm, 'argument-hint');
    const allowedTools = extractYamlList(fm, 'allowed-tools');

    // The regex extractions above feed the per-field gates, but they cannot see
    // malformed YAML: `description: >-` followed by unindented keys reads as a
    // present description to the regex while a real YAML parser folds the next
    // keys into the block scalar — the bug that shipped an empty description to
    // superskill install for dev-feature-change. Gate (b) re-checks with a real
    // parse so that class cannot regress.
    let frontmatterYamlProblem: string | undefined;
    if (fm.trim() !== '') {
        try {
            const parsed: unknown = parseYaml(fm);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                frontmatterYamlProblem = 'frontmatter is not a YAML mapping';
            } else {
                const parsedDescription = (parsed as Record<string, unknown>).description;
                if (typeof parsedDescription !== 'string' || parsedDescription.trim() === '') {
                    frontmatterYamlProblem = 'frontmatter description is empty after YAML parsing';
                }
            }
        } catch (error) {
            const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
            frontmatterYamlProblem = `frontmatter is not valid YAML: ${detail}`;
        }
    }

    const lines = body.split('\n');
    const title = lines[0]?.startsWith('# ') ? lines[0].slice(2).trim() : '';

    // Collect headings at EVERY level (not just `## `) so lifecycle prose cannot
    // hide under a `### Behavior` subheading — gate (a) asserts the set is exactly
    // {Usage, Implementation}. Fenced code blocks are skipped so a shell comment
    // (`# regenerate …`) in an example is never mistaken for a heading; commands
    // are hand-authored now, so that false positive would be a real trap.
    const headings: string[] = [];
    let inFence = false;
    for (const [index, line] of lines.entries()) {
        if (line.startsWith('```')) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        if (index === 0 && line.startsWith('# ')) continue; // H1 title, not a section heading
        if (line.startsWith('#')) {
            headings.push(line.replace(/^#+\s*/, '').trim());
        }
    }

    return { name, title, headings, description, argumentHint, allowedTools, frontmatterYamlProblem, body };
}

/** Extract a plain YAML string field (handles quoted and unquoted). */
function extractYamlField(fm: string, key: string): string | undefined {
    const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
    const m = fm.match(re);
    if (!m) return undefined;
    const value = m[1].trim();
    // Unquote double-quoted YAML scalars
    if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replace(/\\"/g, '"');
    }
    return value;
}

/** Extract a YAML flow list ["A", "B"]. */
function extractYamlList(fm: string, key: string): string[] | undefined {
    const re = new RegExp(`^${key}:\\s*\\[(.*)\\]$`, 'm');
    const m = fm.match(re);
    if (!m) return undefined;
    return [...m[1].matchAll(/"([^"]*)"/g)].map((q) => q[1]);
}

const ALLOWED_HEADINGS: Record<string, true> = { Usage: true, Implementation: true };

/** The heading set every non-dev command must carry — exactly these, no more, no fewer. */
const REQUIRED_HEADINGS = ['Usage', 'Implementation'] as const;

/** Dev commands carry an ordered Argument Flags → Usage → Implementation section sequence. */
const DEV_REQUIRED_HEADINGS = ['Argument Flags', 'Usage', 'Implementation'] as const;

const DEV_REQUIRED_SET: Record<string, true> = {
    'Argument Flags': true,
    Implementation: true,
    Usage: true,
};

/** Canonical glossary reference every dev command carries exactly once. */
const GLOSSARY_REF = '../skills/spur-dev/references/flag-glossary.md';

function isDevCommand(name: string): boolean {
    return name.startsWith('dev-');
}

function checkHeadingWhitelist(cmd: ParsedCommand): readonly Violation[] {
    const violations: Violation[] = [];
    const dev = isDevCommand(cmd.name);
    const required = dev ? DEV_REQUIRED_HEADINGS : REQUIRED_HEADINGS;
    const allowedSet = dev ? DEV_REQUIRED_SET : ALLOWED_HEADINGS;
    const allowedList = dev ? DEV_REQUIRED_HEADINGS : REQUIRED_HEADINGS;

    // Forbidden: anything outside the allowed set, at any heading level.
    for (const h of cmd.headings) {
        if (!allowedSet[h]) {
            violations.push({
                command: cmd.name,
                gate: 'a',
                message: `forbidden heading "${h}" (allowed: ${allowedList.map((x) => `## ${x}`).join(', ')})`,
            });
        }
    }

    // Missing: a wrapper that simply omits a required section must not pass.
    for (const req of required) {
        if (!cmd.headings.includes(req)) {
            violations.push({
                command: cmd.name,
                gate: 'a',
                message: `missing required heading "## ${req}"`,
            });
        }
    }

    // Duplicated: two `## Usage` sections is a malformed wrapper, not a thin one.
    for (const req of required) {
        if (cmd.headings.filter((h) => h === req).length > 1) {
            violations.push({
                command: cmd.name,
                gate: 'a',
                message: `duplicate heading "## ${req}"`,
            });
        }
    }

    // Dev commands enforce order: Argument Flags immediately before Usage, Usage before Implementation.
    if (dev) {
        const indexes: Record<string, number> = {};
        for (const [i, h] of cmd.headings.entries()) {
            if (DEV_REQUIRED_SET[h] && indexes[h] === undefined) indexes[h] = i;
        }
        if (
            indexes['Argument Flags'] !== undefined &&
            indexes.Usage !== undefined &&
            indexes['Argument Flags'] + 1 !== indexes.Usage
        ) {
            violations.push({
                command: cmd.name,
                gate: 'a',
                message: 'heading order: "## Argument Flags" must immediately precede "## Usage"',
            });
        }
        if (
            indexes.Usage !== undefined &&
            indexes.Implementation !== undefined &&
            indexes.Usage >= indexes.Implementation
        ) {
            violations.push({
                command: cmd.name,
                gate: 'a',
                message: 'heading order: "## Usage" must precede "## Implementation"',
            });
        }
    }

    return violations;
}

// ─── Gate (b): frontmatter schema ───────────────────────────────────────────

function checkFrontmatterSchema(cmd: ParsedCommand): readonly Violation[] {
    const violations: Violation[] = [];
    if (cmd.frontmatterYamlProblem) {
        violations.push({ command: cmd.name, gate: 'b', message: cmd.frontmatterYamlProblem });
    }
    if (!cmd.description) {
        violations.push({ command: cmd.name, gate: 'b', message: 'missing frontmatter description' });
    }
    if (!cmd.argumentHint) {
        violations.push({ command: cmd.name, gate: 'b', message: 'missing frontmatter argument-hint' });
    }
    if (!cmd.allowedTools) {
        violations.push({ command: cmd.name, gate: 'b', message: 'missing frontmatter allowed-tools' });
    }
    return violations;
}

// ─── Gate (c): target resolution ────────────────────────────────────────────

function checkTargetResolution(cmd: ParsedCommand, skillsDir: string, root: string): readonly Violation[] {
    const violations: Violation[] = [];

    // Extract ## Implementation section content
    const implPart = cmd.body.split(/^## Implementation\n/m)[1] ?? '';
    const implSection = implPart.split(/\n## (?!Usage)/m)[0].trim();

    // Skill() calls: Skill(skill="sp:NAME",
    // The name charset must stay at least as wide as any name a skill directory can
    // take: a ref this pattern does not match is silently not collected, so the gate
    // would pass a genuinely unresolved reference rather than report it.
    const skillCalls = [...implSection.matchAll(/Skill\(skill="sp:([a-z][a-z0-9-]*)"/g)];
    for (const ref of skillCalls) {
        const skillName = ref[1];
        const skillPath = join(skillsDir, skillName, 'SKILL.md');
        if (!existsSync(skillPath)) {
            violations.push({
                command: cmd.name,
                gate: 'c',
                message: `unresolved skill reference sp:${skillName} (missing ${skillPath})`,
            });
        }
    }

    // Workflow file refs — patterns like .spur/workflows/<name>.yaml
    const workflowRefs = [...implSection.matchAll(/\.spur\/workflows\/([^\s)"\]]+\.yaml)/g)];
    for (const ref of workflowRefs) {
        const wfPath = join(root, '.spur', 'workflows', ref[1]);
        if (!existsSync(wfPath)) {
            violations.push({
                command: cmd.name,
                gate: 'c',
                message: `unresolved workflow file ${ref[0]} (missing ${wfPath})`,
            });
        }
    }

    // Procedure reference + anchor — markdown links with anchors in Implementation
    const anchorRefs = [...implSection.matchAll(/\[([^\]]*)\]\(([^)]*#([^)]*))\)/g)];
    for (const ref of anchorRefs) {
        const filePart = ref[2].split('#')[0];
        const anchor = ref[3];
        // Resolve relative paths from commands/ directory
        const resolved = resolve(join(root, 'plugins', 'sp', 'commands'), filePart);
        if (!existsSync(resolved)) {
            violations.push({
                command: cmd.name,
                gate: 'c',
                message: `unresolved procedure reference ${filePart} (missing ${resolved})`,
            });
            continue;
        }
        // Check anchor exists
        const content = readFileSync(resolved, 'utf8');
        const headings = content.split('\n').filter((l) => l.startsWith('#'));
        const slugAnchors = headings.map((l) => slugify(l.replace(/^#+\s*/, '').trim()));
        // Honor explicit `**Anchor:** `#id`` directives (the glossary convention in
        // flag-glossary.md) so a shared-flag entry can expose a stable `#flag-<name>`
        // anchor independent of its heading text.
        const explicitAnchors = [...content.matchAll(/^\*\*Anchor:\*\*\s*`#([^`]+)`/gm)].map((m) => m[1]);
        const anchors = [...slugAnchors, ...explicitAnchors];
        if (!anchors.includes(anchor)) {
            violations.push({
                command: cmd.name,
                gate: 'c',
                message: `unresolved anchor #${anchor} in ${filePart}`,
            });
        }
    }

    return violations;
}

// ─── Gate (d): allowed-tools coherence ──────────────────────────────────────

function checkAllowedToolsCoherence(cmd: ParsedCommand): readonly Violation[] {
    const violations: Violation[] = [];
    if (!cmd.allowedTools) return violations;

    const hasSkillTool = cmd.allowedTools.includes('Skill');
    const hasSkillCall = cmd.body.includes('Skill(');

    if (hasSkillTool && !hasSkillCall) {
        violations.push({
            command: cmd.name,
            gate: 'd',
            message: 'allowed-tools includes Skill but body contains no Skill() call',
        });
    }
    if (!hasSkillTool && hasSkillCall) {
        violations.push({
            command: cmd.name,
            gate: 'd',
            message: 'body contains Skill() call but allowed-tools does not include Skill',
        });
    }

    return violations;
}

// ─── Gate (e): dev-command argument contract ────────────────────────────────

/**
 * Extract the `## Argument Flags` section body (between the heading and the next
 * level-two heading or end of body). Returns the raw section text.
 */
function extractArgumentFlagsSection(body: string): string {
    const marker = /^## Argument Flags\n/m;
    const start = body.search(marker);
    if (start < 0) return '';
    const after = body.slice(start);
    // Cut at the next level-two heading (## ) that is not the Argument Flags header itself.
    const nextH2 = after.slice(after.indexOf('\n') + 1).search(/^## /m);
    if (nextH2 < 0) return after;
    return after.slice(0, after.indexOf('\n') + 1 + nextH2);
}

/**
 * Parse a markdown table in a section. Returns the header cells and data rows.
 * Header row is the first `|`-delimited row following the heading; the separator
 * row (`| --- |`) is skipped; data rows are every subsequent `|`-delimited line
 * until a blank line or non-table line.
 */
interface MarkdownTable {
    header: string[];
    rows: string[][];
}

function parseMarkdownTable(section: string): MarkdownTable | null {
    const lines = section.split('\n');
    const tableLines: string[] = [];
    let seenHeader = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) {
            if (seenHeader) break;
            continue;
        }
        tableLines.push(trimmed);
        seenHeader = true;
    }
    if (tableLines.length < 2) return null;
    // Split on unescaped pipes only, then unescape `\|` → `|` per cell.
    // Standard GFM: `\|` in a table cell renders as a literal `|`.
    const split = (row: string): string[] =>
        row
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split(/(?<!\\)\|/)
            .map((c) => c.trim().replace(/\\\|/g, '|'));
    const header = split(tableLines[0]);
    // Skip the separator row (--- cells).
    const dataRows = tableLines
        .slice(1)
        .filter((r) => !split(r).every((c) => /^:?-{2,}:?$/.test(c) || c === ''))
        .map(split);
    return { header, rows: dataRows };
}

/**
 * Extract flag and positional tokens from a canonical (syntax-only) argument-hint.
 * Positionals: `<...>` tokens. Flags: `--flag` optionally with `<value>` / alternatives.
 */
function extractHintTokens(hint: string): { positionals: string[]; flags: string[] } {
    const positionals = [...hint.matchAll(/<[^>]+>/g)].map((m) => m[0]);
    // Flags: capture the `--flag` literal, ignoring the value placeholder that follows.
    const flags = [...hint.matchAll(/(--[a-z][a-z0-9-]*)/g)].map((m) => m[1]);
    // Deduplicate while preserving order.
    return {
        positionals: [...new Set(positionals)],
        flags: [...new Set(flags)],
    };
}

/**
 * Extract the flag / positional tokens declared in an Argument Flags table. The
 * first cell of each row is the token: `<positional>` or `--flag` (with optional
 * value placeholder and alternatives). For parity we compare the leading token
 * (`--flag` or `<positional>`), since hint parity is on those literals.
 */
function extractTableTokens(rows: string[][]): { positionals: string[]; flags: string[] } {
    const positionals: string[] = [];
    const flags: string[] = [];
    for (const row of rows) {
        const cell = row[0] ?? '';
        const pos = [...cell.matchAll(/<[^>]+>/g)].map((m) => m[0]);
        const flg = cell.match(/--[a-z][a-z0-9-]*/);
        if (pos.length > 0) positionals.push(...pos);
        if (flg) flags.push(flg[0]); // Not `else if` — a cell like `--mode <full|implement>` has both.
    }
    return {
        positionals: [...new Set(positionals)],
        flags: [...new Set(flags)],
    };
}

/** Flags whose table-row description marks them as alias / compat / no-op / deprecated. */
const COMPAT_MARKERS = /\b(alias|compat|no-op|deprecated|compatibility)\b/i;

function checkDevArgumentContract(cmd: ParsedCommand): readonly Violation[] {
    if (!isDevCommand(cmd.name)) return [];
    const violations: Violation[] = [];
    const hint = cmd.argumentHint ?? '';

    // 1. Syntax-only hint: no Markdown links (`](`) and no `<...>`-wrapped prose.
    if (hint.includes('](')) {
        violations.push({
            command: cmd.name,
            gate: 'e',
            message: `argument-hint contains a Markdown link "](" — hint must be syntax only`,
        });
    }

    // 2. Argument Flags table: exactly one table with exactly Flag | Description | Default.
    const section = extractArgumentFlagsSection(cmd.body);
    const table = parseMarkdownTable(section);
    if (!table) {
        violations.push({
            command: cmd.name,
            gate: 'e',
            message: '## Argument Flags section must contain a markdown table',
        });
        return violations;
    }
    const expectedCols = ['Flag', 'Description', 'Default'];
    if (table.header.length !== 3 || !expectedCols.every((c, i) => table.header[i] === c)) {
        violations.push({
            command: cmd.name,
            gate: 'e',
            message: `Argument Flags table columns must be exactly "Flag | Description | Default" (got "${table.header.join(' | ')}")`,
        });
    }

    // Every row must have a non-blank Default cell (deterministic default rule).
    for (const [idx, row] of table.rows.entries()) {
        const defaultCell = row[2];
        if (defaultCell === undefined || defaultCell === '' || /^\s*$/.test(defaultCell)) {
            violations.push({
                command: cmd.name,
                gate: 'e',
                message: `Argument Flags row ${idx + 1} ("${row[0] ?? ''}") has a blank Default cell`,
            });
        }
    }

    // 3. Exactly one canonical glossary reference.
    const glossaryCount = (cmd.body.match(new RegExp(GLOSSARY_REF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? [])
        .length;
    if (glossaryCount !== 1) {
        violations.push({
            command: cmd.name,
            gate: 'e',
            message: `expected exactly one glossary reference to ${GLOSSARY_REF}, found ${glossaryCount}`,
        });
    }

    // 4. Bidirectional hint ↔ table parity.
    const hintTokens = extractHintTokens(hint);
    const tableTokens = extractTableTokens(table.rows);

    // Forward: every hint positional and flag must appear in the table.
    for (const pos of hintTokens.positionals) {
        if (!tableTokens.positionals.includes(pos)) {
            violations.push({
                command: cmd.name,
                gate: 'e',
                message: `hint positional "${pos}" has no matching row in the Argument Flags table`,
            });
        }
    }
    for (const flag of hintTokens.flags) {
        if (!tableTokens.flags.includes(flag)) {
            violations.push({
                command: cmd.name,
                gate: 'e',
                message: `hint flag "${flag}" has no matching row in the Argument Flags table`,
            });
        }
    }

    // Reverse: every table flag must appear in the hint, unless the row marks it
    // as an alias / compat / no-op / deprecated spelling (compatibility surface).
    for (const flag of tableTokens.flags) {
        if (hintTokens.flags.includes(flag)) continue;
        const row = table.rows.find((r) => (r[0] ?? '').includes(flag));
        const desc = row?.[1] ?? '';
        if (!COMPAT_MARKERS.test(desc)) {
            violations.push({
                command: cmd.name,
                gate: 'e',
                message: `table flag "${flag}" is absent from the hint and is not marked alias/compat/no-op/deprecated`,
            });
        }
    }

    return violations;
}

// ─── Core validation ────────────────────────────────────────────────────────

export function validate(root: string = process.cwd()): ValidationResult {
    const commandsDir = join(root, 'plugins', 'sp', 'commands');
    const skillsDir = join(root, 'plugins', 'sp', 'skills');

    const files = readdirSync(commandsDir)
        .filter((f) => f.endsWith('.md'))
        .sort();
    const allViolations: Violation[] = [];

    for (const file of files) {
        const name = file.replace(/\.md$/, '');
        const filePath = join(commandsDir, file);
        const cmd = parseCommand(filePath, name);

        allViolations.push(...checkHeadingWhitelist(cmd));
        allViolations.push(...checkFrontmatterSchema(cmd));
        allViolations.push(...checkTargetResolution(cmd, skillsDir, root));
        allViolations.push(...checkAllowedToolsCoherence(cmd));
        allViolations.push(...checkDevArgumentContract(cmd));
    }

    return { violations: allViolations, fileCount: files.length };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

export interface CliArgs {
    readonly check: boolean;
    readonly help: boolean;
    readonly json: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
    const args = new Set(argv);
    return {
        check: args.has('--check'),
        help: args.has('--help') || args.has('-h'),
        json: args.has('--json'),
    };
}

export function renderHelp(): string {
    return [
        'validate-commands — enforce the thin-wrapper contract on plugins/sp/commands/*.md',
        '',
        'Usage: bun plugins/sp/scripts/validate-commands.ts [--json]',
        '',
        'Options:',
        '  --json    Output JSON (default: human-readable)',
        '  --help    Show this help',
        '',
        'Gates:',
        '  (a) heading whitelist  — H1 title + per-contract ordered section headings',
        '  (b) frontmatter schema — description, argument-hint, allowed-tools present',
        '  (c) target resolution  — sp:<skill>, workflow, procedure anchor exist on disk',
        '  (d) allowed-tools coherence — Skill <-> Skill() call',
        '  (e) dev argument contract — syntax-only hint, Argument Flags table columns,',
        '      single glossary reference, and bidirectional hint↔table parity (dev-* only)',
    ].join('\n');
}

export interface CliResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
}

export function runCli(
    argv: string[],
    opts?: {
        validateFn?: (root: string) => ValidationResult;
    },
): CliResult {
    const args = parseCliArgs(argv);

    if (args.help) {
        return { exitCode: 0, stdout: renderHelp(), stderr: '' };
    }

    const v = (opts?.validateFn ?? validate)(process.cwd());

    if (args.json) {
        return { exitCode: v.violations.length > 0 ? 1 : 0, stdout: JSON.stringify(v), stderr: '' };
    }

    if (v.violations.length === 0) {
        const msg = `${v.fileCount} commands pass all 5 thin-wrapper gates.\n`;
        return { exitCode: 0, stdout: msg, stderr: '' };
    }

    const lines = v.violations.map((vi) => `(${vi.gate})\t${vi.command}\t${vi.message}`);
    const stderr = [
        `${v.violations.length} violation(s) across ${v.fileCount} commands:`,
        ...lines,
        '',
        'Fix the commands and re-run. Commands are hand-editable — no regeneration step.',
    ].join('\n');

    return { exitCode: 1, stdout: '', stderr };
}

/**
 * Entry-point boot — runs the CLI using process.argv. Tests inject exit /
 * stdout/stderr spies instead of spawning a subprocess.
 */
export function bootMain(
    argv: string[] = process.argv.slice(2),
    opts?: {
        exit?: (code?: number) => void;
        stdout?: { write(s: string): boolean };
        stderr?: { write(s: string): boolean };
        run?: (argv: string[]) => CliResult;
    },
): void {
    const result = (opts?.run ?? runCli)(argv);
    if (result.stdout) (opts?.stdout ?? process.stdout).write(result.stdout);
    if (result.stderr) (opts?.stderr ?? process.stderr).write(result.stderr);
    (opts?.exit ?? process.exit)(result.exitCode);
}

if (import.meta.main) {
    bootMain();
}
