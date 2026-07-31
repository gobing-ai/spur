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
    feature: ['create', 'show', 'update', 'advance', 'list', 'move', 'refresh', 'check', 'sync'],
    rule: ['run', 'validate', 'list', 'trace'],
    workflow: ['validate', 'run', 'continue', 'clean', 'cancel', 'list', 'trace'],
};

// Critical task verbs required by task 0317
const CRITICAL_TASK_VERBS = ['deps', 'sections', 'run-link'];

// Expected Tier B verb sets documented in sp:spur-cli references (task 0395)
const EXPECTED_TIER_B_VERBS: Record<string, string[]> = {
    agent: ['run', 'loop', 'list', 'doctor', 'create', 'edit', 'delete'],
    message: ['send', 'inbox', 'reply', 'watch'],
    team: ['assign', 'status', 'up', 'down', 'start', 'stop'],
    init: ['init'],
    status: ['status'],
    serve: ['serve'],
};

// Tier C nouns explicitly excluded from documentation with stated reasons (task 0395 R5)
const EXCLUDED_TIER_C_NOUNS = ['history', 'migrate', 'projects', 'help'];

// Tier B noun -> reference file mapping (init and status share init.md)
const TIER_B_REF_FILES: Record<string, string> = {
    agent: 'agent.md',
    message: 'message.md',
    team: 'team.md',
    init: 'init.md',
    status: 'init.md',
    serve: 'serve.md',
};

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
        expect(skillRaw).toContain('Tier C');
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
    test('Tier B reference files exist and document all expected verbs', () => {
        for (const [noun, refFile] of Object.entries(TIER_B_REF_FILES)) {
            const refPath = join(REFS_DIR, refFile);
            const refRaw = readFileSync(refPath, 'utf8');

            for (const verb of EXPECTED_TIER_B_VERBS[noun]) {
                expect(refRaw).toContain(`\`${verb}`);
            }
        }
    });

    test('live CLI subcommands cover all documented Tier B verbs for each noun', async () => {
        const cliPath = join(import.meta.dir, '..', '..', '..', 'apps', 'cli', 'src', 'index.ts');

        for (const [noun, verbs] of Object.entries(EXPECTED_TIER_B_VERBS)) {
            const proc = Bun.spawnSync(['bun', cliPath, noun, '--help']);
            expect(proc.exitCode).toBe(0);
            const helpText = proc.stdout.toString();

            for (const verb of verbs) {
                expect(helpText).toContain(verb);
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

    test('Tier B reference flags exist in live CLI (no phantom flags, R8)', async () => {
        const cliPath = join(import.meta.dir, '..', '..', '..', 'apps', 'cli', 'src', 'index.ts');

        // Group nouns by reference file (init and status share init.md)
        const refToNouns = new Map<string, string[]>();
        for (const [noun, refFile] of Object.entries(TIER_B_REF_FILES)) {
            const existing = refToNouns.get(refFile);
            if (existing) {
                existing.push(noun);
            } else {
                refToNouns.set(refFile, [noun]);
            }
        }

        for (const [refFile, nouns] of refToNouns) {
            const refRaw = readFileSync(join(REFS_DIR, refFile), 'utf8');

            // Extract --flag tokens from verb-map and flag-table rows only (lines
            // starting with |).  This avoids false positives from prose mentions
            // of other nouns' flags (e.g. init.md's post-scaffold validation
            // references `spur rule --preset`).
            const refFlags = new Set<string>();
            for (const line of refRaw.split('\n')) {
                if (!line.startsWith('|') || !line.includes('`--')) continue;
                for (const m of line.matchAll(/`(--[a-z][a-z-]*)/g)) {
                    refFlags.add(m[1]);
                }
            }

            // Collect CLI help for every noun sharing this reference + all verbs
            let allHelpText = '';
            for (const noun of nouns) {
                allHelpText += Bun.spawnSync(['bun', cliPath, noun, '--help']).stdout.toString();
                for (const verb of EXPECTED_TIER_B_VERBS[noun]) {
                    const vh = Bun.spawnSync(['bun', cliPath, noun, verb, '--help']);
                    allHelpText += `\n${vh.stdout.toString()}${vh.stderr.toString()}`;
                }
            }

            for (const flag of refFlags) {
                expect(allHelpText).toContain(flag);
            }
        }
    });

    // R6 phantom detection — Tier A nouns (task/feature/rule/workflow).
    // Symmetric to the Tier B phantom test above: a flag documented in a
    // Tier A reference that the live CLI no longer provides must fail.
    test('Tier A reference flags exist in live CLI (no phantom flags, R6)', async () => {
        const cliPath = join(import.meta.dir, '..', '..', '..', 'apps', 'cli', 'src', 'index.ts');

        const TIER_A_REF_FILES: Record<string, string[]> = {
            task: ['tasks.md', 'tasks/verbs.md'],
            feature: ['features.md'],
            rule: ['rules.md'],
            workflow: ['workflows.md'],
        };

        for (const [noun, refFiles] of Object.entries(TIER_A_REF_FILES)) {
            // Collect every `--flag` token from table rows across the noun's refs.
            const refFlags = new Set<string>();
            for (const refFile of refFiles) {
                const refRaw = readFileSync(join(REFS_DIR, refFile), 'utf8');
                for (const line of refRaw.split('\n')) {
                    if (!line.startsWith('|') || !line.includes('`--')) continue;
                    for (const m of line.matchAll(/`(--[a-z][a-z-]*)/g)) {
                        refFlags.add(m[1]);
                    }
                }
            }

            // Gather live CLI help for the noun and each of its Tier A verbs.
            let allHelpText = '';
            allHelpText += Bun.spawnSync(['bun', cliPath, noun, '--help']).stdout.toString();
            for (const verb of EXPECTED_TIER_A_VERBS[noun]) {
                const vh = Bun.spawnSync(['bun', cliPath, noun, verb, '--help']);
                allHelpText += `\n${vh.stdout.toString()}${vh.stderr.toString()}`;
            }

            for (const flag of refFlags) {
                expect(allHelpText).toContain(flag);
            }
        }
    }, 30000);
});
