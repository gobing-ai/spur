/**
 * validate-commands — thin-wrapper contract validator for plugin sp commands
 * (feature O, task 0309; ADR-032).
 *
 * Validates each plugins/sp/commands/<name>.md directly against the
 * thin-wrapper contract — no registry, no generation. The .md files are the
 * hand-editable SSOT; superskill owns per-platform emission.
 *
 * Gates:
 *  (a) heading whitelist — H1 title + exactly ## Usage + ## Implementation
 *  (b) frontmatter schema — description, argument-hint, allowed-tools
 *  (c) target resolution — sp:<skill> refs, workflow files, procedure anchors
 *  (d) allowed-tools coherence — Skill present iff body contains Skill() call
 *
 * Exit non-zero listing every violation on stderr.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Violation {
    /** Command basename without extension (dev-run). */
    readonly command: string;
    /** Gate tag (a|b|c|d). */
    readonly gate: 'a' | 'b' | 'c' | 'd';
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

    return { name, title, headings, description, argumentHint, allowedTools, body };
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

// ─── Gate (a): heading whitelist ────────────────────────────────────────────

const ALLOWED_HEADINGS: Record<string, true> = { Usage: true, Implementation: true };

/** The heading set every command must carry — exactly these, no more, no fewer. */
const REQUIRED_HEADINGS = ['Usage', 'Implementation'] as const;

function checkHeadingWhitelist(cmd: ParsedCommand): readonly Violation[] {
    const violations: Violation[] = [];

    // Forbidden: anything outside the whitelist, at any heading level.
    for (const h of cmd.headings) {
        if (!ALLOWED_HEADINGS[h]) {
            violations.push({
                command: cmd.name,
                gate: 'a',
                message: `forbidden heading "${h}" (allowed: ## Usage, ## Implementation)`,
            });
        }
    }

    // Missing: a wrapper that simply omits a required section must not pass.
    for (const required of REQUIRED_HEADINGS) {
        if (!cmd.headings.includes(required)) {
            violations.push({
                command: cmd.name,
                gate: 'a',
                message: `missing required heading "## ${required}"`,
            });
        }
    }

    // Duplicated: two `## Usage` sections is a malformed wrapper, not a thin one.
    for (const required of REQUIRED_HEADINGS) {
        if (cmd.headings.filter((h) => h === required).length > 1) {
            violations.push({
                command: cmd.name,
                gate: 'a',
                message: `duplicate heading "## ${required}"`,
            });
        }
    }

    return violations;
}

// ─── Gate (b): frontmatter schema ───────────────────────────────────────────

function checkFrontmatterSchema(cmd: ParsedCommand): readonly Violation[] {
    const violations: Violation[] = [];
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
        '  (a) heading whitelist  — only ## Usage + ## Implementation beyond the H1',
        '  (b) frontmatter schema — description, argument-hint, allowed-tools present',
        '  (c) target resolution  — sp:<skill>, workflow, procedure anchor exist on disk',
        '  (d) allowed-tools coherence — Skill <-> Skill() call',
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
        const msg = `${v.fileCount} commands pass all 4 thin-wrapper gates.\n`;
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
