import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowAppService } from '../../src/services/workflow-service';

// 0614: warn-only composition advisory on `workflow validate` (ADR-069 amendment).
// Drives the private advisory through WorkflowAppService.validate(); temp dirs sit
// under /var/folders, away from any repo config, so no ancestor state can alter
// the measured findings.

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

const shellAction = (lines: number): string =>
    `      - kind: shell\n        options:\n          command: |\n${Array.from({ length: lines }, (_, i) => `            echo line-${i}\n`).join('')}`;

const sm = (body: string): string =>
    `name: advisory-flow\nkind: state-machine\ninitialState: start\nstates:\n  - id: start\n    onEnter:\n${body}\n  - id: done\ntransitions:\n  - from: start\n    to: done\nterminalStates:\n  - done\n`;

describe('workflow validate composition advisory', () => {
    test('shell action at 6 lines flags; 5 lines does not', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-comp-adv-'));
        try {
            await writeFile(join(dir, 'w6.yaml'), sm(shellAction(6)));
            const r6 = await new WorkflowAppService(makeCtx(dir)).validate(join(dir, 'w6.yaml'));
            expect(r6.valid).toBe(true);
            if (!r6.valid) return;
            expect(r6.composition?.findings).toHaveLength(1);
            const f = r6.composition?.findings[0];
            expect(f?.actionKey).toBe('start:onEnter:0');
            expect(f?.measure.kind).toBe('shell-lines');
            expect(f?.measure.measured).toBe(6);
            expect(f?.measure.threshold).toBe(6);

            await writeFile(join(dir, 'w5.yaml'), sm(shellAction(5)));
            const r5 = await new WorkflowAppService(makeCtx(dir)).validate(join(dir, 'w5.yaml'));
            expect(r5.valid).toBe(true);
            if (!r5.valid) return;
            expect(r5.composition?.findings).toHaveLength(0);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('comment and blank units are skipped; `;` splits units', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-comp-adv-'));
        try {
            // 4 real units + comments/blanks → measured 4 → below threshold.
            const cmd = ['# header comment', '', 'echo a', '# inline comment', 'echo b', '', 'echo c', 'echo d'].join(
                '\n',
            );
            await writeFile(
                join(dir, 'w.yaml'),
                sm(
                    `      - kind: shell\n        options:\n          command: |2\n${cmd
                        .split('\n')
                        .map((l) => (l === '' ? '' : `            ${l}`))
                        .join('\n')}`,
                ),
            );
            const r = await new WorkflowAppService(makeCtx(dir)).validate(join(dir, 'w.yaml'));
            expect(r.valid).toBe(true);
            if (!r.valid) return;
            expect(r.composition?.findings).toHaveLength(0);

            // same 4 real units + 2 more joined by `;` on one line → 6 units → flags.
            const cmd6 = `${cmd}\necho e; echo f`;
            await writeFile(
                join(dir, 'w2.yaml'),
                sm(
                    `      - kind: shell\n        options:\n          command: |2\n${cmd6
                        .split('\n')
                        .map((l) => (l === '' ? '' : `            ${l}`))
                        .join('\n')}`,
                ),
            );
            const r6 = await new WorkflowAppService(makeCtx(dir)).validate(join(dir, 'w2.yaml'));
            expect(r6.valid).toBe(true);
            if (!r6.valid) return;
            expect(r6.composition?.findings).toHaveLength(1);
            expect(r6.composition?.findings[0]?.measure.measured).toBe(6);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('non-slash agent.run input flags with severity bands; slash-pinned exempt', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-comp-adv-'));
        const ar = (input: string): string =>
            `      - kind: agent.run\n        options:\n          input: ${JSON.stringify(input)}\n          agent: omp\n          role: coder\n`;
        try {
            await writeFile(
                join(dir, 'w.yaml'),
                sm(ar('x'.repeat(150)) + ar('x'.repeat(500)) + ar('x'.repeat(2000)) + ar('/dev-run something')),
            );
            const r = await new WorkflowAppService(makeCtx(dir)).validate(join(dir, 'w.yaml'));
            expect(r.valid).toBe(true);
            if (!r.valid) return;
            const fs = r.composition?.findings ?? [];
            expect(fs).toHaveLength(3);
            const bySeverity = Object.fromEntries(fs.map((f) => [f.measure.severity, f.measure.measured]));
            expect(bySeverity.low).toBe(150);
            expect(bySeverity.medium).toBe(500);
            expect(bySeverity.high).toBe(2000);
            // slash-pinned input produced no finding
            expect(fs.every((f) => f.measure.kind === 'agent-run-chars')).toBe(true);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('baseline disposition files are ignored — the finding stays visible (0775 R1)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-comp-adv-'));
        try {
            await writeFile(join(dir, 'w.yaml'), sm(shellAction(6)));
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
            const r = await new WorkflowAppService(makeCtx(dir)).validate(join(dir, 'w.yaml'));
            expect(r.valid).toBe(true);
            if (!r.valid) return;
            // The retired suppression layer must not silently resurrect: a stale
            // baseline file cannot hide the advisory.
            expect(r.composition?.findings).toHaveLength(1);
            expect(r.composition?.findings[0]?.actionKey).toBe('start:onEnter:0');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('transition-flow definitions visit node actions; guards never flag', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-comp-adv-'));
        try {
            const flow = `name: flow\nkind: transition-flow\ninitialNode: start\nnodes:\n  - id: start\n    action:\n      kind: shell\n      options:\n        command: |\n${Array.from({ length: 6 }, (_, i) => `          echo n-${i}`).join('\n')}\n  - id: done\nterminalNodes: [done]\nedges:\n  - from: start\n    to: done\n`;
            await writeFile(join(dir, 'flow.yaml'), flow);
            const r = await new WorkflowAppService(makeCtx(dir)).validate(join(dir, 'flow.yaml'));
            expect(r.valid).toBe(true);
            if (!r.valid) return;
            expect(r.composition?.findings).toHaveLength(1);
            expect(r.composition?.findings[0]?.actionKey).toBe('start:onEnter:0');
            // edge guards are not node actions — replacing the action with a gated edge
            // (guard on the edge, no node action) yields no findings
            const guardFlow = `name: g\nkind: transition-flow\ninitialNode: start\nnodes:\n  - id: start\n  - id: done\nterminalNodes: [done]\nedges:\n  - from: start\n    to: done\n    condition:\n      kind: shell\n      options:\n        command: |\n${Array.from({ length: 8 }, (_, i) => `          echo g-${i}`).join('\n')}\n`;
            await writeFile(join(dir, 'g.yaml'), guardFlow);
            const g = await new WorkflowAppService(makeCtx(dir)).validate(join(dir, 'g.yaml'));
            if (g.valid) expect(g.composition?.findings).toHaveLength(0);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('exit-status invariance: valid stays valid with findings (advisory-only)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-comp-adv-'));
        try {
            await writeFile(join(dir, 'w.yaml'), sm(shellAction(20)));
            const r = await new WorkflowAppService(makeCtx(dir)).validate(join(dir, 'w.yaml'));
            expect(r.valid).toBe(true); // findings present, validity unchanged — that IS the contract
            if (!r.valid) return;
            expect(r.composition?.findings).toHaveLength(1);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
