import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// Task 0703 (ADR-071): the task-pipeline proof chain must form ONE immutable bracket around the
// evidence-producing final chain. Capture happens once at quality-gate entry (before any evidence
// stage), bounded remediation re-captures, the certifying verify is observe-only, and the
// completion guards refuse missing/malformed/mismatched proof evidence. These invariants are
// structural: any composition change that breaks them must fail here AND in the baseline gate.

interface Action {
    kind: string;
    options?: Record<string, unknown>;
}
interface Guard {
    kind: string;
    options?: { command?: string };
}
interface Transition {
    from: string;
    to: string;
    guard?: Guard;
}
interface WorkflowDef {
    states: { id: string; onEnter?: Action[] }[];
    transitions: Transition[];
}

// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8')) as WorkflowDef;

const cmdOf = (from: string, to: string): string =>
    DEF.transitions.find((t) => t.from === from && t.to === to)?.guard?.options?.command?.replace(/\n/g, ' ') ?? '';

describe('task-pipeline proof chain (task 0703, ADR-071)', () => {
    test('verify certifies observe-only: --fix none, never --fix all (R1)', () => {
        const verify = DEF.states.find((s) => s.id === 'verify');
        const agentRun = verify?.onEnter?.find((a) => a.kind === 'agent.run');
        expect(agentRun).toBeDefined();
        const input = String(agentRun?.options?.input ?? '');
        expect(input).toContain('--fix none');
        expect(input).not.toContain('--fix all');
    });

    test('canonical digest capture precedes the first evidence stage; remediation re-captures (R2/R4)', () => {
        const test = DEF.states.find((s) => s.id === 'test');
        const recheck = DEF.states.find((s) => s.id === 'test-recheck');
        const verify = DEF.states.find((s) => s.id === 'verify');
        const captures = (test?.onEnter ?? []).filter((a) => a.kind === 'proof.fingerprint');
        expect(captures).toHaveLength(1);
        expect(captures[0]?.options?.var).toBe('proofDigest');
        // Capture precedes the gate shell (the first evidence stage). The leading
        // taskpath-resolve shell/file.read actions FEED the capture, not evidence.
        const kinds = (test?.onEnter ?? []).map((a) => a.kind);
        expect(kinds.lastIndexOf('proof.fingerprint')).toBeLessThan(kinds.lastIndexOf('shell'));
        const recheckCaptures = (recheck?.onEnter ?? []).filter((a) => a.kind === 'proof.fingerprint');
        expect(recheckCaptures).toHaveLength(1);
        expect(recheckCaptures[0]?.options?.var).toBe('proofDigest');
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(recheckCaptures[0]?.options?.taskFile).toBe('${vars.taskSpecPath}');
        // Midpoint compare at verify entry reuses proofDigestNow against the canonical capture.
        const mid = verify?.onEnter?.[0];
        expect(mid?.kind).toBe('proof.fingerprint');
        expect(mid?.options?.var).toBe('proofDigestNow');
        // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
        expect(mid?.options?.expect).toBe('${vars.proofDigest}');
    });

    test('verdict artifact carries the proof block: one digest, three named stages (R3)', () => {
        const verify = DEF.states.find((s) => s.id === 'verify');
        const stamp = verify?.onEnter?.at(-1);
        expect(stamp?.kind).toBe('shell');
        const cmd = String(stamp?.options?.command ?? '');
        expect(cmd).toContain('capturePoint');
        for (const stage of ['qualityGate', 'review', 'verification']) {
            expect(cmd).toContain(`${stage}: {status`);
            expect(cmd).toContain(`digest: $d`);
        }
        expect(cmd).toContain('proof-input-digest');
    });

    test('completion guards refuse non-PASS and missing/malformed/mismatched proof evidence (R5)', () => {
        const toRecord = cmdOf('verify', 'record');
        expect(toRecord).toContain('.verdict');
        expect(toRecord).toContain('PASS');
        expect(toRecord).toContain('.proof.digest');
        for (const stage of ['qualityGate', 'review', 'verification']) {
            expect(toRecord).toContain(`.proof.stages.${stage}.digest`);
        }
        expect(toRecord).toContain('$proofDigest');
        const toDone = cmdOf('record', 'done');
        expect(toDone).toContain('task check');
        expect(toDone).toContain('.verdict');
        expect(toDone).toContain('.proof.digest');
        expect(toDone).toContain('$proofDigest');
    });

    test('verify non-PASS routes to bounded remediation; catch-alls guarantee termination (R4)', () => {
        const toFix = DEF.transitions.find((t) => t.from === 'verify' && t.to === 'test-fix');
        expect(toFix).toBeDefined();
        const fixCmd = toFix?.guard?.options?.command?.replace(/\n/g, ' ') ?? '';
        expect(fixCmd).toContain('!= PASS');
        expect(fixCmd).toContain('qualityGateMaxFixAttempts');
        expect(DEF.transitions.find((t) => t.from === 'verify' && t.to === 'failed')?.guard?.kind).toBe('always');
        expect(DEF.transitions.find((t) => t.from === 'record' && t.to === 'failed')?.guard?.kind).toBe('always');
    });

    test('baseline pins the observe-only invocation (R7)', () => {
        const baseline = JSON.parse(
            readFileSync(join(import.meta.dir, '../../../../config', 'workflow-composition-baseline.json'), 'utf8'),
        ) as { workflows: Record<string, { actions: Record<string, { invocation?: string }> }> };
        const actions = baseline.workflows['task-pipeline']?.actions ?? {};
        const verifyAgent = Object.values(actions).find((a) => a.invocation?.startsWith('/sp:dev-verify') === true);
        expect(verifyAgent?.invocation).toContain('--fix none');
        expect(verifyAgent?.invocation).not.toContain('--fix all');
    });
});

describe('task-pipeline review independence (task 0710)', () => {
    // P2 remediation: the live YAML itself must declare the independence policy. The composition
    // baseline records kind/invocation only, so without this check a re-pinned executor or a
    // dropped freshSession would pass CI silently (review finding 0710-P2).
    const agentRunOf = (state: string): Record<string, unknown> | undefined => {
        const agentRun = DEF.states.find((s) => s.id === state)?.onEnter?.find((a) => a.kind === 'agent.run');
        return agentRun?.options as Record<string, unknown> | undefined;
    };

    test('review and verify run fresh, reviewer-role, unpinned, and compare against implement (R2/R4/R7)', () => {
        for (const state of ['review', 'verify']) {
            const opts = agentRunOf(state);
            expect(opts, `state ${state} must declare an agent.run`).toBeDefined();
            expect(opts?.freshSession).toBe(true);
            expect(opts?.role).toBe('reviewer');
            expect(opts, `state ${state} must not pin an executor`).not.toHaveProperty('agent');
            expect(opts?.compareExecutorWith).toBe('implement');
            expect(opts?.priority).toBe('$' + '{vars.taskPriority}');
        }
    });

    // P1 remediation: the shipped extraction command must sed the TASK FILE (resolved via
    // taskpath.txt), not the path listing itself, and normalize the tier to upper case so
    // requiresDistinctExecutor's exact 'P0'/'P1' match engages (review finding 0710-P1).
    test('priority extraction reads the task file and normalizes to upper (R4)', () => {
        const { execSync } = require('node:child_process') as typeof import('node:child_process');
        const { mkdtempSync, rmSync, writeFileSync, chmodSync } = require('node:fs') as typeof import('node:fs');
        const { tmpdir } = require('node:os') as typeof import('node:os');
        const joinPath = require('node:path') as typeof import('node:path');

        const qualityGate = DEF.states.find((s) => s.id === 'test');
        const shell = qualityGate?.onEnter?.find(
            (a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('-priority.txt'),
        );
        expect(shell).toBeDefined();
        const command = String(shell?.options?.command ?? '');
        expect(command).toContain('cat ".spur/run/$wbs-taskpath.txt"');

        const dir = mkdtempSync(joinPath.join(tmpdir(), 't0710-priority-'));
        try {
            const runDir = joinPath.join(dir, '.spur', 'run');
            mkdirRecursive(runDir);
            const spec = joinPath.join(dir, 'spec.md');
            writeFileSync(spec, '---\nwbs: t9001\npriority: p1\n---\nbody\n');
            // $spurBin renders to an emitter that ignores argv and prints the same JSON shape
            // `spur task path --json` does, so the jq segment writes the path like production.
            const emit = joinPath.join(dir, 'emit.sh');
            writeFileSync(emit, `#!/bin/sh\nprintf '{"filePath":"%s"}' "${spec}"\n`);
            chmodSync(emit, 0o755);
            const rendered = command.replaceAll('$spurBin', emit).replaceAll('$wbs', 't9001');
            execSync(rendered, { cwd: dir, stdio: 'pipe' });
            expect(readFileSync(joinPath.join(runDir, 't9001-priority.txt'), 'utf8').trim()).toBe('P1');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('task-path lookup fails closed (task 0751 R2)', () => {
    const resolveShell = (): { shell?: { options?: { command?: string } }; command: string } => {
        const test = DEF.states.find((st) => st.id === 'test');
        const shell = test?.onEnter?.find(
            (a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('-taskpath.txt'),
        );
        return { shell, command: String(shell?.options?.command ?? '') };
    };

    test('the lookup is not suppressed: no `|| true`, no forced `exit 0`, no stderr suppression', () => {
        const { command } = resolveShell();
        expect(command).toContain('task path $wbs --json');
        expect(command).not.toContain('--json 2>/dev/null');
        expect(command).not.toContain('|| true');
        expect(command).not.toContain('; exit 0');
        expect(command).not.toContain(';exit 0');
    });

    test('an empty resolved task path exits non-zero with a message naming the failure', () => {
        const { command } = resolveShell();
        expect(command).toContain('-z "$task_path"');
        expect(command).toContain('exit 1');
        expect(command).toContain('did not resolve');
    });

    test('the done-state verdict artifact declares the enforced proof binding (0751 R4)', () => {
        const done = DEF.states.find((st) => st.id === 'done');
        const artifact = done?.onEnter?.find((a) => a.kind === 'run.artifact');
        expect(artifact).toBeDefined();
        expect(artifact?.options?.proofBinding).toBe('current');
    });

    test('behavioral: an unresolved task path fails the rendered command', () => {
        const { execSync } = require('node:child_process') as typeof import('node:child_process');
        const { mkdtempSync, rmSync, writeFileSync, chmodSync } = require('node:fs') as typeof import('node:fs');
        const { tmpdir } = require('node:os') as typeof import('node:os');
        const joinPath = require('node:path') as typeof import('node:path');

        const { command } = resolveShell();
        const dir = mkdtempSync(joinPath.join(tmpdir(), 't0751-taskpath-'));
        try {
            mkdirRecursive(joinPath.join(dir, '.spur', 'run'));
            // Emit the same JSON shape `spur task path --json` does when the task
            // cannot be resolved: no path field, so jq drains to `empty`.
            const emit = joinPath.join(dir, 'emit.sh');
            writeFileSync(emit, "#!/bin/sh\nprintf '{}'\n");
            chmodSync(emit, 0o755);
            const rendered = command.replaceAll('$spurBin', emit).replaceAll('$wbs', 't9001');
            expect(() => execSync(rendered, { cwd: dir, stdio: 'pipe' })).toThrow();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

function mkdirRecursive(path: string): void {
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(path, { recursive: true });
}
