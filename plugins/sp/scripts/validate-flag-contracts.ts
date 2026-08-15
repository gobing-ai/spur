/**
 * validate-flag-contracts — mechanical consistency gate for the sp contract surfaces.
 *
 * Compares flag claims across the five surfaces that document them — command files,
 * flag-glossary.md, cross-cutting.md, dev-operations.md, docs/00_ADR.md — and reports
 * disagreements. Extraction reads structured markers only (value tables, flag tables,
 * declaring-command parentheticals) — never free prose. A surface that cannot be parsed
 * fails loudly (named file + location), never silently skipped.
 *
 * Claim families (task 0415 / H82, extended 0480 / H1):
 *   C1   declaring commands per flag        glossary parenthetical lists ↔ command argument-hints
 *   C2   default value per flag per command command Argument Flags table ↔ dev-operations Inputs
 *   C3a  --agent value→behavior mapping     cross-cutting.md ↔ flag-glossary.md ↔ ADR-047 (ADR-041 legacy)
 *   C3b  --agent <name> in-file unanimity   within cross-cutting.md
 *   C4   --agent SSOT integrity             no reference restates the value table outside the SSOT
 *   C5   SSOT anchor resolution            every cross-cutting.md#anchor link names a real heading
 *
 * Authority ordering (R6): command files own declaring commands (C1) and local defaults
 * (C2); cross-cutting.md owns the execution-surface mapping (C3) — glossary and ADR are
 * derived and must agree with it. C4 (R8/task 0480) guards R1: only cross-cutting.md and
 * flag-glossary.md (the C3a parity surface) may state the value table; every other surface
 * links to the SSOT anchor instead. C5 guards the other half of R1: a pointer to a
 * non-existent anchor is not a link to the SSOT — it silently drops the reader at the top
 * of the file. Substring assertions cannot catch this (a wrong longer anchor contains the
 * right shorter one as a prefix), which is how 14 dangling pointers shipped in 0480.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SurfaceClaim {
    readonly name: string;
    readonly claim: string;
}

export interface FlagViolation {
    /** Flag under dispute, e.g. `--agent`. */
    readonly flag: string;
    /** Claim family tag (C1 | C2 | C3a | C3b | C4 | C5). */
    readonly gate: 'C1' | 'C2' | 'C3a' | 'C3b' | 'C4' | 'C5';
    /** Every surface that stated a claim and what it stated. */
    readonly surfaces: readonly SurfaceClaim[];
    /** Designated authority surface for this claim. */
    readonly authority: string;
    /** Human-readable description of the disagreement. */
    readonly message: string;
}

export interface FlagValidationResult {
    readonly violations: readonly FlagViolation[];
    readonly fileCount: number;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Slice from the first match of `startRe` (anchored to a line start) up to the next
 * heading at the same level (`## ` / `### `) or end of input. `\Z` is not a valid JS
 * anchor, so end-of-input is handled by index arithmetic, not a lookahead.
 */
function sectionBetween(raw: string, startRe: RegExp, nextHeading: '## ' | '### '): string | undefined {
    const start = raw.match(startRe);
    if (!start || start.index === undefined) return undefined;
    const from = start.index;
    const next = raw.indexOf(`\n${nextHeading}`, from + start[0].length);
    return next === -1 ? raw.slice(from) : raw.slice(from, next);
}

/** Extract `--flag` tokens from a string (same regex as command-flag-parity.test.ts). */
function extractFlags(text: string): Set<string> {
    const flags = new Set<string>();
    for (const m of text.matchAll(/(--[a-z][a-z-]*)/g)) {
        flags.add(m[1]);
    }
    return flags;
}

/** Flags declared as `--flag (deprecated)` — not active declarers. */
function deprecatedFlagSet(hint: string): Set<string> {
    const out = new Set<string>();
    for (const m of hint.matchAll(/(--[a-z][a-z-]*)\s*\(deprecated\)/g)) {
        out.add(m[1]);
    }
    return out;
}

/** Extract the `argument-hint:` value from a command .md frontmatter. */
function argumentHint(raw: string): string | undefined {
    return raw.match(/^argument-hint:\s*"(.*)"\s*$/m)?.[1];
}

// ─── C1 — glossary declaring-commands vs command argument-hints ─────────────

interface GlossaryEntry {
    readonly flag: string;
    /** First paragraph after the **Anchor:** line. */
    readonly firstParagraph: string;
}

/** Split the glossary into entries: `### \`--flag …\`` … next `### ` (or `#### ` child stays). */
function glossaryEntries(glossaryRaw: string): GlossaryEntry[] {
    const out: GlossaryEntry[] = [];
    const entryRe = /^### `(--[a-z][a-z-]*)[^\n]*$/gm;
    for (const m of glossaryRaw.matchAll(entryRe)) {
        const flag = m[1];
        if (m.index === undefined) continue;
        const bodyStart = m.index + m[0].length;
        const next = glossaryRaw.indexOf('\n### ', bodyStart);
        const body = next === -1 ? glossaryRaw.slice(bodyStart) : glossaryRaw.slice(bodyStart, next);

        const anchor = body.indexOf('**Anchor:**');
        if (anchor === -1) continue; // no anchor line → no structured claim
        const afterAnchor = body.slice(anchor + '**Anchor:**'.length);
        // Skip the anchor value line, take the first paragraph (up to blank line).
        const nl = afterAnchor.indexOf('\n');
        const rest = nl === -1 ? '' : afterAnchor.slice(nl + 1);
        const para = rest.replace(/^\n+/, '').split(/\n\s*\n/)[0] ?? '';
        out.push({ flag, firstParagraph: para });
    }
    return out;
}

/**
 * A glossary declaring-commands claim: a parenthetical in the first paragraph listing ≥2
 * distinct backticked `dev-*` names. Single-name parentheticals are explanatory mentions
 * (e.g. `--feature` "feature-advancing commands (`dev-wrapall`)"), not enumerations —
 * excluded by the ≥2 rule.
 */
function glossaryDeclaringClaims(glossaryRaw: string): Map<string, Set<string>> {
    const claims = new Map<string, Set<string>>();
    for (const { flag, firstParagraph } of glossaryEntries(glossaryRaw)) {
        const names = new Set<string>();
        for (const paren of firstParagraph.matchAll(/\(([^)]*)\)/g)) {
            for (const n of paren[1].matchAll(/`(dev-[a-z-]+)`/g)) {
                names.add(n[1]);
            }
        }
        if (names.size >= 2) claims.set(flag, names);
    }
    return claims;
}

/**
 * Authority: commands whose argument-hint declares the flag, minus `(deprecated)`-marked
 * declarations (e.g. `dev-review --fix` — the hint itself marks it deprecated).
 */
function commandAuthority(commandHints: ReadonlyMap<string, string>): Map<string, Set<string>> {
    const authority = new Map<string, Set<string>>();
    for (const [command, hint] of commandHints) {
        const deprecated = deprecatedFlagSet(hint);
        for (const flag of extractFlags(hint)) {
            if (deprecated.has(flag)) continue;
            authority.set(flag, new Set([...(authority.get(flag) ?? []), command]));
        }
    }
    return authority;
}

/**
 * For every glossary entry whose first paragraph carries a parenthetical listing ≥2
 * backticked dev-* names, the listed set must EXACTLY equal the authority set (commands
 * whose argument-hint declares the flag, minus `(deprecated)`-marked declarations).
 * Exact equality catches both directions: naming a command that never declared the flag
 * (drift #3 false positive) and omitting one that did (drift #3 omission).
 */
export function checkGlossaryMembership(
    glossaryRaw: string,
    commandHints: ReadonlyMap<string, string>,
): FlagViolation[] {
    const violations: FlagViolation[] = [];
    const authority = commandAuthority(commandHints);

    for (const [flag, glossaryNames] of glossaryDeclaringClaims(glossaryRaw)) {
        const authorityNames = authority.get(flag) ?? new Set<string>();
        if (glossaryNames.size === authorityNames.size && [...glossaryNames].every((n) => authorityNames.has(n))) {
            continue;
        }
        const extra = [...glossaryNames].filter((n) => !authorityNames.has(n));
        const missing = [...authorityNames].filter((n) => !glossaryNames.has(n));
        const bits: string[] = [];
        if (extra.length) bits.push(`names ${extra.join(', ')} that never declared it`);
        if (missing.length) bits.push(`omits ${missing.join(', ')} that declared it`);
        violations.push({
            flag,
            gate: 'C1',
            surfaces: [
                {
                    name: 'flag-glossary.md',
                    claim: `declaring commands listed: ${[...glossaryNames].sort().join(', ')}`,
                },
                {
                    name: 'command files (argument-hints)',
                    claim: `declaring commands: ${[...authorityNames].sort().join(', ') || '(none)'}`,
                },
            ],
            authority: 'command files',
            message: `glossary declaring-commands list for ${flag} ${bits.join('; ')}`,
        });
    }
    return violations;
}

// ─── C2 — command Argument Flags table defaults vs dev-operations Inputs ─────

/** Parse a command file's `## Argument Flags` table: flag -> Default cell. */
function commandTableDefaults(commandRaw: string): Map<string, string> {
    const out = new Map<string, string>();
    const start = commandRaw.match(/^## Argument Flags\s*\n/m);
    if (!start || start.index === undefined) return out;
    const from = start.index + start[0].length;
    const next = commandRaw.indexOf('\n## ', from);
    const table = (next === -1 ? commandRaw.slice(from) : commandRaw.slice(from, next)).split(/\n\s*\n/)[0];
    // Split on unescaped pipes only (same as validate-commands.ts parseMarkdownTable),
    // then unescape `\|` → `|` per cell.
    const split = (row: string): string[] =>
        row
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split(/(?<!\\)\|/)
            .map((c) => c.trim().replace(/\\\|/g, '|'));
    for (const line of table.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) continue;
        const cells = split(trimmed);
        if (cells.length < 3 || cells[0].startsWith('---') || cells[0] === 'Flag') continue;
        const flag = cells[0].replace(/`/g, '').split(/\s/)[0];
        if (!flag.startsWith('--')) continue;
        out.set(flag, cells[2].replace(/[`*]/g, '').trim());
    }
    return out;
}

/** Operation-map rows: `| <n> | <op> | \`dev-<cmd>\` | …` → command -> section header token. */
function commandToOpHeader(opsRaw: string): Map<string, string> {
    const map = new Map<string, string>();
    const rowRe = /^\|\s*(\d+[a-z]?)\s*\|\s*([a-z-]+)\s*\|\s*`(dev-[a-z-]+)`/;
    for (const line of opsRaw.split('\n')) {
        const m = line.match(rowRe);
        if (m) map.set(m[3], `${m[1]}. ${m[2]}`);
    }
    return map;
}

/** Parse a dev-operations.md operation section body: flag -> (default value, verbatim claim). */
function opsSectionDefaults(sectionBody: string): Map<string, { value: string; claim: string }> {
    const out = new Map<string, { value: string; claim: string }>();
    for (const line of sectionBody.split('\n')) {
        // Pair each default marker with the flag mentioned immediately before it on the line.
        const flags: Array<{ name: string; index: number }> = [];
        for (const m of line.matchAll(/`(--[a-z][a-z-]*)(?: <[^>]+>)?`/g)) {
            flags.push({ name: m[1], index: m.index });
        }
        for (const m of line.matchAll(/\(default:?\s*\*?\*?`?([^`);]+?)\s*`?[;)]/g)) {
            const value = m[1].replace(/[`*]/g, '').trim();
            const preceding = flags.filter((f) => f.index < m.index).pop();
            if (!preceding) continue;
            out.set(preceding.name, { value, claim: line.trim() });
        }
        // `X (default)` trailing form (e.g. "**`full`** (default):" in Modes prose).
        for (const m of line.matchAll(/`([^`]+)`\s*\(default\)/g)) {
            out.set(m[1], { value: m[1], claim: line.trim() });
        }
    }
    return out;
}

/** Light vocabulary normalization for default cells (synonym groups only, no semantics). */
function normalizeDefault(v: string): string {
    const s = v.toLowerCase().replace(/\s+/g, ' ').trim();
    const synonyms: Record<string, string> = {
        'latest tag': 'last tag',
        detected: 'auto-detect',
        'auto-detect from latest tag': 'auto-detect',
        halt: 'off',
        halts: 'off',
        'halts on first failure': 'off',
    };
    return synonyms[s] ?? s;
}

/**
 * For each (command, flag) where the command's Argument Flags table Default column and the
 * matching dev-operations.md operation Inputs both state a default, they must agree after
 * light normalization. Authority: the command file owns local defaults (R6).
 */
export function checkDefaultsParity(commandTables: ReadonlyMap<string, string>, opsRaw: string): FlagViolation[] {
    const violations: FlagViolation[] = [];
    const opHeader = commandToOpHeader(opsRaw);

    for (const [command, commandRaw] of commandTables) {
        const tableDefaults = commandTableDefaults(commandRaw);
        if (tableDefaults.size === 0) continue;

        const header = opHeader.get(command);
        if (!header) continue; // no operation-map row → no ops Inputs claim to compare
        const section = sectionBetween(
            opsRaw,
            new RegExp(`^### ${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'),
            '### ',
        );
        if (!section) continue;
        const opsDefaults = opsSectionDefaults(section);

        for (const [flag, tableValue] of tableDefaults) {
            const opsClaim = opsDefaults.get(flag);
            if (!opsClaim) continue; // ops states no default → no claim to compare
            if (normalizeDefault(tableValue) === normalizeDefault(opsClaim.value)) continue;
            violations.push({
                flag,
                gate: 'C2',
                surfaces: [
                    { name: 'command file', claim: `Default: ${tableValue}` },
                    { name: 'dev-operations.md', claim: opsClaim.claim },
                ],
                authority: 'command file',
                message: `${command} Argument Flags table says ${flag} default ${tableValue}; dev-operations.md Inputs says ${opsClaim.value}`,
            });
        }
    }
    return violations;
}

// ─── C3 — --agent value→behavior mapping ────────────────────────────────────

export interface SurfaceBehavior {
    readonly surfaces: ReadonlySet<'inline' | 'subprocess'>;
    /** True when the claim is conditional on the executor being the current session. */
    readonly conditional: boolean;
    /** True when the row marks the value as the default when the flag is omitted. */
    readonly defaultWhenOmitted: boolean;
}

/**
 * Normalize a "Derived surface" cell to the surface set it positively asserts. Clauses are
 * split on `;` / `—` / `,`; negated clauses ("does not force subprocess") contribute
 * nothing. `<name>` behavior is conditional when a "when/otherwise/if" marker appears.
 */
export function normalizeSurfaceCell(cell: string): SurfaceBehavior {
    const surfaces = new Set<'inline' | 'subprocess'>();
    const conditional = /\b(when|otherwise|if)\b/.test(cell);
    for (const clause of cell.split(/[;,—]/)) {
        const c = clause.toLowerCase();
        if (/\b(not|no|never)\b/.test(c)) continue; // negated clause asserts nothing
        if (c.includes('inline')) surfaces.add('inline');
        if (c.includes('subprocess')) surfaces.add('subprocess');
    }
    return { surfaces, conditional, defaultWhenOmitted: false };
}

/**
 * Parse the `| Value | Who does the work | Derived surface |` table from a raw surface.
 * Exported so tests assert on the extracted claim (R3) instead of pinning prose.
 */
export function extractValueBehaviorTable(
    raw: string,
    heading: '## Inline-default execution surface' | '### `--agent',
): Map<string, SurfaceBehavior> | null {
    const section = sectionBetween(
        raw,
        new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'),
        heading.startsWith('##') ? '## ' : '### ',
    );
    if (!section) return null;
    const out = new Map<string, SurfaceBehavior>();
    for (const line of section.split('\n')) {
        const cells = line
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim());
        if (cells.length < 3 || cells[0].startsWith('---') || cells[0] === 'Value') continue;
        const valueCell = cells[0].replace(/`/g, '').trim();
        const value = valueCell.split(/\s/)[0];
        if (value !== 'inline' && value !== 'auto' && value !== '<name>') continue;
        const behavior = normalizeSurfaceCell(cells[2]);
        out.set(value, { ...behavior, defaultWhenOmitted: /default when omitted/i.test(valueCell) });
    }
    return out.size === 3 ? out : null;
}

/**
 * Parse the escalation-trigger table (`| Trigger | Subprocess condition | Required report |`)
 * in the inline-default section. Exported so tests assert on the extracted claim (R3).
 */
export function extractTriggerTable(crossCuttingRaw: string): string[] | null {
    const section = sectionBetween(crossCuttingRaw, /^## Inline-default execution surface/m, '## ');
    if (!section) return null;
    const header = section.match(/^\| Trigger \| Subprocess condition \| Required report \|\s*$/m);
    if (!header) return null;
    const rows: string[] = [];
    for (const line of section.slice(header.index).split('\n')) {
        const cells = line
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim());
        if (cells.length < 3 || cells[0].startsWith('---')) continue;
        if (cells[0] === 'Trigger') continue;
        rows.push(cells[0].replace(/\*\*/g, '').replace(/\.\s*$/, ''));
    }
    return rows.length >= 4 ? rows : null;
}

/** ADR-041/ADR-047 participation: the rule sentence and the collapse mapping (marker tokens). */
function adrAgentClaims(adrRaw: string): Map<string, SurfaceBehavior> | null {
    if (adrRaw.includes('## ADR-047')) {
        const out = new Map<string, SurfaceBehavior>();
        // G5 amendment (feature G5 / task 0565): explicit inline is host-session-only — headless
        // surfaces reject it with the stable special error; 0508 native-subagent eligibility
        // applies to omitted --agent only, never explicit inline.
        out.set('inline', {
            surfaces: new Set(['inline']),
            conditional: false,
            defaultWhenOmitted: false,
        });
        out.set('auto', { surfaces: new Set(['subprocess']), conditional: false });
        out.set('<name>', { surfaces: new Set(['inline', 'subprocess']), conditional: true });
        return out;
    }
    // Slice from the `## ADR-041` heading to the next `## ADR-` heading or end of input
    // (index arithmetic — `\Z`-style lookaheads are unreliable with the `m` flag).
    const start = adrRaw.match(/^## ADR-041[^\n]*$/m);
    if (!start || start.index === undefined) return null;
    const bodyStart = start.index + start[0].length;
    const next = adrRaw.indexOf('\n## ADR-', bodyStart);
    const section = next === -1 ? adrRaw.slice(bodyStart) : adrRaw.slice(bodyStart, next);
    if (!section) return null;
    const out = new Map<string, SurfaceBehavior>();
    // Rule sentence: "if the named executor is … inline; otherwise … subprocess" → <name> conditional.
    if (/the work happens inline;\s*otherwise it dispatches a subprocess/.test(section)) {
        out.set('<name>', { surfaces: new Set(['inline', 'subprocess']), conditional: true });
    }
    // Collapse mapping: `--subprocess` → `--agent <target>`. The target value's behavior is
    // claimed by the mapping itself — parse the target generically so a drifted mapping
    // (e.g. `→ --agent inline`) is a *stated* claim that disagrees with the value table,
    // not an absent claim (R1: stated semantics must be compared). The backtick after
    // `--subprocess` is matched explicitly (`` `--subprocess` `` in the source).
    const subprocessTarget = section.match(/--subprocess`\s*→\s*`--agent ([a-z]+)/)?.[1];
    if (subprocessTarget === 'auto') {
        out.set('auto', { surfaces: new Set(['subprocess']), conditional: false });
    } else if (subprocessTarget === 'inline') {
        out.set('auto', { surfaces: new Set(['inline']), conditional: false });
    }
    if (/--inline`\s*→\s*`--agent inline/.test(section)) {
        out.set('inline', { surfaces: new Set(['inline']), conditional: false });
    }
    return out.size === 0 ? null : out;
}

function behaviorClaim(b: SurfaceBehavior): string {
    const s = [...b.surfaces].sort().join(' + ');
    const cond = b.conditional ? ' (conditional on current session)' : '';
    const def = b.defaultWhenOmitted ? ' (default when omitted)' : '';
    return `${s}${cond}${def}`;
}

function behaviorAgree(a: SurfaceBehavior, b: SurfaceBehavior): boolean {
    if (a.surfaces.size !== b.surfaces.size) return false;
    return [...a.surfaces].every((s) => b.surfaces.has(s)) && a.conditional === b.conditional;
}

/**
 * C3a (cross-file): the `| Value | … | Derived surface |` table in cross-cutting.md
 * ("Inline-default execution surface") and the #flag-agent entry in flag-glossary.md must
 * agree row-for-row on each value's derived surface. ADR-041 participates via its rule
 * sentence and collapse mapping.
 * C3b (in-file): within cross-cutting.md's section, every claim about <name>'s derived
 * surface — the one-rule blockquote, the value-table row, and any numbered
 * "Resolution order"-style list — must agree (all conditional).
 */
export function checkAgentValueTables(crossCuttingRaw: string, glossaryRaw: string, adrRaw: string): FlagViolation[] {
    const violations: FlagViolation[] = [];

    // ── C3a: cross-file table parity ──────────────────────────────────────
    const ccTable = extractValueBehaviorTable(crossCuttingRaw, '## Inline-default execution surface');
    const glossaryTable = extractValueBehaviorTable(glossaryRaw, '### `--agent');
    const surfaces: SurfaceClaim[] = [];

    if (ccTable === null) {
        violations.push({
            flag: '--agent',
            gate: 'C3a',
            surfaces: [{ name: 'cross-cutting.md', claim: 'value table not parseable (missing section or 3 rows)' }],
            authority: 'cross-cutting.md',
            message:
                'cross-cutting.md "Inline-default execution surface" value table missing or malformed — loud failure, not silent skip',
        });
    }
    if (glossaryTable === null) {
        violations.push({
            flag: '--agent',
            gate: 'C3a',
            surfaces: [
                { name: 'flag-glossary.md', claim: 'value table not parseable (missing #flag-agent entry or 3 rows)' },
            ],
            authority: 'cross-cutting.md',
            message: 'flag-glossary.md #flag-agent value table missing or malformed — loud failure, not silent skip',
        });
    }
    if (ccTable !== null) {
        surfaces.push({
            name: 'cross-cutting.md',
            claim: [...ccTable].map(([v, b]) => `${v} → ${behaviorClaim(b)}`).join('; '),
        });
    }
    if (glossaryTable !== null) {
        surfaces.push({
            name: 'flag-glossary.md',
            claim: [...glossaryTable].map(([v, b]) => `${v} → ${behaviorClaim(b)}`).join('; '),
        });
    }
    if (ccTable !== null && glossaryTable !== null) {
        for (const value of ['inline', 'auto', '<name>']) {
            const cc = ccTable.get(value);
            const gl = glossaryTable.get(value);
            if (cc === undefined || gl === undefined) continue;
            if (!behaviorAgree(cc, gl) || cc.defaultWhenOmitted !== gl.defaultWhenOmitted) {
                violations.push({
                    flag: '--agent',
                    gate: 'C3a',
                    surfaces,
                    authority: 'cross-cutting.md',
                    message: `--agent value ${value}: cross-cutting.md says ${behaviorClaim(cc)}; flag-glossary.md says ${behaviorClaim(gl)}`,
                });
            }
        }
    }

    // ── ADR-041 participation ─────────────────────────────────────────────
    const adr = adrRaw ? adrAgentClaims(adrRaw) : null;
    if (adr !== null && ccTable !== null) {
        for (const [value, adrBehavior] of adr) {
            const cc = ccTable.get(value);
            if (cc !== undefined && !behaviorAgree(cc, adrBehavior)) {
                violations.push({
                    flag: '--agent',
                    gate: 'C3a',
                    surfaces: [
                        { name: 'docs/00_ADR.md', claim: `ADR-041: ${value} → ${behaviorClaim(adrBehavior)}` },
                        { name: 'cross-cutting.md', claim: `value table: ${value} → ${behaviorClaim(cc)}` },
                    ],
                    authority: 'cross-cutting.md',
                    message: `--agent value ${value}: ADR-041 says ${behaviorClaim(adrBehavior)}; cross-cutting.md says ${behaviorClaim(cc)}`,
                });
            }
        }
    }

    // ── C3b: in-file unanimity within cross-cutting.md ────────────────────
    const section = sectionBetween(crossCuttingRaw, /^## Inline-default execution surface/m, '## ');
    if (section) {
        const claims: Array<{ source: string; behavior: SurfaceBehavior }> = [];

        // 1. The one-rule blockquote (first `>` block under "### The one rule"). This is
        //    the anchor claim of the whole section — missing ⇒ loud failure, never silent
        //    skip (R2).
        const oneRule = section.match(/^### The one rule\s*\n(>.*(?:\n>.*)*)/m)?.[1];
        if (!oneRule) {
            violations.push({
                flag: '--agent',
                gate: 'C3b',
                surfaces: [{ name: 'cross-cutting.md', claim: 'one-rule blockquote missing under "### The one rule"' }],
                authority: 'cross-cutting.md',
                message:
                    'cross-cutting.md "The one rule" blockquote missing or malformed — loud failure, not silent skip',
            });
        } else {
            claims.push({ source: 'the one rule', behavior: normalizeSurfaceCell(oneRule.replace(/^>\s?/gm, ' ')) });
        }

        // 2. The value-table <name> row (already parsed above).
        const ccName = ccTable?.get('<name>');
        if (ccName) claims.push({ source: 'value table <name> row', behavior: ccName });

        // 3. Any numbered list item in the section asserting <name>'s surface.
        for (const m of section.matchAll(/^\s*\d+\.\s+.*`(--agent <name>|<name>)`.*$/gm)) {
            claims.push({
                source: `resolution-order item: ${m[0].trim().slice(0, 80)}`,
                behavior: normalizeSurfaceCell(m[0]),
            });
        }

        const baseline = claims[0];
        if (baseline) {
            for (const claim of claims.slice(1)) {
                if (behaviorAgree(baseline.behavior, claim.behavior)) continue;
                violations.push({
                    flag: '--agent',
                    gate: 'C3b',
                    surfaces: claims.map((c) => ({ name: c.source, claim: behaviorClaim(c.behavior) })),
                    authority: 'cross-cutting.md',
                    message: `cross-cutting.md contradicts itself on --agent <name>: ${baseline.source} says ${behaviorClaim(baseline.behavior)} but ${claim.source} says ${behaviorClaim(claim.behavior)}`,
                });
            }
        }
    }

    return violations;
}

// ─── C4: --agent SSOT integrity (R8 / task 0480) ────────────────────────────

/**
 * Files permitted to state the `--agent` value table. cross-cutting.md is the SSOT (R1);
 * flag-glossary.md is the C3a parity surface that is kept in lockstep. No other reference,
 * help file, or command document may restate the table — it must link to the SSOT anchor.
 */
const SSOT_FILES: Record<string, true> = { 'cross-cutting.md': true, 'flag-glossary.md': true };

/**
 * Detect a paraphrased `--agent` value table: a markdown table whose first column contains
 * all three value tokens (`inline`, `auto`, `<name>`) within a single table block. This is
 * the structural signature of the value table, not a prose match — it fires on any table
 * that restates the full three-value contract regardless of wording in other columns.
 *
 * Exempt: the SSOT (cross-cutting.md) and the C3a parity surface (flag-glossary.md).
 * Returns one violation per offending file, naming the file and the detected table header.
 */
export function checkAgentSsotIntegrity(files: ReadonlyMap<string, string>): FlagViolation[] {
    const violations: FlagViolation[] = [];
    for (const [filename, raw] of files) {
        if (filename in SSOT_FILES) continue;
        // Split into table blocks: consecutive lines starting with `|`
        const tableBlocks: string[][] = [];
        let current: string[] = [];
        for (const line of raw.split('\n')) {
            if (line.trim().startsWith('|')) {
                current.push(line);
            } else {
                if (current.length > 0) tableBlocks.push(current);
                current = [];
            }
        }
        if (current.length > 0) tableBlocks.push(current);

        for (const block of tableBlocks) {
            const valuesFound = new Set<string>();
            for (const row of block) {
                const firstCell = row.replace(/^\|/, '').split('|')[0].replace(/`/g, '').trim();
                const token = firstCell.split(/\s/)[0].toLowerCase();
                if (token === 'inline' || token === 'auto' || token === '<name>') {
                    valuesFound.add(token);
                }
            }
            if (valuesFound.size === 3) {
                violations.push({
                    flag: '--agent',
                    gate: 'C4',
                    surfaces: [
                        {
                            name: filename,
                            claim: `restates --agent value table (${[...valuesFound].sort().join(', ')})`,
                        },
                    ],
                    authority: 'cross-cutting.md § Inline-default execution surface',
                    message: `${filename} restates the --agent value table instead of linking to the SSOT anchor. See cross-cutting.md § Inline-default execution surface.`,
                });
                break; // one violation per file is enough
            }
        }
    }
    return violations;
}

// ─── C5: SSOT anchor resolution (task 0480 R1 regression guard) ─────────────

/**
 * GitHub's heading→anchor slug: lowercase, drop everything that is not a word
 * character, space, or hyphen, then spaces → hyphens. `## Executor precedence chain (R7)`
 * → `executor-precedence-chain-r7`; `` ## Inline-default execution surface `` →
 * `inline-default-execution-surface`.
 */
export function headingSlug(heading: string): string {
    return heading
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s/g, '-');
}

/** Every anchor a reader can actually land on in `raw` (all heading levels). */
export function headingAnchors(raw: string): Set<string> {
    const anchors = new Set<string>();
    for (const line of raw.split('\n')) {
        const m = line.match(/^#{1,6}\s+(.*)$/);
        if (m) anchors.add(headingSlug(m[1]));
    }
    return anchors;
}

/**
 * Detect `cross-cutting.md#<anchor>` links whose anchor names no heading in the SSOT file.
 * A dangling anchor satisfies every substring assertion in the suite (the correct short
 * anchor is a prefix of the wrong long one) while landing the reader nowhere near the
 * contract, so R1's "every other mention is a link to that anchor" decays undetected.
 *
 * @param crossCuttingRaw - contents of the SSOT file, the anchor authority
 * @param files - candidate linking surfaces, keyed by display name
 */
export function checkSsotAnchorsResolve(crossCuttingRaw: string, files: ReadonlyMap<string, string>): FlagViolation[] {
    const anchors = headingAnchors(crossCuttingRaw);
    const violations: FlagViolation[] = [];
    for (const [filename, raw] of files) {
        const seen = new Set<string>();
        for (const m of raw.matchAll(/cross-cutting\.md#([\w-]+)/g)) {
            const anchor = m[1];
            if (anchors.has(anchor) || seen.has(anchor)) continue;
            seen.add(anchor);
            violations.push({
                flag: '--agent',
                gate: 'C5',
                surfaces: [{ name: filename, claim: `links to cross-cutting.md#${anchor}` }],
                authority: 'cross-cutting.md headings',
                message: `${filename} links to cross-cutting.md#${anchor}, which names no heading in cross-cutting.md. The link drops the reader at the top of the file instead of the SSOT anchor.`,
            });
        }
    }
    return violations;
}

// ─── Full-tree gate ─────────────────────────────────────────────────────────

// ── R4: module-relative default so validate() is CWD-independent ──
const SCRIPT_DIR: string = typeof import.meta.dir === 'string' ? import.meta.dir : join(__dirname);
const MODULE_ROOT: string = join(SCRIPT_DIR, '..', '..', '..');

export function validate(root: string = MODULE_ROOT): FlagValidationResult {
    const commandsDir = join(root, 'plugins', 'sp', 'commands');
    const refsDir = join(root, 'plugins', 'sp', 'skills', 'spur-dev', 'references');

    const commandHints = new Map<string, string>();
    const commandTables = new Map<string, string>();
    const commandFiles: string[] = [];
    for (const file of readdirSync(commandsDir)
        .filter((f) => f.startsWith('dev-') && f.endsWith('.md'))
        .sort()) {
        const raw = readFileSync(join(commandsDir, file), 'utf8');
        const hint = argumentHint(raw);
        if (hint) commandHints.set(file.replace(/\.md$/, ''), hint);
        commandTables.set(file.replace(/\.md$/, ''), raw);
        commandFiles.push(file);
    }

    const glossaryRaw = readFileSync(join(refsDir, 'flag-glossary.md'), 'utf8');
    const crossCuttingRaw = readFileSync(join(refsDir, 'cross-cutting.md'), 'utf8');
    const opsRaw = readFileSync(join(refsDir, 'dev-operations.md'), 'utf8');
    const adrRaw = readFileSync(join(root, 'docs', '00_ADR.md'), 'utf8');

    // C4: scan all reference + help files for paraphrased --agent value tables
    // (cross-cutting.md and flag-glossary.md are exempt as SSOT + parity surface)
    const c4Files = new Map<string, string>();
    for (const file of readdirSync(refsDir).filter((f) => f.endsWith('.md'))) {
        c4Files.set(file, readFileSync(join(refsDir, file), 'utf8'));
    }
    const helpDir = join(root, 'docs', 'help');
    for (const file of readdirSync(helpDir).filter((f) => f.endsWith('.md'))) {
        c4Files.set(file, readFileSync(join(helpDir, file), 'utf8'));
    }
    const c4Count = c4Files.size;

    // C5: anchor resolution over every surface that can link to the SSOT — the C4 set
    // (references + help) plus the command files, which carry the contract pointer too.
    const c5Files = new Map<string, string>(c4Files);
    for (const [name, raw] of commandTables) c5Files.set(`${name}.md`, raw);

    const violations: FlagViolation[] = [
        ...checkGlossaryMembership(glossaryRaw, commandHints),
        ...checkDefaultsParity(commandTables, opsRaw),
        ...checkAgentValueTables(crossCuttingRaw, glossaryRaw, adrRaw),
        ...checkAgentSsotIntegrity(c4Files),
        ...checkSsotAnchorsResolve(crossCuttingRaw, c5Files),
    ];

    return { violations, fileCount: commandFiles.length + 4 + c4Count };
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
        'validate-flag-contracts — cross-surface flag parity gate for the sp contract surfaces',
        '',
        'Usage: bun plugins/sp/scripts/validate-flag-contracts.ts [--json]',
        '',
        'Options:',
        '  --json    Output JSON (default: human-readable)',
        '  --help    Show this help',
        '',
        'Gates:',
        '  C1   glossary declaring-command lists ↔ command argument-hints (exact equality)',
        '  C2   command Argument Flags table defaults ↔ dev-operations.md Inputs',
        '  C3a  --agent value→behavior table: cross-cutting.md ↔ flag-glossary.md ↔ ADR-047 (ADR-041 legacy)',
        '  C3b  --agent <name> in-file unanimity within cross-cutting.md',
        '  C4   --agent SSOT integrity: no reference restates the value table outside cross-cutting.md / flag-glossary.md',
        '  C5   SSOT anchor resolution: every cross-cutting.md#anchor link names a real heading',
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
        validateFn?: (root: string) => FlagValidationResult;
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
        return { exitCode: 0, stdout: `All ${v.fileCount} contract surfaces agree across all claims.\n`, stderr: '' };
    }

    const lines = v.violations.map(
        (vi) =>
            `(${vi.gate})\t${vi.flag}\t${vi.surfaces.map((s) => `${s.name}: ${s.claim}`).join(' | ')}\t[authority: ${vi.authority}]\t${vi.message}`,
    );
    const stderr = [
        `${v.violations.length} cross-surface disagreement(s):`,
        ...lines,
        '',
        'Fix the surface that disagrees with the authority and re-run.',
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
