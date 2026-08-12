/**
 * cli-surface.ts — source-local CLI surface capture for the parity harness (task 0512, feature I2).
 *
 * This helper is the single capture layer behind the spur-cli/spur-dev parity gate. It invokes
 * the MONOREPO CLI entry directly (`apps/cli/src/index.ts` through Bun) — never a bare PATH
 * `spur` — so a stale global binary can never silently validate the wrong surface, and every
 * capture carries provenance (resolved entry path + `@gobing-ai/spur` version).
 *
 * Scope note (R2): published npm `spur` may lag the source-local monorepo CLI. This gate is
 * deterministic ONLY for the source-local surface — it validates the monorepo CLI as built in
 * this repository and cannot catch skew on end-user npm installs. Arbitrary published
 * installations are explicitly outside this parity gate (docs/design/plugin-surface-parity.md §2).
 *
 * Frozen exports consumed by downstream tasks: `captureCliSurface` (0516 scope parsers,
 * 0517 focused parity suite), `parseCommanderHelp` (fixture assertions), and the 0516 scope
 * parsers `parseTierCExclusions` / `parseSpineRoutes` / `parseOwnershipMarkers` (explicit
 * exclusions + ADR-054 boundary, consumed by 0517). The Commander adapter is a NARROW
 * adapter for `Commands:`/`Options:` blocks only — not a general help parser.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const CLI_ENTRY = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
const CLI_PACKAGE_JSON = join(REPO_ROOT, 'apps', 'cli', 'package.json');

export interface CliSurfaceProvenance {
    /** Absolute path to the source-local CLI entry that was captured. */
    entryPath: string;
    packageName: '@gobing-ai/spur';
    /** Read dynamically from apps/cli/package.json — never pinned. */
    packageVersion: string;
}

export interface CliSurfaceCapture {
    /** Commands from the Commander `Commands:` block (empty when the block is absent). */
    commands: string[];
    /** Flags from the Commander `Options:` block (empty when the block is absent). */
    flags: string[];
    provenance: CliSurfaceProvenance;
}

/** Collect the indented lines of a Commander block (`Commands:` / `Options:`), or null when the header is absent. */
function commanderBlock(text: string, header: string): string[] | null {
    const lines = text.split(/\r?\n/);
    const start = lines.indexOf(header);
    if (start === -1) {
        return null;
    }
    const block: string[] = [];
    for (let i = start + 1; i < lines.length && /^ {2}/.test(lines[i]); i++) {
        block.push(lines[i]);
    }
    return block;
}

/**
 * Parse Commander `Commands:` and `Options:` blocks from `--help` text.
 * Returns sorted, deduplicated arrays; a block that is absent yields an empty array.
 * Throws when neither block is present — the text is not Commander help, and parsing
 * it silently would mask a broken capture (fail loudly, per the 0512 contract).
 */
export function parseCommanderHelp(text: string): { commands: string[]; flags: string[] } {
    // A command entry starts at the 2-space indent with its token; continuation lines
    // (description wraps, aligned to the description column) are indented deeper and must
    // NOT inject phantom commands — the first word of a wrapped description is not a verb.
    const commands =
        commanderBlock(text, 'Commands:')
            ?.map((line) => line.match(/^ {2}(\S+)/)?.[1] ?? '')
            .filter(Boolean) ?? [];
    const flags =
        commanderBlock(text, 'Options:')?.flatMap((line) =>
            [...line.matchAll(/(?:^|\s)(-{1,2}[A-Za-z][A-Za-z0-9-]*)/g)].map((m) => m[1]),
        ) ?? [];
    if (commands.length === 0 && flags.length === 0 && !text.includes('Commands:') && !text.includes('Options:')) {
        throw new Error('parseCommanderHelp: no Commander "Commands:" or "Options:" block found — not Commander help?');
    }
    return {
        commands: [...new Set(commands)].sort(),
        flags: [...new Set(flags)].sort(),
    };
}

/**
 * Capture the live source-local CLI surface for `commandPath`.
 *
 * Runs `[process.execPath, 'run', <repo>/apps/cli/src/index.ts, ...commandPath, '--help']`
 * with the repository root as cwd. Supports root (`[]`), noun (`['task']`), and noun+verb
 * (`['task', 'update']`) captures. Fails loudly on a non-zero exit or unreadable package
 * metadata, with the invoked argv in the message. The resolved entry path and the
 * `@gobing-ai/spur` version read from `apps/cli/package.json` are attached as provenance.
 */
export function captureCliSurface(commandPath: string[] = []): CliSurfaceCapture {
    let packageVersion: string;
    try {
        const meta = JSON.parse(readFileSync(CLI_PACKAGE_JSON, 'utf8')) as { version?: unknown };
        if (typeof meta.version !== 'string' || meta.version.length === 0) {
            throw new Error('apps/cli/package.json has no string "version"');
        }
        packageVersion = meta.version;
    } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        throw new Error(`captureCliSurface: cannot read ${CLI_PACKAGE_JSON}: ${cause}`);
    }

    const argv = [process.execPath, 'run', CLI_ENTRY, ...commandPath, '--help'];
    const result = Bun.spawnSync(argv, { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) {
        const stderr = (result.stderr ?? '').toString().trim();
        throw new Error(
            `captureCliSurface: command failed (exit ${result.exitCode}): ${JSON.stringify(argv)}${stderr ? `\nstderr: ${stderr}` : ''}`,
        );
    }

    const { commands, flags } = parseCommanderHelp((result.stdout ?? '').toString());
    return {
        commands,
        flags,
        provenance: {
            entryPath: CLI_ENTRY,
            packageName: '@gobing-ai/spur',
            packageVersion,
        },
    };
}

// ---------------------------------------------------------------------------
// 0516 scope parsers — explicit exclusions and the ADR-054 ownership boundary.
//
// The two skill Markdown documents remain the single authoritative catalogs: the facade's
// `### Tier C exclusion reasons` table owns noun exclusions, and the spine's `## Step routing`
// table owns route classification. These parsers consume those tables mechanically —
// no copied allow-list, no regex silence. ADR-054 markers are likewise read from the skills.
// ---------------------------------------------------------------------------

/** Heading in `plugins/sp/skills/spur-cli/SKILL.md` that owns the Tier C noun-exclusion catalog. */
const TIER_C_HEADING = '### Tier C exclusion reasons';
/** Heading in `plugins/sp/skills/spur-dev/SKILL.md` that owns the step-routing table. */
const STEP_ROUTING_HEADING = '## Step routing';
/** ADR-054: the facade owns CLI noun/verb/flag semantics (incl. status-transition verbs). */
const FACADE_OWNS_PHRASE = 'owns CLI noun/verb/flag semantics';
/** ADR-054: the spine owns multi-step lifecycle orchestration. */
const SPINE_OWNS_PHRASE = 'owns multi-step lifecycle orchestration';
const ADR_054_MARKER = 'ADR-054';

export interface TierCExclusion {
    noun: string;
    reason: string;
}

export interface SpineRoute {
    step: string;
    kind: 'cli' | 'non-cli';
    /** Set only for `kind: 'cli'` rows (the noun/verb of the backticked `spur <noun> <verb>` gate). */
    noun?: string;
    verb?: string;
    /** Original `CLI gate` cell text — the reason for non-CLI rows, the command for CLI rows. */
    reason: string;
}

export interface OwnershipClaim {
    surface: 'facade' | 'spine';
    /** The ADR-054 ownership paragraph extracted from the skill document. */
    claim: string;
}

/** Split one Markdown table row (`| a | b | c |`) into trimmed cells. */
function tableCells(line: string): string[] {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells[0] === '') cells.shift();
    if (cells[cells.length - 1] === '') cells.pop();
    return cells;
}

/**
 * Table rows under `heading` in `markdown`, stopping at the next heading of any level.
 * Skips the `|---|` separator row and the header row. Empty when the heading is absent —
 * callers fail loudly on that.
 */
function tableUnderHeading(markdown: string, heading: string): string[][] {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start === -1) {
        return [];
    }
    const rows: string[][] = [];
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#')) break;
        if (!line.startsWith('|')) continue;
        const cells = tableCells(line);
        if (cells.every((cell) => /^-{2,}$/.test(cell))) continue; // |---|---| separator
        rows.push(cells);
    }
    return rows.slice(1); // drop the header row — Markdown tables always lead with one
}

/**
 * Parse the facade's `### Tier C exclusion reasons` table (spur-cli/SKILL.md).
 *
 * Every row must carry a non-empty reason and a unique noun — a blank reason or duplicate
 * noun is a loud failure, never a silent skip. Commander's generated `help` is expected here
 * exactly like any other Tier C noun: excluded with a reason, not regex-silenced.
 */
export function parseTierCExclusions(markdown: string): TierCExclusion[] {
    const rows = tableUnderHeading(markdown, TIER_C_HEADING);
    if (rows.length === 0) {
        throw new Error(`parseTierCExclusions: no "${TIER_C_HEADING}" table found`);
    }
    const seen = new Set<string>();
    const exclusions: TierCExclusion[] = [];
    for (const cells of rows) {
        const noun = (cells[0] ?? '').replace(/^`|`$/g, '').trim();
        const reason = (cells[1] ?? '').trim();
        if (noun.length === 0) {
            throw new Error('parseTierCExclusions: table row with no noun cell');
        }
        if (reason.length === 0) {
            throw new Error(`parseTierCExclusions: noun "${noun}" has an empty exclusion reason`);
        }
        if (seen.has(noun)) {
            throw new Error(`parseTierCExclusions: duplicate noun "${noun}"`);
        }
        seen.add(noun);
        exclusions.push({ noun, reason });
    }
    return exclusions;
}

/**
 * Parse the spine's `## Step routing` table (spur-dev/SKILL.md) into explicit records.
 *
 * A row is CLI-routed only when its `CLI gate` cell starts with a backticked
 * `spur <noun> <verb>` command. Every other gate — prompt, schema, slash-command, inline,
 * skill-dispatch — is retained as a `non-cli` record with the original gate text as its
 * reason, so spine rows are never misreported as missing CLI verbs.
 */
export function parseSpineRoutes(markdown: string): SpineRoute[] {
    const rows = tableUnderHeading(markdown, STEP_ROUTING_HEADING);
    if (rows.length === 0) {
        throw new Error(`parseSpineRoutes: no "${STEP_ROUTING_HEADING}" table found`);
    }
    return rows.map((cells) => {
        const step = (cells[0] ?? '').trim();
        const gate = (cells[2] ?? '').trim();
        const cli = gate.match(/^`spur\s+(\S+)\s+([^\s`]+)/);
        if (cli) {
            return { step, kind: 'cli' as const, noun: cli[1], verb: cli[2], reason: gate };
        }
        return { step, kind: 'non-cli' as const, reason: gate };
    });
}

/** The paragraph (contiguous non-empty lines) containing `needle`, or '' when absent. */
function paragraphContaining(text: string, needle: string): string {
    const lines = text.split(/\r?\n/);
    const idx = lines.findIndex((line) => line.includes(needle));
    if (idx === -1) {
        return '';
    }
    let start = idx;
    while (start > 0 && lines[start - 1].trim() !== '') start--;
    let end = idx;
    while (end < lines.length - 1 && lines[end + 1].trim() !== '') end++;
    return lines
        .slice(start, end + 1)
        .join('\n')
        .trim();
}

function ownershipClaim(
    markdown: string,
    surface: 'facade' | 'spine',
    ownsPhrase: string,
    inversionPhrase: string,
): OwnershipClaim {
    const label = surface === 'facade' ? 'spur-cli' : 'spur-dev';
    // Markdown reflows freely across line breaks; normalize whitespace before phrase matching
    // so a wrapped marker still satisfies the ADR-054 contract.
    const normalized = markdown.replace(/\s+/g, ' ');
    if (!normalized.includes(ADR_054_MARKER)) {
        throw new Error(`parseOwnershipMarkers: ${label}/SKILL.md has no "${ADR_054_MARKER}" ownership marker`);
    }
    if (!normalized.includes(ownsPhrase)) {
        throw new Error(
            `parseOwnershipMarkers: ${label}/SKILL.md does not document its ADR-054 ownership ("${ownsPhrase}")`,
        );
    }
    if (normalized.includes(inversionPhrase)) {
        throw new Error(`parseOwnershipMarkers: ${label}/SKILL.md inverts the ADR-054 boundary ("${inversionPhrase}")`);
    }
    return { surface, claim: paragraphContaining(markdown, ADR_054_MARKER).replace(/\s+/g, ' ').trim() };
}

/**
 * Extract the ADR-054 ownership markers from the facade and spine skill documents.
 *
 * Returns each surface's documented ownership claim; fails when either marker is absent
 * or inverted (the facade claiming spine orchestration, or the spine claiming verb
 * inventories). Status-transition verbs remain valid facade semantics — nothing here
 * bans lifecycle verbs from the facade; 0517 asserts that against the live CLI.
 */
export function parseOwnershipMarkers(
    facadeMarkdown: string,
    spineMarkdown: string,
): { facade: OwnershipClaim; spine: OwnershipClaim } {
    return {
        facade: ownershipClaim(facadeMarkdown, 'facade', FACADE_OWNS_PHRASE, SPINE_OWNS_PHRASE),
        spine: ownershipClaim(spineMarkdown, 'spine', SPINE_OWNS_PHRASE, FACADE_OWNS_PHRASE),
    };
}
