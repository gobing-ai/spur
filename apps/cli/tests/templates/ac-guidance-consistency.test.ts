import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';

// The AC-guidance comment lives as 8 synchronized copies (task 1061 diff exposed the
// coupling; 1063 pins it): 6 task templates under the bundled-config root, a condensed
// prose form in the sp style guide, and the escaped AC_PLACEHOLDER in task.test.ts.
// The shared body (everything through "checked at close.") must stay byte-identical;
// each template keeps a deliberate one-line closing tail, pinned below. Templates must
// stay self-contained (no generator), so drift is caught here instead.

const ROOT = join(import.meta.dir, '..', '..', '..', '..');
// Template copies resolve through the runtime's bundled-config root (sp-runtime-path
// forbids literal config/... paths); returns the repo's config/ dir in dev runs.
const configRoot = bundledConfigRoot();
if (!configRoot) {
    throw new Error('bundledConfigRoot() unresolved — templates not available in this context');
}
const readTemplate = (file: string) => readFileSync(join(configRoot, 'templates', 'task', file), 'utf8');
const TEMPLATE_FILES = ['brainstorm.md', 'feature-impl.md', 'issue.md', 'meta.md', 'review.md', 'standard.md'] as const;

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function extractTemplateComment(src: string, file: string): string {
    const m = src.match(/^### Acceptance Criteria\n+(<!--[\s\S]*?-->)\n/m);
    if (!m?.[1]) {
        throw new Error(`${file}: no AC-guidance comment found under "### Acceptance Criteria"`);
    }
    return m[1];
}

// Splits a copied comment at the shared-body anchor.
const BODY_ANCHOR = 'checked at close.';
function bodyAndTail(comment: string): { body: string; tail: string } {
    const i = comment.indexOf(BODY_ANCHOR);
    if (i < 0) {
        throw new Error(`comment missing shared-body anchor "${BODY_ANCHOR}"`);
    }
    return {
        body: comment.slice(0, i),
        tail: comment
            .slice(i + BODY_ANCHOR.length)
            .replace(/\s*-->\s*$/, '')
            .trim(),
    };
}

// Deliberate per-template closing tails — changing one is a cross-copy decision that
// must land here as a coordinated edit.
const EXPECTED_TAILS: Record<string, string> = {
    'brainstorm.md': 'Keep empty if not applicable.',
    'feature-impl.md': 'Do not leave placeholder AC here.',
    'issue.md': 'Use a regression scenario proving the bug is fixed.',
    'meta.md': 'Keep empty if not applicable.',
    'review.md': 'Keep empty until the review task becomes executable work.',
    'standard.md': 'Keep empty if this task has no objective AC yet.',
};

function drift(copies: Record<string, string>, reference: string): string[] {
    return Object.entries(copies)
        .filter(([, text]) => text !== reference)
        .map(([name]) => name);
}

describe('AC-guidance comment consistency across copies (1063)', () => {
    const reference = extractTemplateComment(readTemplate('standard.md'), 'standard.md');

    test('all six templates share the contract-pinned body with pinned tails', () => {
        const bodies: Record<string, string> = {};
        for (const file of TEMPLATE_FILES) {
            const expected = EXPECTED_TAILS[file];
            if (expected === undefined) {
                throw new Error(`no pinned closing tail for ${file}`);
            }
            const comment = extractTemplateComment(readTemplate(file), file);
            const { body, tail } = bodyAndTail(comment);
            bodies[file] = body;
            expect(tail, `${file} closing tail drifted`).toBe(expected);
        }
        expect(drift(bodies, bodyAndTail(reference).body)).toEqual([]);
    });

    test('AC_PLACEHOLDER in task.test.ts matches the templates (escaping-insensitive)', () => {
        const src = read('apps/cli/tests/commands/task.test.ts');
        const m = src.match(/const AC_PLACEHOLDER =\s*'((?:[^'\\]|\\.)*)';/);
        expect(m).toBeTruthy();
        // The only backslashes in either copy are JS-string escapes; stripping them
        // compares pure content, so escaping choices cannot mask real drift.
        const content = m?.[1]?.replace(/\\/g, '') ?? '';
        expect(content).toBe(reference.replace(/\\/g, ''));
    });

    test('condensed style-guide form keeps the load-bearing clauses', () => {
        const guide = read('plugins/sp/skills/spur-dev/references/ac-style-guide.md');
        for (const clause of [
            'owns the **feature subset**',
            'owns **task requirement bindings**',
            'ac_numbering: task-local',
        ]) {
            expect(guide).toContain(clause);
        }
    });

    test('a perturbed copy fails and names the drifted file (AC1 canary)', () => {
        const perturbed = `${reference}<!-- stray drift sentence -->`;
        expect(drift({ 'standard.md': reference, 'issue.md': perturbed }, reference)).toEqual(['issue.md']);
    });
});
