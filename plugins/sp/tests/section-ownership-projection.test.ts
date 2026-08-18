/**
 * section-ownership-projection — static projection regression test (F92 0593 R1/R2).
 *
 * The runtime section/verdict contracts live in the section matrix, TaskCheckService,
 * and the canonical verdict code. Portable harness material (skills, agents, commands)
 * must be a *checked projection* of those contracts, not a parallel authority:
 *  - R1: one writer per evidence section (implement → Solution, review coordinator
 *    → Review, record → Testing, verify → verdict artifact, components → fragments).
 *  - R2: no trio section-batching, no static status→section tables, no invented gate
 *    identifiers on the plugin mirror; skills query `spur task sections`/`spur task check`.
 *
 * These tests scan the shipped markdown for stale claims only — they never re-derive
 * runtime validation logic (that would duplicate the very authority they project).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN = join(import.meta.dir, '..');

function read(rel: string): string {
    try {
        return readFileSync(join(PLUGIN, rel), 'utf8');
    } catch {
        return '';
    }
}

/** Whitespace-normalized read (assertions span line breaks in prose). */
function norm(rel: string): string {
    return read(rel).replace(/\s+/g, ' ').trim();
}

const FILES = {
    sectionBatching: 'skills/spur-dev/references/section-batching.md',
    spurDev: 'skills/spur-dev/SKILL.md',
    functionalReview: 'skills/functional-review/SKILL.md',
    codeVerification: 'skills/code-verification/SKILL.md',
    codeImprovement: 'skills/code-improvement/SKILL.md',
    superReviewer: 'agents/super-reviewer.md',
    superPlanner: 'agents/super-planner.md',
    devReview: 'commands/dev-review.md',
    tasksFacade: 'skills/spur-cli/references/tasks.md',
    verbs: 'skills/spur-cli/references/tasks/verbs.md',
    sectionEditing: 'skills/spur-cli/references/tasks/section-editing.md',
    decomposition: 'skills/spec-decomposition/references/decomposition.md',
    gateChecklists: 'skills/spur-dev/references/gate-checklists.md',
    executionWorkflow: 'skills/spur-dev/references/execution-workflow.md',
    devOperations: 'skills/spur-dev/references/dev-operations.md',
} as const;

describe('0593 R1 — one writer per evidence section (no competing writers in portable material)', () => {
    test('only the review coordinator claims authored `## Review` ownership', () => {
        // Coordinator may claim it; no component skill, command, or spine may.
        expect(read(FILES.superReviewer)).toContain('single `## Review` writer');
        const mustNotClaim = [
            FILES.functionalReview,
            FILES.codeVerification,
            FILES.codeImprovement,
            FILES.devReview,
            FILES.spurDev,
            FILES.devOperations,
        ];
        const banned = [
            'owns `## Review`',
            "write the review body to the task's `## Review` section",
            "May write findings to the task's `## Review`",
            'Review section only)',
        ];
        for (const f of mustNotClaim) {
            const content = read(f);
            for (const phrase of banned) {
                expect(
                    content.includes(phrase),
                    `${f} still claims component-authored Review ("${phrase}" — F92 0593 R1)`,
                ).toBe(false);
            }
        }
    });

    test('component review skills return fragments and say so', () => {
        expect(read(FILES.functionalReview)).toContain('review fragment');
        expect(read(FILES.codeImprovement)).toContain('review fragment');
        expect(read(FILES.superReviewer)).toContain('review fragments only');
    });

    test('record is labeled the deterministic Testing writer; bare-Review is fallback-only', () => {
        for (const f of [FILES.tasksFacade, FILES.verbs, FILES.sectionEditing, FILES.sectionBatching]) {
            expect(read(f), `${f} must name record as the Testing writer`).toContain('Testing');
        }
        expect(read(FILES.sectionEditing)).toMatch(/only when the section is bare|only when bare/i);
        expect(read(FILES.verbs)).toMatch(/bare-only|only when the section is bare/i);
        // No portable material may claim record writes Testing AND Review as equal ownership.
        const banned = [
            'Write `Testing` + `Review` from a verify verdict',
            'writes the `Testing` and `Review` sections',
            'writes per-task `## Testing` / `## Review`',
        ];
        for (const f of [FILES.tasksFacade, FILES.verbs, FILES.sectionEditing, FILES.superPlanner]) {
            for (const phrase of banned) {
                expect(read(f).includes(phrase), `${f} still claims record owns Review ("${phrase}")`).toBe(false);
            }
        }
    });

    test('verification never claims a section write as its output', () => {
        const cv = norm(FILES.codeVerification);
        expect(cv).toContain('verification writes no task section');
        expect(cv).toContain('Do not write `## Review` directly, ever');
    });
});

describe('0593 R2 — portable material queries runtime contracts (no stale static projections)', () => {
    test('trio section-batching is gone; the protocol is one-writer + runtime queries', () => {
        const sb = read(FILES.sectionBatching);
        expect(sb).not.toMatch(/Stage complete, body-only Solution, Testing, and Review files/);
        expect(sb).toContain('spur task sections <wbs> list --json');
        expect(sb).toContain('spur task check <wbs> --json');
    });

    test('no static status→section table remains in skills (decomposition, section-editing)', () => {
        expect(read(FILES.decomposition)).not.toContain('| Stage | Means | Sections present |');
        expect(read(FILES.decomposition)).toContain('spur task sections <wbs> list --json');
        expect(read(FILES.decomposition)).toContain('spur task check <wbs> --json');
        expect(read(FILES.sectionEditing)).toContain('spur task sections <wbs> list --json');
    });

    test('no variant-blind "Solution first appears at wip" restatement survives', () => {
        for (const f of [FILES.verbs, FILES.decomposition]) {
            expect(read(f), `${f} restates a static section claim`).not.toContain('`Solution` first appears at `wip`');
        }
    });

    test('spine references the writer map, not the old record-owns-both gotcha', () => {
        const sd = read(FILES.spurDev);
        expect(sd).toContain('One writer per evidence section');
        expect(sd).not.toContain(
            "`## Testing` and `## Review` sections are\n   filled by the pipeline's `record` step",
        );
        expect(sd).toContain('one-writer protocol');
    });

    test('spine docs and gate checklists tell agents to query runtime state', () => {
        expect(read(FILES.gateChecklists)).toContain('spur task record'); // deterministic Testing writer
        expect(norm(FILES.executionWorkflow)).toMatch(/one writer per evidence section/i);
        expect(read(FILES.sectionBatching)).toContain('never a static table');
    });
});
