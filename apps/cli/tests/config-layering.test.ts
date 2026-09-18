import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar } from '@gobing-ai/spur-config';
import { runCli } from './helpers';

// A5/ADR-082: composition-root merged-config wiring regression tests (R6).
// Hermetic-subprocess pattern copied from packages/config/tests/loader-layers.test.ts:
// every case spawns the REAL CLI entry with HOME/USERPROFILE -> temp dir and
// SPUR_SKIP_GLOBAL_CONFIG='' (tests/setup.ts sets 'true' process-wide and subprocesses
// inherit it, so each case must clear it to exercise the global layer).

interface LayerDirs {
    fakeHome: string;
    projectDir: string;
    binDir: string;
    /** Subprocess env: hermetic HOME, global layer enabled, stub agents on PATH. */
    env: Record<string, string>;
}

/**
 * Stub the agent binaries `agent doctor` probes.
 *
 * `AgentDetector` shells `<agent> --version` and marks an agent usable when the
 * output carries a parseable `\d+\.\d+` version (ts-ai-runner `agent-detector.js`,
 * `usable: detected.installed && detected.version !== null`). Without these stubs
 * the doctor cases below assert the HOST's agent installation rather than the
 * merged config: `resolveRole` finds no usable executor, exits 1, and prints
 * `No usable executor for role … — tried: coder-exec` instead of the doctor
 * payload. That passes on a dev box with claude/codex installed and fails on any
 * machine without them, CI included.
 */
async function makeStubAgentBin(): Promise<string> {
    const binDir = await mkdtemp(join(tmpdir(), 'spur-cli-bin-'));
    for (const agent of ['claude', 'codex']) {
        const shim = join(binDir, agent);
        await writeFile(shim, `#!/bin/sh\necho "1.0.0 (${agent} stub)"\n`);
        await chmod(shim, 0o755);
    }
    return binDir;
}

async function makeLayerDirs(globalYaml?: string, projectYaml?: string): Promise<LayerDirs> {
    const fakeHome = await mkdtemp(join(tmpdir(), 'spur-cli-home-'));
    const projectDir = await mkdtemp(join(tmpdir(), 'spur-cli-proj-'));
    const binDir = await makeStubAgentBin();
    if (globalYaml !== undefined) {
        await mkdir(join(fakeHome, '.config', 'spur'), { recursive: true });
        await writeFile(join(fakeHome, '.config', 'spur', 'config.yaml'), globalYaml);
    }
    if (projectYaml !== undefined) {
        await mkdir(join(projectDir, '.spur'), { recursive: true });
        await writeFile(join(projectDir, '.spur', 'config.yaml'), projectYaml);
    }
    return {
        fakeHome,
        projectDir,
        binDir,
        env: {
            HOME: fakeHome,
            USERPROFILE: fakeHome,
            SPUR_SKIP_GLOBAL_CONFIG: '',
            PATH: `${binDir}:${getEnvVar('PATH') ?? ''}`,
        },
    };
}

/** Global config: a 'coder' role + a 'coder-exec' executor, machine-wide. */
const GLOBAL_EXECUTOR = [
    'version: "1"',
    'name: global',
    'agent:',
    '  default: coder',
    '  executors:',
    '    - name: coder-exec',
    '      agent: claude',
    '      tier: capable-1',
    '  roles:',
    '    coder:',
    '      tier: standard',
    '      stages: [implement, test, wrap]',
    'workflows:',
    '  paths: [global-only-workflows]',
].join('\n');

const FALLBACK_NOTE = 'agent.roles: no config layer defines a table — built-in DEFAULT_AGENT_ROLES fallback in effect';

/** Task 0889: text-mode doctor appends a staleness warning when the stub's detected version differs from the runner record's verifiedAgainst (claude stub reports 1.0.0; record verified against 2.1.274). */
const CAPABILITY_STALE_WARNING =
    'Warning: capability-declaration-stale: executor coder-exec (claude) detects version "1.0.0 (claude stub)" (core 1.0.0), but the runner record was verified against "2.1.274" (core 2.1.274) — session capability flags may have drifted.';

const dirsToClean: LayerDirs[] = [];

afterEach(async () => {
    while (dirsToClean.length > 0) {
        const dirs = dirsToClean.pop();
        if (dirs === undefined) break;
        await rm(dirs.fakeHome, { recursive: true, force: true });
        await rm(dirs.projectDir, { recursive: true, force: true });
        await rm(dirs.binDir, { recursive: true, force: true });
    }
});

// Case names mirror the design-doc test table (R2/R3/R12/R13/R1-R5).
describe('config layering — composition-root merged-config (A5)', () => {
    test('R2: a global-only executor is honored by every CLI command (reversion tripwire)', async () => {
        const dirs = await makeLayerDirs(GLOBAL_EXECUTOR, 'version: "1"\nname: proj\n');
        dirsToClean.push(dirs);
        // Project config has no agent section — the merged config must supply the
        // globally-defined coder executor for agent doctor resolution.
        const res = await runCli(['agent', 'doctor', 'coder', '--json'], dirs.projectDir, dirs.env);
        expect(res.code).toBe(0);
        const json = res.json as {
            rolesSource?: string;
            agents?: Array<{ agent?: string; capabilityTier?: string }>;
        };
        expect(json.rolesSource).toBe('config');
        expect(json.agents?.find((a) => a.agent === 'coder-exec')?.capabilityTier).toBe('capable-1');
    });

    test('R3: a project config value overrides the same global key', async () => {
        // Global defines coder-exec as claude; project re-declares it as codex.
        const projectYaml = [
            'version: "1"',
            'name: proj',
            'agent:',
            '  default: coder',
            '  executors:',
            '    - name: coder-exec',
            '      agent: codex',
            '      tier: capable-2',
            '  roles:',
            '    coder:',
            '      tier: standard',
            '      stages: [implement, test, wrap]',
        ].join('\n');
        const dirs = await makeLayerDirs(GLOBAL_EXECUTOR, projectYaml);
        dirsToClean.push(dirs);
        // The project's coder-exec (codex) must win. Use the config-layer parity
        // helper indirectly: agent doctor reflects the merged coder-exec profile.
        const res = await runCli(['agent', 'doctor', 'coder-exec', '--json'], dirs.projectDir, dirs.env);
        expect(res.code).toBe(0);
        // Project override must not error; the executor is still resolvable.
        // (The exact winning agent is asserted via the executor resolution; a
        // project-overridden coder-exec means dispatch resolves codex, not claude.)
        const json = res.json as { agents?: Array<{ agent?: string; capabilityTier?: string }> };
        expect(json.agents?.find((a) => a.agent === 'coder-exec')?.capabilityTier).toBe('capable-2');
    });

    test('R12: the CLI works when no global config file exists', async () => {
        const dirs = await makeLayerDirs(undefined, 'version: "1"\nname: proj\nagent:\n  default: coder\n');
        dirsToClean.push(dirs);
        const res = await runCli(['workflow', 'list', '--json'], dirs.projectDir, dirs.env);
        expect(res.code).toBe(0);
        // No config-loading error on either stream.
        expect(res.stderr).not.toMatch(/config|Error/);
    });

    test('R13: an invalid global config fails once with a single --json error envelope', async () => {
        const dirs = await makeLayerDirs('this is: not: valid: yaml: [unclosed\n', 'version: "1"\nname: proj\n');
        dirsToClean.push(dirs);
        const res = await runCli(['workflow', 'list', '--json'], dirs.projectDir, dirs.env);
        expect(res.code).not.toBe(0);
        expect(res.stderr).toBe('');
        const json = res.json as { error?: { code?: string; message?: string } };
        expect(json.error?.code).toBe('config');
        // The message names the global (home-layer) path, not one error per consumer.
        expect(json.error?.message ?? '').toContain(join(dirs.fakeHome, '.config', 'spur', 'config.yaml'));
    });

    test('R1/R5: a workflow-surface command observes a global-only setting via the threaded config (no split-brain)', async () => {
        const dirs = await makeLayerDirs(GLOBAL_EXECUTOR, 'version: "1"\nname: proj\n');
        dirsToClean.push(dirs);
        // `spur workflow list` reads resolveWorkflowPaths from the threaded config;
        // a global-only workflow.paths setting must be observed (not re-read per slice).
        const res = await runCli(['workflow', 'list', '--json'], dirs.projectDir, dirs.env);
        expect(res.code).toBe(0);
        const json = res.json as { layers?: Array<{ id?: string; path?: string }> };
        // The global-only `workflows.paths` entry surfaces as a `registered` layer
        // (ADR-113/task 0819 vocabulary: project → registered → shared), resolved
        // against cwd — proving the threaded merged config reached the command.
        const layers = json.layers ?? [];
        expect(layers).toContainEqual({
            id: 'registered',
            path: join(await realpath(dirs.projectDir), 'global-only-workflows'),
        });
        const layerIds = layers.map((l) => l.id);
        const projectIdx = layerIds.indexOf('project');
        const registeredIdx = layerIds.indexOf('registered');
        const sharedIdx = layerIds.indexOf('shared');
        expect(projectIdx).toBeGreaterThanOrEqual(0);
        expect(registeredIdx).toBeGreaterThan(projectIdx);
        if (sharedIdx !== -1) expect(sharedIdx).toBeGreaterThan(registeredIdx);
    });

    test('R7: no config layer defines agent.roles → doctor reports rolesSource: fallback (explicit fallback proven)', async () => {
        // Neither layer supplies an `agent.roles` table; a `coder` role selector
        // resolves via DEFAULT_AGENT_ROLES. The doctor --json payload must carry
        // top-level `rolesSource: 'fallback'` (whole-table provenance).
        const dirs = await makeLayerDirs(
            'version: "1"\nname: global\nagent:\n  executors:\n    - name: coder-exec\n      agent: claude\n      tier: standard\n',
            'version: "1"\nname: proj\n',
        );
        dirsToClean.push(dirs);
        const res = await runCli(['agent', 'doctor', 'coder', '--json'], dirs.projectDir, dirs.env);
        const json = res.json as { rolesSource?: string; agents?: Array<{ agent?: string }> };
        expect(res.stderr).toBe('');
        expect(json.rolesSource).toBe('fallback');
        // The coder role still resolves (fallback table), so doctor is usable.
        expect(Array.isArray(json.agents)).toBe(true);
    });

    test('R7: text-mode doctor prints the explicit-fallback note when no layer defines agent.roles', async () => {
        const dirs = await makeLayerDirs(
            'version: "1"\nname: global\nagent:\n  executors:\n    - name: coder-exec\n      agent: claude\n      tier: standard\n',
            'version: "1"\nname: proj\n',
        );
        dirsToClean.push(dirs);
        const res = await runCli(['agent', 'doctor', 'coder'], dirs.projectDir, dirs.env);
        expect(res.stderr.trim()).toBe(`${FALLBACK_NOTE}\n${CAPABILITY_STALE_WARNING}`);
    });

    test('0898 R3: text-mode doctor table carries the runner-declared CAPS cell with the staleness marker', async () => {
        const dirs = await makeLayerDirs(GLOBAL_EXECUTOR, 'version: "1"\nname: proj\n');
        dirsToClean.push(dirs);
        // The capability surface under test is the doctor TABLE cell (CAPS header);
        // a role selector renders the eligible ladder, which has no CAPS column, so
        // the table is read in full mode. The column is located by header lookup —
        // never by exact line or fixed offset (parallel doctor-column work).
        const res = await runCli(['agent', 'doctor'], dirs.projectDir, dirs.env);
        expect(res.code).toBe(0);
        const lines = res.stdout.split('\n');
        const header = lines.find((line) => line.includes('CAPS'));
        expect(header).toBeDefined();
        const capsIdx = (header as string).indexOf('CAPS');
        const row = lines.find((line) => line !== header && line.includes('coder-exec'));
        expect(row).toBeDefined();
        // Column start positions align across header and data rows (left-aligned
        // padEnd columns), so the header index slices the same column in the row.
        const capsCell = (row as string).slice(capsIdx).split(/\s{2,}/)[0] ?? '';
        // claude record: resume-by-id true (r✓); staleness from the 1.0.0 stub vs
        // the record's verifiedAgainst appends the ⚠ suffix.
        expect(capsCell.startsWith('r✓')).toBe(true);
        expect(capsCell.endsWith('⚠')).toBe(true);
    });

    test('0898 R3: doctor --json carries capabilities (verifiedAgainst) and capabilityStale with clean stderr', async () => {
        const dirs = await makeLayerDirs(GLOBAL_EXECUTOR, 'version: "1"\nname: proj\n');
        dirsToClean.push(dirs);
        const res = await runCli(['agent', 'doctor', 'coder', '--json'], dirs.projectDir, dirs.env);
        expect(res.code).toBe(0);
        expect(res.stderr).toBe('');
        const json = res.json as {
            agents?: Array<{
                agent?: string;
                capabilities?: { supportsResumeById?: boolean; verifiedAgainst?: string } | null;
                capabilityStale?: { verifiedAgainst?: string; detected?: string } | null;
            }>;
        };
        const coderExec = json.agents?.find((a) => a.agent === 'coder-exec');
        expect(coderExec).toBeDefined();
        expect(typeof coderExec?.capabilities?.verifiedAgainst).toBe('string');
        expect((coderExec?.capabilities?.verifiedAgainst ?? '').length).toBeGreaterThan(0);
        expect(coderExec?.capabilities?.supportsResumeById).toBe(true);
        expect(coderExec?.capabilityStale?.verifiedAgainst).toBe(coderExec?.capabilities?.verifiedAgainst);
        expect(typeof coderExec?.capabilityStale?.detected).toBe('string');
        expect((coderExec?.capabilityStale?.detected ?? '').startsWith('1.0.0')).toBe(true);
    });
});
