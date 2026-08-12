/**
 * cli-surface-parity — the focused facade/spine/root parity gate (task 0517, feature I2).
 *
 * Wires the frozen 0512 capture helper and the 0516 scope parsers into three deterministic
 * comparisons against the live source-local CLI (never a bare PATH `spur`):
 *
 *   1. Facade noun routing (Tier A/B/C) + Tier C reasons vs root `--help`.
 *   2. Per-noun verb/flag inventories (spur-cli/references/*.md) vs `<noun> --help` and
 *      `<noun> <verb> --help`, for every documented/live verb.
 *   3. Spine Step-routing CLI rows and the AGENTS.md noun table vs captured help.
 *
 * Every comparison is bidirectional with labels `documented-not-on-CLI` / `on-CLI-not-documented`
 * (both emitted even when one side is empty); the only reasoned live-vs-docs delta is Commander's
 * auto-generated `help` subcommand, excluded via the parsed Tier C table (0516). The sorted
 * failure arrays this suite emits ARE task 0513's authoritative edit list — drift is reported,
 * never corrected here.
 *
 * No snapshots, no crawler, no new dependencies; live captures are cached per command path.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    type CliSurfaceCapture,
    captureCliSurface,
    parseCommanderHelp,
    parseOwnershipMarkers,
    parseSpineRoutes,
    parseTierCExclusions,
} from './helpers/cli-surface';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const SKILLS_DIR = join(import.meta.dir, '..', 'skills');
const FACADE_SKILL = join(SKILLS_DIR, 'spur-cli', 'SKILL.md');
const REFERENCES_DIR = join(SKILLS_DIR, 'spur-cli', 'references');
const SPINE_SKILL = join(SKILLS_DIR, 'spur-dev', 'SKILL.md');
const AGENTS_MD = join(REPO_ROOT, 'AGENTS.md');

const facadeMd = readFileSync(FACADE_SKILL, 'utf8');
const spineMd = readFileSync(SPINE_SKILL, 'utf8');
const agentsMd = readFileSync(AGENTS_MD, 'utf8');

// ---------------------------------------------------------------------------
// Live capture, cached per command path (design: one capture per path per process).
// ---------------------------------------------------------------------------

const captureCache = new Map<string, CliSurfaceCapture>();

/** Capture `<noun> <verb> ... --help` once per command path; root path is `[]`. */
function liveCapture(commandPath: string[] = []): CliSurfaceCapture {
    const key = commandPath.length === 0 ? '(root)' : commandPath.join(' ');
    let hit = captureCache.get(key);
    if (hit === undefined) {
        hit = captureCliSurface(commandPath);
        captureCache.set(key, hit);
    }
    return hit;
}

/** The source-local provenance contract (0512 R1/R13) — entry + version, read dynamically. */
function assertProvenance(surface: CliSurfaceCapture, pathLabel: string): void {
    expect({ pathLabel, ...surface.provenance }).toMatchObject({
        pathLabel,
        entryPath: expect.stringContaining('apps/cli/src/index.ts'),
        packageName: '@gobing-ai/spur',
        packageVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
}

// ---------------------------------------------------------------------------
// One local diffSets helper — sorted failure arrays are 0513's authoritative edit list.
// ---------------------------------------------------------------------------

function diffSets(
    documented: string[],
    live: string[],
): { documentedNotOnCli: string[]; onCliNotDocumented: string[] } {
    const doc = new Set(documented);
    const liveSet = new Set(live);
    return {
        documentedNotOnCli: [...doc].filter((x) => !liveSet.has(x)).sort(),
        onCliNotDocumented: [...liveSet].filter((x) => !doc.has(x)).sort(),
    };
}

/** Assert a bidirectional inventory match, carrying both sorted labels into the failure. */
function expectParity(documented: string[], live: string[], label: string): void {
    const { documentedNotOnCli, onCliNotDocumented } = diffSets(documented, live);
    expect({ label, documentedNotOnCli, onCliNotDocumented }).toEqual({
        label,
        documentedNotOnCli: [],
        onCliNotDocumented: [],
    });
}

// ---------------------------------------------------------------------------
// Minimal Markdown table parsing (local to this test; the helper's parser is private).
// ---------------------------------------------------------------------------

/** Split one Markdown table row (`| a | b | c |`) into trimmed cells. */
function tableCells(line: string): string[] {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells[0] === '') cells.shift();
    if (cells[cells.length - 1] === '') cells.pop();
    return cells;
}

/**
 * Table rows under `heading`, stopping at the next heading of any level.
 * Collects only the FIRST contiguous table (stops at the first non-table line once rows
 * have started — sections may hold prose or a second table after the inventory).
 * Drops the `|---|` separator and the header row. Fails loudly on a missing heading.
 */
function firstTableUnderHeading(markdown: string, heading: string): string[][] {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start === -1) {
        throw new Error(`firstTableUnderHeading: heading not found: ${heading}`);
    }
    let rows: string[][] | null = null;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#')) break;
        if (!line.startsWith('|')) {
            if (rows !== null) break; // first table ended
            continue;
        }
        const cells = tableCells(line);
        if (cells.every((cell) => /^-{2,}$/.test(cell))) continue;
        if (rows === null)
            rows = []; // first content row is the header
        else rows.push(cells);
    }
    return rows ?? [];
}

// ---------------------------------------------------------------------------
// Facade noun routing (Tier A/B/C) from spur-cli/SKILL.md.
// ---------------------------------------------------------------------------

/** Nouns documented by the facade's `## Noun routing` table, with their tier. */
function facadeRoutingNouns(): { tier: string; noun: string }[] {
    const out: { tier: string; noun: string }[] = [];
    for (const cells of firstTableUnderHeading(facadeMd, '## Noun routing')) {
        const tier = (cells[0] ?? '')
            .replace(/\*\*/g, '')
            .replace(/^Tier\s+/i, '')
            .trim();
        for (const part of (cells[1] ?? '').split('/')) {
            const noun = part.replace(/\*\*/g, '').replace(/`/g, '').trim();
            if (noun.length > 0) out.push({ tier, noun });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Per-noun verb/flag inventories from spur-cli/references/*.md.
// ---------------------------------------------------------------------------

interface VerbRow {
    verb: string;
    flags: string[];
}

/** Which reference owns each Tier A/B noun, and the inventory format that file uses. */
const REFERENCE_LAYOUT: Record<string, { file: string; heading: string; format: 'table' | 'fence' }> = {
    task: { file: 'tasks.md', heading: '## Verb map', format: 'table' },
    feature: { file: 'features.md', heading: '## Verb map', format: 'table' },
    rule: { file: 'rules.md', heading: '## Command surface', format: 'fence' },
    workflow: { file: 'workflows.md', heading: '## Command surface', format: 'fence' },
    agent: { file: 'agent.md', heading: '## Verb map', format: 'table' },
    message: { file: 'message.md', heading: '## Verb map', format: 'table' },
    team: { file: 'team.md', heading: '## Verb map', format: 'table' },
    // The combined init/status reference documents both noun commands in one table.
    init: { file: 'init.md', heading: '## CLI verbs', format: 'table' },
    status: { file: 'init.md', heading: '## CLI verbs', format: 'table' },
    serve: { file: 'serve.md', heading: '## Verb map', format: 'table' },
};

/** Extract `--flag` tokens (same shape the 0512 Commander adapter parses). */
function flagTokens(text: string): string[] {
    return [...text.matchAll(/(?:^|\s)(-{1,2}[A-Za-z][A-Za-z0-9-]*)/g)].map((m) => m[1]);
}

/** Parse the first contiguous `| Verb | Purpose | Key flags |` table under `heading`. */
function verbTable(markdown: string, heading: string): VerbRow[] {
    const out: VerbRow[] = [];
    for (const cells of firstTableUnderHeading(markdown, heading)) {
        const verb = (cells[0] ?? '').replace(/`/g, '').split(/\s+/)[0]?.trim() ?? '';
        if (verb.length === 0) continue;
        out.push({ verb, flags: flagTokens(cells[2] ?? '') });
    }
    return out;
}

/** Parse a `## Command surface` fenced block of `spur <noun> <verb> [flags]` lines. */
function commandSurfaceVerbs(markdown: string, heading: string): VerbRow[] {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start === -1) {
        throw new Error(`commandSurfaceVerbs: heading not found: ${heading}`);
    }
    const out: VerbRow[] = [];
    let inFence = false;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('```')) {
            if (!inFence) inFence = true;
            else break;
            continue;
        }
        if (line.startsWith('#')) break;
        if (inFence) {
            const m = line.match(/^spur\s+(\S+)\s+(\S+)/);
            if (m) out.push({ verb: m[2], flags: flagTokens(line) });
        }
    }
    return out;
}

/** The documented verb/flag rows a Tier A/B noun's reference owns. */
function documentedVerbs(noun: string): VerbRow[] {
    const layout = REFERENCE_LAYOUT[noun];
    if (layout === undefined) {
        throw new Error(`documentedVerbs: no reference layout for noun "${noun}"`);
    }
    const md = readFileSync(join(REFERENCES_DIR, layout.file), 'utf8');
    return layout.format === 'table' ? verbTable(md, layout.heading) : commandSurfaceVerbs(md, layout.heading);
}

// ---------------------------------------------------------------------------
// The three comparisons.
// ---------------------------------------------------------------------------

const tierCExclusions = parseTierCExclusions(facadeMd);
const tierCNouns = new Set(tierCExclusions.map((e) => e.noun));
// Commander auto-generates a `help` subcommand under EVERY noun; its Tier C reason
// ("Auto-generated by Commander.js; not a real noun") is the only per-noun exclusion.
// Other Tier C nouns (`migrate`, ...) may legitimately exist as sub-verbs (e.g. `task migrate`),
// so the per-noun filter is scoped to the parsed `help` exclusion — loud if it ever vanishes.
const helpExclusion = tierCExclusions.find((e) => e.noun === 'help');
if (helpExclusion === undefined) {
    // Loud at module load: if the parsed `help` exclusion ever vanishes, the per-noun filter
    // must not silently fall back to a hardcoded noun (P4 fix — 0517 verify).
    throw new Error(
        'cli-surface-parity: parsed Tier C exclusions no longer contain the Commander-generated `help` noun',
    );
}
const helpNoun = helpExclusion.noun;
const spineRoutes = parseSpineRoutes(spineMd);
const ownership = parseOwnershipMarkers(facadeMd, spineMd);

describe('cli-surface-parity — provenance (0512 R1/R13)', () => {
    test('root, noun, and noun+verb captures carry source-local provenance', () => {
        assertProvenance(liveCapture([]), 'root');
        assertProvenance(liveCapture(['task']), 'noun');
        assertProvenance(liveCapture(['task', 'create']), 'noun+verb');
    });

    test('live root help still parses under the frozen Commander adapter', () => {
        const argv = [process.execPath, 'run', join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts'), '--help'];
        const result = Bun.spawnSync(argv, { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' });
        expect(result.exitCode).toBe(0);
        const parsed = parseCommanderHelp((result.stdout ?? '').toString());
        expect(parsed.commands).toEqual(liveCapture([]).commands);
    });
});

describe('cli-surface-parity — R1: facade noun routing vs live root', () => {
    test('routing table Tier C row agrees with the parsed Tier C exclusion table', () => {
        const routedC = new Set(
            facadeRoutingNouns()
                .filter((r) => r.tier === 'C')
                .map((r) => r.noun),
        );
        const excluded = new Set(tierCExclusions.map((e) => e.noun));
        expect([...routedC].sort()).toEqual([...excluded].sort());
    });

    test('facade documented nouns (Tier A/B/C union) match root help bidirectionally', () => {
        const documented = facadeRoutingNouns().map((r) => r.noun);
        const live = liveCapture([]).commands;
        // Tier C nouns are documented in the exclusion table (with reasons) and are live today —
        // a Tier C noun vanishing from the CLI surfaces here as documented-not-on-CLI.
        expectParity(documented, live, 'facade noun routing vs root help');
    });

    test('every Tier C exclusion carries a non-empty reason', () => {
        for (const e of tierCExclusions) {
            expect(e.reason.trim().length).toBeGreaterThan(0);
        }
    });
});

describe('cli-surface-parity — R1: per-noun verb/flag inventories vs live', () => {
    const rootCommands = liveCapture([]).commands;

    for (const { tier, noun } of facadeRoutingNouns().filter((r) => r.tier !== 'C')) {
        test(`${tier}: ${noun} reference verbs/flags match live surface`, () => {
            const rows = documentedVerbs(noun);
            const documented = rows.map((r) => r.verb);
            const nounCapture = liveCapture([noun]);

            if (nounCapture.commands.length === 0) {
                // Leaf noun (init/status/serve): the reference documents the noun command itself.
                // The live surface for a noun command is root help — check existence there, and
                // compare the noun row's key flags against the noun's own Options block.
                const ownRows = rows.filter((r) => r.verb === noun);
                expect(ownRows.length).toBeGreaterThan(0);
                const { documentedNotOnCli } = diffSets(
                    ownRows.map((r) => r.verb),
                    rootCommands,
                );
                expect({ noun, label: 'documented-not-on-CLI', documentedNotOnCli }).toEqual({
                    noun,
                    label: 'documented-not-on-CLI',
                    documentedNotOnCli: [],
                });
                for (const row of ownRows) {
                    if (row.flags.length === 0) continue;
                    const { documentedNotOnCli: missing } = diffSets(row.flags, nounCapture.flags);
                    expect({
                        noun,
                        verb: row.verb,
                        label: 'flags-documented-not-on-CLI',
                        documentedNotOnCli: missing,
                    }).toEqual({
                        noun,
                        verb: row.verb,
                        label: 'flags-documented-not-on-CLI',
                        documentedNotOnCli: [],
                    });
                }
                return;
            }

            // Non-leaf noun: bidirectional verb comparison. Commander's generated `help`
            // subcommand is excluded via its parsed Tier C reason (0516).
            const liveVerbs = nounCapture.commands.filter((v) => v !== helpNoun);
            expectParity(documented, liveVerbs, `facade ${noun} verbs vs <noun> --help`);

            // Key flags documented for each documented/live verb must exist on the live verb.
            // Live-only flags are the documented "unlisted long-tail" (Execute-First Contract) —
            // not drift, so only the documented-not-on-CLI side is asserted.
            for (const row of rows) {
                if (row.flags.length === 0) continue;
                if (!liveVerbs.includes(row.verb)) continue; // already a verb-level finding
                const liveFlags = liveCapture([noun, row.verb]).flags;
                const { documentedNotOnCli: missing } = diffSets(row.flags, liveFlags);
                expect({
                    noun,
                    verb: row.verb,
                    label: 'flags-documented-not-on-CLI',
                    documentedNotOnCli: missing,
                }).toEqual({
                    noun,
                    verb: row.verb,
                    label: 'flags-documented-not-on-CLI',
                    documentedNotOnCli: [],
                });
            }
        });
    }
});

describe('cli-surface-parity — R2: spine Step-routing CLI rows vs live', () => {
    test('every kind:"cli" route\'s noun and verb exist on the live surface', () => {
        const rootCommands = liveCapture([]).commands;
        const cliRows = spineRoutes.filter((r) => r.kind === 'cli');
        expect(cliRows.length).toBeGreaterThan(0);
        for (const row of cliRows) {
            const { step, noun, verb } = row;
            if (typeof noun !== 'string' || typeof verb !== 'string') {
                throw new Error(`spine row ${step} is missing noun/verb: ${JSON.stringify(row)}`);
            }
            expect({ step, noun, live: rootCommands }).toEqual(
                expect.objectContaining({ noun: expect.stringMatching(/^\S+$/) }),
            );
            expect(rootCommands).toContain(noun);
            const liveVerbs = liveCapture([noun]).commands.filter((v) => v !== helpNoun);
            expect({ step, verb, live: liveVerbs }).toEqual(
                expect.objectContaining({ verb: expect.stringMatching(/^\S+$/) }),
            );
            expect(liveVerbs).toContain(verb);
        }
    });

    test('every non-CLI spine row is retained in the diagnostic with its reason', () => {
        const nonCliRows = spineRoutes.filter((r) => r.kind === 'non-cli');
        expect(nonCliRows.length).toBeGreaterThan(0);
        const diagnostic = nonCliRows.map((r) => `${r.step} -> ${r.reason}`);
        for (const row of nonCliRows) {
            expect(row.reason.trim().length).toBeGreaterThan(0);
        }
        // Pin the exact non-CLI step set (P3 fix — 0517 verify): a parser regression that
        // drops a step, reclassifies a row as CLI, or loses its gate text fails here.
        expect(nonCliRows.map((r) => r.step).sort()).toEqual([
            'All writes (both halves)',
            'Batch refine',
            'Batch run',
            'Decomposition (dispatch)',
            'Design doc',
            'Implement (dispatch)',
            'Intake',
            'Operation catalog',
            'Parallel fan-out',
            'Pipeline run',
            'Review / verify (dispatch)',
            'Test (dispatch)',
        ]);
        // Every retained row's diagnostic entry must pair the step with its original gate text.
        for (const row of nonCliRows) {
            expect(diagnostic).toContain(`${row.step} -> ${row.reason}`);
        }
    });
});

describe('cli-surface-parity — R4: AGENTS.md noun table vs live root', () => {
    test('AGENTS.md Spur CLI surface noun inventory matches root help, honoring Tier C exclusions', () => {
        const table = firstTableUnderHeading(agentsMd, '## Spur CLI surface');
        expect(table.length).toBeGreaterThan(0);
        const agentsNouns = table.map((cells) => (cells[0] ?? '').replace(/`/g, '').trim()).filter((n) => n.length > 0);
        const live = liveCapture([]).commands;
        const { documentedNotOnCli, onCliNotDocumented } = diffSets(agentsNouns, live);
        // `help` is Commander-generated (Tier C reason) and therefore not expected in AGENTS.md.
        const honored = onCliNotDocumented.filter((n) => !tierCNouns.has(n));
        expect({ label: 'AGENTS.md nouns vs root help', documentedNotOnCli, onCliNotDocumented: honored }).toEqual({
            label: 'AGENTS.md nouns vs root help',
            documentedNotOnCli: [],
            onCliNotDocumented: [],
        });
    });
});

describe('cli-surface-parity — R8: ADR-054 ownership boundary', () => {
    test('facade owns CLI noun/verb/flag semantics; spine owns orchestration', () => {
        expect(ownership.facade.surface).toBe('facade');
        expect(ownership.facade.claim).toContain('ADR-054');
        expect(ownership.facade.claim).toContain('owns CLI noun/verb/flag semantics');
        expect(ownership.spine.surface).toBe('spine');
        expect(ownership.spine.claim).toContain('ADR-054');
        expect(ownership.spine.claim).toContain('owns multi-step lifecycle orchestration');
    });
});
