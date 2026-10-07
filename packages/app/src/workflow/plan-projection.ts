/**
 * Phased plan projection (task 1104) — derives the letters-first two-layer
 * A-Z/1-9 plan from a workflow definition's `display` annotations instead of a
 * hand-maintained mirror. Pure def→items formatters over the engine's
 * presentation-only `StateDef.display` (phase/phaseTitle/title/show); the
 * engine never reads `display` at run time and this module never executes
 * workflow actions or guards.
 *
 * Lives beside `step-reporter.ts` and reuses `VisibleItem`/`VisibleOutcome`.
 * It is a separate file because it is a standalone bundle entrypoint:
 * `plugins/sp/scripts/batch-plan.ts` reaches these functions through the
 * generated `plugins/sp/lib/plan-projection.generated.mjs` (node-builtin only,
 * so the committed `.mjs` twin runs under bare `node`). Regenerate with the
 * `bundlePlanProjectionLib` entry in `scripts/commands/bundle-plugin-lib.ts`.
 */
import type { StateDef, StateDisplay, StateMachineWorkflowDef, WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import type { VisibleItem, VisibleOutcome } from './step-reporter';

// ── Label caps ───────────────────────────────────────────────────────────────

/**
 * Letter for a zero-based plan row: 0→A … 25→Z. Throws past Z — the cap is a
 * correctness boundary, not a rendering choice: callers must split (waves) or
 * stop instead of silently emitting two-letter addresses.
 */
export function planLetter(index: number): string {
    if (!Number.isInteger(index) || index < 0 || index > 25) {
        throw new Error(`plan letter out of range: ${index} (expected 0..25)`);
    }
    return String.fromCharCode(65 + index);
}

/**
 * Digit child label under a single-letter parent: ('B', 0)→B1 … ('B', 8)→B9.
 * Throws past 9 (and for multi-letter parents) — same boundary as `planLetter`.
 */
export function planChild(parent: string, index: number): string {
    if (!Number.isInteger(index) || index < 0 || index > 8) {
        throw new Error(`plan child index out of range: ${index} (expected 0..8 under ${parent})`);
    }
    if (parent.length !== 1 || !/[A-Z]/.test(parent)) {
        throw new Error(`plan child parent must be a single letter: ${parent}`);
    }
    return `${parent}${index + 1}`;
}

// ── Plan items ───────────────────────────────────────────────────────────────

/** One row of the phased plan: a `VisibleItem` plus its prepared text and parent address. */
export interface PhasedPlanItem extends VisibleItem {
    /** Prepared display text (e.g. `B Implement`, `B1 Check task readiness · precheck`). */
    text: string;
    /** Parent address for digits under a phase or prepare letter (e.g. `B`, `A`). */
    parent?: string;
    /** Row title (state title or phase title). Absent when the caller did not supply one. */
    title?: string;
}

/** Canonical ids inside a phased plan. */
const PREPARE_ID = 'prepare';
const REPORT_ID = 'report';
const PHASE_ID_PREFIX = 'phase.';
const TASK_ID_PREFIX = 'task.';
/** Batch wave size: B..Y hold 24 task letters; A/Z bookend every wave. */
const WAVE_SIZE = 24;
/** Task titles truncate to this many characters including the ellipsis. */
const TITLE_CAP = 60;

/** Whether the def is a state-machine workflow (the only kind carrying states/display). */
function isStateMachine(def: WorkflowDef): def is StateMachineWorkflowDef {
    return def.kind !== 'transition-flow' && def.kind !== 'dag';
}

/** Type guard for states carrying a `display` annotation (the projection's input set). */
function hasDisplay(s: StateDef): s is StateDef & { display: StateDisplay } {
    return s.display !== undefined;
}

/** Phase title for a phase key: first declared `phaseTitle`, else the key itself. */
function resolvePhaseTitle(
    states: readonly { id: string; display?: { phase: string; phaseTitle?: string } }[],
    phase: string,
): string {
    for (const s of states) {
        if (s.display?.phase === phase && s.display.phaseTitle !== undefined) return s.display.phaseTitle;
    }
    return phase;
}

/** `<label> <title>` digit text; multi-letter ids (neither `prepare.` nor `task.`) append ` · <id>`. */
function childText(label: string, title: string, id: string): string {
    return id.startsWith('prepare.') || id.startsWith('task.') || id === PREPARE_ID || id === REPORT_ID
        ? `${label} ${title}`
        : `${label} ${title} · ${id}`;
}

/**
 * Build the initial phased plan from a definition. Returns null when no state
 * declares `display` — unannotated pipelines keep the existing flat todo
 * projection unchanged (R1: annotation is additive).
 *
 * Rows: `A Prepare` + A1..A3, then one letter row per phase (first-appearance
 * order in state declaration order) with only `show: 'plan'` states as digits
 * (`show: 'on-entry'` and terminal states never appear — AC2).
 */
export function buildPhasedPlan(def: WorkflowDef): PhasedPlanItem[] | null {
    if (!isStateMachine(def)) return null;
    const annotated = def.states.filter(hasDisplay);
    if (annotated.length === 0) return null;

    const items: PhasedPlanItem[] = [
        { label: 'A', id: PREPARE_ID, outcome: 'pending', title: 'Prepare', text: 'A Prepare' },
        {
            label: 'A1',
            id: 'prepare.1',
            outcome: 'pending',
            parent: 'A',
            title: 'Quick readiness',
            text: 'A1 Quick readiness',
        },
        { label: 'A2', id: 'prepare.2', outcome: 'pending', parent: 'A', title: 'Prepare Git', text: 'A2 Prepare Git' },
        {
            label: 'A3',
            id: 'prepare.3',
            outcome: 'pending',
            parent: 'A',
            title: 'Publish plan',
            text: 'A3 Publish plan',
        },
    ];

    const phases: string[] = [];
    for (const s of def.states) {
        if (s.display !== undefined && !phases.includes(s.display.phase)) phases.push(s.display.phase);
    }

    for (const [phaseIndex, phase] of phases.entries()) {
        const letter = planLetter(phaseIndex + 1); // A is the prepare row
        const phaseTitle = resolvePhaseTitle(def.states, phase);
        items.push({
            label: letter,
            id: `${PHASE_ID_PREFIX}${phase}`,
            outcome: 'pending',
            title: phaseTitle,
            text: `${letter} ${phaseTitle}`,
        });
        let childIndex = 0;
        for (const s of def.states) {
            if (s.display?.phase !== phase || s.display.show === 'on-entry') continue;
            const label = planChild(letter, childIndex++);
            const title = s.display.title ?? s.id;
            items.push({
                label,
                id: s.id,
                outcome: 'pending',
                parent: letter,
                title,
                text: childText(label, title, s.id),
            });
        }
    }
    return items;
}

// ── Phase-table validation ───────────────────────────────────────────────────

/**
 * Validate a definition's `display` phase table. Empty findings = valid.
 * Unannotated definitions (and non-state-machine kinds) are valid by omission
 * — validation is opt-in per annotated workflow, never a global requirement
 * (R3). Findings name the offending state or phase.
 */
export function validatePhaseTable(def: WorkflowDef): string[] {
    if (!isStateMachine(def)) return [];
    const annotated = def.states.filter(hasDisplay);
    if (annotated.length === 0) return [];

    const errors: string[] = [];
    const terminals = new Set(def.terminalStates ?? []);

    for (const s of def.states) {
        if (s.display === undefined && !terminals.has(s.id)) {
            errors.push(
                `state "${s.id}" has no display phase — every non-terminal state must declare display when any state does`,
            );
        }
        if (s.display !== undefined && terminals.has(s.id)) {
            errors.push(`terminal state "${s.id}" must not declare display`);
        }
    }

    const phases: string[] = [];
    for (const s of annotated) {
        if (!phases.includes(s.display.phase)) phases.push(s.display.phase);
    }
    if (phases.length > 25) {
        errors.push(`${phases.length} phases exceed the 25 plan letters (B-Z); split the workflow or drop phase rows`);
    }
    for (const phase of phases) {
        const members = annotated.filter((s) => s.display.phase === phase);
        if (members.length > 9) {
            errors.push(
                `phase "${phase}" has ${members.length} states — at most 9 digit children fit under one letter`,
            );
        }
        const titles = [...new Set(members.map((s) => s.display.phaseTitle).filter((t) => t !== undefined))];
        if (titles.length > 1) {
            errors.push(
                `phase "${phase}" has conflicting phaseTitle values: ${titles.map((t) => `"${t}"`).join(', ')}`,
            );
        }
    }
    return errors;
}

// ── On-entry insertion ───────────────────────────────────────────────────────

/**
 * Insert the `show: 'on-entry'` state's digit the moment the host enters it
 * (R2: plan-visible states stay constant on every pass; on-entry states appear
 * only when reached). Pure: returns a new array; existing labels never change
 * so a loop verify→test-fix→verify re-renders identically; re-entering an
 * already-present state is a no-op (label stability). Terminal or unannotated
 * states leave the plan unchanged.
 */
export function insertOnEntry(items: PhasedPlanItem[], stateId: string, def: WorkflowDef): PhasedPlanItem[] {
    if (!isStateMachine(def)) return items;
    if (items.some((i) => i.id === stateId)) return items;
    const display = def.states.find((s) => s.id === stateId)?.display;
    if (display === undefined || (def.terminalStates ?? []).includes(stateId)) return items;

    const phaseRow = items.find((i) => i.id === `${PHASE_ID_PREFIX}${display.phase}`);
    if (phaseRow === undefined) return items;
    const children = items.filter((i) => i.parent === phaseRow.label);
    const label = planChild(phaseRow.label, children.length);
    const title = display.title ?? stateId;
    const item: PhasedPlanItem = {
        label,
        id: stateId,
        outcome: 'pending',
        parent: phaseRow.label,
        title,
        text: childText(label, title, stateId),
    };
    const last = children.at(-1) ?? phaseRow;
    const at = items.indexOf(last) + 1;
    return [...items.slice(0, at), item, ...items.slice(at)];
}

// ── Batch plan (host-driven waves) ───────────────────────────────────────────

/** One task entry the host already froze into the batch. */
export interface BatchTask {
    wbs: string;
    name: string;
}

/** Truncate to `TITLE_CAP` characters, ellipsis included in the count. */
function truncateTitle(name: string): string {
    if (name.length <= TITLE_CAP) return name;
    // Drop a dangling high surrogate so the cut never splits an astral character.
    return `${name.slice(0, TITLE_CAP - 1).replace(/[\uD800-\uDBFF]$/, '')}…`;
}

/**
 * Slice the frozen task list into waves of 24 and render each wave's plan
 * (R5): `A Prepare batch` + A1..A4, one letter B..Y per task with no digit
 * children, then `Z Batch report`. Letters come from `planLetter` so the A-Z
 * cap is enforced, not assumed.
 */
export function buildBatchPlan(tasks: BatchTask[]): PhasedPlanItem[][] {
    const waves: PhasedPlanItem[][] = [];
    for (let offset = 0; offset < tasks.length; offset += WAVE_SIZE) {
        const items: PhasedPlanItem[] = [
            { label: 'A', id: PREPARE_ID, outcome: 'pending', title: 'Prepare batch', text: 'A Prepare batch' },
            {
                label: 'A1',
                id: 'prepare.1',
                outcome: 'pending',
                parent: 'A',
                title: 'Resolve and freeze task set',
                text: 'A1 Resolve and freeze task set',
            },
            {
                label: 'A2',
                id: 'prepare.2',
                outcome: 'pending',
                parent: 'A',
                title: 'Order by dependencies',
                text: 'A2 Order by dependencies',
            },
            {
                label: 'A3',
                id: 'prepare.3',
                outcome: 'pending',
                parent: 'A',
                title: 'Prepare Git',
                text: 'A3 Prepare Git',
            },
            {
                label: 'A4',
                id: 'prepare.4',
                outcome: 'pending',
                parent: 'A',
                title: 'Publish plan',
                text: 'A4 Publish plan',
            },
        ];
        tasks.slice(offset, offset + WAVE_SIZE).forEach((task, i) => {
            const label = planLetter(i + 1);
            const title = `${task.wbs} ${truncateTitle(task.name)}`;
            items.push({
                label,
                id: `${TASK_ID_PREFIX}${task.wbs}`,
                outcome: 'pending',
                title,
                text: `${label} ${title}`,
            });
        });
        items.push({ label: 'Z', id: REPORT_ID, outcome: 'pending', title: 'Batch report', text: 'Z Batch report' });
        waves.push(items);
    }
    return waves;
}

/**
 * A task row's phase digits (R5): one digit per phase row of the task's
 * workflow plan, addressed under the task's letter. Row ids stay
 * `phase.<key>`; labels are fresh so they never collide with the wave letters.
 */
export function taskPhaseChildren(taskLetter: string, plan: PhasedPlanItem[]): PhasedPlanItem[] {
    if (!Array.isArray(plan)) return [];
    return plan
        .filter((i) => i.id.startsWith(PHASE_ID_PREFIX) && i.label.length === 1)
        .map((row, i) => {
            const label = planChild(taskLetter, i);
            return {
                label,
                id: row.id,
                outcome: row.outcome,
                parent: taskLetter,
                title: row.title,
                text: `${label} ${row.title}`,
            };
        });
}

// ── Host status mapping ──────────────────────────────────────────────────────

/**
 * Map an engine outcome to host-todo status when the HOST performs lifecycle
 * transitions (AC6): only `completed` and `active` are host-observable facts;
 * the engine-decided outcomes (`skipped`/`failed`/`unattempted`/`blocked`) and
 * `pending` all render as pending — the host decides them, never the renderer.
 */
export function hostStatus(outcome: VisibleOutcome): 'completed' | 'in_progress' | 'pending' {
    if (outcome === 'completed') return 'completed';
    if (outcome === 'active') return 'in_progress';
    return 'pending';
}

/** Human text for the host todo list: appends `[outcome]` only for the four host-decided outcomes. */
export function hostText(item: PhasedPlanItem): string {
    const hostDecided =
        item.outcome === 'skipped' ||
        item.outcome === 'failed' ||
        item.outcome === 'unattempted' ||
        item.outcome === 'blocked';
    return hostDecided ? `${item.text} [${item.outcome}]` : item.text;
}
