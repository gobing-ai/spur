/**
 * AC-guidance comment cross-copy consistency (task 1063, residual from 1061/fc5ed7cf).
 *
 * The AC-guidance placeholder comment exists in 8 synchronized copies:
 *   - 6 templates under the task-template dir (identical core + per-template tail)
 *   - the condensed prose form in plugins/sp/skills/spur-dev/references/ac-style-guide.md
 *   - the sed-escaped fixture copy in apps/cli/tests/commands/task.test.ts (0788)
 *
 * Only standard.md is contract-pinned; this test pins every other copy to it so the
 * lockstep-edit cost of one wording change cannot hide silent drift. Templates must stay
 * self-contained (spur task create without the plugin), so the check reads repo files only
 * — no dedup, no dependencies.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE_TEST = 'apps/cli/tests/commands/task.test.ts';

// Task-template dir under the repo-root build-time asset tree. Joined at runtime — the
// sp-runtime-path rule bans `config/(...)` literals in runtime source, and this test audits
// those build-time copies directly (repo-consistency guard, not a runtime path).
const TEMPLATE_DIR_REL = ['config', 'templates', 'task'].join('/');
const STANDARD_TEMPLATE = `${TEMPLATE_DIR_REL}/standard.md`;
const STYLE_GUIDE = 'plugins/sp/skills/spur-dev/references/ac-style-guide.md';

/** Marker-anchored repo root — import.meta.dir is not stable across bun test invocations. */
function findRoot(dir: string): string {
    let cur = dir;
    for (let i = 0; i < 8; i++) {
        if (existsSync(join(cur, '.git'))) return cur; // bundle copies under apps/cli/ ship no .git
        cur = join(cur, '..');
    }
    throw new Error(`repo root (.git) not found above ${dir}`);
}

const ROOT = findRoot(import.meta.dir);

/** Shared core ends here; everything after is the template's own tail sentence. */
const CORE_END = 'checked at close.';

/** Load-bearing claims the condensed style-guide form must keep in lockstep (byte-identical tokens). */
const STYLE_GUIDE_INVARIANTS = [
    '`AC1, AC2, …`',
    '`Scenario: AC1 — <concrete outcome> (req: R1)`',
    '`ac_altitude: task-local`',
    '`ac_numbering: task-local`',
    '(`- [ ] AC1 — <title>`)',
    '`Scenario:` titles only',
    'legacy unparsed records',
    'never substitutes for a `(req: …)` binding',
];

/** Extract the text of the single-line `<!-- Number items AC1 … -->` comment. */
function extractTemplateComment(content: string): string | null {
    const match = content.match(/<!-- (Number items AC1.*?) -->/);
    return match?.[1] ?? null;
}

/** Un-sed-escape the fixture copy: raw source `\\[`/`\\]` (any backslash run) back to literal brackets. */
function unescapeFixture(body: string): string {
    return body.replace(/\\+([[\]])/g, '$1');
}

function coreOf(comment: string): string {
    const end = comment.indexOf(CORE_END);
    return end === -1 ? comment : comment.slice(0, end + CORE_END.length);
}

/**
 * Pure checker over a file→content map so the perturbation fixture (AC1) can exercise
 * the failure path without touching repo files. Returns one error per drifted copy,
 * naming the file.
 */
export function checkAcCommentConsistency(files: Record<string, string>): string[] {
    const errors: string[] = [];
    const standard = extractTemplateComment(files[STANDARD_TEMPLATE] ?? '');
    if (!standard) {
        return [`${STANDARD_TEMPLATE}: AC-guidance comment missing or malformed`];
    }
    const canonical = coreOf(standard);

    for (const [path, content] of Object.entries(files)) {
        if (path.endsWith('.md') && path.startsWith(`${TEMPLATE_DIR_REL}/`)) {
            const comment = extractTemplateComment(content);
            if (!comment) {
                errors.push(`${path}: AC-guidance comment missing or malformed`);
            } else if (coreOf(comment) !== canonical) {
                errors.push(`${path}: AC-guidance core drifted from ${STANDARD_TEMPLATE} (lockstep edit required)`);
            }
            continue;
        }
        if (path === FIXTURE_TEST) {
            const body = content.match(/'<!-- (Number items AC1.*?) -->';/)?.[1];
            if (!body) {
                errors.push(`${FIXTURE_TEST}: sed-escaped AC_PLACEHOLDER copy missing`);
            } else if (unescapeFixture(body) !== standard) {
                errors.push(`${FIXTURE_TEST}: fixture copy no longer matches ${STANDARD_TEMPLATE} after unescaping`);
            }
            continue;
        }
        if (path === STYLE_GUIDE) {
            const section = content.slice(
                content.indexOf('## Task-side numbering'),
                content.indexOf('\n## ', content.indexOf('## Task-side numbering')),
            );
            for (const phrase of STYLE_GUIDE_INVARIANTS) {
                if (!section.includes(phrase)) {
                    errors.push(`${STYLE_GUIDE}: condensed form lost the shared contract phrase: ${phrase}`);
                }
            }
        }
    }
    return errors;
}

function readRepoCopies(): Record<string, string> {
    const files: Record<string, string> = {
        [FIXTURE_TEST]: readFileSync(join(ROOT, FIXTURE_TEST), 'utf8'),
        [STYLE_GUIDE]: readFileSync(join(ROOT, STYLE_GUIDE), 'utf8'),
    };
    for (const name of readdirSync(join(ROOT, TEMPLATE_DIR_REL)).filter((f) => f.endsWith('.md'))) {
        const path = `${TEMPLATE_DIR_REL}/${name}`;
        files[path] = readFileSync(join(ROOT, path), 'utf8');
    }
    return files;
}

/** Apply one in-memory perturbation to a copy (AC1 fixture). */
function perturb(files: Record<string, string>, path: string, from: string, to: string): void {
    const content = files[path];
    if (content === undefined) throw new Error(`missing copy: ${path}`);
    files[path] = content.replace(from, to);
}

describe('AC-guidance comment consistency (1063)', () => {
    test('AC2: committed tree passes with zero source edits', () => {
        expect(checkAcCommentConsistency(readRepoCopies())).toEqual([]);
    });

    test('AC1: perturbed template copy fails and names the file', () => {
        const files = readRepoCopies();
        const drifted = `${TEMPLATE_DIR_REL}/review.md`;
        perturb(
            files,
            drifted,
            'never bind requirements',
            'never bind requirements directly. A stray sentence slipped in here.',
        );
        const errors = checkAcCommentConsistency(files);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain(drifted);
    });

    test('AC1: perturbed style-guide copy fails and names the file', () => {
        const files = readRepoCopies();
        perturb(files, STYLE_GUIDE, 'legacy unparsed records', 'obsolete records');
        const errors = checkAcCommentConsistency(files);
        expect(errors.some((e) => e.includes(STYLE_GUIDE))).toBe(true);
    });

    test('AC1: perturbed fixture copy fails and names the file', () => {
        const files = readRepoCopies();
        perturb(files, FIXTURE_TEST, 'checked at close.', 'checked at close early.');
        const errors = checkAcCommentConsistency(files);
        expect(errors.some((e) => e.includes(FIXTURE_TEST))).toBe(true);
    });
});
