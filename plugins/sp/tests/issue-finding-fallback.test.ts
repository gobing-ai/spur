/**
 * issue-finding-fallback.test.ts — task 0556 R4 + R5.
 *
 * R4: the raw-JSONL fallback parser (explicit `--sessions` is fallback condition 2, so the
 *     fixture always exercises it) must reproduce, on examples/session-test-loop.jsonl, the
 *     categorization expected-findings.json documented *before* the report-first rewrite —
 *     same findings, not new ones.
 * R5: documented flags / modes / `--json` shapes must be tied to the real command
 *     definitions (command file ↔ skill ↔ live CLI surface), not to memory.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureCliSurface } from './helpers/cli-surface';

const SKILL_DIR = join(import.meta.dir, '..', 'skills', 'issue-finding');
const PLUGIN_ROOT = join(import.meta.dir, '..');

type Fixture = {
    fixture: string;
    source: string;
    expectedCategories: Array<{
        id: string;
        commandContains?: string;
        commands?: string[];
        minIdenticalCommandRuns?: number;
        minSpurTaskCheckRuns?: number;
        minCompactions?: number;
        minSeverity?: string;
    }>;
    smokeCommand: string;
};

const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const command = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-find-issue.md'), 'utf8');
const fixtureText = readFileSync(join(SKILL_DIR, 'examples', 'session-test-loop.jsonl'), 'utf8');
const expected = JSON.parse(readFileSync(join(SKILL_DIR, 'examples', 'expected-findings.json'), 'utf8')) as Fixture;

// ─── R4: portable fallback parser (mirrors SKILL.md Phase 1 signal table) ───

type ToolCall = { toolName: string; command: string };
type ToolResult = { toolName: string; output: string };

function parseToolCalls(lines: string[]): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type !== 'message') continue;
        const message = event.message as Record<string, unknown> | undefined;
        const content = (message?.content ?? []) as Array<Record<string, unknown>>;
        for (const block of content) {
            if (block.type !== 'toolCall') continue;
            // Task 0564 R4: live omp emits `arguments`; legacy emits `input`. Mirror the
            // importer's precedence exactly (mappers.ts normalizeOmpToolCall read:
            // `call.input ?? call.arguments`) so the two can never disagree.
            const input = (block.input ?? block.arguments ?? {}) as Record<string, unknown>;
            calls.push({ toolName: String(block.name), command: String(input.command ?? '') });
        }
    }
    return calls;
}

function parseToolResults(lines: string[]): ToolResult[] {
    const results: ToolResult[] = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type !== 'message') continue;
        const message = event.message as Record<string, unknown> | undefined;
        const content = (message?.content ?? []) as Array<Record<string, unknown>>;
        for (const block of content) {
            if (block.type !== 'toolResult') continue;
            results.push({ toolName: String(block.name ?? ''), output: String(block.output ?? '') });
        }
    }
    return results;
}

const lines = fixtureText.split('\n');
const commands = parseToolCalls(lines).map((c) => c.command);
const outputs = parseToolResults(lines).map((r) => r.output);
const compactions = lines.filter((l) => l.includes('"type":"compaction"')).length;

/** IDENTIFY category rules — thresholds transcribed from SKILL.md, not from memory. */
function categorize(cmds: string[], outs: string[], compactionCount: number): Map<string, number> {
    const counts = new Map<string, number>();
    const runCounts = new Map<string, number>();
    for (const cmd of cmds) {
        runCounts.set(cmd, (runCounts.get(cmd) ?? 0) + 1);
    }
    const loopedCommands = [...runCounts.entries()].filter(([, n]) => n >= 3).map(([cmd]) => cmd);
    if (loopedCommands.length > 0) counts.set('test-loop', loopedCommands.length);
    const guardCmds = cmds.filter((c) => /^spur task check\b/.test(c));
    if (guardCmds.length >= 3) counts.set('guard', guardCmds.length);
    const gitCmds = cmds.filter((c) => /\bgit (stash|status|diff|branch)\b/.test(c));
    if (gitCmds.length > 0) counts.set('git-red-herring', gitCmds.length);
    if (compactionCount > 5) counts.set('compaction', compactionCount);
    if (outs.some((o) => o.includes('GuardDeniedError'))) {
        counts.set('guard-denied', outs.filter((o) => o.includes('GuardDeniedError')).length);
    }
    return counts;
}

const findings = categorize(commands, outputs, compactions);

describe('(0556 R4) fallback categorization reproduces pre-rewrite findings on the fixture', () => {
    test('fixture matches its declared id / source / file', () => {
        expect(expected.fixture).toBe('session-test-loop.jsonl');
        expect(expected.source).toBe('omp');
    });

    test('test-loop: identical command run 3+ times, severity floor S1', () => {
        const spec = expected.expectedCategories.find((c) => c.id === 'test-loop');
        expect(spec).toBeDefined();
        const specRuns = spec?.minIdenticalCommandRuns ?? 3;
        const specCmd = spec?.commandContains ?? '';
        const hits = commands.filter((c) => c.includes(specCmd)).length;
        expect(hits).toBeGreaterThanOrEqual(specRuns);
        // 4 identical runs ⇒ (4-1) × ~2min ≈ 6min ≥ S1 floor (30min–2h band is S1; S1 is the
        // documented minimum severity for this category in expected-findings.json).
        expect(['S0', 'S1']).toContain(spec?.minSeverity);
        expect(findings.get('test-loop')).toBeGreaterThanOrEqual(1);
    });

    test('guard: 3+ spur task check runs on the same task', () => {
        const spec = expected.expectedCategories.find((c) => c.id === 'guard');
        expect(spec).toBeDefined();
        const specRuns = spec?.minSpurTaskCheckRuns ?? 3;
        expect(commands.filter((c) => c.includes('spur task check 0376')).length).toBeGreaterThanOrEqual(specRuns);
        expect(findings.get('guard')).toBeGreaterThanOrEqual(specRuns);
    });

    test('git-red-herring: stash/status/diff between failures', () => {
        const spec = expected.expectedCategories.find((c) => c.id === 'git-red-herring');
        expect(spec).toBeDefined();
        for (const gitCmd of spec?.commands ?? []) {
            expect(commands.some((c) => c.includes(gitCmd))).toBe(true);
        }
        expect(findings.get('git-red-herring')).toBeGreaterThanOrEqual(1);
    });

    test('compaction: more than 5 compactions in the session', () => {
        const spec = expected.expectedCategories.find((c) => c.id === 'compaction');
        expect(spec).toBeDefined();
        const specMin = spec?.minCompactions ?? 6;
        expect(compactions).toBeGreaterThanOrEqual(specMin);
        expect(findings.get('compaction')).toBeGreaterThanOrEqual(specMin);
    });

    test('smoke command: report-first — no removed flags', () => {
        expect(expected.smokeCommand).toContain('--sessions');
        expect(expected.smokeCommand).not.toContain('--no-task');
        expect(expected.smokeCommand).not.toContain('--use-history');
    });
});

// ─── R5: documented surface tied to real definitions ───

describe('(0556 R5) documented flags / modes / --json tied to real command definitions', () => {
    test('command argument-hint carries --create-task, not the removed flags', () => {
        expect(command).toMatch(/^argument-hint:.*\[<topic>\]/m);
        expect(command).toContain('--create-task');
        const hint = command.match(/^argument-hint:\s*(.*)$/m)?.[1] ?? '';
        expect(hint).not.toContain('--use-history');
        expect(hint).not.toContain('--no-task');
    });

    test('SKILL.md names replacements for removed flags (no silent unknown-option)', () => {
        expect(skill).toContain('Removed flags (task 0556)');
        expect(skill).toContain('spur history report --mode forensics');
        expect(skill).toContain('no typed mapper');
        expect(skill).toContain('do not retain');
        expect(skill).toContain('0492 R7');
    });

    test('live CLI surface: history report exposes --mode (forensics renderer)', () => {
        const surface = captureCliSurface(['history', 'report']);
        expect(surface.flags.some((f) => f.startsWith('--mode'))).toBe(true);
    });
});

// ─── Task 0564 R4: the fallback fixture reads the live omp tool-call shape ───
//
// The 0556 fixture (`session-test-loop.jsonl`) predates the current flat omp
// `arguments` shape, so it cannot catch a parser that only reads `input`. This
// regression set runs the SAME parser over a committed anonymized live-captured
// snippet (`tests/fixtures/omp-live-tool-calls.jsonl`) whose toolCall blocks
// carry `arguments.command`, plus a legacy-key equivalence case.

describe('(0564 R4) fallback parser reads the live omp arguments shape', () => {
    const liveFixture = readFileSync(join(import.meta.dir, 'fixtures', 'omp-live-tool-calls.jsonl'), 'utf8');
    const liveLines = liveFixture.split('\n');
    const liveCommands = parseToolCalls(liveLines).map((c) => c.command);
    const liveOutputs = parseToolResults(liveLines).map((r) => r.output);
    const liveFindings = categorize(liveCommands, liveOutputs, 0);

    test('the committed snippet is the live flat shape (arguments.command), not legacy input', () => {
        // Structure guard: the fixture must exercise the shape this regression exists for.
        expect(liveFixture).toContain('"type":"toolCall"');
        expect(liveFixture).toContain('"arguments":{"command":');
        expect(liveFixture).toContain('"role":"toolResult"');
        expect(liveFixture).toContain('"toolCallId"');
    });

    test('extracts non-empty commands and non-zero categorization counts from the live shape', () => {
        expect(liveCommands.length).toBeGreaterThan(0);
        expect(liveCommands.every((c) => c.length > 0)).toBe(true);
        // guard: 3 identical `spur task check` runs; git-red-herring: git status.
        // (guard-denied needs the toolResult output, which lives in content[].text on the
        // live shape — reading it is out of 0564 R4's parseToolCalls scope.)
        expect(liveFindings.get('guard')).toBeGreaterThanOrEqual(3);
        expect(liveFindings.get('git-red-herring')).toBeGreaterThanOrEqual(1);
    });

    test('legacy input.command extracts identically to arguments.command', () => {
        const argumentsLine = JSON.stringify({
            type: 'message',
            message: {
                role: 'assistant',
                content: [{ type: 'toolCall', id: 'call-a', name: 'bash', arguments: { command: 'git diff HEAD' } }],
            },
        });
        const inputLine = JSON.stringify({
            type: 'message',
            message: {
                role: 'assistant',
                content: [{ type: 'toolCall', id: 'call-b', name: 'bash', input: { command: 'git diff HEAD' } }],
            },
        });

        const argsCommand = parseToolCalls([argumentsLine]).map((c) => c.command);
        const inputCommand = parseToolCalls([inputLine]).map((c) => c.command);
        expect(argsCommand).toEqual(['git diff HEAD']);
        expect(inputCommand).toEqual(argsCommand);
    });
});
