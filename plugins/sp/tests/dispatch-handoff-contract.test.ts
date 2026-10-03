/**
 * Task 0818 R2 — the native-subagent dispatch handoff contract.
 *
 * Two boundaries are checked with the real artifacts, not prose about them:
 *   1. the driver reference carries the five payload fields (and no longer the "Send only"
 *      restriction), plus a real child proving the supplied invocation beats a competing PATH `spur`;
 *   2. an answer fixture authored from that contract round-trips through the real
 *      `spur task verdict` — which owns the answer lint and the derivation (task 1003 R2).
 */

import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/ts-utils';

const ROOT = join(import.meta.dir, '..', '..', '..');
const DRIVER = readFileSync(
    join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'inline-pipeline-driver.md'),
    'utf8',
);
const CLI = join(ROOT, 'apps', 'cli', 'src', 'index.ts');

describe('0818 R2 — dispatch payload contract', () => {
    test('the driver supplies cwd, invocation, output path and the owning artifact contract', () => {
        expect(DRIVER).toContain('confirmed execution-tree cwd');
        expect(DRIVER).toContain('resolved absolute Spur invocation');
        expect(DRIVER).toContain('resolved absolute output path');
        expect(DRIVER).toContain("owning stage's artifact contract");
        // The restriction this task replaces is gone, not merely contradicted elsewhere.
        expect(DRIVER).not.toContain('Send only: the stage id');
    });

    test('the exact slash command and the no-recursive-dispatch rule survive the replacement', () => {
        expect(DRIVER).toContain(
            'execution surface already resolved: native subagent; do not dispatch this stage again',
        );
        expect(DRIVER).toMatch(/\*\*exact\*\* pure slash command/);
        expect(DRIVER).toContain('Dispatch exactly one native subagent');
    });

    test('the invocation is the existing resolver, and SPUR_BIN is not claimed to fix bare resolution', () => {
        expect(DRIVER).toContain('vars.spurBin');
        expect(DRIVER).toContain('resolve-spur-bin.ts');
        expect(DRIVER).toContain('--spur-bin');
        expect(DRIVER).toMatch(/`SPUR_BIN` alone does \*\*not\*\* change bare-command resolution/);
    });

    test('verify handoffs name the canonical schema; review handoffs point at the reviewer', () => {
        expect(DRIVER).toContain('code-verification/references/verdict-schema.md');
        expect(DRIVER).toContain('Verdict: PASS|PARTIAL|FAIL');
        expect(DRIVER).toContain('| Req | Status | Evidence |');
        expect(DRIVER).toContain('| AC | Status | Evidence Type | Evidence |');
        expect(DRIVER).toContain('test | command | static-ref | manual-review | llm-judge | n/a');
        expect(DRIVER).toContain('N/A and PASS are NOT valid requirement statuses');
        expect(DRIVER).toContain('exact AC identities');
        expect(DRIVER).toContain('requires executable evidence');
        // R3 owns the review vocabulary; the review handoff must not borrow the answer schema.
        expect(DRIVER).toContain('plugins/sp/agents/super-reviewer.md');
        expect(DRIVER).toMatch(/\*\*not\*\* the verify answer schema/);
    });

    test('post-join gates are untouched', () => {
        expect(DRIVER).toContain('expectFile');
        expect(DRIVER).toContain('requireDiff');
        expect(DRIVER).toContain('do **not** replay the stage in the host');
    });

    test('a child uses the supplied invocation even with a competing spur earlier on PATH', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0818-invocation-'));
        const competingDir = join(dir, 'competing');
        Bun.spawnSync(['mkdir', '-p', competingDir]);
        const competing = join(competingDir, 'spur');
        writeFileSync(competing, '#!/bin/sh\necho COMPETING\n');
        chmodSync(competing, 0o755);
        const checkout = join(dir, 'checkout-spur');
        writeFileSync(checkout, '#!/bin/sh\necho CHECKOUT "$@"\n');
        chmodSync(checkout, 0o755);
        const env = { ...getEnvVars(), PATH: `${competingDir}:${getEnvVar('PATH') ?? ''}` };

        const supplied = Bun.spawnSync(['sh', '-c', `"${checkout}" task check 0818`], { cwd: dir, env });
        expect(supplied.stdout.toString().trim()).toBe('CHECKOUT task check 0818');

        // Control: the bare command really is shadowed, which is why the payload must carry
        // the invocation instead of trusting the delegate's PATH.
        const bare = Bun.spawnSync(['sh', '-c', 'spur task check 0818'], { cwd: dir, env });
        expect(bare.stdout.toString().trim()).toBe('COMPETING');
    });
});

// ─── Answer round-trip through the real validators ──────────────────────────

const TASK_CONTENT = `## 0818. Handoff fixture task

### Requirements

- [ ] **R1. First requirement.** Guard the thing.

### Acceptance Criteria

- [ ] AC1 (R1): the guard rejects an unsafe input.
`;

function answer(reqStatus: string, acEvidenceType: string): string {
    return [
        'Verdict: PASS',
        'Confidence: HIGH',
        '',
        '### Per-Requirement Traceability',
        '| Req | Status | Evidence |',
        '| --- | --- | --- |',
        `| R1 | ${reqStatus} | \`src/guard.ts:42\` |`,
        '',
        '### Acceptance Criteria Verification',
        '| AC | Status | Evidence Type | Evidence |',
        '| --- | --- | --- | --- |',
        `| AC1 | MET | ${acEvidenceType} | \`tests/guard.test.ts:9\` |`,
        '',
    ].join('\n');
}

interface RoundTrip {
    code: number | null;
    verdict?: string;
    lintFindings: unknown[];
    verdictFile: boolean;
}

function roundTrip(body: string): RoundTrip {
    const dir = mkdtempSync(join(tmpdir(), 'spur-0818-answer-'));
    // Task 1003 moved the lint into the CLI: `task verdict` resolves the task corpus
    // in-process (TaskLocator over the default docs/tasks folder) — no fake spur.
    mkdirSync(join(dir, 'docs', 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'tasks', '0818_fixture.md'), TASK_CONTENT);
    const answerPath = join(dir, 'verify-answer.txt');
    writeFileSync(answerPath, body);
    const derived = Bun.spawnSync(['bun', CLI, 'task', 'verdict', '0818', '--from-answer', answerPath, '--json'], {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const parsed = JSON.parse(derived.stdout.toString()) as { verdict?: string; lintFindings?: unknown[] };
    return {
        code: derived.exitCode,
        verdict: parsed.verdict,
        lintFindings: parsed.lintFindings ?? [],
        verdictFile: existsSync(join(dir, '.spur', 'run', '0818-verdict.json')),
    };
}

describe('0818 R2 — answer fixtures round-trip through the real verdict gate', () => {
    test('a contract-shaped answer is accepted without a repair pass', () => {
        const r = roundTrip(answer('MET', 'test'));
        expect(r.code).toBe(0);
        expect(r.verdict).toBe('PASS');
        expect(r.lintFindings).toEqual([]);
    });

    test('PASS in a requirement Status cell is lint-rejected with no verdict artifact', () => {
        const r = roundTrip(answer('PASS', 'test'));
        expect(r.code).not.toBe(0);
        expect(r.lintFindings.length).toBeGreaterThan(0);
        expect(r.verdictFile).toBe(false);
    });

    test('N/A in a requirement Status cell is lint-rejected with no verdict artifact', () => {
        const r = roundTrip(answer('N/A', 'test'));
        expect(r.code).not.toBe(0);
        expect(r.lintFindings.length).toBeGreaterThan(0);
        expect(r.verdictFile).toBe(false);
    });

    test('a behavioral MET AC carried only by static evidence cannot yield PASS', () => {
        const r = roundTrip(answer('MET', 'static-ref'));
        expect(r.code).not.toBe(0);
        expect(r.verdict).toBe('PARTIAL');
    });
});
