import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    checkAgentValueTables,
    extractTriggerTable,
    extractValueBehaviorTable,
} from '../scripts/validate-flag-contracts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const COMMANDS_DIR = join(ROOT, 'plugins', 'sp', 'commands');
const CROSS_CUTTING = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'cross-cutting.md');
const GLOSSARY = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'flag-glossary.md');
const ADR = join(ROOT, 'docs', '00_ADR.md');
const DISPATCH_SURFACE = join(
    ROOT,
    'plugins',
    'sp',
    'skills',
    'parallel-execution',
    'references',
    'dispatch-surface.md',
);
const TASK_PIPELINE = join(ROOT, 'config', 'workflows', 'task-pipeline.yaml');

// Derive mode-aware commands dynamically: any command that applies the inline-default
// execution-surface contract is mode-aware by definition. This self-documents scope —
// adding the contract reference to a new command automatically extends coverage.
const MODE_AWARE_COMMANDS = readdirSync(COMMANDS_DIR)
    .filter((f) => f.startsWith('dev-') && f.endsWith('.md'))
    .filter((f) =>
        readFileSync(join(COMMANDS_DIR, f), 'utf8').includes('cross-cutting.md#inline-default-execution-surface'),
    )
    .map((f) => f.replace(/\.md$/, ''));

// Commands that delegate model-bearing work via Skill() but are NOT mode-aware
// (CLI-mechanical or workflow-backed). These must not grow Skill() delegation without
// also applying the contract — guarded by the test below.
const EXCLUDED_COMMANDS = [
    'dev-changelog',
    'dev-daily',
    'dev-gitmsg',
    'dev-fixall',
    'dev-handover',
    'dev-idea',
] as const;

// Workflow commands that have no interactive host-stage inversion. Task execution
// wrappers are tested separately below because ADR-047 grants them the inline driver.
const HEADLESS_ONLY_WORKFLOW_COMMANDS = ['dev-plan'] as const;

// 0676 R1/R2: engine-driven headless surfaces must not present `inline` as usable.
// They either omit it from the advertised options (this set) or document the stable
// rejection explicitly (dev-wrap/dev-wrapall shape, covered by their own docs).
const HEADLESS_NO_INLINE_ADVERTISED = ['dev-find-issue', 'dev-idea'] as const;

describe('task 0406 / H82 — unified --agent execution-surface contract', () => {
    test('the unified --agent selector governs the surface; inline is the default and resolves identically to omit', () => {
        // Extracted claims (R2/R3) — not prose pins. The value→behavior table and the
        // one-rule blockquote are compared mechanically by the cross-surface gate
        // (flag-contract-parity.test.ts); here we assert the extracted claim directly.
        const crossCutting = readFileSync(CROSS_CUTTING, 'utf8');
        const table = extractValueBehaviorTable(crossCutting, '## Inline-default execution surface');
        if (table === null) {
            throw new Error('cross-cutting.md inline-default value table must parse');
        }
        expect(table.get('inline')?.surfaces.has('inline')).toBe(true);
        // 0687 R1: inline IS the default and resolves identically to omit; the table keeps
        // both rows, with the (omitted) row carrying the default marker and 0508 eligibility
        // now generalized to all inline resolution (0687 R2).
        expect(table.get('inline')?.defaultWhenOmitted).toBe(false); // (omitted) is the carrier row; inline is documented identical (0687 R1)
        expect(table.get('inline')?.surfaces.has('subprocess')).toBe(false);
        expect(table.get('auto')?.surfaces.has('subprocess')).toBe(true);
        expect(table.get('<name>')?.surfaces.has('subprocess')).toBe(true);
        expect(table.get('<name>')?.conditional).toBe(true);
        // The single-rule sentence is the section's anchor — the gate fails loudly if
        // it disappears (validate-flag-contracts.ts C3b), so no wording pin here.
    });

    test('all dispatch-surface escalation triggers override inline positively', () => {
        // The four triggers are extracted from the structured trigger table
        // (Trigger | Subprocess condition | Required report), not pinned from prose.
        const crossCutting = readFileSync(CROSS_CUTTING, 'utf8');
        const triggers = extractTriggerTable(crossCutting);
        if (triggers === null) {
            throw new Error('cross-cutting.md escalation trigger table must parse');
        }
        for (const expected of [
            'Different model or coding agent required',
            'Headless or unattended step',
            'Durable auditable run record required',
            'Workspace or credential isolation required',
        ]) {
            expect(triggers, `cross-cutting.md trigger table must list ${expected}`).toContain(expected);
        }
        // The dispatch-surface owns the trigger vocabulary; cross-cutting defers to it.
        const dispatch = readFileSync(DISPATCH_SURFACE, 'utf8');
        for (const trigger of triggers) {
            expect(dispatch, `dispatch-surface.md must name trigger "${trigger}"`).toContain(trigger);
        }
    });

    test('mode-aware dev commands use the unified --agent <inline|auto|name> selector', () => {
        // Sanity: the known mode-aware set is non-empty and includes the originals
        expect(MODE_AWARE_COMMANDS.length).toBeGreaterThanOrEqual(12);
        for (const expected of ['dev-run', 'dev-review', 'dev-verify']) {
            expect(MODE_AWARE_COMMANDS, `${expected} should be mode-aware`).toContain(expected);
        }

        for (const command of MODE_AWARE_COMMANDS.filter((c) => !HEADLESS_NO_INLINE_ADVERTISED.includes(c as never))) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');

            // The unified selector must appear with all three values
            expect(raw, `${command}: missing unified --agent selector`).toContain('--agent');
            expect(raw, `${command}: missing central execution-surface contract`).toContain(
                'cross-cutting.md#inline-default-execution-surface',
            );
            const hintMatch = raw.match(/argument-hint:\s*(.+)/);
            if (hintMatch) {
                expect(hintMatch[1], `${command}: argument-hint must use the correct --agent selector`).toContain(
                    'inline|auto|name',
                );
            }
            expect(raw, `${command}: domain vocabulary leaked into the operator surface`).not.toContain('--executor');
        }
    });

    test('0676 R1/R2 — headless find-issue/idea never advertise inline as usable', () => {
        for (const command of HEADLESS_NO_INLINE_ADVERTISED) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');
            expect(raw, `${command}: must not advertise --agent <inline|auto|name>`).not.toContain(
                '--agent <inline|auto|name>',
            );
            expect(raw, `${command}: must still reference the execution-surface contract`).toContain(
                'cross-cutting.md#inline-default-execution-surface',
            );
        }
    });

    test('0687 — headless workflow commands (dev-plan) resolve omission and explicit inline identically via tier substitution', () => {
        for (const command of HEADLESS_ONLY_WORKFLOW_COMMANDS) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');
            expect(raw, `${command}: must be mode-aware to carry --agent`).toContain(
                'cross-cutting.md#inline-default-execution-surface',
            );
            expect(raw, `${command}: must document the <inline|auto|name> selector`).toContain('<inline|auto|name>');
            expect(raw, `${command}: must state the task 0687 unified resolution`).toContain('task 0687');
            expect(raw, `${command}: must not advertise the retired headless rejection`).not.toContain(
                'rejected with the stable special error',
            );
        }
    });

    test('0503 — interactive full task execution uses the YAML-backed host driver with provenance', () => {
        const driver = readFileSync(
            join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'inline-pipeline-driver.md'),
            'utf8',
        );
        for (const command of ['dev-run', 'dev-runall']) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');
            expect(raw, `${command}: missing host driver route`).toContain('inline pipeline driver');
            expect(raw, `${command}: missing interactive omit/inline contract`).toContain('omit/`inline`');
        }
        expect(driver).toContain('remains the sole');
        expect(driver).toContain('project→bundled model');
        expect(driver).toContain('spur task run-link <wbs> --source inline-full');
        expect(driver).toContain('stage <id> executed inline in session <session-id>');
        expect(driver).toContain("execute the action's slash command, native-subagent-first");
        expect(driver).toContain('Transition guards are not advisory');
        expect(driver).toContain('Never silently fall back');
    });

    test('0506 R1 — wrap commands are workflow-backed, selector-preserving, and report the subprocess override', () => {
        const WRAP_COMMANDS = ['dev-wrap', 'dev-wrapall'];
        for (const command of WRAP_COMMANDS) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');

            // The unified selector is declared on the wrap surface.
            expect(raw, `${command}: missing unified --agent selector`).toContain('--agent');
            expect(raw, `${command}: argument-hint must use the correct --agent selector`).toContain(
                'inline|auto|name',
            );
            expect(raw, `${command}: must apply the inline-default contract`).toContain(
                'cross-cutting.md#inline-default-execution-surface',
            );
            expect(raw, `${command}: must state unified inline resolution (task 0687)`).toContain('task 0687');

            // Wrap remains workflow-backed — no inline driver, no Skill() substitution.
            expect(raw, `${command}: must stay workflow-backed`).toContain('spur workflow run wrapup-pipeline.yaml');
            expect(raw, `${command}: must not promise an inline wrap driver`).not.toContain('inline-wrapup-driver.md');

            // Pre-dispatch notice fields (R1): subprocess surface, trigger 3, executor resolution.
            expect(raw, `${command}: must name the subprocess surface in the notice`).toContain(
                'execution surface: subprocess',
            );
            expect(raw, `${command}: must name objective trigger 3`).toContain('trigger 3');
            expect(raw, `${command}: must merge the executor into vars.agent`).toContain('vars.agent');
        }

        // Selector preservation through run/runall wrap handoffs and next-router A8/B6 routes.
        for (const command of ['dev-run', 'dev-runall']) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');
            expect(raw, `${command}: wrap handoff must preserve --agent`).toContain('--agent');
            expect(raw, `${command}: wrap handoff must name the wrap hop`).toMatch(/wrap/);
        }
        const routing = readFileSync(
            join(ROOT, 'plugins', 'sp', 'skills', 'next-router', 'references', 'routing-table.md'),
            'utf8',
        );
        expect(routing, 'A8 must preserve --agent into dev-wrap').toContain('/sp:dev-wrap <wbs>` (`--agent');
        expect(routing, 'B6 must preserve --agent into dev-wrapall').toContain(
            '/sp:dev-wrapall --feature <id>` (`--agent',
        );
    });

    test('0508 — interactive inline is host-controlled, native-subagent-first with host fallback', () => {
        const driver = readFileSync(
            join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'inline-pipeline-driver.md'),
            'utf8',
        );
        const crossCutting = readFileSync(CROSS_CUTTING, 'utf8');
        const adr = readFileSync(ADR, 'utf8');

        // Eligibility is deterministic and observable: pure-slash agent.run, non-interactive
        // state, native subagent with shared-worktree capability. No subjective heuristic.
        expect(driver).toContain('Native-subagent dispatch (R2 eligibility');
        expect(driver).toContain('pure slash command');
        expect(driver).toContain('native subagent that shares the working tree');
        expect(driver).toContain('No token estimate, stage-size threshold, model heuristic');
        // Distinct provenance: subagent vs inline; no post-launch replay; host-owned HITL.
        expect(driver).toContain('stage <id> executed via subagent <agent-id> (host session <session-id>)');
        expect(driver).toContain('stage <id> executed inline in session <session-id>');
        expect(driver).toContain('do **not** replay the stage in the host');
        expect(driver).toContain('the host alone executes operator-confirmation actions');
        expect(driver).toContain('do not dispatch this stage again');

        // The value table stays on three values; the inline row carries the nuance in lockstep.
        expect(crossCutting).toContain('eligible model stages may use a native subagent (0508)');
        // The ADR-047 amendment records the decision.
        expect(adr).toContain('Amendment (2026-08-10, task 0508)');
        expect(adr).toContain('native subagent');

        // Operator surfaces no longer promise host-only model stages.
        for (const command of ['dev-run', 'dev-runall']) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');
            expect(raw, `${command}: must document native-subagent-first inline stages`).toContain('native subagent');
        }
    });

    test('excluded commands must not delegate model-bearing work without the contract', () => {
        for (const command of EXCLUDED_COMMANDS) {
            const path = join(COMMANDS_DIR, `${command}.md`);
            const raw = readFileSync(path, 'utf8');

            // If an excluded command starts delegating via Skill(skill="sp:...), it must
            // also apply the inline-default contract — otherwise it silently bypasses the surface.
            const hasSkillDelegation = /Skill\(skill="sp:/.test(raw);
            if (hasSkillDelegation) {
                expect(
                    raw,
                    `${command}: delegates via Skill() but does not apply the inline-default contract`,
                ).toContain('cross-cutting.md#inline-default-execution-surface');
            }
        }
    });

    test('the operator can select subprocess via --agent auto and escalation triggers override inline', () => {
        // Extracted claims: `auto` → subprocess in the value table (asserted above); the
        // escalation-trigger override is the trigger table's whole point (asserted above).
        // This test exists so removing the `auto` row fails loudly here too.
        const crossCutting = readFileSync(CROSS_CUTTING, 'utf8');
        const table = extractValueBehaviorTable(crossCutting, '## Inline-default execution surface');
        if (table === null) {
            throw new Error('cross-cutting.md inline-default value table must parse');
        }
        expect(table.get('auto')?.surfaces.has('subprocess')).toBe(true);
    });

    test('explicit subprocess paths stay subprocess-backed', () => {
        // Direct `spur agent run` and workflow `agent.run` are structured markers (the
        // pipeline YAML `kind: agent.run` node) — the subprocess claim is extracted from
        // the surface's own structure, not pinned from prose.
        const pipeline = readFileSync(TASK_PIPELINE, 'utf8');
        expect(pipeline).toContain('kind: agent.run');
        // Cross-cutting.md still documents the explicit-subprocess surfaces; the gate's
        // cross-file comparison covers their semantics, so no sentence pin is needed here.
    });

    test('--agent resolution is unambiguous for inline, single-hop, and pipeline wrappers', () => {
        // The one-rule + value-table + ADR parity is the gate's C3a/C3b claim set
        // (flag-contract-parity.test.ts); assert the gate agrees on the real surfaces.
        const crossCutting = readFileSync(CROSS_CUTTING, 'utf8');
        const glossary = readFileSync(GLOSSARY, 'utf8');
        const adr = readFileSync(ADR, 'utf8');
        const violations = checkAgentValueTables(crossCutting, glossary, adr);
        expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);

        // Pipeline wrappers propagate --agent to vars.agent — a structural marker in the
        // command files, asserted here so the passthrough cannot silently regress.
        for (const command of ['dev-run', 'dev-runall']) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');
            expect(raw, `${command}: must document vars.agent propagation`).toContain('vars.agent');
        }
    });

    test('the inline trade-off is explicit', () => {
        // The trade-off is prose by nature; its substance — inline provides no isolation,
        // record, timeout, or tier — is enforced by the value-table claim that `inline`
        // means "the current session's agent" (extracted above). Keep a structural
        // presence check on the documented section so the trade-off cannot silently vanish.
        const crossCutting = readFileSync(CROSS_CUTTING, 'utf8');
        expect(crossCutting).toContain('### Inline trade-off');
    });
});
