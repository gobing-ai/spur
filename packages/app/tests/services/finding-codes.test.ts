import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tasksConfigSchema } from '@gobing-ai/spur-config';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { FeatureCheckService } from '../../src/services/feature-check';
import { ALL_FINDING_CODES, FINDING_CODES, isFindingCode } from '../../src/services/finding-codes';
import { TaskCheckService } from '../../src/services/task-check';

const matrix = {
    variants: {
        standard: {
            backlog: { required: ['Background'], forbidden: ['Solution', 'Review', 'Testing'] },
            todo: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
            wip: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
            testing: { required: ['Solution', 'Testing'], optional: ['Design', 'Review'] },
            done: { required: ['Solution', 'Testing', 'Review'], gate: true },
        },
        active: {
            active: { required: ['Goal', 'Acceptance Criteria'] },
        },
    },
};

// @ac:every finding carries a stable code
test('Every finding code in registry is valid and typed', () => {
    expect(ALL_FINDING_CODES.length).toBeGreaterThan(30);
    for (const code of ALL_FINDING_CODES) {
        expect(isFindingCode(code)).toBe(true);
    }
    expect(isFindingCode('invalid.code')).toBe(false);
    expect(FINDING_CODES.L3_PLAN_FORMAT).toBe('L3.plan-format');
});

// @ac:every finding carries a stable code
test('TaskCheckService and FeatureCheckService emit findings with stable codes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spur-0321-'));
    try {
        const fs = createNodeFileSystem();
        const tasksDir = join(dir, 'docs/tasks');
        const featuresDir = join(dir, 'docs/features');
        mkdirSync(tasksDir, { recursive: true });
        mkdirSync(featuresDir, { recursive: true });

        // Task with missing sections (L2), solution file line (L3), etc.
        const invalidTask = `---
status: wip
variant: standard
feature_id: F1
---

# 0001 Test Task

## Requirements
R1. First requirement
`;
        writeFileSync(join(tasksDir, '0001_test-task.md'), invalidTask);

        const taskService = new TaskCheckService(fs, matrix);
        const taskResult = await taskService.check(join(tasksDir, '0001_test-task.md'), '0001');

        expect(taskResult.findings.length).toBeGreaterThan(0);
        for (const finding of taskResult.findings) {
            expect(finding.code).toBeDefined();
            expect(isFindingCode(finding.code)).toBe(true);
        }

        // Feature with missing sections / BDD errors
        const invalidFeature = `---
id: F1
name: Feature One
status: active
priority: P1
---

# F1 Feature One

## Acceptance Criteria
Given invalid BDD syntax without scenario header
`;
        writeFileSync(join(featuresDir, 'F1_feature-one.md'), invalidFeature);

        const featureService = new FeatureCheckService(fs, matrix);
        const featureResult = await featureService.check(join(featuresDir, 'F1_feature-one.md'), 'F1', {
            tasksDir,
            featuresDir,
        });

        expect(featureResult.findings.length).toBeGreaterThan(0);
        for (const finding of featureResult.findings) {
            expect(finding.code).toBeDefined();
            expect(isFindingCode(finding.code)).toBe(true);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

// @ac:config overrides a finding severity
test('Config overrides a finding severity (off, error, warning)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spur-0321-'));
    try {
        const fs = createNodeFileSystem();
        const tasksDir = join(dir, 'docs/tasks');
        mkdirSync(tasksDir, { recursive: true });

        const taskContent = `---
schema_version: 1
name: Test Task
status: done
variant: standard
feature_id: F1
created_at: '2026-06-13T00:00:00.000Z'
updated_at: '2026-06-13T00:00:00.000Z'
---

# 0001 Test Task

## Solution
\`src/index.ts:10\`

## Testing
100% coverage

## Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P1 | \`src/index.ts:10\` | Test finding | Test rec |

- [ ] Unchecked item in body
`;
        const taskPath = join(tasksDir, '0001_test-task.md');
        writeFileSync(taskPath, taskContent);
        const taskService = new TaskCheckService(fs, matrix);

        // Baseline: L3.unchecked-checklist emitted as warning
        const baseline = await taskService.check(taskPath, '0001');
        const boxFinding = baseline.findings.find((f) => f.code === FINDING_CODES.L3_UNCHECKED_CHECKLIST);
        expect(boxFinding).toBeDefined();
        expect(boxFinding?.severity).toBe('warning');

        // Override 1: 'off' drops the finding completely
        const withOff = await taskService.check(taskPath, '0001', {
            severityOverrides: { [FINDING_CODES.L3_UNCHECKED_CHECKLIST]: 'off' },
        });
        expect(withOff.findings.some((f) => f.code === FINDING_CODES.L3_UNCHECKED_CHECKLIST)).toBe(false);

        // Override 2: 'error' elevates the warning finding to error
        const withError = await taskService.check(taskPath, '0001', {
            severityOverrides: { [FINDING_CODES.L3_UNCHECKED_CHECKLIST]: 'error' },
        });
        const elevated = withError.findings.find((f) => f.code === FINDING_CODES.L3_UNCHECKED_CHECKLIST);
        expect(elevated?.severity).toBe('error');

        // Override 3: 'warning' demotes an error finding (e.g. L4.feature-not-found)
        const withDemote = await taskService.check(taskPath, '0001', {
            severityOverrides: { [FINDING_CODES.L4_FEATURE_NOT_FOUND]: 'error' },
        });
        const demoted = withDemote.findings.find((f) => f.code === FINDING_CODES.L4_FEATURE_NOT_FOUND);
        expect(demoted?.severity).toBe('error');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

// @ac:unknown code in config is rejected
test('Unknown code in tasks config severity map is rejected', () => {
    const validConfig = {
        folders: {},
        active: 'docs/tasks',
        severity: {
            [FINDING_CODES.L3_PLAN_FORMAT]: 'off',
            [FINDING_CODES.L4_DESIGN_PLACEHOLDER]: 'warning',
        },
    };
    const validResult = tasksConfigSchema.safeParse(validConfig);
    expect(validResult.success).toBe(true);

    const invalidConfig = {
        folders: {},
        active: 'docs/tasks',
        severity: {
            'L9.unknown-code': 'off',
        },
    };
    const invalidResult = tasksConfigSchema.safeParse(invalidConfig);
    expect(invalidResult.success).toBe(false);
    if (!invalidResult.success) {
        expect(invalidResult.error.issues[0]?.message).toContain('Unknown finding code "L9.unknown-code"');
    }
});
