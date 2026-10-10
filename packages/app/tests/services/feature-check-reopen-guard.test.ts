// Task 1137 R1 / R5(a)(b) — fail-first tests for the `feature check --fix` reopen:
// with no transition port the check must NOT degrade to a raw frontmatter status
// write; it reports the actionable `feature-reopen-unavailable` error finding and
// leaves the file byte-identical. With a port the reopen still goes through the
// guarded transition (History line + repair entry).
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { FeatureCheckService } from '../../src/services/feature-check';
import { FeatureService } from '../../src/services/feature-service';
import { PlanningWriteService } from '../../src/services/planning-write-service';

const featureFile = (id: string, name: string, status: string): string =>
    [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `name: ${name}`,
        `status: ${status}`,
        'created_at: 2026-10-01T00:00:00Z',
        'updated_at: 2026-10-01T00:00:00Z',
        '---',
        `# ${id} ${name}`,
        '## Goal',
        'goal',
        '## Scope',
        'scope',
        '## Acceptance Criteria',
        'ac',
        '## Tasks',
        'tasks',
        '',
    ].join('\n');

const liveTask = (featureId: string): string =>
    [
        '---',
        'schema_version: 1',
        'wbs: "0900"',
        'name: probe',
        'status: todo',
        `feature_id: ${featureId}`,
        'variant: standard',
        '---',
        '# 0900. probe',
        '## Background',
        'b',
        '## Acceptance Criteria',
        'ac',
        '## Design',
        'd',
        '## Plan',
        'p',
    ].join('\n');

function setup(status: string) {
    const root = mkdtempSync(join(tmpdir(), 'spur-1137-reopen-'));
    const featuresDir = join(root, 'features');
    const tasksDir = join(root, 'tasks');
    mkdirSync(featuresDir, { recursive: true });
    mkdirSync(tasksDir, { recursive: true });
    const featFile = join(featuresDir, 'A_probe.md');
    writeFileSync(featFile, featureFile('A', 'Probe', status));
    writeFileSync(join(tasksDir, '0900_probe.md'), liveTask('A'));
    const fs = createNodeFileSystem(root);
    return { root, featuresDir, tasksDir, featFile, fs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('1137 R1 — feature check --fix never degrades to a raw status write', () => {
    test('AC1/R5(a): no transition port → byte-identical file + feature-reopen-unavailable error finding', async () => {
        const { featFile, featuresDir, tasksDir, fs, cleanup } = setup('verifying');
        try {
            const before = readFileSync(featFile, 'utf8');
            const svc = new FeatureCheckService(fs);
            const result = await svc.check(featFile, 'A', { featuresDir, tasksDirs: [tasksDir], fix: true });

            // No raw mutation: the lifecycle status is machine-owned by the transition path.
            expect(readFileSync(featFile, 'utf8')).toBe(before);
            const finding = result.findings.find((f) => f.code === 'feature-reopen-unavailable');
            expect(finding).toBeDefined();
            expect(finding?.severity).toBe('error');
            // The finding names the missing port and both recoveries (R1).
            expect(finding?.message).toContain('transition port');
            expect(finding?.message).toContain('spur feature check A --fix');
            expect(finding?.message).toContain('spur feature update A active');
            // No feature-reopen repair is reported for a reopen that never happened.
            expect(result.repairs?.some((r) => r.kind === 'feature-reopen')).toBeFalsy();
            expect(result.pass).toBe(false);
        } finally {
            cleanup();
        }
    });

    test('AC2/R5(b): with a transition port the reopen still goes through the guarded transition', async () => {
        const { root, featFile, featuresDir, tasksDir, fs, cleanup } = setup('verifying');
        try {
            const writeService = new PlanningWriteService({ fs });
            const featureSvc = new FeatureService({ fs, featuresDir, tasksDir, writeService });
            const svc = new FeatureCheckService(fs);
            const result = await svc.check(featFile, 'A', {
                featuresDir,
                tasksDirs: [tasksDir],
                fix: true,
                transitionPort: (id, to) => featureSvc.transition(id, to),
            });
            const reopen = result.repairs?.find((r) => r.kind === 'feature-reopen');
            expect(reopen).toBeDefined();
            const after = readFileSync(featFile, 'utf8');
            expect(after).toContain('status: active');
            // The transition write path appends exactly one History line (R1/AC2).
            const historyLines = after.split('\n').filter((l) => /verifying → active/.test(l));
            expect(historyLines).toHaveLength(1);
            // No unavailable-finding when the port is present.
            expect(result.findings.some((f) => f.code === 'feature-reopen-unavailable')).toBe(false);
            void root;
        } finally {
            cleanup();
        }
    });
});
