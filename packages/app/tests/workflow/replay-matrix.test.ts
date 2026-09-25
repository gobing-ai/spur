/**
 * Interrupted-entry replay classification matrix (0916 R1).
 *
 * Locks the replay posture of every canonical workflow definition against the
 * engine contract (ADR-122): interrupted resume re-executes on-enter actions
 * only into states explicitly marked `resumeRerun: true` (rerun-enter); paused
 * resume never re-executes them (skip-enter). Absence of `resumeRerun` makes
 * the engine refuse rerun-enter into that state — the safe default every
 * canonical definition relies on today.
 *
 * The matrix below is TEST INPUT, not a routing registry: adding or removing a
 * `resumeRerun` marker, a pause gate, or a canonical definition must update the
 * table here consciously (per Design: "Inventory is test input, not a new
 * routing registry"). Ownership, CAS claiming, skip-enter/rerun-enter runtime
 * semantics and status-refusal messages are exercised by the engine fixtures in
 * `packages/app/tests/services/workflow-service.test.ts` (0901 R2 / 0902) and
 * are not duplicated here.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import { parse } from 'yaml';

interface StateMatrixRow {
    /** State ids declared `resumeRerun: true` — interrupted resume re-executes their on-enter actions. */
    resumeRerunStates: string[];
    /** State ids with `pause: true` — human decision boundaries (paused resume is skip-enter). */
    pauseGates: string[];
    /**
     * Why interrupted-entry replay at the initial state is safe today:
     * - repeatable: entry actions are read-only/idempotent (FSM guards re-evaluate, mkdir, clean-tree checks).
     * - identity-deduplicated: the mutating entry step dedupes on its own identity (pr-review per-HEAD).
     * - reconciliation-required: entry must not auto-replay (none today — refusal is the engine default).
     */
    entryClass: 'repeatable' | 'identity-deduplicated' | 'reconciliation-required';
}

/** Declared matrix — the classification of record for the ten canonical definitions (0916 R1). */
const MATRIX: Record<string, StateMatrixRow> = {
    'task-lifecycle': { resumeRerunStates: [], pauseGates: [], entryClass: 'repeatable' },
    'feature-lifecycle': { resumeRerunStates: [], pauseGates: [], entryClass: 'repeatable' },
    'task-pipeline': { resumeRerunStates: [], pauseGates: ['approve'], entryClass: 'repeatable' },
    'feature-verification': { resumeRerunStates: [], pauseGates: [], entryClass: 'repeatable' },
    'idea-pipeline': {
        resumeRerunStates: [],
        pauseGates: ['idea-eval', 'feature-check', 'design-approval', 'batch-create'],
        entryClass: 'repeatable',
    },
    'pr-review': { resumeRerunStates: [], pauseGates: [], entryClass: 'identity-deduplicated' },
    'history-anatomy': { resumeRerunStates: [], pauseGates: [], entryClass: 'repeatable' },
    'wrapup-pipeline': { resumeRerunStates: [], pauseGates: ['branch-cleanup'], entryClass: 'repeatable' },
    'wayfinder-resolution': { resumeRerunStates: [], pauseGates: ['approve'], entryClass: 'repeatable' },
};

interface CanonicalDoc {
    name: string;
    kind: string;
    states?: Array<{ id?: string; resumeRerun?: boolean; pause?: boolean }>;
}

const loadCanonicalDocs = (): Map<string, CanonicalDoc> => {
    const sharedRoot = bundledConfigRoot();
    if (sharedRoot === null) throw new Error('shared config root not resolved (run from repo or installed package)');
    const sharedDir = join(sharedRoot, 'workflows');
    const docs = new Map<string, CanonicalDoc>();
    for (const file of readdirSync(sharedDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
        const doc = parse(readFileSync(join(sharedDir, file), 'utf8')) as CanonicalDoc | null;
        if (doc && typeof doc.name === 'string' && doc.kind === 'state-machine') docs.set(doc.name, doc);
    }
    return docs;
};

describe('interrupted-entry replay matrix (0916 R1)', () => {
    test('matrix covers exactly the canonical state-machine definitions (no drift)', () => {
        const docs = loadCanonicalDocs();
        expect(docs.size).toBe(Object.keys(MATRIX).length);
        const docNames = [...docs.keys()].sort();
        expect(docNames).toEqual(Object.keys(MATRIX).sort());
    });

    test('no unsafe action gains unconditional interrupted-entry replay (AC1)', () => {
        // Engine default: absence of `resumeRerun` refuses rerun-enter into the
        // state (ADR-122). Every canonical definition relies on that refusal —
        // enabling rerun-enter anywhere requires updating this matrix with
        // demonstrated repeatability evidence (Design: "only demonstrated
        // necessary corrections").
        const docs = loadCanonicalDocs();
        const unexpected: string[] = [];
        for (const [name, doc] of docs) {
            const expected = MATRIX[name]?.resumeRerunStates ?? [];
            const actual = (doc.states ?? []).filter((s) => s.resumeRerun).map((s) => s.id ?? '');
            for (const stateId of actual) {
                if (!expected.includes(stateId)) unexpected.push(`${name}:${stateId}`);
            }
        }
        expect(unexpected).toEqual([]);
    });

    test('declared resumeRerun and pause gates match the definitions (AC3 human boundaries)', () => {
        const docs = loadCanonicalDocs();
        const drift: string[] = [];
        for (const [name, doc] of docs) {
            const row = MATRIX[name];
            if (!row) continue;
            const actualRerun = (doc.states ?? []).filter((s) => s.resumeRerun).map((s) => s.id ?? '');
            const actualPause = (doc.states ?? []).filter((s) => s.pause).map((s) => s.id ?? '');
            if (JSON.stringify(actualRerun.sort()) !== JSON.stringify([...row.resumeRerunStates].sort()))
                drift.push(
                    `${name} resumeRerun: actual=${JSON.stringify(actualRerun)} declared=${JSON.stringify(row.resumeRerunStates)}`,
                );
            if (JSON.stringify(actualPause.sort()) !== JSON.stringify([...row.pauseGates].sort()))
                drift.push(
                    `${name} pauseGates: actual=${JSON.stringify(actualPause)} declared=${JSON.stringify(row.pauseGates)}`,
                );
        }
        expect(drift).toEqual([]);
    });

    test('entry classification is declared for every workflow (matrix completeness)', () => {
        for (const row of Object.values(MATRIX)) {
            expect(['repeatable', 'identity-deduplicated', 'reconciliation-required']).toContain(row.entryClass);
            // reconciliation-required entries must not be opted into rerun-enter either —
            // the engine refusal is the reconciliation path until manually resolved.
            if (row.entryClass === 'reconciliation-required') expect(row.resumeRerunStates).toEqual([]);
        }
    });
});
