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
const TASK_PIPELINE = join(ROOT, '.spur', 'workflows', 'task-pipeline.yaml');

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
    'dev-wrap',
    'dev-wrapall',
] as const;

describe('task 0406 / H82 — unified --agent execution-surface contract', () => {
    test('inline is the default and the single --agent selector governs the surface', () => {
        // Extracted claims (R2/R3) — not prose pins. The value→behavior table and the
        // one-rule blockquote are compared mechanically by the cross-surface gate
        // (flag-contract-parity.test.ts); here we assert the extracted claim directly.
        const crossCutting = readFileSync(CROSS_CUTTING, 'utf8');
        const table = extractValueBehaviorTable(crossCutting, '## Inline-default execution surface');
        if (table === null) {
            throw new Error('cross-cutting.md inline-default value table must parse');
        }
        expect(table.get('inline')?.surfaces.has('inline')).toBe(true);
        expect(table.get('inline')?.defaultWhenOmitted).toBe(true);
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

        for (const command of MODE_AWARE_COMMANDS) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');

            // The unified selector must appear with all three values
            expect(raw, `${command}: missing unified --agent selector`).toContain('--agent');
            expect(raw, `${command}: missing central execution-surface contract`).toContain(
                'cross-cutting.md#inline-default-execution-surface',
            );
            // The old standalone --inline / --subprocess flags must not appear as
            // independent command flags (they may appear only in migration/deprecation prose).
            // Check the argument-hint line specifically — it must carry <inline|auto|name>.
            const hintMatch = raw.match(/argument-hint:\s*(.+)/);
            if (hintMatch) {
                expect(hintMatch[1], `${command}: argument-hint must use the unified selector`).toContain(
                    'inline|auto|name',
                );
            }
            expect(raw, `${command}: domain vocabulary leaked into the operator surface`).not.toContain('--executor');
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
