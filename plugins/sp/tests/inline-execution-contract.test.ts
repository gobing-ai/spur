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

describe('task 0406 — inline execution contract', () => {
    test('inline is the default and never shells to spur agent run without a named trigger or override', () => {
        const contract = readFileSync(CROSS_CUTTING, 'utf8');
        const normalized = normalizedMarkdown(contract);

        expect(contract).toContain('## Inline-default execution surface');
        expect(normalized).toContain('Default: execute the backing skill directly in the current coding-agent session');
        expect(normalized).toContain(
            'Do not invoke `spur agent run` when no escalation trigger or operator override applies',
        );
        expect(normalized).toContain('the applied trigger must be named');
        expect(normalized).toContain(
            'Strip `--inline`, `--subprocess`, and the outer `--agent` selector from the command placed in the child prompt',
        );
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
        expect(normalized).toContain('A trigger selects subprocess even when `--inline` was supplied');
    });

    test('mode-aware dev commands expose inline default and an explicit subprocess override', () => {
        // Sanity: the known mode-aware set is non-empty and includes the originals
        expect(MODE_AWARE_COMMANDS.length).toBeGreaterThanOrEqual(12);
        for (const expected of ['dev-run', 'dev-review', 'dev-verify']) {
            expect(MODE_AWARE_COMMANDS, `${expected} should be mode-aware`).toContain(expected);
        }

        for (const command of MODE_AWARE_COMMANDS) {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');

            expect(raw, `${command}: missing --inline`).toContain('--inline');
            expect(raw, `${command}: missing --subprocess`).toContain('--subprocess');
            expect(raw, `${command}: missing central execution-surface contract`).toContain(
                'cross-cutting.md#inline-default-execution-surface',
            );
            expect(raw, `${command}: operator flag must retain task 0405 vocabulary`).toContain('--agent');
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

    test('the operator can force subprocess dispatch and contradictory mode flags are rejected', () => {
        const contract = readFileSync(CROSS_CUTTING, 'utf8');
        const normalized = normalizedMarkdown(contract);

        expect(normalized).toContain('`--subprocess` forces subprocess execution');
        expect(normalized).toContain('Report `operator override`');
        expect(normalized).toContain('`--inline` and `--subprocess` together are invalid usage');
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

        // --agent <different> forces subprocess (trigger 1), wins over --inline
        expect(normalized).toContain(
            'An explicit `--agent <name>` that requires a different coding agent is trigger 1 and forces subprocess',
        );
        // --agent auto does NOT force subprocess on its own — runs inline
        expect(normalized).toContain(
            '`--agent auto` or a selector resolving to the current agent does not force subprocess on its own',
        );
        // Single-hop strip applies to single-skill dispatch only
        expect(normalized).toContain(
            'Strip `--inline`, `--subprocess`, and the outer `--agent` selector from the command placed in the child prompt',
        );
        // Pipeline-wrapper carve-out: --agent reaches vars.agent, not stripped
        expect(normalized).toContain('Pipeline-wrapper carve-out');
        expect(normalized).toContain('merged into per-task `vars.agent`');

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
