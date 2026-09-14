/**
 * ADR-052 supersession by ADR-116 (task 0850 R1/R2, feature G64).
 *
 * The G6 program replaced team-scoped Board composition with project-scoped fleets. The decision is
 * recorded additively: ADR-052's status line gains a supersession pointer, ADR-116 carries the
 * replacement, and no earlier ADR's text is touched. These assertions make R2 checkable rather than
 * promised — (c) is what proves "no historical ADR is rewritten" at the moment it could be violated.
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
const adr052 = blocks.find((b) => b.number === 52);
const adr116 = blocks.find((b) => b.number === 116);

describe('ADR-052 supersession (0850 R1/R2)', () => {
    test('(a) ADR-052 is marked superseded by ADR-116, keeping its decision body', () => {
        expect(adr052, 'ADR-052 must exist in docs/00_ADR.md').toBeDefined();
        if (!adr052) return;
        const status = adr052.lines.find((l) => l.startsWith('- **Status:**'));
        expect(status).toBeDefined();
        expect(status).toContain(SUPERSEDED_BY_116);
        // The supersession is metadata: the decision, its Why, and its Detail links stay as written.
        expect(adr052.lines.join('\n')).toContain('**Decision:** Use `agent.team.<teamId>`');
        expect(adr052.lines.join('\n')).toContain('**Why:** Team already owns the work folder');
    });

    test('(b) ADR-116 exists, supersedes ADR-052, and names the retained ADRs', () => {
        expect(adr116, 'ADR-116 must exist (the replacement decision)').toBeDefined();
        if (!adr116) return;
        const body = adr116.lines.join('\n');
        expect(adr116.title).toContain('Project-Scoped Fleet Composition');
        expect(body).toContain('**Supersedes:** ADR-052');
        // Retention lives where a reader looking for what G6 did not replace will look.
        const retains = adr116.lines.find((l) => l.startsWith('- **Retains:**'));
        expect(retains).toBeDefined();
        for (const retained of ['ADR-037', 'ADR-057', 'ADR-022']) {
            expect(retains).toContain(retained);
        }
    });

    test('(c1) ADR-052 is the only pre-116 ADR carrying the supersession pointer', () => {
        const carriers = blocks
            .filter((b) => b.number < 116)
            .filter((b) => b.lines.join('\n').includes(SUPERSEDED_BY_116))
            .map((b) => b.number);
        expect(carriers).toEqual([52]);
    });

    test('(c2) a working diff of 00_ADR.md rewrites no historical text', () => {
        // `git diff` is empty once the change is committed — then the assertion is vacuously true and
        // (c1) plus the frozen-body checks above remain the durable guard. While the change is staged
        // or unstaged, every removed line must be the old ADR-052 status line and every added line
        // must belong to ADR-116 (or be the new status line) — the assertable form of R2's "no
        // historical decision is rewritten".
        const diff = execFileSync('git', ['diff', '--unified=0', 'HEAD', '--', ADR_REL], {
            cwd: REPO_ROOT,
            encoding: 'utf-8',
        });
        if (diff.trim() === '') return;

        const body = diff.split('\n');
        const added = body.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
        const removed = body.filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
        expect(added.length, 'a non-empty diff must add at least one line').toBeGreaterThan(0);

        const adr116Lines = new Set(adr116?.lines ?? []);
        const statusText = adr052?.lines.find((l) => l.startsWith('- **Status:**'));
        for (const line of added) {
            expect(
                line === statusText || adr116Lines.has(line) || line.trim() === '',
                `added line is outside the two allowed edits (ADR-052 status line, ADR-116 block): ${line}`,
            ).toBe(true);
        }
        for (const line of removed) {
            expect(
                line.startsWith('- **Status:** Accepted · **Date:** 2026-08-11'),
                `removed line is not ADR-052's old status line — a historical ADR was rewritten: ${line}`,
            ).toBe(true);
        }
    });
});
