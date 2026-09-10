import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0818 R2 — the native dispatch handoff contract in inline-pipeline-driver.md.
 *
 * 1. The doc carries every required handoff element (stage id, exact slash command,
 *    absolute cwd, resolved Spur invocation, output path, stage artifact contract).
 * 2. A controlled child command honors the supplied checkout invocation despite a
 *    competing PATH spur (deterministic fake-child evidence, not a model smoke run).
 * 3. An answer fixture authored from the handoff contract round-trips through the
 *    REAL validators: verify-answer-lint and `task verdict`. The behavioral-MET +
 *    static-only downgrade is already proven at the service level
 *    (packages/app/tests/services/task-verdict.test.ts "PARTIAL: behavior-bearing AC…").
 */

const ROOT = join(import.meta.dir, '..', '..', '..');
const DRIVER = readFileSync(
    join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'inline-pipeline-driver.md'),
    'utf8',
);
const CLI = join(ROOT, 'apps', 'cli', 'src', 'index.ts');
const LINT = join(ROOT, 'plugins', 'sp', 'scripts', 'verify-answer-lint.ts');

// Fixture task/feature served by a fake spur (same shape as verify-answer-lint.test.ts).
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
const FAKE_SPUR_BODY = [
    '#!/bin/sh',
    'case "$1:$2" in',
    '  task:show) cat "$FAKE_TASK" ;;',
    '  feature:show) cat "$FAKE_FEATURE" ;;',
    '  *) exit 3 ;;',
    'esac',
].join('\n');

describe('0818 R2 — dispatch handoff contract', () => {
    test('driver doc carries every required handoff element', () => {
        for (const needle of [
            'the stage id;',
            "the YAML's exact pure slash command (never reformulated);",
            'the confirmed execution-tree cwd (absolute);',
            'the resolved absolute Spur invocation',
            'the resolved absolute output path',
            'plugins/sp/skills/code-verification/SKILL.md',
            'plugins/sp/agents/super-reviewer.md',
            'execution surface already resolved: native subagent; do not dispatch this stage again',
            '`SPUR_BIN` env value alone does not change bare-command',
        ]) {
            expect(DRIVER).toContain(needle);
        }
    });

    test('controlled child command uses the supplied checkout invocation despite a competing PATH spur', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0818-handoff-'));
        const tree = join(dir, 'execution tree'); // spaced path, as a real worktree could have
        mkdirSync(join(tree, 'scripts', 'test-shims'), { recursive: true });
        // The checkout-owned launcher IS the resolved invocation's subject; the fake child
        // executes whatever invocation the handoff supplies.
        const launcher = join(tree, 'scripts', 'test-shims', 'spur');
        writeFileSync(
            launcher,
            '#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P) || exit 127\nexec bun "$ROOT/apps/cli/src/index.ts" "$@"\n',
        );
        chmodSync(launcher, 0o755);
        mkdirSync(join(tree, 'apps', 'cli', 'src'), { recursive: true });
        writeFileSync(join(tree, 'apps', 'cli', 'src', 'index.ts'), 'console.log("CHECKOUT-ENTRY");\n');

        // Competing PATH spur — must never be reached when the handoff supplies the invocation.
        const rival = join(dir, 'rival-bin');
        mkdirSync(rival);
        const rivalSpur = join(rival, 'spur');
        writeFileSync(rivalSpur, '#!/bin/sh\necho "RIVAL-PATH-SPUR";\nexit 42\n');
        chmodSync(rivalSpur, 0o755);

        // Handoff payload per the contract: absolute cwd + resolved absolute invocation,
        // shell-ready (quoted) — delegates run it through a shell, like the YAML's shell actions.
        const handoffCwd = join(dir, 'caller cwd');
        mkdirSync(handoffCwd);
        const invocation = `${JSON.stringify(process.execPath)} ${JSON.stringify(join(tree, 'apps', 'cli', 'src', 'index.ts'))}`;
        // Controlled child: honors the contract — cd to the supplied cwd, run the supplied invocation.
        const child = join(dir, 'controlled-child.sh');
        writeFileSync(child, '#!/bin/sh\ncd "$HANDOFF_CWD" || exit 1\neval "$HANDOFF_INVOCATION"\n');
        chmodSync(child, 0o755);

        const proc = Bun.spawnSync([child], {
            env: {
                HANDOFF_CWD: handoffCwd,
                HANDOFF_INVOCATION: invocation,
                PATH: `${rival}:${join(process.execPath, '..')}:/usr/bin:/bin`,
            },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(proc.exitCode).toBe(0); // rival spur exits 42
        expect(proc.stdout.toString()).toContain('CHECKOUT-ENTRY');
        expect(proc.stdout.toString()).not.toContain('RIVAL-PATH-SPUR');
    });
});

describe('0818 R2 — verify answer round-trips through the real validators', () => {
    function makeSandbox(): { dir: string; answerPath: string; write: (a: string) => void } {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0818-roundtrip-'));
        writeFileSync(
            join(dir, 'task-0726.json'),
            JSON.stringify({ wbs: '0726', feature_id: 'F9', content: TASK_CONTENT }),
        );
        writeFileSync(join(dir, 'feature-F9.json'), JSON.stringify({ id: 'F9', content: FEATURE_CONTENT }));
        const bin = join(dir, 'spur-fake');
        writeFileSync(bin, FAKE_SPUR_BODY);
        chmodSync(bin, 0o755);
        const answerPath = join(dir, 'verify-answer.txt');
        return { dir, answerPath, write: (a: string) => writeFileSync(answerPath, a) };
    }

    function runLint(dir: string, bin: string): { code: number; stderr: string } {
        const proc = Bun.spawnSync(
            ['bun', LINT, '0726', '--answer', join(dir, 'verify-answer.txt'), '--spur-bin', bin],
            {
                cwd: dir,
                env: {
                    ...process.env,
                    FAKE_TASK: join(dir, 'task-0726.json'),
                    FAKE_FEATURE: join(dir, 'feature-F9.json'),
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        return { code: proc.exitCode, stderr: proc.stderr.toString() };
    }

    function runVerdict(dir: string): { code: number; json: string } {
        const out = mkdtempSync(join(tmpdir(), 'spur-0818-verdict-'));
        const proc = Bun.spawnSync(
            ['bun', CLI, 'task', 'verdict', '0726', '--from-answer', join(dir, 'verify-answer.txt'), '--json'],
            { cwd: out, stdout: 'pipe', stderr: 'pipe' },
        );
        return { code: proc.exitCode, json: proc.stdout.toString() };
    }

    // Authored strictly from the handoff contract's compact vocabulary.
    const CONTRACT_ANSWER = [
        'Verdict: PASS',
        '',
        '### Per-Requirement Traceability',
        '| Req | Status | Evidence |',
        '| --- | --- | --- |',
        '| R1 | MET | `src/guard.ts:42` |',
        '| R2 | MET | `src/lint.ts:10` |',
        '',
        '### Acceptance Criteria Verification',
        '| AC | Status | Evidence Type | Evidence |',
        '| --- | --- | --- | --- |',
        '| AC1 | MET | test | `tests/a.test.ts:9` |',
        '| AC2 | MET | command | `bun test` |',
        '',
    ].join('\n');

    test('contract-authored answer: lint PASS without repair, verdict derives PASS', () => {
        const sb = makeSandbox();
        sb.write(CONTRACT_ANSWER);
        expect(runLint(sb.dir, join(sb.dir, 'spur-fake')).code).toBe(0);
        const v = runVerdict(sb.dir);
        expect(v.code).toBe(0);
        expect(v.json).toContain('"verdict": "PASS"');
    });

    test('PASS in a requirement Status cell is rejected by the lint gate', () => {
        const sb = makeSandbox();
        sb.write(CONTRACT_ANSWER.replace('| R1 | MET |', '| R1 | PASS |'));
        const r = runLint(sb.dir, join(sb.dir, 'spur-fake'));
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('invalid status');
    });

    test('N/A in a requirement Status cell is rejected by the lint gate', () => {
        const sb = makeSandbox();
        sb.write(CONTRACT_ANSWER.replace('| R1 | MET |', '| R1 | N/A |'));
        const r = runLint(sb.dir, join(sb.dir, 'spur-fake'));
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('invalid status');
    });
});
