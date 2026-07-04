/**
 * sp plugin structural invariants (task 0161, ADR-028).
 *
 * The functional skill split decomposed the spur-dev umbrella into a thin orchestration spine plus
 * deep competency skills (sys-architecture, code-implementation, code-testing, code-verification,
 * spec-decomposition) and a single CLI facade (spur-cli). These assertions lock the invariants the
 * split depends on, so a future edit that violates one fails the gate instead of silently rotting:
 *
 *   R13  — cross-cutting.md is single-SSOT: exactly one physical copy across the plugin.
 *   R16a — disjoint trigger surfaces: the spine and the competency skills do not share a routing
 *          keyword that would make skill selection ambiguous.
 *   R16b — every cross-skill `sp:<skill>` reference names a skill that actually exists.
 *   R16c — relative markdown links inside skill files resolve to a real file.
 *   R16d — no retired skill/agent name is referenced anywhere in the plugin.
 *   R20  — the plugin is self-contained: no shipped file references `vendors/` or the external rd3
 *          plugin path. Research-time evidence is never a runtime/documentation dependency.
 *   R23  — repository ignore rules do not hide plugin skill entrypoints.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PLUGIN_ROOT = join(import.meta.dir, '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..');
const SKILLS_DIR = join(PLUGIN_ROOT, 'skills');
const AGENTS_DIR = join(PLUGIN_ROOT, 'agents');
const WORKFLOWS_DIR = join(REPO_ROOT, 'config', 'workflows');

/** Recursively collect every file under `dir` matching `pred`. */
function walk(dir: string, pred: (p: string) => boolean): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full, pred));
        } else if (pred(full)) {
            out.push(full);
        }
    }
    return out;
}

const allMarkdown = walk(PLUGIN_ROOT, (p) => p.endsWith('.md'));
const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

describe('sp plugin structure — functional split invariants (task 0161 / ADR-028)', () => {
    test('R13 — cross-cutting.md exists exactly once across the plugin', () => {
        const copies = allMarkdown.filter((p) => p.endsWith('cross-cutting.md'));
        expect(copies.map((p) => relative(PLUGIN_ROOT, p))).toEqual(['skills/spur-dev/references/cross-cutting.md']);
    });

    test('R16a — spine and competency skills have disjoint trigger surfaces', () => {
        // The work-unit keywords each competency owns; the spine must NOT trigger on these
        // (it dispatches the competency instead). This is the routing-ambiguity guard.
        const spineDesc = readFileSync(join(SKILLS_DIR, 'spur-dev', 'SKILL.md'), 'utf8')
            .split('---')[1] // frontmatter block
            .toLowerCase();
        // Phrases that belong to a competency's trigger, not the spine's.
        const competencyOnlyTriggers = [
            'decompose this',
            'create tasks from this',
            'write code',
            'measure coverage',
            "what's the right approach",
        ];
        for (const phrase of competencyOnlyTriggers) {
            expect(
                spineDesc.includes(phrase),
                `spine description must not trigger on competency phrase "${phrase}"`,
            ).toBe(false);
        }
    });

    test("R16b — references to this plugin's own skills name an existing skill", () => {
        // We only assert integrity of references to THIS plugin's skills/agents/commands — a
        // dangling `sp:<our-skill>` is the mis-route this guards. Cross-plugin names (e.g.
        // sp:product-management, sp:super-pm from the rd3 plugin) and slash-command names
        // (sp:dev-*, sp:rule-*, sp:workflow-*, sp:brainstorm-*, sp:prd-*) are out of scope here.
        const ownSkills = new Set(skillDirs);
        const ownAgents = new Set(
            readdirSync(AGENTS_DIR)
                .filter((f) => f.endsWith('.md'))
                .map((f) => f.replace(/\.md$/, '')),
        );
        const commandPrefixes = /^(dev|rule|workflow|brainstorm|prd|magent|agent|command|skill|hook)-/;
        const crossPluginOrCommand = (name: string) => commandPrefixes.test(name) || name === 'spur-init';
        const offenders: string[] = [];
        for (const file of allMarkdown) {
            const text = readFileSync(file, 'utf8');
            for (const match of text.matchAll(/\bsp:([a-z][a-z0-9-]+)\b/g)) {
                const name = match[1];
                if (crossPluginOrCommand(name)) continue;
                if (ownSkills.has(name) || ownAgents.has(name)) continue;
                // A `spur-` / `code-` / `sys-` / `expert-` prefixed name is unambiguously meant to be
                // one of THIS plugin's skills/agents — if it has no home, it is a dangling reference.
                if (/^(spur-|code-|sys-|spec-|expert-)/.test(name)) {
                    offenders.push(`${relative(PLUGIN_ROOT, file)} → sp:${name}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('R16c — relative markdown links inside plugin markdown files resolve', () => {
        const broken: string[] = [];
        const linkRe = /\]\((?!https?:|#)([^)]+\.md)(?:#[^)]*)?\)/g;
        for (const file of allMarkdown) {
            const raw = readFileSync(file, 'utf8');
            // Strip fenced code blocks and inline-code spans: a link inside backticks documents a
            // FORMAT (e.g. the roster-row example `[0110](0110_<slug>.md)`), it is not a navigable link.
            const text = raw.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
            const dir = join(file, '..');
            for (const match of text.matchAll(linkRe)) {
                // Skip obvious placeholders (angle-bracket vars like <slug>).
                if (match[1].includes('<')) continue;
                const target = join(dir, match[1]);
                try {
                    statSync(target);
                } catch {
                    broken.push(`${relative(PLUGIN_ROOT, file)} → ${match[1]}`);
                }
            }
        }
        expect(broken).toEqual([]);
    });

    test('R16d — no retired skill/agent name is referenced anywhere in the plugin', () => {
        // Retired in Wave A (noun-skills + noun-experts + expert-dev). The spur-cli facade and
        // expert-spur subagent replaced them; super-coder absorbed expert-dev's single-task role.
        const retired = [
            'spur-tasks',
            'spur-features',
            'spur-rules',
            'spur-workflows',
            'spur-plan',
            'expert-tasks',
            'expert-features',
            'expert-rules',
            'expert-workflows',
            'expert-dev',
        ];
        const offenders: string[] = [];
        for (const file of allMarkdown.filter((p) => !p.endsWith('skill-structure.test.ts'))) {
            const text = readFileSync(file, 'utf8');
            for (const name of retired) {
                if (new RegExp(`(?:sp:)?${name}\\b`).test(text)) {
                    offenders.push(`${relative(PLUGIN_ROOT, file)} → ${name}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('R20 — no shipped plugin file references vendors/ or the external rd3 plugin', () => {
        const offenders: string[] = [];
        // Research-time evidence only; never a runtime/documentation dependency (ADR-028d).
        const forbidden = [/\bvendors\//i, /cc-agents\/plugins\/rd3/i, /\/plugins\/rd3\//i, /\brd3\b/i];
        const files = walk(PLUGIN_ROOT, (p) => {
            if (p.endsWith('.test.ts')) return false;
            return /\.(md|ya?ml|json|ts)$/.test(p);
        });
        for (const file of new Set(files)) {
            const text = readFileSync(file, 'utf8');
            for (const re of forbidden) {
                if (re.test(text)) {
                    offenders.push(`${relative(PLUGIN_ROOT, file)} → ${re.source}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('the five competency skills and the spur-cli facade all exist', () => {
        for (const name of [
            'sys-architecture',
            'code-implementation',
            'code-testing',
            'code-verification',
            'spec-decomposition',
            'spur-cli',
        ]) {
            expect(skillDirs, `missing skill: ${name}`).toContain(name);
            statSync(join(SKILLS_DIR, name, 'SKILL.md')); // throws if absent
        }
    });

    test('R21 — dev-verify contract keeps AC as a first-class gate', () => {
        const command = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-verify.md'), 'utf8');
        const skill = readFileSync(join(SKILLS_DIR, 'code-verification', 'SKILL.md'), 'utf8');
        const verdictSchema = readFileSync(
            join(SKILLS_DIR, 'code-verification', 'references', 'verdict-schema.md'),
            'utf8',
        );

        expect(command).toContain('AC checking itself is automatic when AC exists');
        expect(command).toContain('Strict BDD lens');
        expect(skill).toContain('### Step 5 — Acceptance Criteria guard');
        expect(skill).toContain('| AC | Status | Evidence Type | Evidence |');
        expect(skill).toContain('Objective AC cannot be cleared by `llm-judge` alone');
        expect(verdictSchema).toContain('acceptanceCriteria?: Array');
        expect(verdictSchema).toContain("evidenceType: 'test' | 'command' | 'static-ref'");
    });

    test('R22 — dogfood reports include a mandatory ledger and computed cache methodology', () => {
        const command = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-dogfood.md'), 'utf8');
        const skill = readFileSync(join(SKILLS_DIR, 'dogfood-testing', 'SKILL.md'), 'utf8');
        const reportTemplate = readFileSync(
            join(SKILLS_DIR, 'dogfood-testing', 'references', 'report-template.md'),
            'utf8',
        );
        const monitorLedger = readFileSync(
            join(SKILLS_DIR, 'dogfood-testing', 'references', 'monitor-ledger.md'),
            'utf8',
        );

        expect(command).toContain('mandatory Monitor Ledger section');
        expect(skill).toContain('Monitor Ledger');
        expect(skill).toContain('recomputable from');
        expect(reportTemplate).toContain('### 3. Monitor Ledger');
        expect(reportTemplate).toContain('aggregate cache% = round((sum(Cached Tokens)');
        expect(monitorLedger).toContain('Anti-fiction rule');
        expect(monitorLedger).toContain('Cache % = round(Cached Tokens / (Fresh Tokens + Cached Tokens) * 100)');
        expect(monitorLedger).toContain('aggregate cache% = round(sum(Cached Tokens)');
    });

    test('R23 — ignore rules do not hide plugin skill entrypoints', () => {
        const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
        const unscopedSpurCliIgnores = gitignore
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line === 'spur-cli' || line === 'spur-cli/');

        expect(unscopedSpurCliIgnores).toEqual([]);
        statSync(join(SKILLS_DIR, 'spur-cli', 'SKILL.md'));
    });

    test('R24 — parallel-execution skill and references exist (task 0164)', () => {
        const skillDir = join(SKILLS_DIR, 'parallel-execution');
        statSync(join(skillDir, 'SKILL.md'));
        statSync(join(skillDir, 'references', 'fan-out-patterns.md'));
        statSync(join(skillDir, 'references', 'result-synthesis.md'));
    });

    test('R25 — sys-debugging skill and protocol reference exist (task 0165)', () => {
        const d = join(SKILLS_DIR, 'sys-debugging');
        statSync(join(d, 'SKILL.md'));
        statSync(join(d, 'references', 'debugging-protocol.md'));
    });

    test('R26 — code-review skill, self-review checklist, and review-lenses exist (task 0165)', () => {
        const d = join(SKILLS_DIR, 'code-review');
        statSync(join(d, 'SKILL.md'));
        statSync(join(d, 'references', 'self-review-checklist.md'));
        statSync(join(d, 'references', 'review-lenses.md'));
    });

    test('R27 — branch-workflow skill, branch-lifecycle, and worktree-patterns exist (task 0165)', () => {
        const d = join(SKILLS_DIR, 'branch-workflow');
        statSync(join(d, 'SKILL.md'));
        statSync(join(d, 'references', 'branch-lifecycle.md'));
        statSync(join(d, 'references', 'worktree-patterns.md'));
    });

    test('R28 — bundled workflows all carry the Spur schema ref and task-pipeline pauses for HITL', () => {
        for (const file of readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith('.yaml'))) {
            const text = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
            expect(text, `${file} should use the package schema ref`).toContain(
                '"$schema": "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"',
            );
        }

        const taskPipeline = readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8');
        expect(taskPipeline).toContain('  - id: approve\n');
        expect(taskPipeline).toContain('    pause: true\n');
        expect(taskPipeline).not.toContain('deferred until the globally-installed');
    });

    test('R29 — parallel batch contracts are not internally contradictory', () => {
        const superCoder = readFileSync(join(AGENTS_DIR, 'super-coder.md'), 'utf8');
        const executionBatch = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'execution-batch.md'), 'utf8');
        const devRunall = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-runall.md'), 'utf8');
        const devParallel = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-parallel.md'), 'utf8');

        expect(superCoder).toContain('sp:parallel-execution');
        expect(superCoder).not.toContain('Never run tasks in parallel (v1)');
        expect(executionBatch).toContain('optional parallel fan-out');
        expect(devRunall).toContain('--mode <sequential\\|parallel>');
        expect(devParallel).toContain('args="$ARGUMENTS"');
    });

    test('R30 — dev-idea, dev-wrap, dev-wrapall command docs exist and delegate to correct workflows', () => {
        for (const [cmd, workflow] of [
            ['dev-idea', 'idea-pipeline'],
            ['dev-wrap', 'wrapup-pipeline'],
            ['dev-wrapall', 'wrapup-pipeline'],
        ] as const) {
            const path = join(PLUGIN_ROOT, 'commands', `${cmd}.md`);
            const text = readFileSync(path, 'utf8');
            expect(text, `${cmd}.md should have frontmatter`).toContain('---\n');
            expect(text, `${cmd}.md should delegate to ${workflow}`).toContain(workflow);
        }
    });

    test('R31 — gate-checklists.md exists and is linked from spur-dev SKILL.md', () => {
        statSync(join(SKILLS_DIR, 'spur-dev', 'references', 'gate-checklists.md'));
        const skill = readFileSync(join(SKILLS_DIR, 'spur-dev', 'SKILL.md'), 'utf8');
        expect(skill).toContain('gate-checklists');
    });

    test('R32 — dev-operations.md registers idea, wrap, and wrapall operations', () => {
        const ops = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'dev-operations.md'), 'utf8');
        expect(ops).toContain('idea');
        expect(ops).toContain('wrap');
        expect(ops).toContain('wrapall');
    });

    test('R33 — cross-cutting.md includes all six required convention sections', () => {
        const cc = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'cross-cutting.md'), 'utf8');
        for (const section of [
            '## Auto-Decision Principles',
            '## Iron Laws',
            '## Design Approval Gate',
            '## Learning Log Convention',
            '## Session Checkpoint Convention',
            '## Pipeline Alignment',
        ]) {
            expect(cc, `cross-cutting.md should contain "${section}"`).toContain(section);
        }
    });

    test('R34 — idea-pipeline.yaml and wrapup-pipeline.yaml exist with valid schema', () => {
        for (const name of ['idea-pipeline', 'wrapup-pipeline']) {
            const path = join(WORKFLOWS_DIR, `${name}.yaml`);
            const text = readFileSync(path, 'utf8');
            expect(text, `${name}.yaml should have schema ref`).toContain(
                '"$schema": "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"',
            );
            expect(text, `${name}.yaml should be kind: state-machine`).toContain('kind: state-machine');
        }
    });

    test('R35 — brainstorm SKILL.md includes Design Approval Gate and needs_design signal', () => {
        const bs = readFileSync(join(SKILLS_DIR, 'brainstorm', 'SKILL.md'), 'utf8');
        expect(bs).toContain('## Design Approval Gate');
        expect(bs).toContain('needs_design');
    });

    test('R36 — every vars.* template reference in a workflow YAML is declared in its vars block', () => {
        // The engine's template resolver THROWS on an undefined var ("Workflow variable "x" is
        // not defined") — it does not fall through to the next transition. An undeclared var in
        // any guard or action therefore crashes the run at that state. Declaring a default in the
        // YAML's `vars:` block is the only safe shape (callers may override via --vars).
        const offenders: string[] = [];
        for (const file of readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith('.yaml'))) {
            const text = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
            const varsBlock = text.match(/^vars:\n((?:[ \t]+\S.*\n)+)/m)?.[1] ?? '';
            const declared = new Set([...varsBlock.matchAll(/^[ \t]+([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map((m) => m[1]));
            for (const match of text.matchAll(/\$\{vars\.([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) {
                const name = match[1];
                if (!declared.has(name)) offenders.push(`${file} → \${vars.${name}}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('R37 — idea/planning pipelines route HITL answers and keep transition guards side-effect free', () => {
        const idea = readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8');
        const planning = readFileSync(join(WORKFLOWS_DIR, 'planning-pipeline.yaml'), 'utf8');

        expect(idea).toContain('kind: file.read.into-var');
        expect(idea).toContain('  - id: batch-create-run\n');
        expect(idea).not.toContain('$(cat .spur/run/idea-feature-id.txt)');

        const transitionBlocks = idea.split('\ntransitions:\n')[1] ?? '';
        expect(transitionBlocks).not.toContain('task batch-create --file .spur/run/idea-task-batch.json');
        expect(transitionBlocks).not.toContain('> .spur/run/idea-ac-retry-count');
        expect(transitionBlocks).not.toContain('> .spur/run/idea-decompose-retry-count');

        const hitlAnswer = `$${'{vars.__hitlAnswer}'}`;
        for (const text of [idea, planning]) {
            expect(text).toContain(`test "${hitlAnswer}" = yes`);
            expect(text).toContain(`test "${hitlAnswer}" = no`);
            expect(text).toContain(`test "${hitlAnswer}" = cancel`);
        }
    });

    test('R38 — planning-pipeline declares agent dispatch vars used by agent.run steps', () => {
        const planning = readFileSync(join(WORKFLOWS_DIR, 'planning-pipeline.yaml'), 'utf8');
        for (const line of ['  agent: "omp"', '  spurBin: "spur"', '  stepTimeoutMs: "600000"']) {
            expect(planning).toContain(line);
        }
        const varsAgent = `$${'{vars.agent}'}`;
        const varsStepTimeout = `$${'{vars.stepTimeoutMs}'}`;
        const varsSpurBin = `$${'{vars.spurBin}'}`;
        expect(planning).toContain(`agent: ${varsAgent}`);
        expect(planning).toContain(`timeoutMs: ${varsStepTimeout}`);
        expect(planning).toContain(`${varsSpurBin} feature create`);
    });

    test('R39 — idea-pipeline discovery delegates needs_design criteria to sp:brainstorm', () => {
        const idea = readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8');
        const discovery = idea.split('  - id: discovery\n')[1]?.split('  - id: feature-create\n')[0] ?? '';
        expect(discovery).toContain(
            'The skill owns the approach-generation, design summary, and `needs_design` signal criteria',
        );
        expect(discovery).not.toContain('High / Medium / Low');
        expect(discovery).not.toContain('2-3 approaches');
    });

    test('R40 — idea-pipeline decompose prompt matches task-batch schema fields', () => {
        const idea = readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8');
        const decompose = idea.split('  - id: decompose\n')[1]?.split('  - id: batch-create\n')[0] ?? '';
        for (const field of [
            'name',
            'background',
            'requirements',
            'feature_id',
            'parent_wbs',
            'priority',
            'tags',
            'template',
        ]) {
            expect(decompose).toContain(field);
        }
        expect(decompose).toContain('Schema-permitted fields per entry');
        expect(decompose).toContain(
            'Acceptance Criteria, Design, and Plan sections are filled in by the per-task refine step',
        );
        expect(decompose).not.toContain('acceptance_criteria');
    });

    test('R41 — task-pipeline approve gate routes three HITL outcomes with no always fallback (0182 R1)', () => {
        const taskPipeline = readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8');

        // cancelled must be a declared terminal state, and the approve state's own
        // description must document all three outcomes (not just the happy path).
        expect(taskPipeline).toContain('  - cancelled\n');
        expect(taskPipeline).toContain('  - id: cancelled\n');

        // __hitlAnswer must be declared in vars: (R36's undeclared-var crash guard) and
        // default to empty until the approve state's hitl.confirm sets it.
        expect(taskPipeline).toContain('__hitlAnswer: ""');

        const transitionBlocks = taskPipeline.split('\ntransitions:\n')[1] ?? '';
        const approveBlock =
            transitionBlocks.split('# ── approve:')[1]?.split('# ── completion gate')[0] ?? transitionBlocks;

        const hitlAnswer = `$${'{vars.__hitlAnswer}'}`;
        expect(approveBlock).toContain(`test "${hitlAnswer}" = yes`);
        expect(approveBlock).toContain(`test "${hitlAnswer}" = no`);
        expect(approveBlock).toContain(`test "${hitlAnswer}" = cancel`);

        // Declaration order matters (yes checked before no before cancel) — assert the
        // three guard commands appear in that order, not just that all three exist.
        const yesIdx = approveBlock.indexOf(`test "${hitlAnswer}" = yes`);
        const noIdx =
            approveBlock.indexOf(`test "${hitlAnswer}" = no"`) !== -1
                ? approveBlock.indexOf(`test "${hitlAnswer}" = no"`)
                : approveBlock.indexOf(`test "${hitlAnswer}" = no'`);
        const cancelIdx = approveBlock.indexOf(`test "${hitlAnswer}" = cancel`);
        expect(yesIdx).toBeGreaterThan(-1);
        expect(noIdx).toBeGreaterThan(-1);
        expect(cancelIdx).toBeGreaterThan(-1);
        expect(yesIdx).toBeLessThan(noIdx);
        expect(noIdx).toBeLessThan(cancelIdx);

        // No bare `always` transition may originate from approve — every exit must be
        // gated on the captured answer (bug-750: an always edge silently approves).
        const approveFromBlocks = [
            ...transitionBlocks.matchAll(/ {2}- from: approve\n(?:.*\n)*?(?= {2}- from:|Z)/g),
        ].map((m) => m[0]);
        expect(approveFromBlocks.length).toBe(3);
        for (const block of approveFromBlocks) {
            expect(block).not.toContain('kind: always');
        }

        // R2a — implement step uses its own (longer) timeout budget, not the shared
        // stepTimeoutMs, and the rationale is documented inline (bugs 742/744/746/748).
        expect(taskPipeline).toContain('implementTimeoutMs: "1800000"');
        const implementBlock = taskPipeline.split('  - id: implement\n')[1]?.split('  - id: test\n')[0] ?? '';
        const varsImplementTimeout = `$${'{vars.implementTimeoutMs}'}`;
        expect(implementBlock).toContain(`timeoutMs: ${varsImplementTimeout}`);
        expect(implementBlock).not.toContain(`timeoutMs: \${vars.stepTimeoutMs}`);

        // R2c — anti-recursion guard: the implement prompt must warn against invoking
        // the pipeline (or full-mode dev-run) from inside the implement step itself.
        expect(implementBlock).toContain('NEVER invoke');
        expect(implementBlock).toContain('--mode implement');
    });

    test('R42 — skill description budgets stay within the 0187 aggregate/per-skill caps', () => {
        // Router skills (spine + facade) get a larger budget than the 14 competency/technique
        // skills; the aggregate cap keeps total context load bounded even as skills are added.
        const ROUTER_SKILLS = new Set(['spur-dev', 'spur-cli']);
        const NON_ROUTER_BUDGET = 350;
        const ROUTER_BUDGET = 600;
        const AGGREGATE_BUDGET = 4400;

        let aggregate = 0;
        const offenders: string[] = [];
        for (const skill of skillDirs) {
            const text = readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
            const frontmatter = text.split('---')[1] ?? '';
            const match = frontmatter.match(/^description:\s*([\s\S]*?)(?=\n[a-zA-Z_-]+:|\n?$)/m);
            expect(match, `${skill} SKILL.md must have a description field`).not.toBeNull();
            const raw = (match?.[1] ?? '').trim();
            const desc = raw.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
            aggregate += desc.length;
            const budget = ROUTER_SKILLS.has(skill) ? ROUTER_BUDGET : NON_ROUTER_BUDGET;
            if (desc.length > budget) {
                offenders.push(`${skill}: ${desc.length} chars (budget ${budget})`);
            }
        }
        expect(offenders).toEqual([]);
        expect(
            aggregate,
            `aggregate description chars (${aggregate}) must stay <= ${AGGREGATE_BUDGET}`,
        ).toBeLessThanOrEqual(AGGREGATE_BUDGET);
    });

    test('R43 — README command index lists every commands/*.md file exactly once (task 0187 AC6)', () => {
        const readmePath = join(PLUGIN_ROOT, 'README.md');
        statSync(readmePath);
        const readme = readFileSync(readmePath, 'utf8');
        const commandFiles = readdirSync(join(PLUGIN_ROOT, 'commands'))
            .filter((f) => f.endsWith('.md'))
            .map((f) => f.replace(/\.md$/, ''));

        // Scope the index check to the "### Command index" section only — commands are
        // legitimately cross-referenced elsewhere (skill-dispatch table, pipeline routing),
        // and those prose mentions must not count as index duplicates. The section runs from
        // the "### Command index" heading to the next "## " (top-level) heading.
        const lines = readme.split('\n');
        const startIdx = lines.findIndex((l) => l.trim() === '### Command index');
        expect(startIdx, 'README must have a "### Command index" section').toBeGreaterThanOrEqual(0);
        const endIdx = lines.findIndex((l, i) => i > startIdx && /^## /.test(l));
        const indexSection = lines.slice(startIdx, endIdx === -1 ? undefined : endIdx).join('\n');

        const missing: string[] = [];
        const duplicated: string[] = [];
        for (const name of commandFiles) {
            const re = new RegExp(`\\b${name}\\b`, 'g');
            const count = (indexSection.match(re) ?? []).length;
            if (count === 0) missing.push(name);
            if (count > 1) duplicated.push(`${name} (${count}x)`);
        }
        expect(missing, 'commands missing from README index').toEqual([]);
        expect(duplicated, 'commands listed more than once in README index').toEqual([]);
    });

    test('R44 — glossary.md exists exactly once and is linked from spur-dev SKILL.md (task 0187 R7/AC7)', () => {
        const copies = allMarkdown.filter((p) => p.endsWith('glossary.md'));
        expect(copies.map((p) => relative(PLUGIN_ROOT, p))).toEqual(['skills/spur-dev/references/glossary.md']);

        const spineSkill = readFileSync(join(SKILLS_DIR, 'spur-dev', 'SKILL.md'), 'utf8');
        expect(spineSkill).toContain('glossary.md');
    });
});
