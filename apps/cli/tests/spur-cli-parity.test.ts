import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Live CLI parity is owned by `plugins/sp/tests/cli-surface-parity.test.ts`, which captures the
// source-local CLI in subprocesses. This suite checks the complementary SKILL/reference contract
// by path; importing every Commander registration here would duplicate that coverage and make a
// focused test run instrument the whole CLI graph.
const PLUGIN_ROOT = join(import.meta.dir, '..', '..', '..', 'plugins', 'sp');
const SKILLS_DIR = join(PLUGIN_ROOT, 'skills', 'spur-cli');
const REFS_DIR = join(SKILLS_DIR, 'references');

// Expected Tier A verb sets documented in sp:spur-cli references
const EXPECTED_TIER_A_VERBS = {
    task: [
        'create',
        'show',
        'update',
        'deps',
        'sections',
        'list',
        'refresh',
        'migrate',
        'refresh-roster',
        'batch-create',
        'record',
        'verdict',
        'check',
        'resolve',
        'path',
        'run-link',
    ],
    feature: ['create', 'show', 'update', 'advance', 'list', 'move', 'refresh', 'check', 'sync'],
    rule: ['run', 'validate', 'list', 'trace'],
    workflow: ['validate', 'run', 'continue', 'clean', 'cancel', 'list', 'trace'],
} satisfies Record<string, string[]>;

// Critical task verbs required by task 0317
const CRITICAL_TASK_VERBS = ['deps', 'sections', 'run-link'];

// Hardcoded verb floor for Tier B nouns — verbs asserted regardless of the
// reference table's content (task 0623 Q&A keeps the vocabulary pinned).
const TIER_B_VERB_FLOOR: Record<string, string[]> = {
    agent: ['run', 'loop', 'wait', 'list', 'doctor', 'create', 'edit', 'delete'],
    message: ['send', 'inbox', 'reply', 'watch'],
    team: ['assign', 'status', 'up', 'down', 'start', 'stop'],
    self: ['init', 'migrate', 'serve', 'status'],
};

// ---------------------------------------------------------------------------
// Tier B/C surface data, derived from the facade SKILL.md SSOT (task 0623).
//
// `plugins/sp/skills/spur-cli/SKILL.md` owns the noun routing table: Tier B
// nouns and their reference files come from `## Noun routing`; Tier C
// exclusions come from `### Tier C exclusion reasons`. A new Tier B noun lands
// here (and in the plugins/sp parity suite, which parses the same table)
// without editing this file. Verb vocabulary stays a hardcoded floor per
// task 0623 Q&A; verbs come from each reference's `## Verb map` table.
// ---------------------------------------------------------------------------

const SKILL_MD = readFileSync(join(SKILLS_DIR, 'SKILL.md'), 'utf8');

/** Split one Markdown table row (`| a | b | c |`) into trimmed cells. */
function tableCells(line: string): string[] {
    return line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
}

/** Table rows under `heading`, stopping at the next heading; skips separator + header rows. */
function tableUnderHeading(markdown: string, heading: string): string[][] {
    const lines = markdown.split('\n');
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start === -1) throw new Error(`heading not found in SKILL.md: ${heading}`);
    const rows: string[][] = [];
    let inTable = false;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (line.startsWith('#')) break;
        if (!line.startsWith('|')) {
            if (inTable) break;
            continue;
        }
        const cells = tableCells(line);
        if (!inTable) {
            inTable = true; // header row
            continue;
        }
        if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue; // separator
        rows.push(cells);
    }
    if (rows.length === 0) throw new Error(`no table rows under heading: ${heading}`);
    return rows;
}

/** Noun cell (`**a** / **b**`) → nouns; strips bold and backticks. */
function nounsFromCell(cell: string): string[] {
    return cell
        .split('/')
        .map((part) => part.replace(/[*`]/g, '').trim())
        .filter((noun) => noun.length > 0);
}

/** Reference cell → file name; `references/agent.md` → `agent.md`. */
function refFileFromCell(cell: string): string {
    const m = cell.match(/references\/([a-z-]+\.md)/);
    if (m?.[1] === undefined) throw new Error(`no reference file in routing cell: ${cell}`);
    return m[1];
}

interface RoutingRow {
    tier: string;
    nouns: string[];
    refFile: string | null;
}

/** Parsed `## Noun routing` rows (tier label stripped of bold). */
function routingRows(): RoutingRow[] {
    return tableUnderHeading(SKILL_MD, '## Noun routing').map((cells) => ({
        tier: (cells[0] ?? '').replace(/\*/g, '').trim(),
        nouns: nounsFromCell(cells[1] ?? ''),
        refFile: (cells[3] ?? '').includes('references/') ? refFileFromCell(cells[3] ?? '') : null,
    }));
}

// Tier B noun -> reference file, derived from the routing table.
const TIER_B_REF_FILES = Object.fromEntries(
    routingRows()
        .filter((row) => row.tier === 'Tier B')
        .map((row): [string, string] => {
            const noun = row.nouns[0];
            if (row.nouns.length !== 1 || noun === undefined || row.refFile === null) {
                throw new Error(`unparseable Tier B routing row: ${JSON.stringify(row)}`);
            }
            return [noun, row.refFile];
        }),
) satisfies Record<string, string>;

// Tier C excluded nouns, derived from the exclusion table's first column.
const EXCLUDED_TIER_C_NOUNS = tableUnderHeading(SKILL_MD, '### Tier C exclusion reasons').map((cells) =>
    (cells[0] ?? '').replace(/[*`]/g, '').trim(),
);

/** A noun's verbs from its reference's `## Verb map` table (first token of each verb cell). */
function verbsFromReference(refFile: string): string[] {
    const refRaw = readFileSync(join(REFS_DIR, refFile), 'utf8');
    return tableUnderHeading(refRaw, '## Verb map')
        .map((cells) => (cells[0] ?? '').replace(/`/g, '').split(/\s+/)[0]?.trim() ?? '')
        .filter((verb) => verb.length > 0);
}

// Tier B documented verbs: hardcoded floor (task 0623 Q&A) + reference table.
// The floor pins verbs the table format cannot express; the reference keeps
// the map in sync when the vocabulary grows.
const EXPECTED_TIER_B_VERBS = Object.fromEntries(
    Object.keys(TIER_B_REF_FILES).map((noun): [string, string[]] => {
        const refFile = TIER_B_REF_FILES[noun];
        if (refFile === undefined) throw new Error(`no reference file derived for noun: ${noun}`);
        return [noun, [...new Set([...(TIER_B_VERB_FLOOR[noun] ?? []), ...verbsFromReference(refFile)])]];
    }),
) satisfies Record<string, string[]>;

describe('sp:spur-cli reference <-> live CLI parity (R9)', () => {
    test('tasks/verbs.md documents all Tier A task verbs including deps, sections, run-link', () => {
        const verbsRaw = readFileSync(join(REFS_DIR, 'tasks', 'verbs.md'), 'utf8');
        const tasksRaw = readFileSync(join(REFS_DIR, 'tasks.md'), 'utf8');

        for (const verb of EXPECTED_TIER_A_VERBS.task) {
            expect(verbsRaw).toContain(verb);
            expect(tasksRaw).toContain(verb);
        }

        for (const critical of CRITICAL_TASK_VERBS) {
            expect(verbsRaw).toContain(`## \`${critical}`);
        }
    });

    test('tasks/section-editing.md lists every canonical + universal section from the domain SSOT', () => {
        const sectionEditRaw = readFileSync(join(REFS_DIR, 'tasks', 'section-editing.md'), 'utf8');
        // Derive the section vocabulary from the domain SSOT rather than a hardcoded copy, so this
        // test fails loud when the domain adds a canonical section the reference omits (e.g. `Root
        // Cause`, previously missed). A hardcoded list can only re-assert the same omission.
        const mdDocSrc = readFileSync(
            join(import.meta.dir, '..', '..', '..', 'packages', 'domain', 'src', 'planning', 'markdown-document.ts'),
            'utf8',
        );
        const extractConst = (name: string): string[] => {
            const block = mdDocSrc.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
            const body = block?.[1];
            if (body === undefined) throw new Error(`${name} not found in domain SSOT`);
            return [...body.matchAll(/'([^']+)'/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
        };
        const sections = new Set([...extractConst('TASK_CANONICAL_SECTIONS'), ...extractConst('UNIVERSAL_SECTIONS')]);
        // Sanity: the extraction actually parsed the SSOT (guards against a silent regex miss).
        expect(sections.has('Root Cause')).toBe(true);
        for (const section of sections) {
            expect(sectionEditRaw).toContain(section);
        }
    });

    test('features.md documents all Tier A feature verbs', () => {
        const featuresRaw = readFileSync(join(REFS_DIR, 'features.md'), 'utf8');
        for (const verb of EXPECTED_TIER_A_VERBS.feature) {
            expect(featuresRaw).toContain(`\`${verb}`);
        }
    });

    test('rules.md documents all Tier A rule verbs', () => {
        const rulesRaw = readFileSync(join(REFS_DIR, 'rules.md'), 'utf8');
        for (const verb of EXPECTED_TIER_A_VERBS.rule) {
            expect(rulesRaw).toContain(`\`${verb}\``);
        }
    });

    test('workflows.md documents all Tier A workflow verbs', () => {
        const workflowsRaw = readFileSync(join(REFS_DIR, 'workflows.md'), 'utf8');
        for (const verb of EXPECTED_TIER_A_VERBS.workflow) {
            expect(workflowsRaw).toContain(`\`${verb}\``);
        }
    });

    test('SKILL.md defines execute-first contract and Tier A/B/C routing', () => {
        const skillRaw = readFileSync(join(SKILLS_DIR, 'SKILL.md'), 'utf8');
        expect(skillRaw).toContain('Execute-First Contract');
        expect(skillRaw).toContain('Tier A');
        expect(skillRaw).toContain('Tier B');
        expect(skillRaw).toContain('Tier C');
        expect(skillRaw).toContain('deps');
        expect(skillRaw).toContain('sections');
    });

    test('Tier B reference files exist and document all expected verbs', () => {
        for (const [noun, refFile] of Object.entries(TIER_B_REF_FILES)) {
            const refPath = join(REFS_DIR, refFile);
            const refRaw = readFileSync(refPath, 'utf8');

            for (const verb of EXPECTED_TIER_B_VERBS[noun] ?? []) {
                expect(refRaw).toContain(`\`${verb}`);
            }
        }
    });

    test('SKILL.md routing table links Tier B noun references', () => {
        const skillRaw = readFileSync(join(SKILLS_DIR, 'SKILL.md'), 'utf8');

        for (const refFile of Object.values(TIER_B_REF_FILES)) {
            expect(skillRaw).toContain(`references/${refFile}`);
        }
    });

    test('SKILL.md explicitly excludes Tier C nouns with reasons', () => {
        const skillRaw = readFileSync(join(SKILLS_DIR, 'SKILL.md'), 'utf8');

        expect(skillRaw).toContain('Tier C');

        for (const noun of EXCLUDED_TIER_C_NOUNS) {
            expect(skillRaw).toContain(noun);
        }
    });

    test('agent.md cross-references the dispatch-surface rule and documents --model/--agent (R7)', () => {
        const agentRaw = readFileSync(join(REFS_DIR, 'agent.md'), 'utf8');

        expect(agentRaw).toContain('--model');
        expect(agentRaw).toContain('--agent');
        expect(agentRaw).toContain('dispatch-surface');
    });
});
