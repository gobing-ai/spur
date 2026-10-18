/**
 * Task 0818 R2 — the native-subagent dispatch handoff contract.
 *
 * The surviving boundary is checked with real artifacts: an answer fixture round-trips through the
 * real `spur task verdict` — which owns the answer lint and the derivation (task 1003 R2). The
 * driver-reference half of the original contract retired with the inline driver (task 1242).
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const CLI = join(ROOT, 'apps', 'cli', 'src', 'index.ts');

// ─── Answer round-trip through the real validators ──────────────────────────

const TASK_CONTENT = `## 0818. Handoff fixture task

### Requirements

- [ ] **R1. First requirement.** Guard the thing.

### Acceptance Criteria

- [ ] AC1 (R1): the guard rejects an unsafe input.
`;

function answer(reqStatus: string, acEvidenceType: string): string {
    // ADR-141: the answer states the level its own rows derive (MET + test/command -> HIGH).
    const executable = acEvidenceType.includes('test') || acEvidenceType.includes('command');
    const confidence = reqStatus === 'MET' && executable ? 'HIGH' : reqStatus === 'MET' ? 'MEDIUM' : 'LOW';
    return [
        'Verdict: PASS',
        `Confidence: ${confidence}`,
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
