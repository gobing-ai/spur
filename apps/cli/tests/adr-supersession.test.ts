/**
 * ADR-052 (and ADR-042) supersession by ADR-116, plus ADR-086's fleet amendment
 * (tasks 0850/0854, feature G64).
 *
 * The G6 program replaced team-scoped Board composition with project-scoped fleets. The decision is
 * recorded additively: each retired ADR's status line names the live authority, a surviving decision
 * is amended by a dated block, and no historical decision text is rewritten. These assertions make
 * that checkable at the moment it could be violated.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Repo root: apps/cli/tests → apps/cli → repo. */
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const ADR_PATH = join(REPO_ROOT, 'docs', '00_ADR.md');
const ADR_REL = 'docs/00_ADR.md';

const SUPERSEDED_BY_116 = 'Superseded by ADR-116';

interface AdrBlock {
    number: number;
    /** 1-based line number of the `## ADR-<n>:` heading. */
    headingLine: number;
    title: string;
    lines: string[];
}

/** Split the ADR corpus into blocks keyed by their `## ADR-<n>:` headings. */
function readAdrBlocks(): AdrBlock[] {
    const lines = readFileSync(ADR_PATH, 'utf-8').split('\n');
    const blocks: AdrBlock[] = [];
    for (const [index, line] of lines.entries()) {
        const match = /^## ADR-(\d+):\s*(.*)$/.exec(line);
        if (!match) continue;
        const previous = blocks.at(-1);
        if (previous) previous.lines = lines.slice(previous.headingLine - 1, index);
        blocks.push({ number: Number(match[1]), headingLine: index + 1, title: match[2] ?? '', lines: [] });
    }
    const last = blocks.at(-1);
    if (last) last.lines = lines.slice(last.headingLine - 1);
    return blocks;
}

const blocks = readAdrBlocks();
const body = (n: number): string => blocks.find((b) => b.number === n)?.lines.join('\n') ?? '';
/** Status line for an ADR — the corpus uses both `- **Status:**` and `**Status:**` forms. */
const status = (n: number): string | undefined =>
    blocks
        .find((b) => b.number === n)
        ?.lines.find((l) => l.trim().startsWith('- **Status:**') || l.trim().startsWith('**Status:**'));
const adr116 = blocks.find((b) => b.number === 116);

describe('ADR-052 supersession (0850 R1/R2)', () => {
    test('(a) ADR-052 is marked superseded by ADR-116, keeping its decision body', () => {
        expect(
            blocks.find((b) => b.number === 52),
            'ADR-052 must exist in docs/00_ADR.md',
        ).toBeDefined();
        expect(status(52)).toContain(SUPERSEDED_BY_116);
        // The supersession is metadata: the decision, its Why, and its Detail links stay as written.
        expect(body(52)).toContain('**Decision:** Use `agent.team.<teamId>`');
        expect(body(52)).toContain('**Why:** Team already owns the work folder');
    });

    test('(b) ADR-116 exists, supersedes ADR-052, and names the retained ADRs', () => {
        expect(adr116, 'ADR-116 must exist (the replacement decision)').toBeDefined();
        if (!adr116) return;
        expect(adr116.title).toContain('Project-Scoped Fleet Composition');
        const supersedes = adr116.lines.find((l) => l.includes('**Supersedes:**'));
        expect(supersedes).toContain('ADR-052');
        // Retention lives where a reader looking for what G6 did not replace will look.
        const retains = adr116.lines.find((l) => l.startsWith('- **Retains:**'));
        expect(retains).toBeDefined();
        for (const retained of ['ADR-037', 'ADR-057', 'ADR-022']) {
            expect(retains).toContain(retained);
        }
    });
});

describe('ADR-042 retires with the Inbox module (0854 R1/R2)', () => {
    test('(c1) the chain resolves: ADR-042 names ADR-116 and keeps its ADR-052 hop', () => {
        expect(
            blocks.find((b) => b.number === 42),
            'ADR-042 must exist',
        ).toBeDefined();
        const s = status(42);
        expect(s).toContain(SUPERSEDED_BY_116);
        expect(s).toContain('via ADR-052');
        // The decision body is untouched — only the metadata line moved.
        expect(body(42)).toContain(
            '**Decision:** Consolidate Board messaging into `modules/inbox` with All, Supervisor, and member tabs',
        );
        expect(body(42)).toContain('**Why:** Three overlapping message surfaces');
        expect(body(42)).toContain('**Detail:** `03 §14`; `docs/design/inbox-board-module.md`');
        // The amendment records why the status moved, in this task's own words.
        expect(body(42)).toContain('Amendment (2026-09-14 · ADR-116 / task 0854)');
        expect(body(42)).toContain('deleted by task 0849');
    });

    test('(c2) ADR-042 is the only extra carrier, and ADR-116 names it transitively', () => {
        const carriers = blocks
            .filter((b) => b.number < 116)
            .filter((b) => b.lines.join('\n').includes(SUPERSEDED_BY_116))
            .map((b) => b.number)
            .sort((a, b) => a - b);
        expect(carriers).toEqual([42, 52]);
        const supersedes = adr116?.lines.find((l) => l.includes('**Supersedes:** ADR-052'));
        expect(supersedes, 'ADR-116 must name ADR-052 in its Supersedes line').toBeDefined();
        expect(supersedes).toContain('ADR-042');
    });
});

describe('ADR-086 is amended, not rewritten (0854 R2)', () => {
    test('(d) the fleet re-point lands as a dated amendment with the taxonomy intact', () => {
        expect(
            blocks.find((b) => b.number === 86),
            'ADR-086 must exist',
        ).toBeDefined();
        const text = body(86);
        expect(text).toContain('**Amendment (2026-09-14 · ADR-116 / task 0854):**');
        expect(text).toContain('.spur/fleet.json');
        expect(text).toContain('FleetService');
        // The original decision, its three layers, and its runtime-state rule stay as written.
        expect(text).toContain('Agent-team state is a three-layer taxonomy');
        expect(text).toContain('**Materialized agent instances**');
        expect(text).toContain('never a source of truth and never committed shapes');
        expect(text).toContain('`agent.team.demo` block in `.spur/config.yaml`');
    });
});

describe('ADR-057 stays accepted and points at the live authority (0854 R1)', () => {
    test('(f) the retained ADR names its superseded companion correctly', () => {
        expect(
            blocks.find((b) => b.number === 57),
            'ADR-057 must exist',
        ).toBeDefined();
        // ADR-116 retains ADR-057, so its own status must NOT move — pinned exactly.
        expect(status(57)).toBe('**Status:** Accepted · **Date:** 2026-08-12 · **Feature:** G4');
        const text = body(57);
        expect(text).toContain('**Amendment (2026-09-14 · ADR-116 / task 0854):**');
        expect(text).toContain('superseded by ADR-116');
        expect(text).toContain('retained');
        // The historical reasoning that named ADR-052 is not rewritten.
        expect(text).toContain('would collapse ADR-052');
        expect(text).toContain('two planes');
    });
});

describe('no historical ADR text is rewritten (0850/0854 R2)', () => {
    test("(e) a working diff of 00_ADR.md deletes only the amended ADRs' status lines", () => {
        // `git diff` is empty once the change is committed — the assertion is then vacuously true and
        // (a)–(d) plus the frozen-body checks above remain the durable guard. While the change is
        // unstaged, every removed line must be one of the amended ADRs' *pre-change* status lines
        // (read from HEAD, so a status rewrite anywhere else still fails) and every added line must
        // belong to one of the amended ADRs' current blocks.
        const diff = execFileSync('git', ['diff', '--unified=0', 'HEAD', '--', ADR_REL], {
            cwd: REPO_ROOT,
            encoding: 'utf-8',
        });
        if (diff.trim() === '') return;

        const amended = [42, 52, 57, 86, 116];
        const amendedLines = new Set(blocks.filter((b) => amended.includes(b.number)).flatMap((b) => b.lines));

        // Only the statuses that ACTUALLY moved may disappear: derive the allowed removals from
        // HEAD's status lines for the ADRs whose current status differs from HEAD's (read from HEAD,
        // so a rewrite that strips any other ADR's status still fails — mutation-tested in pass 2).
        const headLines = execFileSync('git', ['show', `HEAD:${ADR_REL}`], {
            cwd: REPO_ROOT,
            encoding: 'utf-8',
        }).split('\n');
        const headStatusByAdr = new Map<number, string>();
        let headAdr: number | null = null;
        for (const line of headLines) {
            const heading = /^## ADR-(\d+):/.exec(line);
            if (heading) headAdr = Number(heading[1]);
            else if (headAdr !== null && line.includes('**Status:**')) headStatusByAdr.set(headAdr, line);
        }
        const allowedRemovals = new Set(
            amended
                .filter((n) => {
                    const head = headStatusByAdr.get(n);
                    return head !== undefined && head !== status(n);
                })
                .map((n) => headStatusByAdr.get(n))
                .filter((l): l is string => l !== undefined),
        );

        const lines = diff.split('\n');
        const added = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
        const removed = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
        expect(added.length, 'a non-empty diff must add at least one line').toBeGreaterThan(0);

        for (const line of added) {
            expect(
                amendedLines.has(line) || line.trim() === '',
                `added line is outside the amended ADRs (42, 52, 57, 86, 116): ${line}`,
            ).toBe(true);
        }
        for (const line of removed) {
            expect(
                allowedRemovals.has(line),
                `removed line is not an amended ADR's pre-change status — a historical decision was rewritten: ${line}`,
            ).toBe(true);
        }
    });
});
