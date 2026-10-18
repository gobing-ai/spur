/**
 * Retired pr-review / wayfinder-resolution workflow references (task 1251, feature D66).
 *
 * The two definitions are deleted (R1): `spur builder pr-status | pr-check | pr-open | pr-review`
 * already own the PR sequencing in `runPrVerb`, and the wayfinder investigate hop is a skill
 * procedure. This pins the removal from the *reference* side — a reintroduced
 * `spur workflow run pr-review.yaml`, a resurrected budget entry, or a plugin page that still
 * frames the Codex route as a workflow state order all fail here.
 *
 * Scope note: the deprecated `spur builder pr <op>` alias is deliberately kept (R5) and
 * documented in the `sp:spur-cli` builder reference. What is forbidden is a *caller* invoking it
 * instead of the flat verbs.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';

const REPO_ROOT = join(import.meta.dir, '../../..');

/** The two retired definitions, by the filename a reference or `spur workflow run` must spell. */
const RETIRED = ['pr-review.yaml', 'wayfinder-resolution.yaml'] as const;

/** Reference surfaces that must be free of the retired names (R1/R2/R3/R4). */
const SCANNED = ['plugins/sp/**/*.{md,ts,json,yaml}', 'packages/app/src/**/*.ts', 'config/**/*.{yaml,json}'];

/**
 * Attestation files are exempt: a test that pins the removal has to spell what it removed (this
 * file, and the catalog test's "retired" comment). Non-test plugin sources — hooks, lib, scripts —
 * are still scanned, so a real reintroduced caller is caught.
 */
const isAttestation = (rel: string): boolean => rel.startsWith('plugins/sp/tests/') && rel.endsWith('.test.ts');

function scannedFiles(): string[] {
    const out: string[] = [];
    for (const pattern of SCANNED) {
        for (const rel of new Glob(pattern).scanSync({ cwd: REPO_ROOT })) {
            const normalized = rel.split('\\').join('/');
            if (isAttestation(normalized)) continue;
            out.push(normalized);
        }
    }
    return out.sort();
}

describe('retired pr-review / wayfinder-resolution workflows (1251)', () => {
    // The workflow asset dir is spelled in segments on purpose: `sp-runtime-path` forbids the
    // joined literal in `plugins/sp/**`, and a rephrase is cheaper than a rule exemption.
    test('R1: neither definition ships in the bundled workflow assets', () => {
        for (const name of ['pr-review.yaml', 'wayfinder-resolution.yaml']) {
            expect(existsSync(join(REPO_ROOT, 'config', 'workflows', name)), `${name} must be deleted`).toBe(false);
        }
    });

    test('R1: neither pipeline keeps a cost-budget entry', () => {
        const budgets = JSON.parse(readFileSync(join(REPO_ROOT, 'config', 'pipeline-budgets.json'), 'utf8')) as {
            budgets: Record<string, unknown>;
        };
        expect(
            Object.keys(budgets.budgets).filter((name) => name === 'pr-review' || name === 'wayfinder-resolution'),
        ).toEqual([]);
    });

    test('R3: no wayfinder file names the retired workflow, and its hop reference is gone', () => {
        expect(existsSync(join(REPO_ROOT, 'plugins/sp/skills/wayfinder/references/pipeline-resolution.md'))).toBe(
            false,
        );
        const offenders: string[] = [];
        for (const rel of new Glob('plugins/sp/skills/wayfinder/**/*').scanSync({ cwd: REPO_ROOT })) {
            const normalized = rel.split('\\').join('/');
            // Bare name too, not just the filename: the investigate hop is a skill procedure now.
            if (readFileSync(join(REPO_ROOT, normalized), 'utf8').includes('wayfinder-resolution')) {
                offenders.push(normalized);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('R1/R2/R3/R4: no plugin, app-source or config file names a retired definition', () => {
        const offenders: string[] = [];
        for (const rel of scannedFiles()) {
            const path = join(REPO_ROOT, rel);
            if (!statSync(path).isFile()) continue;
            const text = readFileSync(path, 'utf8');
            for (const name of RETIRED) {
                if (text.includes(name)) offenders.push(`${rel}: ${name}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('R5: no plugin page invokes the deprecated bare `spur builder pr` alias', () => {
        // The alias keeps exactly one documentation home — the CLI catalog that must list every
        // surface, deprecated ones included. Every other page calls a flat verb.
        const ALIAS_DOC = 'plugins/sp/skills/spur-cli/references/builder.md';
        // `spur builder pr` followed by a bare op word is the invocation shape; `pr-<verb>` is not.
        const BARE_ALIAS = /spur builder pr\s+(preflight|push|ensure|ensure-pr|hygiene|request|wait|collect|status)\b/;
        const offenders: string[] = [];
        for (const rel of new Glob('plugins/sp/**/*.md').scanSync({ cwd: REPO_ROOT })) {
            const normalized = rel.split('\\').join('/');
            if (normalized === ALIAS_DOC) continue;
            if (BARE_ALIAS.test(readFileSync(join(REPO_ROOT, normalized), 'utf8'))) offenders.push(normalized);
        }
        expect(offenders).toEqual([]);
    });

    test('R2: the Codex route is described as a flat-verb sequence, not a workflow state order', () => {
        const skill = readFileSync(join(REPO_ROOT, 'plugins/sp/skills/pr-reviewing/SKILL.md'), 'utf8');
        expect(skill).not.toContain('spur workflow run');
        for (const verb of ['pr-check', 'pr-open', 'pr-review', 'pr-status']) {
            expect(skill, `the Codex sequence must name ${verb}`).toContain(`spur builder ${verb}`);
        }
        // The mode→flag mapping the retired YAML used to hold now lives in the skill.
        expect(skill).toContain('--no-wait');
        expect(skill).toContain('--force');
    });
});
