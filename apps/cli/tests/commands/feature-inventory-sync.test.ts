/**
 * 1004 R6 CLI ports for the feature check --inventory gate and the
 * service-level blocked-sync suppression, exercised through the real main():
 * the deleted wrapper/coverage scripts are replaced by CLI flags on
 * `feature check` / `feature sync`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

let cwd: string;

const featureContent = (id: string, name: string, status: string, covers: boolean): string => `---
schema_version: 1
id: "${id}"
name: "${name}"
status: ${status}
priority: P2
tags: []
created_at: "2026-09-29T00:00:00.000Z"
updated_at: "2026-09-29T00:00:00.000Z"
---

# ${id}: ${name}

## Goal

## Scope

- In:
- Out:

## Acceptance Criteria

\`\`\`gherkin
Feature: ${name}

  Scenario: Basic acceptance
${covers ? '    # covers: I1\n' : ''}    Given a precondition
    When the thing happens
    Then the outcome holds
\`\`\`
`;

const writeTask = (wbs: string, name: string, status: string, featureId: string): void => {
    writeFileSync(
        join(cwd, 'docs', 'tasks', `${wbs}_${name.toLowerCase().replace(/\s+/g, '-')}-task.md`),
        `---
schema_version: 1
wbs: "${wbs}"
name: "${name}"
status: "${status}"
feature_id: "${featureId}"
created_at: "2026-09-29T00:00:00.000Z"
updated_at: "2026-09-29T00:00:00.000Z"
---
# ${wbs}: ${name}
`,
    );
};

const run = async (args: string[]): Promise<{ exitCode: number; output: CapturedOutput }> => {
    const output = createCapturedOutput();
    const exitCode = await main(args, { cwd, output });
    return { exitCode, output };
};

const lastMessage = (output: CapturedOutput): string => {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
};

beforeAll(async () => {
    cwd = join(import.meta.dir, '..', `.tmp-feature-inv-sync-${Date.now()}`);
    mkdirSync(join(cwd, 'docs', 'features'), { recursive: true });
    mkdirSync(join(cwd, 'docs', 'tasks'), { recursive: true });
    writeFileSync(join(cwd, '.gitignore'), '.spur/\n');
    const init = Bun.spawnSync(
        [
            'sh',
            '-c',
            'git init -q && git config user.email t@t && git config user.name t && git add -A && git commit -q -m init',
        ],
        { cwd },
    );
    if (init.exitCode !== 0) throw new Error(`fixture git init failed: ${init.stderr.toString()}`);
}, 20000);

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

describe('spur feature check --inventory (1004 R1)', () => {
    test('uncovered inventory item fails the check with the inventory-coverage finding', async () => {
        writeFileSync(
            join(cwd, 'docs', 'features', 'C1_uncovered.md'),
            featureContent('C1', 'Uncovered', 'backlog', false),
        );
        writeFileSync(join(cwd, 'docs', 'features', 'C2_covered.md'), featureContent('C2', 'Covered', 'backlog', true));
        const report = join(cwd, 'requirement-inventory.md');
        writeFileSync(report, '## Requirement inventory\n\n- I1 — Capture the idea verbatim before any processing\n');

        const failing = await run(['feature', 'check', 'C1', '--inventory', report, '--json']);
        expect(failing.exitCode).toBe(1);
        const parsed = JSON.parse(lastMessage(failing.output)) as Array<{
            id: string;
            pass: boolean;
            findings: Array<{ code: string; severity: string }>;
        }>;
        expect(parsed[0]?.id).toBe('C1');
        expect(parsed[0]?.pass).toBe(false);
        expect(parsed[0]?.findings.some((f) => f.code === 'inventory-coverage' && f.severity === 'error')).toBe(true);

        const passing = await run(['feature', 'check', 'C2', '--inventory', report, '--json']);
        const parsedOk = (
            passing.output.messages.at(-1) ? JSON.parse(passing.output.messages.at(-1) ?? '{}') : []
        ) as Array<{
            id: string;
            findings: Array<{ code: string }>;
        }>;
        if (parsedOk.length === 0) throw new Error(`C2 check produced no JSON: ${passing.output.errors.join(' | ')}`);
        expect(parsedOk[0]?.id).toBe('C2');
        expect(parsedOk[0]?.findings.some((f) => f.code === 'inventory-coverage')).toBe(false);
    });
});

describe('spur feature sync suppression (1004 R3)', () => {
    test('two identical calls suppress the repeat; --force re-derives and applies', async () => {
        writeFileSync(
            join(cwd, 'docs', 'features', 'S1_sync-supp.md'),
            featureContent('S1', 'Sync Supp', 'done', true),
        );
        writeTask('0101', 'Sync Supp Task', 'wip', 'S1'); // done feature + wip task → requiresConfirm reopen (BLOCKED)

        const first = await run(['feature', 'sync', 'S1', '--json']);
        expect(first.exitCode).toBe(0);
        const r1 = JSON.parse(lastMessage(first.output)) as {
            applied: boolean;
            suppressed?: boolean;
            proposal: { requiresConfirm?: boolean };
        };
        expect(r1.applied).toBe(false);
        expect(r1.proposal.requiresConfirm).toBe(true);
        expect(r1.suppressed).toBeUndefined();

        const second = await run(['feature', 'sync', 'S1', '--json']);
        const r2 = JSON.parse(lastMessage(second.output)) as { applied: boolean; suppressed?: boolean };
        expect(r2.applied).toBe(false);
        expect(r2.suppressed).toBe(true);

        const forced = await run(['feature', 'sync', 'S1', '--force', '--json']);
        const r3 = JSON.parse(lastMessage(forced.output)) as { applied: boolean; suppressed?: boolean };
        expect(r3.applied).toBe(true);
        expect(r3.suppressed).toBeUndefined();
    }, 30000);
});
