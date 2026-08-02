import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const COMMANDS_DIR = join(ROOT, 'plugins', 'sp', 'commands');
const CROSS_CUTTING = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'cross-cutting.md');
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

function normalizedMarkdown(raw: string): string {
    return raw.replaceAll('**', '').replace(/\s+/g, ' ').trim();
}

describe('task 0406 / H82 — unified --agent execution-surface contract', () => {
    test('inline is the default and the single --agent selector governs the surface', () => {
        const contract = readFileSync(CROSS_CUTTING, 'utf8');
        const normalized = normalizedMarkdown(contract);

        expect(contract).toContain('## Inline-default execution surface');
        expect(normalized).toContain('Default: execute the backing skill directly in the current coding-agent session');
        expect(normalized).toContain(
            'Do not invoke `spur agent run` when no escalation trigger applies and the operator did not select subprocess via the `--agent` selector',
        );
        expect(normalized).toContain('the applied trigger must be named');
        expect(normalized).toContain('Strip the outer `--agent` selector from the command placed in the child prompt');
        expect(normalized).toContain('it must not spawn another `spur agent run` for the same trigger');
    });

    test('all dispatch-surface escalation triggers override inline positively', () => {
        const contract = readFileSync(CROSS_CUTTING, 'utf8');
        const dispatch = readFileSync(DISPATCH_SURFACE, 'utf8');
        const normalized = normalizedMarkdown(contract);

        for (const trigger of [
            'Different model or coding agent required',
            'Headless or unattended step',
            'Durable auditable run record required',
            'Workspace or credential isolation required',
        ]) {
            expect(dispatch).toContain(`**${trigger}**`);
            expect(normalized).toContain(trigger);
        }
        expect(normalized).toContain('A trigger selects subprocess even when `--agent inline` was supplied');
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
        const contract = readFileSync(CROSS_CUTTING, 'utf8');
        const normalized = normalizedMarkdown(contract);

        // --agent auto or --agent <name> explicitly selects a subprocess surface
        expect(normalized).toContain('report `operator override`');
        // The unified selector table lists all three values
        expect(normalized).toContain('`auto`');
        expect(normalized).toContain('`inline`');
    });

    test('explicit subprocess paths stay subprocess-backed', () => {
        const contract = readFileSync(CROSS_CUTTING, 'utf8');
        const pipeline = readFileSync(TASK_PIPELINE, 'utf8');
        const normalized = normalizedMarkdown(contract);

        expect(normalized).toContain('Direct `spur agent run` invocations are always subprocess execution');
        expect(normalized).toContain('Workflow `agent.run` actions are always subprocess execution');
        expect(pipeline).toContain('kind: agent.run');
    });

    test('--agent resolution is unambiguous for inline, single-hop, and pipeline wrappers', () => {
        const contract = readFileSync(CROSS_CUTTING, 'utf8');
        const normalized = normalizedMarkdown(contract);

        // The one rule: --agent names WHO does the model-bearing work; the surface is derived.
        // Assert the rule, not any one phrasing of its consequences — task 0413 verify found the
        // previous assertion pinned the literal string 'Pipeline-wrapper carve-out', which locked
        // in the exception framing the collapse exists to remove.
        expect(normalized).toContain('names *who* does the model-bearing work');
        expect(normalized).toContain('The execution surface is derived from');
        // Single-hop strip applies to single-skill dispatch only
        expect(normalized).toContain('Strip the outer `--agent` selector from the command placed in the child prompt');
        // Pipeline wrappers: --agent reaches vars.agent, stated as the same rule, not an exception
        expect(normalized).toContain('merged into per-task `vars.agent`');
        expect(normalized).toContain('the same rule, not an exception');

        // dev-run and dev-runall document the pipeline-passthrough semantics
        for (const command of ['dev-run', 'dev-runall']) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');
            expect(raw, `${command}: must document vars.agent propagation`).toContain('vars.agent');
        }
    });

    test('the inline trade-off is explicit', () => {
        const contract = readFileSync(CROSS_CUTTING, 'utf8');
        const normalized = normalizedMarkdown(contract);

        expect(normalized).toContain('no isolated workspace');
        expect(normalized).toContain('no separate run record');
        expect(normalized).toContain('no independent timeout or abort boundary');
        expect(normalized).toContain('no tier-selected executor');
    });
});
