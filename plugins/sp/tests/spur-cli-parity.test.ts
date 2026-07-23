import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN_ROOT = join(import.meta.dir, '..');
const SKILLS_DIR = join(PLUGIN_ROOT, 'skills', 'spur-cli');
const REFS_DIR = join(SKILLS_DIR, 'references');

// Expected Tier A verb sets documented in sp:spur-cli references
const EXPECTED_TIER_A_VERBS: Record<string, string[]> = {
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
    feature: ['create', 'show', 'update', 'advance', 'list', 'move', 'refresh', 'check'],
    rule: ['run', 'validate', 'list', 'trace'],
    workflow: ['validate', 'run', 'continue', 'clean', 'cancel', 'list', 'trace'],
};

// Critical task verbs required by task 0317
const CRITICAL_TASK_VERBS = ['deps', 'sections', 'run-link'];

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
            if (!block) throw new Error(`${name} not found in domain SSOT`);
            return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
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
        expect(skillRaw).toContain('deps');
        expect(skillRaw).toContain('sections');
    });

    test('live CLI subcommands cover all documented Tier A verbs for each noun', async () => {
        const cliPath = join(import.meta.dir, '..', '..', '..', 'apps', 'cli', 'src', 'index.ts');

        for (const [noun, verbs] of Object.entries(EXPECTED_TIER_A_VERBS)) {
            const proc = Bun.spawnSync(['bun', cliPath, noun, '--help']);
            if (proc.exitCode !== 0) {
                console.error(`CLI error for ${noun}:`, proc.stderr.toString());
            }
            expect(proc.exitCode).toBe(0);
            const helpText = proc.stdout.toString();

            for (const verb of verbs) {
                // Every documented verb must be present in live CLI help output
                expect(helpText).toContain(verb);
            }
        }
    });
});
