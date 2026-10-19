/**
 * Workflow-consolidation absence proof (task 1252, feature D66, ADR-142).
 *
 * D66 deleted three bundled definitions — `feature-verification.yaml` (1246, folded into
 * `feature-lifecycle`'s `verifying` entry), `pr-review.yaml` and `wayfinder-resolution.yaml`
 * (1251, replaced by the flat `spur builder pr-*` verbs and a skill procedure). Each owning task
 * swept its own file targets; this is the repo-wide half: a doc, skill, command, script or config
 * that still names one of them tells a reader — or an agent — to run a definition that no longer
 * resolves.
 *
 * It runs inside `spur-check-feature` (the feature-scoped repo-wide pass, ADR-119), not the
 * per-task gate, which is the scope the invariant actually has.
 *
 * Scope note (R2): the hidden deprecated `spur builder pr <op>` alias is deliberately kept
 * (1251 R5). What is forbidden is a *caller* invoking it instead of the flat verbs.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';

/** Repo root: repo-wide-tests → repo. */
const REPO_ROOT = join(import.meta.dir, '..');

/**
 * The deleted workflow identities, as a reference spells them. `wayfinder-resolution` is banned
 * bare because the skill, its references and the budget entry all named it without `.yaml`; the
 * other two are banned as filenames only, because the bare `feature-verification` still names the
 * *pass* (its receipt files and the `persist-check` / `run-storage` families keep it — design §3.2)
 * and bare `pr-review` is a live `spur builder` verb.
 */
const RETIRED_IDENTITIES = ['feature-verification.yaml', 'pr-review.yaml', 'wayfinder-resolution'] as const;

/** `spur workflow run <deleted>` in any spelling, including the bare names the token scan allows. */
const RETIRED_INVOCATION = /workflow run\s+(feature-verification|pr-review|wayfinder-resolution)\b/;

/** The deprecated bare alias: `spur builder pr <op>`. `pr-<verb>` is a flat verb, not the alias. */
const BARE_PR_ALIAS = /spur builder pr\s+(preflight|push|ensure|ensure-pr|hygiene|request|wait|collect|status)\b/;

/** Surfaces that must call the flat verbs, never the alias (R2). */
const ALIAS_SCANNED = ['config/', 'plugins/sp/', 'packages/app/src/'];

/**
 * The alias keeps exactly one documentation home — the CLI catalog, which must list every surface
 * including deprecated ones, each with its flat-verb replacement (1251 R5). Documenting the alias
 * is the opposite of invoking it; every other page under the scanned prefixes calls a flat verb.
 */
const ALIAS_DOC = 'plugins/sp/skills/spur-cli/references/builder.md';

/**
 * Files allowed to name a retired identity. History is not rewritten (1252 out-of-scope), and an
 * attestation has to spell what it removed. Every entry carries its reason.
 */
const HISTORY_ALLOWLIST: ReadonlyArray<{ glob: string; reason: string }> = [
    { glob: 'config/workflow-candidates.json', reason: 'recorded retirement decisions required by the promotion gate' },
    { glob: 'CHANGELOG.md', reason: 'generated release history — the BREAKING note names what was removed' },
    { glob: 'docs/00_ADR.md', reason: 'ADR decisions and their numbers are never rewritten (constitution §6.1)' },
    { glob: 'docs/tasks*/**', reason: 'task records are dated execution evidence owned by `spur task`' },
    { glob: 'docs/features/**', reason: 'feature records are dated status owned by `spur feature`' },
    {
        glob: 'docs/{plans,reports,analysis,inventory,dogfood}/**',
        reason: 'dated planning, measurement, analysis, inventory and dogfood records',
    },
    {
        glob: 'docs/design/workflow-consolidation.md',
        reason: 'the design that removed them — naming each definition is its subject',
    },
    {
        glob: 'docs/design/{workflow-catalogue-refactor,workflow-shell-ownership,essential-workflow-checks,run-record-contract,harness-surface-governance}.md',
        reason: 'dated censuses and recorded consent justifications; each carries a D66 supersession pointer',
    },
    {
        glob: 'docs/design/workflow-composition-contract.md',
        reason: 'the retirement ledger — a ~~struck-through~~ row dated with its reason is how every prior deletion is recorded',
    },
    { glob: '.spur/memory/learnings.md', reason: 'append-only dated session learnings log' },
    { glob: '**/*.test.ts', reason: 'an attestation test has to spell what it pins removed (1251 precedent)' },
    {
        glob: 'apps/cli/tests/fixtures/**',
        reason: 'frozen golden fixtures record receipts produced before the retirement',
    },
];

const ALLOWED = HISTORY_ALLOWLIST.map((entry) => new Glob(entry.glob));
const isAllowed = (rel: string): boolean => ALLOWED.some((glob) => glob.match(rel));

/** Tracked files only: `git ls-files` keeps ignored paths and the generated bundle copies out. */
function trackedFiles(): string[] {
    return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 })
        .split('\0')
        .filter((rel) => rel.length > 0);
}

/** Read a tracked file, skipping anything git lists but the worktree no longer holds (a submodule). */
function readTracked(rel: string): string | null {
    const path = join(REPO_ROOT, rel);
    try {
        if (!statSync(path).isFile()) return null;
        return readFileSync(path, 'utf-8');
    } catch {
        return null;
    }
}

describe('D66 workflow consolidation — the deleted definitions are gone everywhere (1252 R1/R2)', () => {
    test('R1: every retired definition has a recorded retirement decision', () => {
        const ledger = JSON.parse(readFileSync(join(REPO_ROOT, 'config/workflow-candidates.json'), 'utf8')) as {
            retirements: { name: string; recordedBy: string; date: string; rationale: string }[];
        };
        for (const identity of RETIRED_IDENTITIES) {
            const record = ledger.retirements.find((entry) => entry.name === identity.replace(/\.yaml$/, ''));
            expect(record, `${identity} needs a retirement decision`).toBeDefined();
            expect(record?.recordedBy).toContain('ADR-142');
            expect(record?.date).toBe('2026-10-18');
            expect(record?.rationale.trim().length).toBeGreaterThan(0);
        }
    });

    test('R1: no tracked file outside the history allowlist names a retired workflow identity', () => {
        const offenders: string[] = [];
        for (const rel of trackedFiles()) {
            if (isAllowed(rel)) continue;
            const text = readTracked(rel);
            if (text === null) continue;
            for (const identity of RETIRED_IDENTITIES) {
                if (text.includes(identity)) offenders.push(`${rel}: ${identity}`);
            }
            if (RETIRED_INVOCATION.test(text)) offenders.push(`${rel}: spur workflow run <retired>`);
        }
        expect(offenders.sort()).toEqual([]);
    });

    test('R1: the three definitions no longer ship in the bundled workflow assets', () => {
        // Spelled in segments on purpose: `sp-runtime-path` forbids the joined literal, and the
        // directory listing is the honest check — a resurrected file fails here, not on a guess.
        const shipped = execFileSync('git', ['ls-files', join('config', 'workflows')], {
            cwd: REPO_ROOT,
            encoding: 'utf-8',
        })
            .split('\n')
            .filter((line) => line.length > 0);
        expect(shipped.filter((rel) => RETIRED_IDENTITIES.some((identity) => rel.endsWith(identity)))).toEqual([]);
    });

    test('R2: no config, plugin or app source invokes the deprecated bare `spur builder pr` alias', () => {
        const offenders: string[] = [];
        for (const rel of trackedFiles()) {
            if (rel === ALIAS_DOC) continue;
            if (!ALIAS_SCANNED.some((prefix) => rel.startsWith(prefix))) continue;
            const text = readTracked(rel);
            if (text !== null && BARE_PR_ALIAS.test(text)) offenders.push(rel);
        }
        // The alias's own registration (`apps/cli/src/commands/builder/pr.ts`) is outside every
        // scanned prefix, so it stays registered without an exemption clause.
        expect(offenders.sort()).toEqual([]);
    });

    test('every allowlist entry carries a reason and still matches a tracked file', () => {
        const tracked = trackedFiles();
        for (const { glob, reason } of HISTORY_ALLOWLIST) {
            expect(reason.trim().length, `${glob} must carry a reason`).toBeGreaterThan(0);
            const matcher = new Glob(glob);
            expect(
                tracked.some((rel) => matcher.match(rel)),
                `${glob} matches nothing — stale allowlist entry`,
            ).toBe(true);
        }
    });
});
