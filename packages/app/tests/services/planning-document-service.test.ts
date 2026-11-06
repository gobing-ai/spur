import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningDocumentError, PlanningDocumentService } from '../../src/services/planning-document-service';

/**
 * Task 1300 — one application owner for the plan/design reads.
 *
 * Both transports delegate here, so these assertions cover the shared behaviour the legacy
 * aliases and the oRPC procedures now have in common: the path allowlists, the descending
 * plan / ascending satellite listing, title derivation and the actionable refusals.
 */

function fixture(): { root: string; service: PlanningDocumentService } {
    const root = mkdtempSync(join(tmpdir(), 'spur-planning-documents-'));
    mkdirSync(join(root, 'docs', 'plans'), { recursive: true });
    mkdirSync(join(root, 'docs', 'design'), { recursive: true });
    writeFileSync(join(root, 'docs', '02_ROADMAP.md'), '# 02 Roadmap — Spur\n\nbody\n');
    writeFileSync(join(root, 'docs', 'plans', '2026-06-10-older-plan.md'), '# Older Plan\n');
    writeFileSync(join(root, 'docs', 'plans', '2026-09-21-newer-plan.md'), '# Newer Plan\n');
    writeFileSync(join(root, 'DESIGN.md'), '# Design System\n');
    writeFileSync(join(root, 'docs', '04_DESIGN.md'), '# 04 Surface Design\n');
    writeFileSync(join(root, 'docs', 'design', 'alpha-feature.md'), '# Alpha Feature\n');
    writeFileSync(join(root, 'docs', 'design', 'beta-feature.md'), '# Beta Feature\n');
    const service = new PlanningDocumentService({ fs: createNodeFileSystem(root), cwd: root });
    return { root, service };
}

let cleanup: (() => void) | undefined;
afterEach(() => {
    cleanup?.();
    cleanup = undefined;
});

describe('PlanningDocumentService listing', () => {
    test('plans list roadmap first then newest-first, with derived titles', async () => {
        const { root, service } = fixture();
        cleanup = () => rmSync(root, { recursive: true, force: true });

        const { files, total } = await service.listPlans();
        expect(total).toBe(3);
        expect(files.map((f) => f.path)).toEqual([
            'docs/02_ROADMAP.md',
            'docs/plans/2026-09-21-newer-plan.md',
            'docs/plans/2026-06-10-older-plan.md',
        ]);
        expect(files[0]?.category).toBe('roadmap');
        expect(files[0]?.title).toBe('02 Roadmap — Spur');
        expect(files[1]?.category).toBe('plan');
        expect(files[1]?.name).toBe('2026-09-21-newer-plan.md');
    });

    test('designs list root, architecture then satellites alphabetically', async () => {
        const { root, service } = fixture();
        cleanup = () => rmSync(root, { recursive: true, force: true });

        const { files } = await service.listDesigns();
        expect(files.map((f) => [f.path, f.category])).toEqual([
            ['DESIGN.md', 'root'],
            ['docs/04_DESIGN.md', 'architecture'],
            ['docs/design/alpha-feature.md', 'satellite'],
            ['docs/design/beta-feature.md', 'satellite'],
        ]);
    });

    test('an absent directory lists empty rather than throwing', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-planning-documents-empty-'));
        cleanup = () => rmSync(root, { recursive: true, force: true });
        const service = new PlanningDocumentService({ fs: createNodeFileSystem(root), cwd: root });
        expect(await service.listPlans()).toEqual({ files: [], total: 0 });
        expect(await service.listDesigns()).toEqual({ files: [], total: 0 });
    });
});

describe('PlanningDocumentService reads and refusals', () => {
    test('a valid path returns the path, derived title and content', async () => {
        const { root, service } = fixture();
        cleanup = () => rmSync(root, { recursive: true, force: true });

        const plan = await service.showPlan('docs/plans/2026-09-21-newer-plan.md');
        expect(plan).toMatchObject({ ok: true, path: 'docs/plans/2026-09-21-newer-plan.md', title: 'Newer Plan' });
        const design = await service.showDesign('DESIGN.md');
        expect(design.title).toBe('Design System');
    });

    test('traversal and disallowed paths are refused as denied', async () => {
        const { root, service } = fixture();
        cleanup = () => rmSync(root, { recursive: true, force: true });

        for (const bad of ['../secret.md', 'docs/plans/../04_DESIGN.md', 'docs/tasks/1300_x.md']) {
            await expect(service.showPlan(bad)).rejects.toMatchObject({ code: 'denied' });
        }
        await expect(service.showDesign('docs/plans/2026-09-21-newer-plan.md')).rejects.toMatchObject({
            code: 'denied',
        });
    });

    test('a missing path is missing-path and an allowlisted absent file is not-found', async () => {
        const { root, service } = fixture();
        cleanup = () => rmSync(root, { recursive: true, force: true });

        await expect(service.showPlan(undefined)).rejects.toMatchObject({ code: 'missing-path' });
        await expect(service.showPlan('docs/plans/2099-01-01-absent.md')).rejects.toMatchObject({
            code: 'not-found',
        });
    });

    test('an absent filesystem context is refused as unavailable', async () => {
        const service = new PlanningDocumentService({});
        await expect(service.showPlan('docs/02_ROADMAP.md')).rejects.toBeInstanceOf(PlanningDocumentError);
        expect(await service.listPlans()).toEqual({ files: [], total: 0 });
    });
});
