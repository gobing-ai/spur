/**
 * E2E for task 1224 R3–R7 (feature A92, design `docs/design/sdlc-actions.md` §3.4): the shipped
 * workflows default to the action map instead of bun scripts, the wrapup tripwire probes the
 * action list before running anything, and an explicit override still wins.
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { parse as parseYaml } from 'yaml';
import { runShellCommand } from '../../src/services/quality-gate';

// Split so biome does not read the shell parameter expansion as a template literal.
const SPUR_BIN_FALLBACK = `\${spurBin:-spur}`;
// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');

function workflowVars(file: string): Record<string, unknown> {
    const text = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
    return (parseYaml(text) as { vars?: Record<string, unknown> }).vars ?? {};
}

describe('shipped workflow defaults use the action map (1224 R3–R5)', () => {
    test('R3 — the task pipeline gate and probe re-enter spur through self exec', () => {
        const vars = workflowVars('task-pipeline.yaml');
        expect(vars.qualityGateCmd).toBe(`${SPUR_BIN_FALLBACK} self exec check`);
        expect(vars.gateProbeCmd).toBe(`${SPUR_BIN_FALLBACK} self exec lint`);
    });

    test('R4 — formatCmd resolves through the action map and stays best-effort', () => {
        expect(workflowVars('task-pipeline.yaml').formatCmd).toBe(`${SPUR_BIN_FALLBACK} self exec format`);
        const text = readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8');
        // A plain `$formatCmd` word would not expand the `${spurBin:-spur}` inside its value.
        expect(text).toContain('command: \'sh -c "$formatCmd" ; exit 0\'');
    });

    test('R5 — feature verification defaults to the argv-split action call', () => {
        expect(workflowVars('feature-verification.yaml').verificationCmd).toBe('spur self exec check-feature');
        const runSource = readFileSync(join(import.meta.dir, '../../src/workflow/feature-verification-run.ts'), 'utf8');
        expect(runSource).toContain(": 'spur self exec check-feature';");
        expect(runSource).not.toContain('spur-check-feature');
    });
});

describe('wrapup tripwire probes the action list (1224 R6)', () => {
    /** A fake `spur` whose `self exec --list --json` reports the actions in `$FAKE_ACTIONS`. */
    function fixture(actions: string): { dir: string; env: Record<string, string>; calls: string } {
        const dir = mkdtempSync(join(tmpdir(), 'spur-tripwire-'));
        const spur = join(dir, 'spur');
        writeFileSync(
            spur,
            '#!/bin/sh\n[ "$1" = self ] && [ "$2" = exec ] || exit 1\nshift 2\n' +
                'if [ "$1" = --list ]; then printf \'%s\\n\' "$FAKE_ACTIONS"; exit 0; fi\n' +
                'printf \'%s\\n\' "$*" >> "$FAKE_LOG"\nexit 0\n',
        );
        chmodSync(spur, 0o755);
        const calls = join(dir, 'calls.log');
        return {
            dir,
            env: { spurBin: spur, FAKE_ACTIONS: actions, FAKE_LOG: calls },
            calls,
        };
    }

    function runTripwire(cmd: string, dir: string, env: Record<string, string>): string {
        const result = runShellCommand('sh -c "$docTripwireCmd" && echo TRIPWIRE-PASS', dir, {
            ...env,
            docTripwireCmd: cmd,
        });
        expect(result.code).toBe(0);
        expect(result.output).toContain('TRIPWIRE-PASS');
        return result.output;
    }

    test('runs the bound action', () => {
        const cmd = workflowVars('wrapup-pipeline.yaml').docTripwireCmd as string;
        expect(cmd).toContain('self exec --list --json');
        expect(cmd).not.toContain('package.json');
        const bound = fixture('[{"name":"test-repo-wide","reserved":false,"source":"config"}]');
        try {
            runTripwire(cmd, bound.dir, bound.env);
            expect(readFileSync(bound.calls, 'utf8').trim()).toBe('test-repo-wide');
        } finally {
            rmSync(bound.dir, { recursive: true, force: true });
        }
    });

    test('no-ops when the action resolves unbound', () => {
        const cmd = workflowVars('wrapup-pipeline.yaml').docTripwireCmd as string;
        const unbound = fixture('[{"name":"test-repo-wide","reserved":false,"source":"unbound"}]');
        try {
            runTripwire(cmd, unbound.dir, unbound.env);
            expect(existsSync(unbound.calls)).toBe(false);
        } finally {
            rmSync(unbound.dir, { recursive: true, force: true });
        }
    });
});

describe('explicit overrides keep precedence (1224 R7)', () => {
    const CLI = new URL('../../../../apps/cli/src/index.ts', import.meta.url).pathname;

    function gate(dir: string, args: string[], env: Record<string, string>): number {
        const result = Bun.spawnSync([process.execPath, CLI, 'task', 'gate', '1224t', 'run', ...args], {
            cwd: dir,
            env: { ...getEnvVars(), ...env },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        return result.exitCode ?? 1;
    }

    test('a var override beats the shipped default, and --cmd beats the var', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-gate-precedence-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            // What `--vars qualityGateCmd=...` injects: the env value wins over `self exec check`.
            expect(gate(dir, [], { qualityGateCmd: 'exit 0' })).toBe(0);
            expect(gate(dir, [], { qualityGateCmd: 'exit 1' })).toBe(1);
            // The flag wins over the same env value.
            expect(gate(dir, ['--cmd', 'exit 0'], { qualityGateCmd: 'exit 1' })).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
