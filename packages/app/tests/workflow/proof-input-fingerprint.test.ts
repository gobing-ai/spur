import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    createGitAlternateTree,
    extractFeatureProofData,
    extractTaskProofData,
    ProofCaptureError,
    ProofInputFingerprint,
    readProofInputContents,
} from '../../src/workflow/proof-input-fingerprint';

describe('ProofInputFingerprint', () => {
    const sampleTaskContent = `---
schema_version: 1
wbs: "0100"
name: "Sample task"
feature_id: "F1"
depends_on: ["0099"]
status: wip
---

## 0100. Sample task

### Background
Task background info.

### Requirements
- [ ] R1. Requirement 1

### Acceptance Criteria
\`\`\`gherkin
Feature: Sample
\`\`\`

### Design
Task design.

### Plan
1. Step 1

### Solution
Modified source code details.

### Testing
Test run outputs.

### Review
Review findings.
`;

    const sampleFeatureContent = `---
id: "F1"
name: "Sample feature"
status: active
---

## Goal
Feature goal.

## Scope
- in scope

## Acceptance Criteria
\`\`\`gherkin
Feature: F1 AC
\`\`\`

## History
Feature history.
`;

    test('extractTaskProofData extracts only proof-input fields and normative sections', () => {
        const data = extractTaskProofData(sampleTaskContent);
        expect(data.wbs).toBe('0100');
        expect(data.name).toBe('Sample task');
        expect(data.feature_id).toBe('F1');
        expect(data.depends_on).toEqual(['0099']);

        expect(data.sections.Background).toBe('Task background info.');
        expect(data.sections.Requirements).toContain('R1. Requirement 1');
        expect(data.sections['Acceptance Criteria']).toContain('Feature: Sample');
        expect(data.sections.Design).toBe('Task design.');
        expect(data.sections.Plan).toBe('1. Step 1');

        expect(data.sections.Solution).toBeUndefined();
        expect(data.sections.Testing).toBeUndefined();
        expect(data.sections.Review).toBeUndefined();
    });

    test('extractFeatureProofData extracts only identity and Goal/Scope/AC sections', () => {
        const data = extractFeatureProofData(sampleFeatureContent);
        expect(data.id).toBe('F1');
        expect(data.name).toBe('Sample feature');
        expect(data.sections.Goal).toBe('Feature goal.');
        expect(data.sections.Scope).toBe('- in scope');
        expect(data.sections['Acceptance Criteria']).toContain('Feature: F1 AC');
        expect(data.sections.History).toBeUndefined();
    });

    test('fingerprint is stable and does not change when only Solution/Testing/Review change', async () => {
        const executor = {
            run: async () => ({
                exitCode: 0,
                stdout: 'tree-sha-1234\n',
                stderr: '',
                command: 'git',
                args: [],
                durationMs: 0,
            }),
        } as unknown as import('@gobing-ai/ts-runtime').ProcessExecutor;

        const digest1 = await ProofInputFingerprint.compute({
            taskContent: sampleTaskContent,
            featureContent: sampleFeatureContent,
            processExecutor: executor,
        });

        const modifiedTaskContent = sampleTaskContent
            .replace('Modified source code details.', 'Updated solution implementation.')
            .replace('Test run outputs.', '10 tests passed.')
            .replace('Review findings.', 'LGTM clean review.');

        const digest2 = await ProofInputFingerprint.compute({
            taskContent: modifiedTaskContent,
            featureContent: sampleFeatureContent,
            processExecutor: executor,
        });

        expect(digest1).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(digest1).toBe(digest2);
    });

    test('fingerprint changes when Requirements or Git tree changes', async () => {
        const executor = {
            run: async () => ({
                exitCode: 0,
                stdout: 'tree-sha-1234\n',
                stderr: '',
                command: 'git',
                args: [],
                durationMs: 0,
            }),
        } as unknown as import('@gobing-ai/ts-runtime').ProcessExecutor;

        const digest1 = await ProofInputFingerprint.compute({
            taskContent: sampleTaskContent,
            featureContent: sampleFeatureContent,
            processExecutor: executor,
        });

        const modifiedReqTaskContent = sampleTaskContent.replace('R1. Requirement 1', 'R1. Modified requirement text');
        const digest2 = await ProofInputFingerprint.compute({
            taskContent: modifiedReqTaskContent,
            featureContent: sampleFeatureContent,
            processExecutor: executor,
        });

        expect(digest1).not.toBe(digest2);

        const executor2 = {
            run: async () => ({
                exitCode: 0,
                stdout: 'tree-sha-DIFFERENT\n',
                stderr: '',
                command: 'git',
                args: [],
                durationMs: 0,
            }),
        } as unknown as import('@gobing-ai/ts-runtime').ProcessExecutor;

        const digest3 = await ProofInputFingerprint.compute({
            taskContent: sampleTaskContent,
            featureContent: sampleFeatureContent,
            processExecutor: executor2,
        });

        expect(digest1).not.toBe(digest3);
    });
});

// The git-tree half returned '' on EVERY call from task 0603 until task 0612: naming an already
// gitignored path (`.spur/run*`) in the exclude pathspec made `git add` warn and exit 1, and the
// function treated any non-zero exit as fatal. Nothing noticed, because an empty string is a valid
// return and the digest still "worked" — it was just blind to the working tree. These two tests
// make that silent failure loud.
describe('git-tree component is live, not silently empty', () => {
    test('returns a real tree hash rather than an empty string', async () => {
        const tree = await createGitAlternateTree(process.cwd());
        expect(tree).not.toBe('');
        expect(tree).toMatch(/^[a-f0-9]{40}$/);
    });

    test('a working-tree change moves the digest, and reverting restores it', async () => {
        const probe = 'docs/design/zz-proof-fingerprint-probe.md';
        const before = await ProofInputFingerprint.compute();
        try {
            await Bun.write(probe, '# probe\n');
            const during = await ProofInputFingerprint.compute();
            expect(during).not.toBe(before);
        } finally {
            await rm(probe, { force: true });
        }
        expect(await ProofInputFingerprint.compute()).toBe(before);
    });
});

// Task 0751 R1: the git-tree capture used to answer `''` on every failure path (read-tree, add,
// write-tree, thrown git error), and `computeProofInputFingerprint` hashed that empty string into a
// valid-looking digest — proof capture failed OPEN. The contract is now total into the error
// channel: every git failure is a distinguishable ProofCaptureError and no digest is derived.
describe('git-tree capture fails closed (task 0751 R1)', () => {
    const failingExecutor = (failedStep: string, exitCode = 1) =>
        ({
            run: async (opts: { args: string[] }) => {
                if (opts.args[0] === failedStep) {
                    return {
                        exitCode,
                        stdout: '',
                        stderr: 'fatal: simulated git failure',
                        command: 'git',
                        args: opts.args,
                        durationMs: 0,
                    };
                }
                return {
                    exitCode: 0,
                    stdout: 'tree-sha-ok\n',
                    stderr: '',
                    command: 'git',
                    args: opts.args,
                    durationMs: 0,
                };
            },
        }) as unknown as import('@gobing-ai/ts-runtime').ProcessExecutor;

    const throwingExecutor = {
        run: async () => {
            throw new Error('git binary vanished');
        },
    } as unknown as import('@gobing-ai/ts-runtime').ProcessExecutor;

    test('read-tree failure rejects createGitAlternateTree with ProofCaptureError (no empty sentinel)', async () => {
        // 0760 R4: the prior `expect(...).rejects` form could settle before the
        // matcher ran, so a regression back to the pre-0751 `''` sentinel could
        // pass vacuously. Await via the sibling `.catch(e => e)` pattern so a
        // thrown rejection is asserted, not the promise of one.
        const err = await createGitAlternateTree(process.cwd(), undefined, failingExecutor('read-tree')).catch(
            (e) => e,
        );
        expect(err).toBeInstanceOf(ProofCaptureError);
    });

    test('add failure carries the git stderr in the rejection', async () => {
        const err = await createGitAlternateTree(process.cwd(), undefined, failingExecutor('add')).catch((e) => e);
        expect(err).toBeInstanceOf(ProofCaptureError);
        expect((err as ProofCaptureError).message).toContain('git add');
        expect((err as ProofCaptureError).stderr).toContain('simulated git failure');
    });

    test('write-tree failure rejects with ProofCaptureError', async () => {
        const err = await createGitAlternateTree(process.cwd(), undefined, failingExecutor('write-tree')).catch(
            (e) => e,
        );
        expect(err).toBeInstanceOf(ProofCaptureError);
        expect((err as ProofCaptureError).message).toContain('git write-tree');
    });

    test('a thrown git error converts to ProofCaptureError, not an empty string', async () => {
        const err = await createGitAlternateTree(process.cwd(), undefined, throwingExecutor).catch((e) => e);
        expect(err).toBeInstanceOf(ProofCaptureError);
        expect((err as ProofCaptureError).message).toContain('git binary vanished');
    });

    test('computeProofInputFingerprint rejects on git failure — no digest is derived from a failed capture', async () => {
        let rejected: unknown;
        try {
            await ProofInputFingerprint.compute({
                processExecutor: failingExecutor('read-tree'),
            });
        } catch (error) {
            rejected = error;
        }
        expect(rejected).toBeInstanceOf(ProofCaptureError);
    });
});

// Task 0785 R1: validated spec reads shared by proof.fingerprint and bound run.artifact.
// Only undefined/'' mean omitted; any other supplied path must resolve to a readable regular
// file under the workflow workdir or the read fails closed with a named error.
describe('readProofInputContents (task 0785 R1)', () => {
    function setup(): { workdir: string; cleanup: () => Promise<void> } {
        const workdir = mkdtempSync(join(tmpdir(), 'proof-input-'));
        return { workdir, cleanup: () => rm(workdir, { recursive: true, force: true }) };
    }

    test('omitted and empty-string inputs stay optional (compatibility)', async () => {
        const { workdir, cleanup } = setup();
        try {
            const fs = createNodeFileSystem();
            for (const options of [{}, { taskFile: undefined }, { taskFile: '', featureFile: '' }]) {
                const res = await readProofInputContents(fs, workdir, options);
                expect(res.ok).toBeTrue();
                if (res.ok) {
                    expect(res.taskContent).toBeUndefined();
                    expect(res.featureContent).toBeUndefined();
                }
            }
        } finally {
            await cleanup();
        }
    });

    test('reads supplied specs and returns their content', async () => {
        const { workdir, cleanup } = setup();
        try {
            // 0818 R4: taskFile must now be task-shaped markdown; featureFile is unchanged.
            writeFileSync(join(workdir, 't.md'), '## 0042. A task\n\n### Requirements\n\ntask body\n');
            writeFileSync(join(workdir, 'f.md'), 'feature body');
            const res = await readProofInputContents(createNodeFileSystem(), workdir, {
                taskFile: 't.md',
                featureFile: join(workdir, 'f.md'),
            });
            expect(res.ok).toBeTrue();
            if (res.ok) {
                expect(res.taskContent).toContain('task body');
                expect(res.featureContent).toBe('feature body');
            }
        } finally {
            await cleanup();
        }
    });

    test('a missing, non-regular, unreadable, or escaping spec fails closed with a named error', async () => {
        const { workdir, cleanup } = setup();
        try {
            const fs = createNodeFileSystem();
            const missing = await readProofInputContents(fs, workdir, { taskFile: 'nope.md' });
            expect(missing.ok).toBeFalse();
            if (!missing.ok) expect(missing.error).toContain('taskFile does not exist');

            mkdirSync(join(workdir, 'adir'));
            const dir = await readProofInputContents(fs, workdir, { taskFile: 'adir' });
            expect(dir.ok).toBeFalse();
            if (!dir.ok) expect(dir.error).toContain('not a regular file');

            const locked = join(workdir, 'locked.md');
            writeFileSync(locked, 'x');
            chmodSync(locked, 0o000);
            if (process.getuid?.() !== 0) {
                const unreadable = await readProofInputContents(fs, workdir, { featureFile: 'locked.md' });
                expect(unreadable.ok).toBeFalse();
                if (!unreadable.ok) expect(unreadable.error).toContain('featureFile is not readable');
            }
            chmodSync(locked, 0o644);

            const escaping = await readProofInputContents(fs, workdir, { taskFile: '../escape.md' });
            expect(escaping.ok).toBeFalse();
            if (!escaping.ok) expect(escaping.error).toContain('must resolve under the workflow workdir');
        } finally {
            await cleanup();
        }
    });

    test('non-string option values are rejected by name', async () => {
        const { workdir, cleanup } = setup();
        try {
            const fs = createNodeFileSystem();
            for (const [options, name] of [
                [{ taskFile: 42 }, 'taskFile'],
                [{ featureFile: ['x'] }, 'featureFile'],
                [{ taskFile: true }, 'taskFile'],
            ] as const) {
                const res = await readProofInputContents(fs, workdir, options);
                expect(res.ok).toBeFalse();
                if (!res.ok) expect(res.error).toContain(`${name} must be a string`);
            }
        } finally {
            await cleanup();
        }
    });
});

// Task 0818 R4: task-document shape validation at the shared read boundary. A readable file that
// is not a task specification — a path pointer, arbitrary text, a feature document — must fail
// here, before any digest computation or artifact ledger write.
describe('readProofInputContents task-document shape (task 0818 R4)', () => {
    const VALID_TASK = [
        '---',
        'schema_version: 1',
        'name: A real task',
        '---',
        '',
        '## 0818. A real task',
        '',
        '### Background',
        '',
        'why',
        '',
        '### Requirements',
        '',
        '- [ ] **R1 — do the thing.**',
        '',
    ].join('\n');

    function setup(): { workdir: string; cleanup: () => Promise<void> } {
        const workdir = mkdtempSync(join(tmpdir(), 'proof-shape-'));
        return { workdir, cleanup: () => rm(workdir, { recursive: true, force: true }) };
    }

    test('a path-pointer taskFile is rejected and never dereferenced', async () => {
        const { workdir, cleanup } = setup();
        try {
            const real = join(workdir, 'real-task.md');
            writeFileSync(real, VALID_TASK);
            // The exact false-positive shape: one line holding the path of a genuine task.
            writeFileSync(join(workdir, 'pointer.md'), `${real}\n`);

            const res = await readProofInputContents(createNodeFileSystem(), workdir, { taskFile: 'pointer.md' });
            expect(res.ok).toBeFalse();
            if (!res.ok) {
                expect(res.error).toContain('taskFile is not a task document');
                expect(res.error).toContain('pointer.md'); // supplied path
                expect(res.error).toContain(join(workdir, 'pointer.md')); // resolved path
                expect(res.error).toContain('## <WBS>. <title>'); // expected shape
                // The pointer's target must NOT have been followed.
                expect(res.error).not.toContain('R1 — do the thing');
            }
        } finally {
            await cleanup();
        }
    });

    test('arbitrary text and a feature document are rejected by the same validation', async () => {
        const { workdir, cleanup } = setup();
        try {
            const fs = createNodeFileSystem();
            writeFileSync(join(workdir, 'prose.md'), 'just some notes about the task\n');
            // Feature identity is `# <ID>: <title>` with a letter-prefixed id — no numeric `##` heading.
            writeFileSync(
                join(workdir, 'feature.md'),
                '---\nid: "D6"\n---\n\n# D6: A feature\n\n## Goal\n\ng\n\n## Acceptance Criteria\n\nac\n',
            );

            for (const file of ['prose.md', 'feature.md']) {
                const res = await readProofInputContents(fs, workdir, { taskFile: file });
                expect(res.ok).toBeFalse();
                if (!res.ok) {
                    expect(res.error).toContain('taskFile is not a task document');
                    expect(res.error).toContain('no canonical task heading');
                }
            }
        } finally {
            await cleanup();
        }
    });

    test('a canonical heading with no task specification section is rejected', async () => {
        const { workdir, cleanup } = setup();
        try {
            writeFileSync(join(workdir, 'heading-only.md'), '## 0818. Title only\n\n### History\n\n- nothing\n');
            const res = await readProofInputContents(createNodeFileSystem(), workdir, {
                taskFile: 'heading-only.md',
            });
            expect(res.ok).toBeFalse();
            if (!res.ok) expect(res.error).toContain('no task specification section');
        } finally {
            await cleanup();
        }
    });

    test('valid task markdown at a custom in-workdir path without wbs frontmatter is accepted', async () => {
        const { workdir, cleanup } = setup();
        try {
            // Not a corpus folder, and no `wbs` frontmatter field — both must still pass.
            mkdirSync(join(workdir, 'custom', 'nested'), { recursive: true });
            const custom = join('custom', 'nested', 'spec.md');
            writeFileSync(join(workdir, custom), VALID_TASK);
            expect(VALID_TASK).not.toContain('wbs:');

            const res = await readProofInputContents(createNodeFileSystem(), workdir, { taskFile: custom });
            expect(res.ok).toBeTrue();
            if (res.ok) expect(res.taskContent).toContain('R1 — do the thing');
        } finally {
            await cleanup();
        }
    });

    test('featureFile keeps its existing behaviour and is not shape-checked', async () => {
        const { workdir, cleanup } = setup();
        try {
            // The same content that fails as a taskFile must still pass as a featureFile.
            writeFileSync(join(workdir, 'anything.md'), 'not a document at all\n');
            const res = await readProofInputContents(createNodeFileSystem(), workdir, {
                featureFile: 'anything.md',
            });
            expect(res.ok).toBeTrue();
            if (res.ok) expect(res.featureContent).toBe('not a document at all\n');
        } finally {
            await cleanup();
        }
    });

    test('a changed valid task still yields a digest difference, not a shape error', async () => {
        const { workdir, cleanup } = setup();
        try {
            const fs = createNodeFileSystem();
            const spec = join(workdir, 'task.md');
            writeFileSync(spec, VALID_TASK);
            const before = await readProofInputContents(fs, workdir, { taskFile: 'task.md' });

            writeFileSync(spec, VALID_TASK.replace('do the thing', 'do a different thing'));
            const after = await readProofInputContents(fs, workdir, { taskFile: 'task.md' });

            expect(before.ok).toBeTrue();
            expect(after.ok).toBeTrue();
            if (before.ok && after.ok) {
                // Both read cleanly; the drift surfaces downstream as a digest mismatch.
                expect(before.taskContent).not.toBe(after.taskContent);
                const stubExecutor = {
                    run: async () => ({
                        exitCode: 0,
                        stdout: 'tree-sha-fixed\n',
                        stderr: '',
                        command: 'git',
                        args: [],
                        durationMs: 0,
                    }),
                } as unknown as import('@gobing-ai/ts-runtime').ProcessExecutor;
                const digestOf = (taskContent: string): Promise<string> =>
                    ProofInputFingerprint.compute({ taskContent, processExecutor: stubExecutor });
                expect(await digestOf(before.taskContent ?? '')).not.toBe(await digestOf(after.taskContent ?? ''));
            }
        } finally {
            await cleanup();
        }
    });
});
