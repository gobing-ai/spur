import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// Task 0760 (sibling of 0751 R2): the docs-pipeline task-path lookup must fail
// closed the same way task-pipeline was repaired. A silent miss would fold an
// empty `taskFile` into the proof digest and degrade the docs-pipeline proof
// to tree-only. These tests pin the structural shape of the lookup and the
// behavioral consequence of an unresolved wbs.

interface Action {
    kind: string;
    options?: Record<string, unknown>;
}
interface WorkflowDef {
    states: { id: string; onEnter?: Action[] }[];
}

const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'docs-pipeline.yaml'), 'utf8')) as WorkflowDef;

describe('docs-pipeline task-path lookup fails closed (task 0760 R1/R2)', () => {
    const resolveShell = (): { shell?: { options?: { command?: string } }; command: string } => {
        const verify = DEF.states.find((st) => st.id === 'verify');
        const shell = verify?.onEnter?.find(
            (a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('-docs-taskpath.txt'),
        );
        return { shell, command: String(shell?.options?.command ?? '') };
    };

    test('the lookup is not suppressed: no `2>/dev/null`, no `|| true`, no forced `exit 0` (R1)', () => {
        const { command } = resolveShell();
        expect(command).toContain('task path $wbs --json');
        expect(command).not.toContain('--json 2>/dev/null');
        expect(command).not.toContain('|| true');
        expect(command).not.toMatch(/;\s*exit 0\s*$/m);
    });

    test('an empty resolved task path exits non-zero with a message naming the failure (R1)', () => {
        const { command } = resolveShell();
        expect(command).toContain('-z "$task_path"');
        expect(command).toContain('exit 1');
        expect(command).toContain('did not resolve');
    });

    test('the resolved path folds into the proof digest via `taskFile:` (R1 / 0751 R4 proofBinding)', () => {
        const verify = DEF.states.find((st) => st.id === 'verify');
        const fingerprints = verify?.onEnter?.filter((a) => a.kind === 'proof.fingerprint') ?? [];
        expect(fingerprints.length).toBeGreaterThanOrEqual(1);
        for (const fp of fingerprints) {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
            expect(fp.options?.taskFile).toBe('${vars.taskSpecPath}');
        }
    });

    test('behavioral: an unresolved task path fails the rendered command (R1)', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { execSync } = require('node:child_process') as typeof import('node:child_process');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } =
            require('node:fs') as typeof import('node:fs');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { tmpdir } = require('node:os') as typeof import('node:os');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const joinPath = require('node:path') as typeof import('node:path');

        const { command } = resolveShell();
        const dir = mkdtempSync(joinPath.join(tmpdir(), 't0760-docs-taskpath-'));
        try {
            mkdirSync(joinPath.join(dir, '.spur', 'run'), { recursive: true });
            // Emit the same JSON shape `spur task path --json` does when the task
            // cannot be resolved: no path field, so jq drains to `empty`.
            const emit = joinPath.join(dir, 'emit.sh');
            writeFileSync(emit, "#!/bin/sh\nprintf '{}'\n");
            chmodSync(emit, 0o755);
            const rendered = command.replaceAll('$spurBin', emit).replaceAll('$wbs', 't9002');
            expect(() => execSync(rendered, { cwd: dir, stdio: 'pipe' })).toThrow();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
