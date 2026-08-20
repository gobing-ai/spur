import { describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import {
    createGitAlternateTree,
    extractFeatureProofData,
    extractTaskProofData,
    ProofInputFingerprint,
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
