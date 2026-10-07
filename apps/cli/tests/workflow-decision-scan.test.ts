/**
 * Workflow decision-placement scan (task 1098 R4, design §4 "keep-deterministic").
 *
 * The five workflows that own deterministic status checks must not carry an AI
 * decision maker: `kind: decide` is forbidden outright, and a shell
 * `decision run` invocation may appear only in the single allowlisted
 * rescue-only step — the verdict rescue that follows the normalization step in
 * history-anatomy's validate state (shared-workflow layer), which the design
 * gates behind the FAIL short-circuit and the model-only PASS rule.
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Repo root: apps/cli/tests → apps/cli → repo. */
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/** Workflows whose status checks are deterministic by design (R4 list). */
const DETERMINISTIC_STATUS_WORKFLOWS = [
    'pr-review.yaml',
    'wayfinder-resolution.yaml',
    'wrapup-pipeline.yaml',
    'feature-verification.yaml',
    'history-anatomy.yaml',
] as const;

/** The one workflow allowed to carry the rescue, by basename. */
const RESCUE_WORKFLOW = 'history-anatomy.yaml';

function readWorkflow(name: string): string {
    const path = join(REPO_ROOT, 'config', 'workflows', name);
    expect(existsSync(path), `missing workflow ${name} at ${path}`).toBe(true);
    return readFileSync(path, 'utf-8');
}

/**
 * The enclosing step block for a match: from the last step boundary before
 * `at` (a `- kind:` item or a `- id:` state) to the next one after it.
 */
function enclosingStep(text: string, at: number): string {
    const boundary = /(^|\n)(\s*- (?:kind|id):)/g;
    let start = 0;
    let end = text.length;
    for (const match of text.matchAll(boundary)) {
        const lead = match[1] ?? '';
        const index = (match.index ?? 0) + lead.length;
        if (index >= at) {
            end = index;
            break;
        }
        start = index;
    }
    return text.slice(start, end);
}

describe('workflow decision placement scan (1098 R4)', () => {
    const workflows = new Map(DETERMINISTIC_STATUS_WORKFLOWS.map((name) => [name, readWorkflow(name)]));

    test('no inline `kind: decide` in any deterministic-status workflow', () => {
        for (const text of workflows.values()) {
            expect(text).not.toMatch(/kind:\s*decide\b/);
        }
    });

    test('`decision run` appears exactly once — in the history-anatomy rescue step', () => {
        const hits: Array<{ workflow: string; index: number }> = [];
        for (const [name, text] of workflows) {
            for (const match of text.matchAll(/decision\s+run\b/g)) {
                hits.push({ workflow: name, index: match.index ?? 0 });
            }
        }
        expect(hits).toHaveLength(1);
        expect(hits[0]?.workflow).toBe(RESCUE_WORKFLOW);

        // The allowlisted step must carry the whole rescue contract: the
        // catalog id, the FAIL short-circuit before the maker call, the
        // model-only PASS rule, and the hard FAIL default.
        const step = enclosingStep(workflows.get(RESCUE_WORKFLOW) ?? '', hits[0]?.index ?? 0);
        expect(step).toContain('anatomy-validation-verdict');
        const shortCircuit = step.indexOf("grep -cx 'Verdict: FAIL'");
        const makerCall = step.indexOf('decision run anatomy-validation-verdict');
        expect(shortCircuit).toBeGreaterThanOrEqual(0);
        expect(makerCall).toBeGreaterThanOrEqual(0);
        expect(shortCircuit).toBeLessThan(makerCall);
        expect(step).toContain('(.source // .data.source) == "model"');
        expect(step).toContain('(.value // .data.value) == "PASS"');
        expect(step).toMatch(/\[ "\$v" = "PASS" \] \|\| v="FAIL";/);
    });
});

/**
 * Normalize-then-rescue ordering pin (task 1106 R1): the rescue shell action in
 * history-anatomy's validate state may only run AFTER the normalization shell
 * action. Reordering the two steps (or collapsing them back into one) flips
 * the observable outcome pinned here while the allowlist scan above stays
 * green — the ADR-115 composition deviation would lose its stated property
 * silently.
 */
describe('history-anatomy normalize-then-rescue ordering pin (1106 R1)', () => {
    const TEXT = readWorkflow(RESCUE_WORKFLOW);

    /** The validate state block: from its `- id:` line to the next same-indent `- id:`. */
    function stateBlock(text: string, stateId: string): string {
        const start = text.indexOf(`  - id: ${stateId}\n`);
        expect(start, `missing state ${stateId}`).toBeGreaterThanOrEqual(0);
        const next = text.indexOf('\n  - id: ', start + 1);
        return text.slice(start, next === -1 ? text.length : next);
    }

    /** The `- kind:` action chunks inside a state block, in YAML order. */
    function actionChunks(block: string): string[] {
        const chunks: string[] = [];
        const boundary = /(^|\n)(\s*- kind:)/g;
        let start = -1;
        for (const match of block.matchAll(boundary)) {
            const index = (match.index ?? 0) + (match[1]?.length ?? 0);
            if (start >= 0) chunks.push(block.slice(start, index));
            start = index;
        }
        if (start >= 0) chunks.push(block.slice(start));
        return chunks;
    }

    test('structural: the rescue shell action is exactly one position after normalization', () => {
        const chunks = actionChunks(stateBlock(TEXT, 'validate'));
        // Content anchors, one match each: normalization moves an exact-line PASS
        // to the end; rescue invokes the anatomy-validation-verdict catalog decision.
        const normalize = chunks.filter((chunk) => chunk.includes("grep -vx 'Verdict: PASS'"));
        const rescue = chunks.filter((chunk) => chunk.includes('decision run anatomy-validation-verdict'));
        expect(normalize).toHaveLength(1);
        expect(rescue).toHaveLength(1);
        expect(chunks.indexOf(rescue[0] as string)).toBe(chunks.indexOf(normalize[0] as string) + 1);
    });

    /** Dedent the folded `command: >-` scalar of an action chunk into runnable shell. */
    function extractCommand(chunk: string): string {
        const marker = chunk.indexOf('command: >-');
        expect(marker).toBeGreaterThanOrEqual(0);
        const lines = chunk
            .slice(marker + 'command: >-'.length)
            .split('\n')
            .filter((line) => line.trim().length > 0);
        const indent = Math.min(...lines.map((line) => line.length - line.trimStart().length));
        return lines.map((line) => line.slice(indent)).join('\n');
    }

    interface Outcome {
        stubCalls: number;
        lastLine: string;
    }

    /** Run the commands in the given order against a fixture validation artifact. */
    function runInOrder(commands: string[], fixture: string): Outcome {
        const tmp = mkdtempSync(join(tmpdir(), 'ha-order-'));
        const callsLog = join(tmp, 'calls.log');
        const stub = join(tmp, 'stub-spur.sh');
        try {
            mkdirSync(join(tmp, '.spur', 'run'), { recursive: true });
            const validation = join(tmp, '.spur', 'run', 'r1-validation.txt');
            writeFileSync(validation, fixture);
            writeFileSync(
                stub,
                '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CALLS_LOG"\nprintf \'%s\' \'{"source":"model","value":"PASS"}\'\n',
            );
            chmodSync(stub, 0o755);
            const env = {
                PATH: `/usr/bin:/bin:${join(Bun.which('jq') ?? '/usr/bin', '..')}`,
                __runId: 'r1',
                spurBin: stub,
                CALLS_LOG: callsLog,
            };
            for (const command of commands) {
                const proc = Bun.spawnSync(['/bin/sh', '-c', command], {
                    cwd: tmp,
                    env,
                    stdout: 'pipe',
                    stderr: 'pipe',
                });
                expect(proc.exitCode).toBe(0);
            }
            const validationText = readFileSync(validation, 'utf-8');
            const lines = validationText.trimEnd().split('\n');
            return {
                stubCalls: existsSync(callsLog) ? readFileSync(callsLog, 'utf-8').trimEnd().split('\n').length : 0,
                lastLine: lines[lines.length - 1] ?? '',
            };
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    }

    // The rescue command pipes through jq; skip (not fail) where it is absent.
    test.skipIf(Bun.which('jq') === null)('behavioral: normalization deciding PASS keeps the rescue silent', () => {
        const validate = actionChunks(stateBlock(TEXT, 'validate'));
        const normalizeCommand = extractCommand(validate.find((c) => c.includes("grep -vx 'Verdict: PASS'")) as string);
        const rescueCommand = extractCommand(
            validate.find((c) => c.includes('decision run anatomy-validation-verdict')) as string,
        );

        // Fixture A — PASS first line, prose last: in YAML order normalization moves
        // the PASS to the end and the rescue short-circuits (stub never called); in
        // reversed order the rescue fires first and calls the stub. A reorder flips
        // the observable outcome.
        const inOrder = runInOrder([normalizeCommand, rescueCommand], 'Verdict: PASS\nprose\n');
        expect(inOrder.stubCalls).toBe(0);
        expect(inOrder.lastLine).toBe('Verdict: PASS');

        const reversed = runInOrder([rescueCommand, normalizeCommand], 'Verdict: PASS\nprose\n');
        expect(reversed.stubCalls).toBe(1);

        // Fixture B — a deterministic FAIL: the rescue's zero-FAIL guard
        // short-circuits BEFORE the maker call and nothing is appended.
        const failOrder = runInOrder([normalizeCommand, rescueCommand], 'Verdict: FAIL\nprose\n');
        expect(failOrder.stubCalls).toBe(0);
        expect(failOrder.lastLine).toBe('prose');
    });
});
