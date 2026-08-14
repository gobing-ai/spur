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
 *   R16c — relative markdown links resolve to a real file and (when anchored) a heading; the
 *          root AGENTS.md doc-map rows resolve to existing docs/*.md (task 0514 R2).
 *   R16d — no retired skill/agent name is referenced anywhere in the plugin.
 *   R20  — the plugin is self-contained: no shipped file references `vendors/` or the external rd3
 *          plugin path. Research-time evidence is never a runtime/documentation dependency.
 *   R23  — repository ignore rules do not hide plugin skill entrypoints.
 *   R43  — README index tables list every shipped command/skill/agent exactly once (task 0514 R1).
 *   R3   — no exact duplicate structured catalog across shipped surfaces (task 0514 R3 / ADR-054).
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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

/** GitHub-style heading slug — matches validate-commands.ts anchor resolution (ADR-031/038). */
function slugifyHeading(heading: string): string {
    return heading
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number} -]/gu, '')
        .replaceAll(' ', '-');
}

/**
 * Valid in-file anchors: GitHub-style heading slugs plus explicit `**Anchor:** `#id`` directives
 * (the flag-glossary.md convention that lets a shared-flag entry expose a stable `#flag-<name>`
 * anchor independent of its heading text; honored by validate-commands.ts).
 */
const anchorCache = new Map<string, Set<string>>();
function anchorSet(file: string): Set<string> {
    let anchors = anchorCache.get(file);
    if (anchors === undefined) {
        const content = readFileSync(file, 'utf8');
        anchors = new Set<string>();
        for (const line of content.split('\n')) {
            if (/^#{1,6}\s+/.test(line)) anchors.add(slugifyHeading(line.replace(/^#+\s*/, '').trim()));
        }
        for (const match of content.matchAll(/^\*\*Anchor:\*\*\s*`#([^`]+)`/gm)) anchors.add(match[1]);
        anchorCache.set(file, anchors);
    }
    return anchors;
}

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

    test('R16c — relative markdown links resolve to a file and (when anchored) a heading', () => {
        const broken: string[] = [];
        const linkRe = /\]\((?!https?:|#)([^)]+\.md)(?:#([^)]*))?\)/g;
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
                    broken.push(`${relative(PLUGIN_ROOT, file)} → ${match[1]} (missing file)`);
                    continue;
                }
                // Task 0514 R2: `#fragment` must name a GitHub-style heading slug or an explicit
                // `**Anchor:** `#id`` directive in the target file.
                const anchor = match[2];
                if (anchor && !anchorSet(target).has(anchor)) {
                    broken.push(`${relative(PLUGIN_ROOT, file)} → ${match[1]}#${anchor} (no such heading/anchor)`);
                }
            }
        }
        expect(broken).toEqual([]);
    });

    test('R16c — root AGENTS.md doc-map rows resolve to existing docs/*.md (task 0514 R2)', () => {
        const agentsMd = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8');
        const docTargets = [...new Set([...agentsMd.matchAll(/`(docs\/[^`]+\.md)`/g)].map((m) => m[1]))];
        expect(docTargets.length, 'AGENTS.md must carry a doc-map').toBeGreaterThan(0);
        const missing = docTargets.filter((target) => {
            try {
                statSync(join(REPO_ROOT, target));
                return false;
            } catch {
                return true;
            }
        });
        expect(missing, 'AGENTS.md doc-map rows must resolve to existing files').toEqual([]);
    });

    test('R16d — no retired skill/agent name is referenced anywhere in the plugin', () => {
        // Retired in Wave A (noun-skills + noun-experts + expert-dev). The spur-cli facade and
        // expert-spur subagent replaced them; the batch-driver role now lives in super-planner (0391).
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

        // Thin-wrapper world (0308): the command carries only the delegation line; the AC-gate
        // contract lives in the dispatched skill. Asserted via structural markers (headings,
        // table header, schema union) — the evidenceType union excludes `llm-judge` by
        // construction, so no prose sentence is pinned.
        expect(command).toContain('Skill(skill="sp:code-verification", args="verify $ARGUMENTS")');
        expect(skill).toContain('### Step 8 — Strict BDD scenario lens');
        expect(skill).toContain('### Step 5 — Acceptance Criteria guard');
        expect(skill).toContain('| AC | Status | Evidence Type | Evidence |');
        expect(verdictSchema).toContain('acceptanceCriteria?: Array');
        expect(verdictSchema).toContain("evidenceType: 'test' | 'command' | 'static-ref'");
    });

    test('R21b — shippable readiness gate on verify/verifyall (default with --fix all)', () => {
        const verifyCmd = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-verify.md'), 'utf8');
        const verifyallCmd = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-verifyall.md'), 'utf8');
        const skill = readFileSync(join(SKILLS_DIR, 'code-verification', 'SKILL.md'), 'utf8');
        const ops = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'dev-operations.md'), 'utf8');

        for (const text of [verifyCmd, verifyallCmd]) {
            expect(text).toContain('--skip-shippable');
            expect(text).toMatch(/--skip-shipable/);
        }
        expect(skill).toContain('### Step 13 — Shippable readiness gate');
        expect(skill).toContain('Shippable: PASS');
        expect(skill).toContain('Shippable: FAIL');
        expect(skill).toContain('spur feature check');
        expect(ops).toContain('Shippable readiness');
        expect(ops).toContain('--skip-shippable');
    });

    test('R22 — dogfood reports include always-on dual-path delivery, mandatory ledger, and computed cache methodology', () => {
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

        // Protocol @1.1 — always-on dual artifacts + ledger (not gated on --save). Thin-wrapper
        // world (0308): the command delegates; the delivery contract lives in the skill.
        expect(command).toContain('Skill(skill="sp:dogfood-testing", args="$ARGUMENTS")');
        expect(skill).toContain('Always-on dual artifacts');
        expect(skill).toContain('Monitor Ledger');
        expect(skill).toContain('[Live:]');
        expect(reportTemplate).toContain('[Report:]');
        expect(skill).toContain('Monitor Ledger');
        expect(skill).toContain('finalize-or-abort');
        expect(skill).toContain('.spur/run/dogfood/');
        expect(skill).toContain('recomputable from');
        expect(reportTemplate).toContain('### 3. Monitor Ledger');
        expect(reportTemplate).toContain('Always-on dual artifacts');
        expect(reportTemplate).toContain('aggregate cache% = round((sum(Cached Tokens)');
        expect(reportTemplate).toContain('#### Cost');
        expect(monitorLedger).toContain('Anti-fiction rule');
        expect(monitorLedger).toContain('Disk SSOT');
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

    test('R24b — issue-finding skill, session-formats reference, and correct GENERATE CLI recipes', () => {
        const skillDir = join(SKILLS_DIR, 'issue-finding');
        const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
        const sessionFormats = readFileSync(join(skillDir, 'references', 'session-formats.md'), 'utf8');
        const command = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-find-issue.md'), 'utf8');
        const fixture = readFileSync(join(skillDir, 'examples', 'session-test-loop.jsonl'), 'utf8');
        const expected = JSON.parse(readFileSync(join(skillDir, 'examples', 'expected-findings.json'), 'utf8')) as {
            expectedCategories: Array<{ id: string; commandContains?: string; minIdenticalCommandRuns?: number }>;
        };
        statSync(join(skillDir, 'agents', 'openai.yaml'));

        // Thin command delegates to the skill SSOT.
        expect(command).toContain('Skill(skill="sp:issue-finding", args="$ARGUMENTS")');
        expect(command).toMatch(/argument-hint:.*\[<topic>\]/);
        expect(command).toContain('--source');
        expect(command).toContain('--severity');
        expect(command).toContain('--min-cost');
        expect(command).toContain('--create-task');
        expect(command).toContain('--json');

        // Optional topic + multi-source honesty live on the skill.
        expect(skill).toContain('[topic]');
        expect(skill).toContain('Smart positional');
        expect(skill).toContain('--source');
        expect(skill).toContain('--min-cost');
        expect(skill).toContain('Bottleneck severity');
        expect(skill).toContain('Task priority');
        expect(skill).toContain('session-formats.md');
        expect(skill).toContain('/sp:rule-scan');
        expect(skill).toContain('examples/session-test-loop.jsonl');
        expect(sessionFormats).toContain('~/.omp/agent/sessions/');
        expect(sessionFormats).toContain('~/.claude/projects/');
        expect(sessionFormats).toContain('spur history import');
        // 0506 R3: schema-first history bridge — one introspection query, importer authority,
        // no copied column contract.
        expect(sessionFormats).toContain('sqlite_schema');
        expect(sessionFormats).toContain('@gobing-ai/ts-llm-jsonl-importer');
        expect(sessionFormats).toContain('HISTORY_IMPORT_SCHEMA_SQL');
        // 0507 R3: selected-file bridge — source-local CLI, force-file mode, both discovery
        // roots, and the ETL-vs-raw signal split, on the skill SSOT (not the thin wrapper).
        expect(sessionFormats).toContain('agent-sessions');
        expect(sessionFormats).toContain('--mode force-file');
        expect(sessionFormats).toContain('history analyze --session');
        expect(sessionFormats).toContain('filename stem');
        // 0556 R3: data plane primary; raw JSONL fallback gated to exactly three conditions.
        expect(skill).toContain('spur history report --mode forensics');
        expect(skill).toContain('no typed mapper');
        expect(skill).toContain('do not retain');
        expect(skill).toContain('0492 R7');
        // Runtime-path boundary: no build-time config/{workflows,...} literals in skill packaging.
        expect(skill).not.toMatch(/config\/(plugins|rules|tasks|templates|workflows)/);
        expect(sessionFormats).not.toMatch(/config\/(plugins|rules|tasks|templates|workflows)/);

        // GENERATE must teach live CLI surface — assert only fenced bash recipes.
        const bashBlocks = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
        expect(bashBlocks.length).toBeGreaterThan(0);
        const bashJoined = bashBlocks.join('\n');
        expect(bashJoined).toContain('--template meta');
        expect(bashJoined).not.toContain('--template.meta');
        expect(bashJoined).not.toMatch(/--name\s/);
        expect(bashJoined).not.toContain('--section."');
        expect(bashJoined).toContain('--section Background --from-file');
        expect(skill).toContain('spur task update <wbs> --priority');
        // Task priority is P0–P3 (CLI); bottleneck severity is S0–S2.
        // Table cells escape pipes as \| — accept either escaped or raw form in prose.
        expect(skill.includes('--priority <P0\\|P1\\|P2\\|P3>') || skill.includes('--priority <P0|P1|P2|P3>')).toBe(
            true,
        );
        expect(skill).toContain('**S0**');
        expect(skill).toContain('**S1**');
        expect(skill).toContain('**S2**');

        // Fixture carries IDENTIFY signals for the documented categories.
        const categoryIds = expected.expectedCategories.map((c) => c.id);
        expect(categoryIds).toContain('test-loop');
        expect(categoryIds).toContain('guard');
        expect(categoryIds).toContain('git-red-herring');
        expect(categoryIds).toContain('compaction');
        const testCmd = 'bun test packages/app/tests/services/feature-check.test.ts';
        const testCmdHits = fixture.split('\n').filter((line) => line.includes(testCmd)).length;
        expect(testCmdHits).toBeGreaterThanOrEqual(3);
        expect(
            fixture.split('\n').filter((line) => line.includes('"type":"compaction"')).length,
        ).toBeGreaterThanOrEqual(6);
        expect(fixture).toContain('spur task check 0376');
        expect(fixture).toContain('git stash');
        expect(fixture).toContain('"type":"toolCall"');
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
        const superPlanner = readFileSync(join(AGENTS_DIR, 'super-planner.md'), 'utf8');
        const executionBatch = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'execution-batch.md'), 'utf8');
        const devRunall = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-runall.md'), 'utf8');
        const devParallel = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-parallel.md'), 'utf8');

        expect(superPlanner).toContain('sp:parallel-execution');
        expect(superPlanner).not.toContain('Never run tasks in parallel (v1)');
        expect(executionBatch).toContain('optional parallel fan-out');
        expect(devRunall).toContain('--mode <sequential|parallel>');
        expect(devRunall).toContain('--feature <id>');
        expect(devParallel).toContain('--feature <id>');
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

        // Guards reference vars by name so the value reaches the shell as env rather than as
        // command text (task 0435). The routing invariants asserted below are unchanged.
        const hitlAnswer = '$__hitlAnswer';
        for (const text of [idea, planning]) {
            expect(text).toContain(`test "${hitlAnswer}" = yes`);
            expect(text).toContain(`test "${hitlAnswer}" = no`);
            expect(text).toContain(`test "${hitlAnswer}" = cancel`);
        }
    });

    test('R38 — planning-pipeline declares agent dispatch vars used by agent.run steps', () => {
        const planning = readFileSync(join(WORKFLOWS_DIR, 'planning-pipeline.yaml'), 'utf8');
        // stepTimeoutMs aligned with task-pipeline headroom (1800000), not the old 600s default.
        for (const line of ['  agent: "omp"', '  spurBin: "spur"', '  stepTimeoutMs: "1800000"']) {
            expect(planning).toContain(line);
        }
        const varsAgent = `$${'{vars.agent}'}`;
        const varsStepTimeout = `$${'{vars.stepTimeoutMs}'}`;
        const varsSpurBin = `$${'{vars.spurBin}'}`;
        expect(planning).toContain(`agent: ${varsAgent}`);
        expect(planning).toContain(`timeoutMs: ${varsStepTimeout}`);
        expect(planning).toContain(`${varsSpurBin} feature create`);
        // Soft precheck + expectFile reliability contract (fleet reliability pass).
        // 0425 R4: non-entity-scoped artifacts are ${vars.__runId}-prefixed.
        expect(planning).toContain('plan-precheck.status');
        const planFeatureExpect = ['expectFile: .spur/run/', '$', '{vars.__runId}', '-plan-feature-id.txt'].join('');
        expect(planning).toContain(planFeatureExpect);
        // Design artifact path uses engine template vars.slug — build without bare ${...}
        // so biome noTemplateCurlyInString stays quiet on the test source.
        const designExpect = ['expectFile: docs/design/', '$', '{vars.slug}', '.md'].join('');
        expect(planning).toContain(designExpect);
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

        // Guards reference vars by name so the value reaches the shell as env rather than as
        // command text (task 0435). The routing invariants asserted below are unchanged.
        const hitlAnswer = '$__hitlAnswer';
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

        // R2c — anti-recursion (bug-742) is structural + skill-level, not YAML prose (ADR-043).
        // 1) Pipeline agent.run input is a pure slash command that already selects implement mode.
        // 2) The recursive-launch prohibition lives in the command/skill SSOT, not multi-line
        //    essays bolted onto the slash line (that fights centralized agentic structure).
        // Pure slash form (literal ${vars.wbs} in the YAML source).
        const pureImplementInput = `input: /sp:dev-run --mode implement $${'{vars.wbs}'} --auto`;
        expect(implementBlock).toContain(pureImplementInput);
        expect(implementBlock).toContain('requireDiff: true');
        // Input must not re-introduce free-form anti-recursion prose next to the slash.
        const inputLine =
            implementBlock
                .split('\n')
                .map((l) => l.trim())
                .find((l) => l.startsWith('input:')) ?? '';
        expect(inputLine).toBe(pureImplementInput);

        const codeImplSkill = readFileSync(join(SKILLS_DIR, 'code-implementation', 'SKILL.md'), 'utf8');
        const devRunCmd = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-run.md'), 'utf8');
        expect(codeImplSkill).toContain('NEVER invoke');
        expect(codeImplSkill).toContain('bug-742');
        expect(devRunCmd).toContain('NEVER invoke');
        expect(devRunCmd).toContain('--mode implement');

        // Quality-gate hop family (not /sp:dev-unit): soft probe + fixall + soft recheck.
        expect(taskPipeline).toContain('  - id: test-fix\n');
        expect(taskPipeline).toContain('  - id: test-recheck\n');
        expect(taskPipeline).toContain('qualityGateCmd:');
        expect(taskPipeline).toContain('qualityGateMaxFixAttempts:');
        const testBlock = taskPipeline.split('  - id: test\n')[1]?.split('  - id: test-fix\n')[0] ?? '';
        expect(testBlock).not.toContain('/sp:dev-unit');
        const testFixBlock = taskPipeline.split('  - id: test-fix\n')[1]?.split('  - id: test-recheck\n')[0] ?? '';
        // Pure slash fixall form (literal ${vars.qualityGateCmd} in YAML).
        const pureFixall = `input: /sp:dev-fixall "$${'{vars.qualityGateCmd}'}"`;
        expect(testFixBlock).toContain(pureFixall);
        // Green path: PASS probe → review without forcing a second full gate.
        expect(taskPipeline).toContain('from: test\n    to: review\n');
        // Exhausted fix attempts land on the failed terminal state.
        expect(taskPipeline).toContain('from: test-recheck\n    to: failed\n');
    });

    test('R42 — skill description budgets stay within the 0187 aggregate/per-skill caps', () => {
        // Router skills (spine + facade) get a larger budget than the 14 competency/technique
        // skills; the aggregate cap keeps total context load bounded even as skills are added.
        const ROUTER_SKILLS = new Set(['spur-dev', 'spur-cli']);
        const NON_ROUTER_BUDGET = 350;
        const ROUTER_BUDGET = 600;
        const AGGREGATE_BUDGET = 7950; // scales with skill count (28 skills incl. next-feature); per-skill caps below are the real bloat guard

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

    test('R43 — README index tables list every shipped command/skill/agent exactly once (task 0187 AC6, task 0514 R1)', () => {
        const readmePath = join(PLUGIN_ROOT, 'README.md');
        statSync(readmePath);
        const readme = readFileSync(readmePath, 'utf8');
        const lines = readme.split('\n');

        // Task 0514 R1: the three owning README index tables, each mapped to its shipped surface.
        // Only the first backticked name cell of each table row counts as an index entry — prose
        // mentions of a name elsewhere in the section (skill-dispatch table, pipeline routing)
        // must not register as duplicates or as indexed-without-a-target.
        const sections: Array<{
            heading: string;
            label: string;
            shipped: string[];
            hasTarget: (name: string) => boolean;
        }> = [
            {
                heading: '### Command index',
                label: 'commands',
                shipped: readdirSync(join(PLUGIN_ROOT, 'commands'))
                    .filter((f) => f.endsWith('.md'))
                    .map((f) => f.replace(/\.md$/, '')),
                hasTarget: (n) =>
                    statSync(join(PLUGIN_ROOT, 'commands', `${n}.md`), { throwIfNoEntry: false }) !== undefined,
            },
            {
                heading: '#### 1. Skills',
                label: 'skills',
                shipped: skillDirs,
                hasTarget: (n) => statSync(join(SKILLS_DIR, n, 'SKILL.md'), { throwIfNoEntry: false }) !== undefined,
            },
            {
                heading: '#### 3. Agents',
                label: 'agents',
                shipped: readdirSync(AGENTS_DIR)
                    .filter((f) => f.endsWith('.md'))
                    .map((f) => f.replace(/\.md$/, '')),
                hasTarget: (n) => statSync(join(AGENTS_DIR, `${n}.md`), { throwIfNoEntry: false }) !== undefined,
            },
        ];

        for (const { heading, label, shipped, hasTarget } of sections) {
            const startIdx = lines.findIndex((l) => l.trim().startsWith(heading));
            expect(startIdx, `README must have a "${heading}" section`).toBeGreaterThanOrEqual(0);
            // Command section runs to the next top-level heading; skill/agent sections run to the
            // next `#### ` subsection (they sit inside "### Entity design").
            const endIdx = lines.findIndex(
                (l, i) => i > startIdx && (heading.startsWith('### ') ? /^## /.test(l) : /^#### /.test(l)),
            );
            const sectionText = lines.slice(startIdx, endIdx === -1 ? undefined : endIdx).join('\n');

            const indexed: string[] = [];
            for (const line of sectionText.split('\n')) {
                if (!line.trim().startsWith('|')) continue;
                const firstCell = line.split('|')[1]?.trim() ?? '';
                const name = firstCell.match(/^`([^`]+)`/)?.[1];
                if (name) indexed.push(name);
            }

            const counts = new Map<string, number>();
            for (const name of indexed) counts.set(name, (counts.get(name) ?? 0) + 1);
            const missing = shipped.filter((n) => !counts.has(n));
            const duplicated = [...counts].filter(([, c]) => c > 1).map(([n, c]) => `${n} (${c}x)`);
            const noTarget = [...counts.keys()].filter((n) => !hasTarget(n));

            expect(missing, `${label} missing from README index`).toEqual([]);
            expect(duplicated, `${label} listed more than once in README index`).toEqual([]);
            expect(noTarget, `${label} indexed in README without a shipped file`).toEqual([]);
        }
    });

    test('R3 — no exact duplicate structured catalog across shipped surfaces (task 0514 R3 / ADR-054)', () => {
        // Mechanical duplication detection is limited to exact machine-comparable catalogs:
        // normalized markdown tables (>=2 data rows) and explicit lists of backticked machine
        // tokens (>=3 items). Arbitrary prose similarity is never a finding (ADR-054 amendment).
        // Test fixtures and eval samples are intentionally duplicated and are not shipped surfaces.
        const shippedMd = allMarkdown.filter(
            (p) => !p.includes(`${PLUGIN_ROOT}${sep}tests`) && !p.includes(`${PLUGIN_ROOT}${sep}evals`),
        );
        const seen = new Map<string, string[]>(); // normalized catalog -> relative paths

        for (const file of shippedMd) {
            const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '\n');
            const lines = text.split('\n');
            let i = 0;
            while (i < lines.length) {
                const isTable = lines[i].trim().startsWith('|');
                const isBullet = !isTable && /^\s*[-*]\s+/.test(lines[i]);
                if (!isTable && !isBullet) {
                    i++;
                    continue;
                }
                const block: string[] = [];
                if (isTable) {
                    while (i < lines.length && lines[i].trim().startsWith('|')) {
                        block.push(lines[i].trim());
                        i++;
                    }
                    const rows = block.map((l) =>
                        l
                            .slice(1, -1)
                            .split('|')
                            .map((c) => c.trim().replace(/\s+/g, ' ')),
                    );
                    const dataRows = rows.filter((r) => !r.every((c) => /^-+$/.test(c)));
                    if (dataRows.length >= 2) {
                        const key = JSON.stringify(dataRows);
                        const rel = relative(PLUGIN_ROOT, file);
                        if (!seen.has(key)) seen.set(key, []);
                        const seenList = seen.get(key);
                        if (seenList !== undefined && !seenList.includes(rel)) seenList.push(rel);
                    }
                } else {
                    while (i < lines.length) {
                        const m = lines[i].match(/^\s*[-*]\s+(.*)$/);
                        if (!m) break;
                        block.push(m[1].trim());
                        i++;
                    }
                    if (block.length >= 3 && block.every((b) => b.startsWith('`'))) {
                        const key = JSON.stringify(block.map((c) => c.trim().replace(/\s+/g, ' ')));
                        const rel = relative(PLUGIN_ROOT, file);
                        if (!seen.has(key)) seen.set(key, []);
                        const seenList = seen.get(key);
                        if (seenList !== undefined && !seenList.includes(rel)) seenList.push(rel);
                    }
                }
            }
        }

        const duplicates = [...seen].filter(([, files]) => files.length > 1).map(([, files]) => files.join('; '));
        expect(duplicates, 'exact duplicate structured catalog on multiple shipped surfaces').toEqual([]);
    });

    test('R44 — glossary.md exists exactly once and is linked from spur-dev SKILL.md (task 0187 R7/AC7)', () => {
        const copies = allMarkdown.filter((p) => p.endsWith('/glossary.md'));
        expect(copies.map((p) => relative(PLUGIN_ROOT, p))).toEqual(['skills/spur-dev/references/glossary.md']);

        const spineSkill = readFileSync(join(SKILLS_DIR, 'spur-dev', 'SKILL.md'), 'utf8');
        expect(spineSkill).toContain('glossary.md');
    });

    test('R45 — spur-init Phase 1.6 rule glob adaptation probe is owned by sp:spur-cli init reference (task 0188 ownership contract)', () => {
        // The ownership contract (04_DESIGN.md §1.1) requires /sp:spur-init to adapt
        // recommended-pre-check globs to the project's layout instead of shipping a broken probe.
        // Thin-wrapper world (0308): the command carries only the delegation line; the Phase 1.6
        // contract lives in the skill reference.
        const initRef = readFileSync(join(SKILLS_DIR, 'spur-cli', 'references', 'init.md'), 'utf8');

        // Phase 1.6 section exists and names the probe.
        expect(initRef, 'init.md must declare a Phase 1.6 rule glob adaptation section').toContain(
            '### Phase 1.6 — Rule glob adaptation',
        );
        expect(initRef).toContain('recommended-pre-check');

        // The LLM-as-judge framing: the executing agent inspects the tree and rewrites globs.
        expect(initRef, 'Phase 1.6 must frame the agent as the LLM-as-judge').toContain('LLM-as-judge');

        // Adapted rules land as local-layer overlays, NOT scaffold files.
        expect(initRef).toContain('.spur/rules/<category>/');
        expect(initRef, 'Phase 1.6 must state the local-layer shadowing invariant (first-layer-wins)').toContain(
            'first-layer-wins',
        );

        // The old "dogfood artifact" excuse must be gone — it papered over a real probe gap.
        expect(initRef, 'init.md must NOT dismiss the probe as a dogfood artifact').not.toContain('dogfood');
        expect(initRef).not.toContain('intentionally NOT a probe');
    });

    test('R46 — gate-bearing skills carry the anti-rationalization anatomy (task 0214 R1)', () => {
        // Behavioral counter-pressure layer (0214 R1): sp has strong DETERMINISTIC gates but no
        // human-pressure counter-layer. Each load-bearing skill must carry a "Common
        // Rationalizations" table (excuse → factual rebuttal) and a "Red Flags" list (observable
        // violation signals). Structural presence + minimum row/item counts are locked here so a
        // future edit that strips the anatomy fails the gate instead of silently rotting.
        const loadBearing = [
            'code-verification',
            'test-driven-development',
            'sys-debugging',
            'code-implementation',
            'spec-decomposition',
            'code-review',
            'sys-architecture',
            'brainstorm',
            'wayfinder',
        ];
        const sectionBody = (text: string, heading: string): string | null => {
            const start = text.indexOf(`\n## ${heading}\n`);
            if (start === -1) return null;
            const after = text.indexOf('\n## ', start + 1);
            return text.slice(start, after === -1 ? undefined : after);
        };
        const offenders: string[] = [];
        for (const skill of loadBearing) {
            const text = readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
            const cr = sectionBody(text, 'Common Rationalizations');
            const rf = sectionBody(text, 'Red Flags');
            if (cr === null) {
                offenders.push(`${skill}: missing "## Common Rationalizations"`);
                continue;
            }
            if (rf === null) {
                offenders.push(`${skill}: missing "## Red Flags"`);
                continue;
            }
            // Data rows = pipe-rows minus the header row and the |---| separator row.
            const pipeRows = cr.split('\n').filter((l) => l.trim().startsWith('|'));
            const separators = pipeRows.filter((l) => /^\|[\s:|-]+\|?$/.test(l.trim())).length;
            const dataRows = pipeRows.length - separators - 1; // minus header row
            if (dataRows < 3) offenders.push(`${skill}: Common Rationalizations has ${dataRows} rows (need >= 3)`);
            const flagItems = rf.split('\n').filter((l) => l.trim().startsWith('- ')).length;
            if (flagItems < 3) offenders.push(`${skill}: Red Flags has ${flagItems} items (need >= 3)`);
        }
        expect(offenders).toEqual([]);
    });

    test('R47 — verification-before-completion rule exists and is referenced from verify/implement/test (0214 R2)', () => {
        // Universal honesty gate (0214 R2): a cross-cutting section generalizes Iron Law 7 to every
        // completion claim, carries a Red-Flags table, and is referenced from the pipeline verify
        // step plus at least the implement and test skills.
        const cc = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'cross-cutting.md'), 'utf8');
        expect(cc).toContain('## Verification Before Completion');
        expect(cc).toContain('Red Flags — an unverified claim');
        // The section carries a Red-Flags table (a "| ... | ... |" row beyond the header).
        const vbc = cc.slice(cc.indexOf('## Verification Before Completion'));
        const tableRows = vbc.split('\n').filter((l) => l.trim().startsWith('|'));
        expect(tableRows.length).toBeGreaterThanOrEqual(5); // header + separator + >= 3 red-flag rows

        const anchor = 'cross-cutting.md#verification-before-completion';
        for (const skill of ['code-verification', 'code-implementation', 'code-testing']) {
            const text = readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
            expect(text, `${skill} must reference ${anchor}`).toContain(anchor);
        }
    });

    test('R48 — Wave 2 competencies + review enrichment landed (0214 R4/R5/R6)', () => {
        // R4: doubt-driven-development skill — five-step loop, artifact-not-claim rule, bounded stop,
        // doubt-theater red flag.
        const doubt = readFileSync(join(SKILLS_DIR, 'doubt-driven-development', 'SKILL.md'), 'utf8');
        for (const marker of ['CLAIM', 'EXTRACT', 'DOUBT', 'RECONCILE', 'STOP']) {
            expect(doubt, `doubt-driven-development must document the ${marker} step`).toContain(marker);
        }
        expect(doubt).toContain('artifact + contract');
        expect(doubt).toContain('NOT the claim');
        expect(doubt).toContain('3 cycles');
        expect(doubt.toLowerCase()).toContain('doubt theater');

        // R5: source-driven-development is the single sp owner; the two questions are distinguished.
        const source = readFileSync(join(SKILLS_DIR, 'source-driven-development', 'SKILL.md'), 'utf8');
        expect(source).toContain('single sp owner');
        // Both questions are numbered bold labels (structured markers), not free prose.
        expect(source).toContain('**Does the API exist?**');
        expect(source).toContain('**Am I using it correctly under its contract?**');
        // Overlap resolved: brainstorm delegates to the sp owner, not the external cc: skill.
        const brainstorm = readFileSync(join(SKILLS_DIR, 'brainstorm', 'SKILL.md'), 'utf8');
        expect(brainstorm).toContain('sp:source-driven-development');
        expect(brainstorm).not.toContain('cc:anti-hallucination');

        // R6: code-review references carry the five review-depth subsections, in sp vocabulary.
        const lenses = readFileSync(join(SKILLS_DIR, 'code-review', 'references', 'review-lenses.md'), 'utf8');
        for (const section of [
            '## Structural Remedies',
            '## Change Sizing',
            '## Honesty in Review',
            '## Dead-Code Hygiene',
            '## Dependency Discipline',
        ]) {
            expect(lenses, `review-lenses.md must contain "${section}"`).toContain(section);
        }
    });

    test('R49 — Wave 3 enrichment landed (0214 R7/R8/R9)', () => {
        // R7: sys-debugging hardening — untrusted error output, non-reproducible decision tree,
        // instrumentation keep/remove — with the feedback-loop-first Phase 1 unchanged.
        const debug = readFileSync(join(SKILLS_DIR, 'sys-debugging', 'SKILL.md'), 'utf8');
        expect(debug, 'Phase 1 must remain feedback-loop-first').toContain('### Phase 1 — Build the feedback loop');
        expect(debug).toContain('Error output is untrusted data');
        expect(debug).toContain('Non-reproducible bugs — the decision tree');
        expect(debug).toContain('Instrumentation — keep vs remove');

        // R8: decision-brief SSOT exists and is referenced from the three HITL sites.
        const brief = join(SKILLS_DIR, 'spur-dev', 'references', 'decision-brief.md');
        statSync(brief);
        const briefText = readFileSync(brief, 'utf8');
        expect(briefText).toContain('# Decision-Brief Format');
        expect(briefText.toLowerCase()).toContain('recommendation'); // recommendation is mandatory
        for (const [label, p] of [
            ['brainstorm', join(SKILLS_DIR, 'brainstorm', 'SKILL.md')],
            ['dev-refine (refine op)', join(SKILLS_DIR, 'spur-dev', 'references', 'dev-operations.md')],
            ['decomposition', join(SKILLS_DIR, 'spec-decomposition', 'references', 'decomposition.md')],
        ] as const) {
            expect(readFileSync(p, 'utf8'), `${label} must reference decision-brief.md`).toContain('decision-brief.md');
        }

        // R9: the four subagent disciplines are documented in all three surfaces.
        const disciplines = ['ledger', 'cheapest model', 'pre-judge the reviewer'];
        for (const p of [
            join(SKILLS_DIR, 'parallel-execution', 'SKILL.md'),
            join(AGENTS_DIR, 'super-planner.md'),
            join(SKILLS_DIR, 'spur-dev', 'references', 'execution-batch.md'),
        ]) {
            const text = readFileSync(p, 'utf8').toLowerCase();
            expect(text, `${p} must document subagent disciplines`).toContain('subagent execution disciplines');
            expect(text).toContain('file');
            for (const d of disciplines) expect(text, `${p} missing "${d}"`).toContain(d);
        }
    });

    test('R50 — architecture-upkeep survey + behavioral eval harness landed (0215 R1/R2)', () => {
        // R1: sys-architecture carries a survey OPERATION that emits a MARKDOWN report and reuses the
        // deep-module vocabulary by reference; a thin /sp:dev-arch command exists; dev-review is unchanged.
        const sysArch = readFileSync(join(SKILLS_DIR, 'sys-architecture', 'SKILL.md'), 'utf8');
        expect(sysArch).toContain('## Survey operation');
        expect(sysArch).toContain('MARKDOWN candidate report');
        expect(sysArch).toContain('- survey'); // operations: - survey
        statSync(join(SKILLS_DIR, 'sys-architecture', 'references', 'upkeep-survey.md'));
        const survey = readFileSync(join(SKILLS_DIR, 'sys-architecture', 'references', 'upkeep-survey.md'), 'utf8');
        expect(survey).toContain('never'); // never auto-refactor
        // The markdown-only constraint is carried by its bold bullet label, not the prose after it.
        expect(survey).toContain('**Markdown only.**');
        expect(survey).toContain('decision-method.md'); // reuse-by-reference, not restated
        statSync(join(PLUGIN_ROOT, 'commands', 'dev-arch.md'));
        // /sp:dev-review is unchanged — still the SECUA per-task diff review, not a survey.
        const devReview = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-review.md'), 'utf8');
        expect(devReview).toContain('SECUA');
        expect(devReview).not.toContain('survey');

        // R2: a behavioral eval harness exists with a free (deterministic) and paid (live) tier,
        // documented, with a separate `bun run eval` entry point that is not a *.test.ts file.
        const evalsDir = join(SKILLS_DIR, '..', 'evals');
        for (const f of ['judge.ts', 'scenarios.ts', 'run-eval.ts', 'judge.test.ts', 'README.md']) {
            statSync(join(evalsDir, f));
        }
        const evalReadme = readFileSync(join(evalsDir, 'README.md'), 'utf8');
        expect(evalReadme.toLowerCase()).toContain('free');
        expect(evalReadme.toLowerCase()).toContain('paid');
        expect(evalReadme).toContain('bun run eval');
        const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        expect(pkg.scripts.eval, 'package.json must expose a separate `eval` entry point').toContain('run-eval.ts');
        // The live/paid tier runner is a standalone script, NOT a test file — so the default suite
        // never picks it up (D4: behavioral evals do not entangle the always-on structural suite).
        expect(pkg.scripts.eval).not.toContain('.test.ts');
    });

    test('R51 — wayfinder skill anatomy + brainstorm escalation reference (task 0216 R1/R2/R5)', () => {
        // R1: wayfinder SKILL.md exists with full anatomy.
        const wayfinder = readFileSync(join(SKILLS_DIR, 'wayfinder', 'SKILL.md'), 'utf8');
        for (const section of [
            '## Overview',
            '## When to Use',
            '## Process',
            '## Common Rationalizations',
            '## Red Flags',
            '## Verification',
        ]) {
            expect(wayfinder, `wayfinder SKILL.md must contain "${section}"`).toContain(section);
        }

        // Core wayfinding concepts expressed in sp vocabulary — no vendor tracker references.
        expect(wayfinder).toContain('spur feature');
        expect(wayfinder).toContain('spur task');
        expect(wayfinder).toContain('## Not yet specified');
        expect(wayfinder).toContain('## Out of scope');
        expect(wayfinder).toContain('## Destination');
        expect(wayfinder).toContain('## Decisions so far');
        expect(wayfinder).toContain('spur task update');
        expect(wayfinder).not.toContain('GitHub issue');
        expect(wayfinder).not.toContain('wayfinder:map');
        expect(wayfinder).not.toContain('issue tracker');

        // R2: brainstorm SKILL.md references wayfinder in its escalation path.
        const brainstorm = readFileSync(join(SKILLS_DIR, 'brainstorm', 'SKILL.md'), 'utf8');
        expect(brainstorm).toContain('sp:wayfinder');
        expect(brainstorm).toContain('## Wayfinding Escalation');
        expect(brainstorm).toContain('scope check');
        expect(brainstorm).toContain('multi-session investigation');

        // R3: --wayfind flag is documented in both surfaces.
        const devBrainstorm = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-brainstorm.md'), 'utf8');
        expect(devBrainstorm).toContain('--wayfind');
        expect(devBrainstorm).toContain('sp:wayfinder');

        // R4: "work through the map" operational mode is documented in wayfinder.
        expect(wayfinder).toContain('### Work Through the Map');
        expect(wayfinder).toContain('Never resolve more than one ticket per session');

        // R5: wayfinder carries the anti-rationalization anatomy (checked by R46 load-bearing list).
        // No vendors/ reference anywhere in the shipped files (checked by R20).
    });

    test('R52 — dev-next command wires to sp:next-router skill with routing-table reference (task 0275)', () => {
        // Command is a thin Skill() wrapper — the pass-through principle (README) forbids domain
        // logic in commands, so the wiring string + file existence is the structural contract.
        const command = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-next.md'), 'utf8');
        expect(command).toContain('Skill(skill="sp:next-router", args="$ARGUMENTS")');
        // Exact stop/plan message ids (0272 R3) — all prefixed `dev-next:`. Thin-wrapper world
        // (0308): the literal templates live in the router skill's messages reference.
        const messages = readFileSync(join(SKILLS_DIR, 'next-router', 'references', 'messages.md'), 'utf8');
        for (const id of ['U1', 'U2', 'U3', 'U4', 'U-HITL', 'U-GUARD', 'P1', 'P2', 'P3', 'W-FULL']) {
            expect(messages, `messages.md must document message ${id}`).toContain(`### ${id} `);
            expect(messages).toContain('dev-next:');
        }

        const skill = readFileSync(join(SKILLS_DIR, 'next-router', 'SKILL.md'), 'utf8');
        const frontmatter = skill.split('---')[1] ?? '';
        expect(frontmatter).toContain('name: next-router');
        // Platform Notes for non-Claude platforms (read SKILL + spur --json; no Skill() required).
        expect(skill).toContain('## Platform Notes');

        const table = readFileSync(join(SKILLS_DIR, 'next-router', 'references', 'routing-table.md'), 'utf8');
        for (const marker of ['TABLE A', 'TABLE B', 'TABLE C', 'Non-routes', 'frontier']) {
            expect(table, `routing-table.md must contain ${marker}`).toContain(marker);
        }
    });

    test('R53 — skills carry prompts only; scripts/tests live at plugin level (ADR-031)', () => {
        // The prompts-vs-code split: a skill directory holds SKILL.md + prompt-side companions
        // (references/, agents/, examples/) — never executable trees. Embedded scripts/tests
        // re-created a second layout convention twice (daily-summary, dogfood-testing) before the
        // split; this guard fails the moment a skill dir grows one again.
        const offenders: string[] = [];
        for (const skill of skillDirs) {
            for (const forbidden of ['scripts', 'tests']) {
                try {
                    statSync(join(SKILLS_DIR, skill, forbidden));
                    offenders.push(`skills/${skill}/${forbidden}/`);
                } catch {
                    // absent — expected
                }
            }
        }
        expect(offenders).toEqual([]);

        // Plugin-level trees exist and pair by skill name: scripts/<skill>/ code is exercised by
        // tests/<skill>/ (coverage gate alone can't prove the suite sits in the right tree).
        const scriptDirs = readdirSync(join(PLUGIN_ROOT, 'scripts'), { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
        const testsDir = join(PLUGIN_ROOT, 'tests');
        const missingSuite: string[] = [];
        for (const name of scriptDirs) {
            try {
                statSync(join(testsDir, name));
            } catch {
                missingSuite.push(`scripts/${name}/ has no tests/${name}/ suite`);
            }
        }
        expect(missingSuite).toEqual([]);
    });

    test('R54 — J4 execution-efficiency guardrails are discoverable and source-grounded (0379)', () => {
        const testingSkill = readFileSync(join(SKILLS_DIR, 'code-testing', 'SKILL.md'), 'utf8');
        expect(testingSkill).toContain('references/test-loop-breaker.md');
        expect(testingSkill).toContain('references/test-output-discipline.md');

        const loopBreaker = readFileSync(
            join(SKILLS_DIR, 'code-testing', 'references', 'test-loop-breaker.md'),
            'utf8',
        );
        for (const marker of [
            'After two identical failure signatures',
            'falsifiable hypothesis',
            'Make one source or test edit',
            'Hard cap: three executions',
            'must not exceed five test executions',
        ]) {
            expect(loopBreaker).toContain(marker);
        }

        const outputDiscipline = readFileSync(
            join(SKILLS_DIR, 'code-testing', 'references', 'test-output-discipline.md'),
            'utf8',
        );
        expect(outputDiscipline).toContain('--reporter=dots');
        expect(outputDiscipline).toContain('--test-name-pattern');
        expect(outputDiscipline).toContain('set -o pipefail');
        expect(outputDiscipline).toContain(['$', '{PIPESTATUS[0]}'].join(''));
        expect(outputDiscipline).toContain('$pipestatus[1]');
        expect(outputDiscipline).toContain('exit "$test_status"');
        // Token-budget prose pin deleted as redundant — the mechanisms asserted above
        // (--reporter=dots, --test-name-pattern) are what enforce the budget.

        const sectionEditing = readFileSync(
            join(SKILLS_DIR, 'spur-cli', 'references', 'tasks', 'section-editing.md'),
            'utf8',
        );
        expect(sectionEditing).toContain('l3-guard-cheatsheet.md');
        const cheatSheet = readFileSync(
            join(SKILLS_DIR, 'spur-cli', 'references', 'tasks', 'l3-guard-cheatsheet.md'),
            'utf8',
        );
        for (const marker of [
            'backlog → todo → wip → testing → done',
            'Solution: `file:line`',
            'Review: populated P1–P4 table',
            'Verdict artifact',
            'Canonical section names',
        ]) {
            expect(cheatSheet).toContain(marker);
        }

        const spine = readFileSync(join(SKILLS_DIR, 'spur-dev', 'SKILL.md'), 'utf8');
        expect(spine).toContain('references/section-batching.md');
        const batching = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'section-batching.md'), 'utf8');
        const stageIndex = batching.indexOf('Stage complete, body-only `Solution`, `Testing`, and `Review`');
        const firstCheckIndex = batching.indexOf('Run `spur task check <wbs> --json` once');
        expect(stageIndex).toBeGreaterThan(-1);
        expect(firstCheckIndex).toBeGreaterThan(stageIndex);
        // Budget prose pin deleted as redundant — the stage-then-single-check ordering
        // asserted above is the batching discipline this test guards.

        const pipeline = readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8');
        expect(pipeline).toContain('normal: backlog → todo → wip → testing → done');
        expect(pipeline).toContain('wip → testing:  spur task check <wbs>');
        expect(pipeline).toContain('testing → done: spur task check <wbs> --strict-core');

        const debugging = readFileSync(join(SKILLS_DIR, 'sys-debugging', 'SKILL.md'), 'utf8');
        // Heading is the structured marker; the sentence pin below it was redundant.
        expect(debugging).toContain('### Source before git state');

        const sectionMatrix = readFileSync(join(REPO_ROOT, 'config', 'tasks', 'section-matrix.yaml'), 'utf8');
        const metaMatrix = sectionMatrix.slice(
            sectionMatrix.indexOf('  meta:'),
            sectionMatrix.indexOf('  brainstorm:'),
        );
        expect(metaMatrix).toContain('Root Cause');
    });
    test('R55 - every sp: skill declared in agent frontmatter resolves to a skill directory (0389 R6)', () => {
        // Agent frontmatter `skills:` lists sp:<name> skills the agent may invoke at runtime. A
        // dangling declaration (e.g. sp:anti-hallucination, which ships under the cc: plugin, or a
        // non-existent sp:tasks) is a silent mis-route. R16b guards sp: references in body text but
        // only flags spur-/code-/sys-/spec-/expert- prefixed names; frontmatter skills: entries use
        // bare names (anti-hallucination, tasks) that R16b skips. This assertion parses the skills:
        // field directly and resolves each sp: entry to a directory under skills/.
        const offenders: string[] = [];
        for (const file of readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'))) {
            const text = readFileSync(join(AGENTS_DIR, file), 'utf8');
            const frontmatter = text.split('---')[1] ?? '';
            const skillsLine = frontmatter.match(/^skills:\s*\[(.*)\]/m)?.[1] ?? '';
            for (const match of skillsLine.matchAll(/\bsp:([a-z][a-z0-9-]+)\b/g)) {
                const name = match[1];
                if (!skillDirs.includes(name)) {
                    offenders.push(`${file} -> sp:${name}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
    test('R56 - four-agent build/orchestration split is non-overlapping (0391)', () => {
        // H6 inversion: super-planner owns batch orchestration; super-coder owns build competencies;
        // super-reviewer owns review; expert-spur owns corpus CLI. No agent may cross into another's
        // core competency in a way that re-blends the split.
        const planner = readFileSync(join(AGENTS_DIR, 'super-planner.md'), 'utf8');
        const coder = readFileSync(join(AGENTS_DIR, 'super-coder.md'), 'utf8');
        const reviewer = readFileSync(join(AGENTS_DIR, 'super-reviewer.md'), 'utf8');
        const spur = readFileSync(join(AGENTS_DIR, 'expert-spur.md'), 'utf8');

        // All four agent files exist and are non-empty.
        expect(planner.length).toBeGreaterThan(0);
        expect(coder.length).toBeGreaterThan(0);
        expect(reviewer.length).toBeGreaterThan(0);
        expect(spur.length).toBeGreaterThan(0);

        // Non-overlap: build agent does not reference the batch SSOT; planner does not declare a
        // build competency skill; reviewer owns verification; spur owns the CLI facade.
        expect(coder).not.toContain('execution-batch.md');
        expect(planner).not.toContain('sp:code-implementation');
        expect(reviewer).toContain('sp:code-verification');
        expect(spur).toContain('sp:spur-cli');
        // AC1 mutual-exclusivity for the other two agents: reviewer must declare it never
        // implements a fix (does not cross into build); spur must declare it never drives the
        // planning/execution lifecycle (does not cross into orchestration). Without these, a
        // future edit could drop the boundary text and re-blend the four-way split with no
        // structural signal - the same failure mode R56 exists to prevent for coder/planner.
        expect(reviewer).toContain('Never implement a fix');
        expect(spur).toContain('Never drive the planning/execution lifecycle');

        // Planner owns the batch driver loop (references execution-batch.md); coder owns build
        // competencies (references the four competency skills).
        expect(planner).toContain('execution-batch.md');
        expect(coder).toContain('sp:code-implementation');
        expect(coder).toContain('sp:sys-architecture');
        expect(coder).toContain('sp:code-testing');
        expect(coder).toContain('sp:sys-debugging');

        // R3 / AC "Polling stays out of the planner body": the spur workflow trace polling loop
        // lives in the command/script layer, not as agent reasoning. Assert the planner explicitly
        // delegates polling to the script layer (positive contract) and names it as transport, not
        // reasoning. Without this, a future edit could inline a poll loop into the planner body and
        // no structural test would catch the re-blend.
        expect(planner).toContain('script layer');
        expect(planner).toContain('not planner reasoning');
        // The build agent must not describe a poll loop either.
        expect(coder).not.toMatch(/spur workflow trace/);

        // R5 / AC "Routing frontmatter matches the new charters": each agent's frontmatter
        // description must carry its own triggers and drop the other's, so the routing layer
        // selects correctly. Extract the description field from the frontmatter block.
        const fm = (file: string) => file.split('---')[1] ?? '';
        const plannerDesc = fm(planner).toLowerCase();
        const coderDesc = fm(coder).toLowerCase();
        // Planner description carries orchestration triggers, not build triggers.
        expect(plannerDesc).toMatch(/run all tasks|drive the batch|dev-runall|execution orchestration/);
        expect(plannerDesc).not.toMatch(/\bimplement\b|\bwrite the code\b|\bdebug this\b/);
        // Coder description carries build triggers, not orchestration triggers.
        expect(coderDesc).toMatch(/\bimplement\b|\bwrite the code\b|\bfix this bug\b|\bdebug\b/);
        expect(coderDesc).not.toMatch(/run all tasks|drive the batch|dev-runall/);

        // R7 / AC "cite the shared housekeeping and dispatch-surface references": both agents cite
        // the done-time housekeeping reference and the dispatch-surface reference by path.
        for (const [label, text] of [
            ['super-planner', planner],
            ['super-coder', coder],
        ] as const) {
            expect(text, `${label} must cite done-housekeeping.md`).toContain('done-housekeeping.md');
            expect(text, `${label} must cite dispatch-surface.md`).toContain('dispatch-surface.md');
        }

        // Positive charter ownership (AC "non-overlapping and correctly named"): planner owns
        // product/project management + execution orchestration; coder owns the build competencies.
        expect(planner.toLowerCase()).toContain('product');
        expect(planner.toLowerCase()).toContain('project management');
        expect(planner.toLowerCase()).toContain('orchestration');
    });
});

// ─── (R57) task 0486 — conflict-finding authority-aware audit capability ─────

describe('task 0486 — conflict-finding authority-aware audit capability', () => {
    test('R57 — skill, four reference rulebooks, and thin dev-find-conflict wrapper exist and delegate correctly', () => {
        const skillDir = join(SKILLS_DIR, 'conflict-finding');
        const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
        const command = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-find-conflict.md'), 'utf8');

        // Skill SSOT + the four reference rulebooks (authority, comparison, finding contract, remediation).
        for (const ref of [
            'authority-resolution.md',
            'comparison-protocol.md',
            'finding-contract.md',
            'remediation-routing.md',
        ]) {
            statSync(join(skillDir, 'references', ref));
        }

        // Thin wrapper delegates semantic logic to the skill SSOT (ADR-023/032); carries the frozen surface.
        expect(command).toContain('Skill(skill="sp:conflict-finding", args="$ARGUMENTS")');
        expect(command).toContain('--pillar');
        expect(command).toContain('--mode');
        expect(command).toContain('--resolve');
        expect(command).toContain('--json');

        // The four-pillar scope + the audit-only invariant live in the skill.
        expect(skill).toContain('four pillars');
        expect(skill).toContain('source');
        expect(skill).toContain('task files');
        expect(skill).toContain('feature files');
        expect(skill).toContain('authority');
        // Audit-only guard: without --resolve, no mutation; --resolve opens a confirmation workflow.
        expect(skill).toContain('--resolve');
        expect(skill.toLowerCase()).toContain('read-only');
    });
});

// ─── (task 0510) feature-E batch-run lessons: preflight, matrix, metadata-only ──

describe('task 0510 — batch-run hardening (feature preflight, changed-path matrix, metadata-only host)', () => {
    const executionBatch = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'execution-batch.md'), 'utf8');
    const codeImpl = readFileSync(join(SKILLS_DIR, 'code-implementation', 'SKILL.md'), 'utf8');
    const crossCutting = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'cross-cutting.md'), 'utf8');
    const devRunall = readFileSync(join(PLUGIN_ROOT, 'commands', 'dev-runall.md'), 'utf8');
    const devOps = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'dev-operations.md'), 'utf8');

    test('R2 — feature-derived strict preflight runs before task resolution and aborts on failure', () => {
        // The strict check must be declared before any task-list resolution / freeze.
        expect(executionBatch).toContain('feature check <id> --strict --json');
        expect(executionBatch).toContain('before any task-list resolution, freeze');
        expect(executionBatch).toContain('before `task list`');
        // Abort shape: verdict aborted, zero attempted tasks, structured findings.
        expect(executionBatch).toContain('verdict `aborted`, zero attempted');
        // Non-feature exclusion: explicit/status/ready selectors add no check.
        expect(executionBatch).toContain('Explicit WBS lists, status pseudo-lists, and `ready` selectors add no');
        // Operator projections carry the same contract.
        expect(devRunall).toContain('feature check <id> --strict --json');
        expect(devRunall).toContain('aborts the batch with verdict `aborted`');
        expect(devOps).toContain('feature check <id> --strict --json');
    });

    test('R3 — changed-path matrix pins dependency direction and the conditional parity limit', () => {
        // Dependency direction domain → app → CLI is literal in the matrix rows.
        expect(codeImpl).toContain('| `packages/domain/src/**` public type/query |');
        expect(codeImpl).toContain('| `packages/app/src/**` public service/type |');
        expect(codeImpl).toContain('| `apps/cli/src/**` |');
        expect(codeImpl).toContain('| shared plugin flag/command/reference |');
        // Downstream consumers named (affected app service test, affected CLI command test).
        expect(codeImpl).toContain('affected app service test; affected CLI command test');
        expect(codeImpl).toContain('affected app test; affected CLI command test');
        // Typecheck surface: `bun run --filter <workspace> typecheck`.
        expect(codeImpl).toContain('bun run --filter <workspace> typecheck');
        // Parity suite only for shared flag surface changes — the conditional limit.
        expect(codeImpl).toContain('flag-contract-parity.test.ts');
        expect(codeImpl).toContain('when the shared flag surface changes');
        // Never a full project check inside implement.
        expect(codeImpl).toContain('never authorizes `bun run spur-check`');
        // The matrix is linked from the targeted-test-first guidance.
        expect(crossCutting).toContain('changed-path matrix');
    });

    test('R5 — host controller projections are metadata-only on the green path and bounded on failure', () => {
        expect(executionBatch).toContain('Metadata-only host controller');
        // task-show projection shape.
        expect(executionBatch).toContain('{wbs, status, dependencies, feature_id}');
        // trace observation projection shape.
        expect(executionBatch).toContain('{runId, status, terminalState}');
        // Failure reads are bounded — never re-stream a whole trace to summarize status.
        expect(executionBatch).toContain('never streams or re-reads a full trace');
        // task 0508 native-subagent dispatch is preserved, not replaced by a cache/parser.
        expect(executionBatch).toContain("task 0508's dispatch contract is preserved unchanged");
    });
});

describe('task 0519 — idea-pipeline planning guidance names canonical artifacts and conditional handoff', () => {
    const guidance = readFileSync(join(SKILLS_DIR, 'spur-dev', 'references', 'planning-workflow.md'), 'utf8');

    test('Step 5.6 documents the run-scoped artifacts by canonical name', () => {
        const step = guidance.slice(guidance.indexOf('## Step 5.6'));
        // The four dogfood findings map to artifacts the guidance must name: Goal/Scope intent
        // files, the design-review feedback file, the order sidecar, and the handoff report.
        for (const artifact of [
            'idea-goal.md',
            'idea-scope.md',
            'idea-design-review.md',
            'idea-task-order.json',
            'idea-batch-create-result.json',
            'idea-handoff.md',
        ]) {
            expect(step, `planning-workflow Step 5.6 must name ${artifact}`).toContain(artifact);
        }
    });

    test('guidance pins the goal/scope and design-review contracts without shell logic', () => {
        const step = guidance.slice(guidance.indexOf('## Step 5.6'));
        // Contract prose (not commands): Goal is intent only; Scope carries boundaries; the
        // review artifact has fixed headings; rejected designs record operator feedback; the
        // revision reconciles invalidated AC through the corpus CLI; design exit re-checks.
        expect(step).toContain('Goal is intent only');
        expect(step).toContain('in-scope and out-of-scope');
        expect(step).toContain('## Proposed design');
        expect(step).toContain('## Operator feedback');
        expect(step).toContain('## Reconciliation');
        expect(step).toContain('spur feature update <id> --section');
        expect(step).toContain('"Acceptance Criteria" --from-file <file>');
        expect(step).toContain('spur feature check <id>');
    });

    test('guidance names the ordering sidecar and the conditional recommendation', () => {
        const step = guidance.slice(guidance.indexOf('## Step 5.6'));
        // 0518: ordering is applied via `spur task deps`; the roster is refreshed; the report
        // carries exactly ONE next command — refineall when any task is unready, runall otherwise.
        expect(step).toContain('depends_on_names');
        expect(step).toContain('spur task deps <wbs> set');
        expect(step).toContain('spur feature refresh --feature <id> --json');
        expect(step).toContain('spur task check <wbs> --json');
        expect(step).toContain('exactly **one** next command');
        expect(step).toContain('/sp:dev-refineall --feature <id> --auto --depth ready');
        expect(step).toContain('otherwise `/sp:dev-runall --feature <id> --auto`');
    });
});
