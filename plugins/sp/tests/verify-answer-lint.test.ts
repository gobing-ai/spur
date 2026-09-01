/**
 * verify-answer-lint contract tests (0726 R3).
 *
 * Behavioral matrix runs the REAL script against a fake spur binary serving a
 * fixture task (R1/R2 requirements, AC1/AC2 checklist, linked feature with two
 * scenario titles). Wiring tests assert the task-pipeline verify stage orders
 * lint → verdict and uses expectFile instead of answerFile.
 */

import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(import.meta.dir, '..', '..', '..');
const SCRIPT = join(ROOT, 'plugins', 'sp', 'scripts', 'verify-answer-lint.ts');

const TASK_CONTENT = `## 0726. Fixture task

### Requirements

- [ ] **R1. First requirement.** Guard the thing.
- [ ] **R2. Second requirement.** Lint the thing.

### Acceptance Criteria

- [ ] AC1 (R1): first acceptance criterion passes.
- [ ] AC2 (R2): second acceptance criterion passes.
`;

const FEATURE_CONTENT = `Scenarios:

Scenario: R1 — the importer guard rejects unsafe versions
Scenario: R2 — the precheck proves live evidence
`;

// Static fake-spur body — payload paths arrive via env vars, never interpolation,
// so the script body is a pure constant (and lens security heuristics stay quiet).
const FAKE_SPUR_BODY = [
    '#!/bin/sh',
    'case "$1:$2" in',
    '  task:show) cat "$FAKE_TASK" ;;',
    '  feature:show) cat "$FAKE_FEATURE" ;;',
    '  *) exit 3 ;;',
    'esac',
].join('\n');

interface Sandbox {
    dir: string;
    spurBin: string;
    exec: (answer: string) => { code: number; stderr: string };
}

/** Sandbox with a fake spur serving the fixture task + feature from JSON payload files. */
function makeSandbox(taskContent: string = TASK_CONTENT, wbs = '0726'): Sandbox {
    const dir = mkdtempSync(join(tmpdir(), 'spur-0726-lint-'));
    writeFileSync(join(dir, `task-${wbs}.json`), JSON.stringify({ wbs, feature_id: 'F9', content: taskContent }));
    writeFileSync(join(dir, 'feature-F9.json'), JSON.stringify({ id: 'F9', content: FEATURE_CONTENT }));
    const bin = join(dir, 'spur-fake');
    writeFileSync(bin, FAKE_SPUR_BODY);
    chmodSync(bin, 0o755);
    const answerPath = join(dir, 'verify-answer.txt');
    const env = {
        ...process.env,
        FAKE_TASK: join(dir, `task-${wbs}.json`),
        FAKE_FEATURE: join(dir, 'feature-F9.json'),
    };
    return {
        dir,
        spurBin: bin,
        exec(answer: string) {
            writeFileSync(answerPath, answer);
            const proc = Bun.spawnSync(['bun', SCRIPT, wbs, '--answer', answerPath, '--spur-bin', bin], {
                cwd: dir,
                env,
                stdout: 'pipe',
                stderr: 'pipe',
            });
            return { code: proc.exitCode, stderr: proc.stderr.toString() };
        },
    };
}

const VERDICT_LINE = 'Verdict: PASS';
const REQ_TABLE = `### Per-Requirement Traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | \`src/guard.ts:42\` |
| R2 | MET | \`src/lint.ts:10\` |
`;
const AC_TABLE = `### Acceptance Criteria Verification
| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test | \`tests/a.test.ts:9\` |
| AC2 | MET | command | \`bun test\` |
`;

function completeAnswer(verdict = VERDICT_LINE): string {
    return `${verdict}\n\n${REQ_TABLE}\n${AC_TABLE}\n`;
}

// ─── Behavioral matrix ───────────────────────────────────────────────────────

describe('verify-answer-lint behavior (0726 R3)', () => {
    test('complete answer with checklist labels and compound evidence type passes', () => {
        const sb = makeSandbox();
        const answer = completeAnswer().replace('| AC2 | MET | command |', '| AC2 | MET | test + command |');
        const r = sb.exec(answer);
        expect(r.code).toBe(0);
        expect(r.stderr).toContain('PASS');
    });

    test('complete answer using exact scenario titles passes', () => {
        const sb = makeSandbox();
        const answer = completeAnswer().replace(
            '| AC1 | MET | test | `tests/a.test.ts:9` |',
            '| R1 — the importer guard rejects unsafe versions | MET | test | `tests/a.test.ts:9` |',
        );
        const r = sb.exec(answer);
        expect(r.code).toBe(0);
    });

    test('missing requirement row is rejected', () => {
        const sb = makeSandbox();
        const r = sb.exec(completeAnswer().replace('| R2 | MET | `src/lint.ts:10` |\n', ''));
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('missing requirement row for "R2"');
    });

    test('unknown requirement ID is rejected', () => {
        const sb = makeSandbox();
        const r = sb.exec(
            completeAnswer().replace('| R2 | MET | `src/lint.ts:10` |', '| R9 | MET | `src/lint.ts:10` |'),
        );
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('unknown requirement ID "R9"');
    });

    test('duplicate requirement row is rejected', () => {
        const sb = makeSandbox();
        const r = sb.exec(
            completeAnswer().replace('| R2 | MET | `src/lint.ts:10` |', '| R1 | MET | `src/guard.ts:99` |'),
        );
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('duplicate requirement row "R1"');
    });

    test('partial (in-progress) answer without a verdict line is rejected before verdict derivation', () => {
        const sb = makeSandbox();
        const partialAnswer = `${REQ_TABLE}\n| R1 | MET | \`src/guard.ts:42\` |\n`;
        const r = sb.exec(partialAnswer);
        expect(r.code).not.toBe(0);
    });

    test('invalid status is rejected', () => {
        const sb = makeSandbox();
        const r = sb.exec(completeAnswer().replace('| R1 | MET |', '| R1 | DONE |'));
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('invalid status "DONE"');
    });

    test('invalid evidence type is rejected', () => {
        const sb = makeSandbox();
        const r = sb.exec(completeAnswer().replace('| AC1 | MET | test |', '| AC1 | MET | vibes |'));
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('invalid evidence type "vibes"');
    });

    test('empty evidence is rejected', () => {
        const sb = makeSandbox();
        const r = sb.exec(completeAnswer().replace('| R1 | MET | `src/guard.ts:42` |', '| R1 | MET |  |'));
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('empty evidence');
    });

    test('inexact AC ID is rejected', () => {
        const sb = makeSandbox();
        const r = sb.exec(completeAnswer().replace('| AC1 | MET |', '| AC 1 | MET |'));
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('matches no task AC checklist label or scenario title');
    });

    test('absent or empty answer file is rejected', () => {
        const sb = makeSandbox();
        const missing = sb.exec('   ');
        expect(missing.code).not.toBe(0);
        const env = {
            ...process.env,
            FAKE_TASK: join(sb.dir, 'task-0726.json'),
            FAKE_FEATURE: join(sb.dir, 'feature-F9.json'),
        };
        const absent = Bun.spawnSync(
            ['bun', SCRIPT, '0726', '--answer', join(sb.dir, 'nope.txt'), '--spur-bin', sb.spurBin],
            {
                cwd: sb.dir,
                env,
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        expect(absent.exitCode).not.toBe(0);
    });
});

// ─── Corpus-form extraction matrix (0728 R1–R3) ─────────────────────────────

const TASK_0727 = `## 0727. Fixture task

### Requirements

- [ ] R1. Host-owned stage-todo reconciliation. The driver must reconcile the todo list at
  every transition so nothing is left stuck in_progress.
- [ ] R2. Inline-dispatch timeout and partial-work contract. A dispatch that hangs must time
  out and record the partial-work fate.
- [ ] R3. Run-log timestamps. Every transition entry is timestamped.

### Acceptance Criteria

- AC1: Given a run whose precheck stage finished, when the driver transitions, then the todo
  shows precheck completed.
- AC2: Given a dispatch that hangs, when the timeout fires, then the driver records the fate.
- AC3: Given a transition, when it is logged, then the log line carries a timestamp.
`;

const TASK_MIXED = `## Mixed. Fixture task

### Requirements

- [x] **R1. Bold checkbox requirement.** Guard the thing.
- [ ] R2. Checkbox requirement. Lint the thing.
- R3. Plain bullet requirement. Trace the thing.
- R4: Colon-lead requirement.

### Acceptance Criteria

- [x] AC1 (R1): first acceptance criterion passes.
- AC2: second acceptance criterion passes.
`;

const TASK_SUBIDS = `## Sub. Fixture task

### Requirements

- [ ] R1. Parent one.
- [ ] R1.1. Child in checkbox form.
- R2: Parent two.
- R2.1: Child in plain colon form.

### Acceptance Criteria

- [ ] AC1: sub-ID acceptance criterion.
`;

/** A complete answer whose rows reference exactly the given declared IDs. */
function answerWith(reqs: string[], acs: string[]): string {
    const reqRows = reqs.map((id, i) => `| ${id} | MET | \`src/f${i}.ts:${i + 1}\` |`).join('\n');
    const acRows = acs.map((id, i) => `| ${id} | MET | test | \`tests/f${i}.test.ts:${i + 1}\` |`).join('\n');
    return [
        VERDICT_LINE,
        '',
        '### Per-Requirement Traceability',
        '| Req | Status | Evidence |',
        '| --- | --- | --- |',
        reqRows,
        '',
        '### Acceptance Criteria Verification',
        '| AC | Status | Evidence Type | Evidence |',
        '| --- | --- | --- |',
        acRows,
        '',
    ].join('\n');
}

describe('corpus-form extraction (0728 R1–R3)', () => {
    test('0726-rendered fixture (bold reqs, checkbox ACs) still extracts IDs end-to-end', () => {
        const sb = makeSandbox();
        const r = sb.exec(answerWith(['R1', 'R2'], ['AC1', 'AC2']));
        expect(r.code).toBe(0);
        expect(r.stderr).toContain('PASS');
    });

    test('0727-rendered fixture (checkbox reqs, plain ACs) extracts all IDs and passes', () => {
        const sb = makeSandbox(TASK_0727, '0727');
        const r = sb.exec(answerWith(['R1', 'R2', 'R3'], ['AC1', 'AC2', 'AC3']));
        expect(r.code).toBe(0);
        expect(r.stderr).toContain('PASS');
        expect(r.stderr).toContain('3 requirement row(s), 3 AC row(s)');
    });

    test('mixed fixture (bold + checkbox + plain + colon reqs, checkbox + plain ACs) extracts all IDs', () => {
        const sb = makeSandbox(TASK_MIXED, 'mixed');
        const r = sb.exec(answerWith(['R1', 'R2', 'R3', 'R4'], ['AC1', 'AC2']));
        expect(r.code).toBe(0);
        expect(r.stderr).toContain('PASS');
        expect(r.stderr).toContain('4 requirement row(s), 2 AC row(s)');
    });

    test('answer referencing genuinely unknown R9 on an R1–R3 doc fails with the unknown-ID finding', () => {
        const sb = makeSandbox(TASK_0727, '0727');
        const r = sb.exec(answerWith(['R1', 'R2', 'R9'], ['AC1']));
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('unknown requirement ID "R9"');
        expect(r.stderr).toContain('task declares: R1, R2, R3');
    });

    test('sub-ID R1.1 is recognized in checkbox and plain forms', () => {
        const sb = makeSandbox(TASK_SUBIDS, 'subids');
        const r = sb.exec(answerWith(['R1', 'R1.1', 'R2', 'R2.1'], ['AC1']));
        expect(r.code).toBe(0);
        expect(r.stderr).toContain('PASS');
        expect(r.stderr).toContain('4 requirement row(s)');
    });
});

// ─── Pipeline wiring ─────────────────────────────────────────────────────────

interface PipelineAction {
    kind: string;
    options?: { input?: string; answerFile?: string; expectFile?: string; command?: string };
}
interface PipelineState {
    id: string;
    onEnter?: PipelineAction[];
}
interface PipelineDefinition {
    states: PipelineState[];
}

const PIPELINE = parse(
    readFileSync(join(ROOT, 'config', 'workflows', 'task-pipeline.yaml'), 'utf8'),
) as PipelineDefinition;

describe('task-pipeline verify wiring (0726 R3)', () => {
    const verify = (): PipelineState => {
        const state = PIPELINE.states.find((s) => s.id === 'verify');
        if (!state) throw new Error('verify state missing');
        return state;
    };

    test('verify agent.run uses expectFile, not answerFile', () => {
        const agent = verify().onEnter?.find((a) => a.kind === 'agent.run');
        expect(agent).toBeDefined();
        // Assert the per-wbs placeholder contract without embedding the YAML syntax in a literal
        // (noTemplateCurlyInString): the raw value must be the run dir path parameterized by vars.wbs.
        const raw = agent?.options?.expectFile ?? '';
        expect(raw.startsWith('.spur/run/')).toBe(true);
        expect(raw.includes('vars.wbs')).toBe(true);
        expect(raw.endsWith('-verify-answer.txt')).toBe(true);
        expect(agent?.options?.answerFile).toBeUndefined();
    });

    test('lint shell step runs after the agent and before spur task verdict', () => {
        const actions = verify().onEnter ?? [];
        const agentIdx = actions.findIndex((a) => a.kind === 'agent.run');
        const lintIdx = actions.findIndex(
            (a) => a.kind === 'shell' && (a.options?.command ?? '').includes('verify-answer-lint.ts'),
        );
        const verdictIdx = actions.findIndex(
            (a) => a.kind === 'shell' && (a.options?.command ?? '').includes('task verdict'),
        );
        expect(agentIdx).toBeGreaterThanOrEqual(0);
        expect(lintIdx).toBeGreaterThan(agentIdx);
        expect(verdictIdx).toBeGreaterThan(lintIdx);
    });
});
