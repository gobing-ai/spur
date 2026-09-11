import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import {
    COMPOSITION_CAPS,
    type CompositionFinding,
    countLogicalCommands,
    WorkflowAppService,
} from '../../src/services/workflow-service';

// 0614 + 0822 (ADR-115): two-tier composition advisory on `workflow validate`.
// Drives the private advisory through WorkflowAppService.validate(); temp dirs sit
// under /var/folders, away from any repo config, so no ancestor state can alter
// the measured findings. Validity stays true at the service layer regardless of
// findings — the CLI turns error-level findings into exit 1.

function makeCtx(cwd: string) {
    let db: ReturnType<typeof createMigratedDb> | undefined;
    return {
        cwd,
        getDb: async () => {
            db ??= createMigratedDb({ url: ':memory:' });
            return db;
        },
        agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
    };
}

/** YAML block scalar under `command:` — parses to the lines plus one trailing newline. */
const blockCommand = (command: string, indent: string): string =>
    `command: |\n${command
        .split('\n')
        .map((l) => (l === '' ? '' : `${indent}${l}`))
        .join('\n')}`;

const smShellAction = (command: string): string => `name: advisory-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          ${blockCommand(command, '            ')}
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

const smShellGuard = (command: string): string => `name: advisory-flow
kind: state-machine
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
    guard:
      kind: shell
      options:
        ${blockCommand(command, '          ')}
terminalStates:
  - done
`;

const smAgentRun = (extraOptions = ''): string => `name: advisory-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: agent.run
        options:
          input: "run the composition task"
          agent: omp
          role: coder
${extraOptions}
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

const flowShellNode = (command: string): string => `name: advisory-flow
kind: transition-flow
initialNode: start
nodes:
  - id: start
    action:
      kind: shell
      options:
        ${blockCommand(command, '          ')}
  - id: done
terminalNodes: [done]
edges:
  - from: start
    to: done
`;

const flowShellEdgeGuard = (command: string): string => `name: advisory-flow
kind: transition-flow
initialNode: start
nodes:
  - id: start
  - id: done
terminalNodes: [done]
edges:
  - from: start
    to: done
    condition:
      kind: shell
      options:
        ${blockCommand(command, '          ')}
`;

const echoLines = (n: number): string => Array.from({ length: n }, (_, i) => `echo line-${i}`).join('\n');

/** Validate a fixture in an isolated temp dir and return its composition findings. */
async function findingsFor(dir: string, yaml: string): Promise<CompositionFinding[]> {
    await writeFile(join(dir, 'w.yaml'), yaml);
    const r = await new WorkflowAppService(makeCtx(dir)).validate(join(dir, 'w.yaml'));
    expect(r.valid).toBe(true); // findings never change service-level validity
    if (!r.valid) throw new Error('fixture unexpectedly invalid');
    return r.composition?.findings ?? [];
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-comp-adv-'));
    try {
        await run(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

describe('countLogicalCommands (ADR-115 unit)', () => {
    test('splits on newline, ;, && and ||', () => {
        expect(countLogicalCommands('echo a\necho b')).toBe(2);
        expect(countLogicalCommands('echo a; echo b')).toBe(2);
        expect(countLogicalCommands('echo a && echo b')).toBe(2);
        expect(countLogicalCommands('echo a || echo b')).toBe(2);
    });

    test('a pipeline counts once; a single | never splits', () => {
        expect(countLogicalCommands('cat f | grep x | wc -l')).toBe(1);
        expect(countLogicalCommands('echo a | grep b')).toBe(1);
    });

    test('blank segments, # comments and bare structure tokens are skipped', () => {
        expect(countLogicalCommands('\n  \n\t\n')).toBe(0);
        expect(countLogicalCommands('# just a comment')).toBe(0);
        for (const token of ['then', 'else', 'fi', 'do', 'done', 'esac', '{', '}', '(', ')']) {
            expect(countLogicalCommands(token)).toBe(0);
        }
        expect(countLogicalCommands('if true; then echo hi; fi')).toBe(2);
        expect(countLogicalCommands('while read line; do echo $line; done')).toBe(2);
    });

    test('a ; inside a quoted string still counts — the split is deliberately naive', () => {
        expect(countLogicalCommands('echo "a; b"')).toBe(2);
    });
});

describe('workflow validate composition advisory (ADR-115 tiers)', () => {
    test('shell tier boundaries: 5 clean, 6–10 warn, 11+ error', async () => {
        await withTempDir(async (dir) => {
            expect(await findingsFor(dir, smShellAction(echoLines(5)))).toHaveLength(0);

            const w6 = await findingsFor(dir, smShellAction(echoLines(6)));
            expect(w6).toHaveLength(1);
            expect(w6[0]?.actionKey).toBe('start:onEnter:0');
            expect(w6[0]?.level).toBe('warn');
            expect(w6[0]?.measure).toEqual({
                kind: 'shell-lines',
                measured: 6,
                threshold: COMPOSITION_CAPS.shell.warnAbove,
            });

            const w10 = await findingsFor(dir, smShellAction(echoLines(10)));
            expect(w10[0]?.level).toBe('warn');
            expect(w10[0]?.measure.measured).toBe(10);
            expect(w10[0]?.measure.threshold).toBe(COMPOSITION_CAPS.shell.warnAbove);

            const w11 = await findingsFor(dir, smShellAction(echoLines(11)));
            expect(w11[0]?.level).toBe('error');
            expect(w11[0]?.measure).toEqual({
                kind: 'shell-lines',
                measured: 11,
                threshold: COMPOSITION_CAPS.shell.errorAbove,
            });
        });
    });

    test('shell chars cap: 800 chars clean, 801 error — even at one logical command', async () => {
        await withTempDir(async (dir) => {
            // 'echo ' (5) + 794 x's = 799, + trailing newline = 800 → not over.
            expect(await findingsFor(dir, smShellAction(`echo ${'x'.repeat(794)}`))).toHaveLength(0);

            // + one more x → 801 parsed chars → error shell-chars, threshold 800.
            const over = await findingsFor(dir, smShellAction(`echo ${'x'.repeat(795)}`));
            expect(over).toHaveLength(1);
            expect(over[0]?.level).toBe('error');
            expect(over[0]?.measure.kind).toBe('shell-chars');
            expect(over[0]?.measure.measured).toBe(801);
            expect(over[0]?.measure.threshold).toBe(COMPOSITION_CAPS.shell.charsErrorAbove);
        });
    });

    test('precedence: an 11-command, >800-char action yields exactly one shell-lines error', async () => {
        await withTempDir(async (dir) => {
            const wide = Array.from({ length: 11 }, (_, i) => `echo ${'y'.repeat(100)}-${i}`).join('\n');
            const f = await findingsFor(dir, smShellAction(wide));
            expect(f).toHaveLength(1);
            expect(f[0]?.level).toBe('error');
            expect(f[0]?.measure.kind).toBe('shell-lines');
            expect(f[0]?.measure.threshold).toBe(COMPOSITION_CAPS.shell.errorAbove);
        });
    });

    test('state-machine transition guard tiers at 3/4/5/6 commands', async () => {
        await withTempDir(async (dir) => {
            expect(await findingsFor(dir, smShellGuard(echoLines(3)))).toHaveLength(0);

            const g4 = await findingsFor(dir, smShellGuard(echoLines(4)));
            expect(g4).toHaveLength(1);
            expect(g4[0]?.state).toBe('start');
            expect(g4[0]?.actionKey).toBe('start→done');
            expect(g4[0]?.level).toBe('warn');
            expect(g4[0]?.measure).toEqual({
                kind: 'guard-lines',
                measured: 4,
                threshold: COMPOSITION_CAPS.guard.warnAbove,
            });

            const g5 = await findingsFor(dir, smShellGuard(echoLines(5)));
            expect(g5[0]?.level).toBe('warn');
            expect(g5[0]?.measure.measured).toBe(5);

            const g6 = await findingsFor(dir, smShellGuard(echoLines(6)));
            expect(g6[0]?.level).toBe('error');
            expect(g6[0]?.measure).toEqual({
                kind: 'guard-lines',
                measured: 6,
                threshold: COMPOSITION_CAPS.guard.errorAbove,
            });
        });
    });

    test('transition-flow edge guards are measured with the same guard tiers', async () => {
        await withTempDir(async (dir) => {
            expect(await findingsFor(dir, flowShellEdgeGuard(echoLines(3)))).toHaveLength(0);
            const g6 = await findingsFor(dir, flowShellEdgeGuard(echoLines(6)));
            expect(g6).toHaveLength(1);
            expect(g6[0]?.state).toBe('start');
            expect(g6[0]?.actionKey).toBe('start→done');
            expect(g6[0]?.level).toBe('error');
            expect(g6[0]?.measure.kind).toBe('guard-lines');
        });
    });

    // Escaped placeholder: the title quotes the literal key shape from the design,
    // not a substitution — a plain string would trip lint/suspicious/noTemplateCurlyInString.
    test(`transition-flow node actions keep \${node.id}:onEnter:0 keys and shell tiers`, async () => {
        await withTempDir(async (dir) => {
            const f = await findingsFor(dir, flowShellNode(echoLines(6)));
            expect(f).toHaveLength(1);
            expect(f[0]?.actionKey).toBe('start:onEnter:0');
            expect(f[0]?.level).toBe('warn');
            expect(f[0]?.measure.kind).toBe('shell-lines');
        });
    });

    test('agent.run input: slash-led >1000 chars errors; non-slash 199/200/1000 warn by severity', async () => {
        await withTempDir(async (dir) => {
            const ar = (input: string): string =>
                `      - kind: agent.run\n        options:\n          input: ${JSON.stringify(input)}\n          agent: omp\n          role: coder\n`;
            const smOf = (body: string): string => `name: advisory-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
${body}  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

            const inputFindings = async (input: string): Promise<CompositionFinding> => {
                const all = await findingsFor(dir, smOf(ar(input)));
                const f = all.filter((x) => x.measure.kind === 'agent-run-chars');
                expect(f).toHaveLength(1);
                return f[0] as CompositionFinding;
            };

            // Slash-led but over the cap → error, threshold 1000, severity high.
            const over = await inputFindings(`/${'x'.repeat(1000)}`);
            expect(over.level).toBe('error');
            expect(over.measure).toEqual({
                kind: 'agent-run-chars',
                measured: 1001,
                threshold: COMPOSITION_CAPS.agentRunInput.charsErrorAbove,
                severity: 'high',
            });

            // Non-slash 199 → low warn (no threshold: no cap exceeded).
            const low = await inputFindings('x'.repeat(199));
            expect(low.level).toBe('warn');
            expect(low.measure.severity).toBe('low');
            expect(low.measure.threshold).toBeUndefined();

            // 200 → medium warn; 1000 → still medium warn; slash-led ≤1000 → no input finding.
            expect((await inputFindings('x'.repeat(200))).measure.severity).toBe('medium');
            expect((await inputFindings('x'.repeat(1000))).measure.severity).toBe('medium');
            const slashLed = await findingsFor(dir, smOf(ar('/dev-run do the thing')));
            expect(slashLed.map((f) => f.measure.kind)).toEqual(['agent-run-output']);
        });
    });

    test('agent.run output check: missing expectFile/requireDiff is its own warn finding', async () => {
        await withTempDir(async (dir) => {
            // Neither declared → separate agent-run-output warn alongside the input warn.
            const missing = await findingsFor(dir, smAgentRun());
            expect(missing.map((f) => f.measure.kind).sort()).toEqual(['agent-run-chars', 'agent-run-output']);
            const outputFinding = missing.find((f) => f.measure.kind === 'agent-run-output');
            expect(outputFinding?.level).toBe('warn');
            expect(outputFinding?.measure.measured).toBe(0);
            expect(outputFinding?.measure.threshold).toBeUndefined();
            expect(outputFinding?.actionKey).toBe('start:onEnter:0');

            // expectFile declared → no output finding.
            expect(
                (await findingsFor(dir, smAgentRun('          expectFile: out.txt\n'))).map((f) => f.measure.kind),
            ).toEqual(['agent-run-chars']);

            // requireDiff: true → no output finding; requireDiff: false still counts as missing.
            expect(
                (await findingsFor(dir, smAgentRun('          requireDiff: true\n'))).map((f) => f.measure.kind),
            ).toEqual(['agent-run-chars']);
            const reqDiffFalse = await findingsFor(dir, smAgentRun('          requireDiff: false\n'));
            expect(reqDiffFalse.map((f) => f.measure.kind)).toContain('agent-run-output');
        });
    });

    test('onExit shell actions are measured under the same key format', async () => {
        await withTempDir(async (dir) => {
            const yaml = `name: advisory-flow
kind: state-machine
initialState: start
states:
  - id: start
  - id: done
    onExit:
      - kind: shell
        options:
          ${blockCommand(echoLines(6), '            ')}
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;
            const f = await findingsFor(dir, yaml);
            expect(f).toHaveLength(1);
            expect(f[0]?.actionKey).toBe('done:onExit:0');
        });
    });

    test('a stale disposition baseline cannot hide a finding — no suppression list returns (ADR-108)', async () => {
        await withTempDir(async (dir) => {
            await mkdir(join(dir, 'config'), { recursive: true });
            await writeFile(
                join(dir, 'config/workflow-composition-baseline.json'),
                JSON.stringify({
                    version: 1,
                    workflows: {
                        w: {
                            boundary: 'test',
                            disposition: 'keep',
                            callers: [],
                            artifacts: { reads: [], writes: [] },
                            failClosed: false,
                            actions: { 'start:onEnter:0': { invocation: 'echo', disposition: 'GLUE' } },
                        },
                    },
                }),
            );
            const f = await findingsFor(dir, smShellAction(echoLines(6)));
            expect(f).toHaveLength(1);
            expect(f[0]?.actionKey).toBe('start:onEnter:0');
        });
    });

    test('service-level validity stays true with an error-level finding — the CLI owns the exit', async () => {
        await withTempDir(async (dir) => {
            const f = await findingsFor(dir, smShellAction(echoLines(20)));
            expect(f).toHaveLength(1);
            expect(f[0]?.level).toBe('error');
        });
    });
});

describe('composition cap parity (ADR-115)', () => {
    // Derived from COMPOSITION_CAPS so a ratchet cannot desync the taught tables:
    // the constants must match the governance §1.2 tier table, the fit-and-tuning
    // §3 table and the cli-contracts composition paragraph, row by row.
    const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');

    test('COMPOSITION_CAPS appear in governance §1.2, fit-and-tuning §3 and cli-contracts', async () => {
        const { shell, guard, agentRunInput } = COMPOSITION_CAPS;
        const byElement: Array<{ marker: string; strings: string[] }> = [
            {
                marker: '`shell` action',
                strings: [
                    `${shell.warnAbove + 1}–${shell.errorAbove}`,
                    `>${shell.errorAbove}`,
                    `${shell.charsErrorAbove}`,
                ],
            },
            {
                marker: 'Shell transition guard',
                strings: [`${guard.warnAbove + 1}–${guard.errorAbove}`, `>${guard.errorAbove}`],
            },
            {
                marker: '`agent.run` `input`',
                strings: [`${agentRunInput.charsErrorAbove}`, `${agentRunInput.lowSeverityBelow}`],
            },
        ];

        const governance = await Bun.file(join(repoRoot, 'docs/design/harness-surface-governance.md')).text();
        const fitTuning = await Bun.file(
            join(repoRoot, 'plugins/sp/skills/spur-cli/references/workflows/workflow-fit-and-tuning.md'),
        ).text();
        const cliContracts = await Bun.file(join(repoRoot, 'docs/design/cli-contracts.md')).text();

        const tiersSection = governance.slice(
            governance.indexOf('### 1.2 Tiers'),
            governance.indexOf('Measured 2026-09-10'),
        );
        const section3 = fitTuning.slice(
            fitTuning.indexOf('## 3. Node simplicity budget'),
            fitTuning.indexOf('## 4. Refactor'),
        );
        const compositionParagraph = cliContracts.slice(
            cliContracts.indexOf('**Composition findings'),
            cliContracts.indexOf('\n- `run <file>`'),
        );
        expect(tiersSection).not.toBe('');
        expect(section3).not.toBe('');
        expect(compositionParagraph).not.toBe('');

        const rowFor = (section: string, marker: string): string =>
            section.split('\n').find((l) => l.includes(marker)) ?? '';

        for (const { marker, strings } of byElement) {
            const governanceRow = rowFor(tiersSection, marker);
            const fitRow = rowFor(section3, marker);
            expect(governanceRow).toContain(marker);
            expect(fitRow).toContain(marker);
            for (const s of strings) {
                expect(governanceRow).toContain(s);
                expect(fitRow).toContain(s);
                expect(compositionParagraph).toContain(s);
            }
        }
    });
});
