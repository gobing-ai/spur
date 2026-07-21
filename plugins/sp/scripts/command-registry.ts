/**
 * command-registry — shared command metadata SSOT for adapter generation
 * (feature O wave-2, task 0308; spec ticket 0283 R4).
 *
 * Every `/sp:dev-*` Claude Code slash wrapper and every `$sp-dev-*` Codex
 * dollar-skill wrapper is generated from the entries below by
 * `generate-adapters.ts`. Wrappers carry invocation syntax + the delegation
 * line only; lifecycle semantics live in the dispatched skill / workflow /
 * inline procedure (0283 R4).
 *
 * Frontmatter values are stored unquoted and re-quoted deterministically at
 * render time, so a byte-exact regeneration match doubles as the no-prose
 * drift gate (0283 R8c).
 */

/** One skill delegation within a command (Claude `Skill()` call shape). */
export interface SkillDispatch {
    /** Guard label for routed dispatches (e.g. dev-run's implement mode). Omit for the only dispatch. */
    readonly when?: string;
    /** Plugin-namespaced skill id (`sp:<dir-name>`). */
    readonly skill: string;
    /** Verbatim args string passed to the skill (`$ARGUMENTS` placeholders kept). */
    readonly args: string;
}

/** How a command reaches its semantics owner. */
export type CommandTarget =
    /** One or more `Skill()` dispatches (single, routed, or multi-dimension dispatcher). */
    | { readonly kind: 'skill'; readonly dispatches: readonly SkillDispatch[] }
    /** Direct `spur workflow run` invocation (no Skill() call). */
    | { readonly kind: 'workflow'; readonly workflow: string; readonly invocation: string }
    /** Inline procedure defined in spur-dev/references/dev-operations.md. */
    | { readonly kind: 'procedure'; readonly referenceFile: string; readonly anchor: string; readonly label: string }
    /** Hybrid deterministic CLI + skill follow-up (spur-init). */
    | { readonly kind: 'composite'; readonly cli: string; readonly dispatches: readonly SkillDispatch[] };

/** Shared metadata for one operator command. */
export interface CommandMeta {
    /** Command basename without extension (`dev-run`) — slash `/sp:dev-run`, dollar `$sp-dev-run`. */
    readonly name: string;
    /** H1 title (`Dev Run`). */
    readonly title: string;
    /** Frontmatter description, unquoted logical value. */
    readonly description: string;
    /** Frontmatter argument-hint inner value (no surrounding quotes). */
    readonly argumentHint: string;
    /** Frontmatter allowed-tools list. */
    readonly allowedTools: readonly string[];
    readonly target: CommandTarget;
}

const DEV_OPERATIONS = 'spur-dev/references/dev-operations.md';

/**
 * The 28 operator commands, in plugins/sp/commands/ filename order.
 *
 * Frontmatter normalizations versus the legacy hand-authored files:
 * - dev-idea / dev-wrap / dev-wrapall drop `Skill` from allowed-tools (they
 *   invoke `spur workflow run` directly; no Skill() call exists).
 * - dev-changelog drops `Write` from allowed-tools (stdout-only invariant —
 *   see dev-operations.md §8; file writes are the operator's redirect choice).
 */
export const COMMANDS: readonly CommandMeta[] = [
    {
        name: 'dev-arch',
        title: 'Dev Arch',
        description:
            'Survey a codebase (or module tree) for shallow modules and deepening opportunities — emit a ranked MARKDOWN candidate report that feeds the planning half; never auto-refactors',
        argumentHint: '[<module-path>] [--scope <all|<path>>] [--json]',
        allowedTools: ['Bash', 'Read', 'Grep', 'Glob', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:sys-architecture', args: 'survey $ARGUMENTS' }] },
    },
    {
        name: 'dev-brainstorm',
        title: 'Dev Brainstorm',
        description:
            'Interactive solution design — heuristic discovery interview followed by structured ideation with trade-offs and confidence scoring',
        argumentHint:
            '<topic> [--depth <basic|detailed|comprehensive>] [--options <n>] [--agent <name|auto>] [--skip-discovery] [--wayfind] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]',
        allowedTools: ['Bash', 'Read', 'Skill', 'AskUserQuestion'],
        target: {
            kind: 'skill',
            dispatches: [
                {
                    when: 'Default',
                    skill: 'sp:brainstorm',
                    args: 'dev-brainstorm --context <decision-tree> --options <n>',
                },
                {
                    when: '`--wayfind`',
                    skill: 'sp:wayfinder',
                    args: 'chart --destination <destination> --context <decision-tree>',
                },
            ],
        },
    },
    {
        name: 'dev-changelog',
        title: 'Dev Changelog',
        description: 'Generate changelog from git commits',
        argumentHint: '[--since <tag|commit>] [--until <tag|commit>] [--version <version>]',
        allowedTools: ['Bash', 'Read'],
        target: { kind: 'procedure', referenceFile: DEV_OPERATIONS, anchor: '8-changelog', label: 'changelog' },
    },
    {
        name: 'dev-dogfood',
        title: 'Dev Dogfood',
        description:
            'Dogfood an agent skill/command/CLI — drive it end-to-end with bounded auto-fix, self-monitor, and emit a comprehensive report',
        argumentHint: '<testee> [--agent <name|auto>] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:dogfood-testing', args: '$ARGUMENTS' }] },
    },
    {
        name: 'dev-fixall',
        title: 'Dev Fixall',
        description: 'Fix all lint, type, and test errors systematically across the working tree',
        argumentHint: '[<validation-command>] [--max-retry <n>] [--scope <path>]',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'],
        target: { kind: 'procedure', referenceFile: DEV_OPERATIONS, anchor: '10-fixall', label: 'fixall' },
    },
    {
        name: 'dev-gitmsg',
        title: 'Dev Gitmsg',
        description:
            'Generate conventional commit message(s) from staged changes via per-file summarization, optionally commit',
        argumentHint: '[--commit] [--squash] [--scope <path>]',
        allowedTools: ['Bash', 'Read'],
        target: { kind: 'procedure', referenceFile: DEV_OPERATIONS, anchor: '9-gitmsg', label: 'gitmsg' },
    },
    {
        name: 'dev-handover',
        title: 'Dev Handover',
        description:
            'Generate a structured handover document when blocked — captures goal, progress, blocker, rejected approaches, and next steps',
        argumentHint: '"<blocker description>"',
        allowedTools: ['Bash', 'Read', 'Write'],
        target: { kind: 'procedure', referenceFile: DEV_OPERATIONS, anchor: '11-handover', label: 'handover' },
    },
    {
        name: 'dev-idea',
        title: 'Dev Idea',
        description:
            'Turn a vague idea into a feature with AC and a decomposed task batch — discovery, feature-create, AC, feature-check, system-design, decompose, batch-create, handoff',
        argumentHint: '"<idea>" [--auto] [--design] [--skip-design] [--design-approved]',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'AskUserQuestion'],
        target: {
            kind: 'workflow',
            workflow: 'idea-pipeline.yaml',
            invocation:
                'spur workflow run .spur/workflows/idea-pipeline.yaml --vars \'{"idea":"<text>","profile":"interactive|auto","design":"auto|force|skip","design_approved":"false|true"}\'',
        },
    },
    {
        name: 'dev-next',
        title: 'Dev Next',
        description: 'Status-aware router — pick and run the next best /sp:dev-* step for a task or feature frontier',
        argumentHint: '[<wbs|feature-id>] [--dry-run] [--once] [--auto] [--agent <name|auto>] [--full]',
        allowedTools: ['Bash', 'Read', 'Skill', 'AskUserQuestion'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:next-router', args: '$ARGUMENTS' }] },
    },
    {
        name: 'dev-parallel',
        title: 'Dev Parallel',
        description:
            'Fan out independent tasks or investigations in parallel via subagents — choose the right pattern and synthesize results',
        argumentHint:
            '--tasks <selector> [--feature <id>] [--mode <fan-out|review-panel|investigation>] [--agent <name|auto>] [--json]',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:parallel-execution', args: '$ARGUMENTS' }] },
    },
    {
        name: 'dev-plan',
        title: 'Dev Plan',
        description:
            'Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create',
        argumentHint:
            '"<description>" [--feature <id>] [--parent <feature-id>] [--agent <name|auto>] [--design] [--auto] [--design-approved]',
        allowedTools: ['Bash', 'Read', 'Write', 'Skill', 'AskUserQuestion'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:spur-dev', args: 'plan $ARGUMENTS' }] },
    },
    {
        name: 'dev-refine',
        title: 'Dev Refine',
        description:
            'Refine task requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria',
        argumentHint: '<wbs> [--focus <mode>] [--description <text>] [--agent <name|auto>] [--auto] [--next]',
        allowedTools: ['Bash', 'Read', 'Write', 'Skill', 'AskUserQuestion'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:spur-dev', args: 'refine $ARGUMENTS' }] },
    },
    {
        name: 'dev-reverse',
        title: 'Dev Reverse',
        description: 'Reverse engineer a codebase with selectable depth, focus, and output format',
        argumentHint:
            '[<path>] [--mode <briefing|structure|architecture|design|full>] [--focus <all|stack|dependencies|data|flows|api|security|quality|performance>] [--format <markdown|json|both>] [--output <file>]',
        allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:reverse-engineering', args: '$ARGUMENTS' }] },
    },
    {
        name: 'dev-review',
        title: 'Dev Review',
        description:
            'Review code for a task or path — multi-dimensional review across functional traceability, SECUA quality, and architectural depth. Triggers: "review this", "check the code", "SECUA review", "dev review", "audit this".',
        argumentHint:
            '[<wbs|path>] [--agent <name|auto>] [--focus <dims>] [--fix <none|blockers-first|all>] [--auto] [--next]',
        allowedTools: ['Bash', 'Read', 'Write', 'Skill'],
        target: {
            kind: 'skill',
            dispatches: [
                { when: 'Functional traceability', skill: 'sp:functional-review', args: '<wbs> $ARGUMENTS' },
                { when: 'SECUA quality review', skill: 'sp:code-verification', args: 'review $ARGUMENTS' },
                { when: 'Architectural depth', skill: 'sp:code-improvement', args: '<wbs|path> $ARGUMENTS' },
            ],
        },
    },
    {
        name: 'dev-run',
        title: 'Dev Run',
        description:
            'Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement)',
        argumentHint: '<wbs> [--mode <full|implement>] [--agent <name|auto>] [--auto] [--next] [--wrap] [--continue]',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Skill'],
        target: {
            kind: 'skill',
            dispatches: [
                { when: 'Full pipeline (default)', skill: 'sp:spur-dev', args: 'run $ARGUMENTS' },
                {
                    when: 'Implement step (`--next` or `--mode implement`)',
                    skill: 'sp:code-implementation',
                    args: '$ARGUMENTS',
                },
            ],
        },
    },
    {
        name: 'dev-runall',
        title: 'Dev Runall',
        description:
            'Run a batch of tasks through their pipelines in dependency-correct order — resolve a set, topo-sort, run each via task-pipeline.yaml, emit a batch report',
        argumentHint:
            '--tasks <selector> [--feature <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <name|auto>] [--json] [--wrap] [--continue]',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:spur-dev', args: 'runall $ARGUMENTS' }] },
    },
    {
        name: 'dev-simplify',
        title: 'Dev Simplify',
        description:
            'Simplify code for clarity without changing behavior — reduce complexity in recent changes (or a given scope), preserving behavior exactly',
        argumentHint: '[<path-or-scope>] [--scope <recent|all|<path>>] [--check <cmd>] [--auto]',
        allowedTools: ['Bash', 'Read', 'Edit', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:code-simplification', args: '$ARGUMENTS' }] },
    },
    {
        name: 'dev-unit',
        title: 'Dev Unit',
        description: 'Generate or extend tests until the unit target is met',
        argumentHint: '<target> [--coverage <n>] [--agent <name|auto>] [--auto]',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:code-testing', args: '$ARGUMENTS' }] },
    },
    {
        name: 'dev-verify',
        title: 'Dev Verify',
        description:
            'Verify a task against its requirements and Acceptance Criteria — traceability check producing a PASS/PARTIAL/FAIL verdict with evidence',
        argumentHint:
            '<wbs> [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next]',
        allowedTools: ['Bash', 'Read', 'Write', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:code-verification', args: 'verify $ARGUMENTS' }] },
    },
    {
        name: 'dev-verifyall',
        title: 'Dev Verifyall',
        description:
            'Verify a batch of tasks against their requirements and Acceptance Criteria — batch traceability check producing per-task verdicts and a summary report',
        argumentHint:
            '--tasks <selector> [--feature <id>] [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--json]',
        allowedTools: ['Bash', 'Read', 'Write', 'Skill'],
        target: {
            kind: 'skill',
            dispatches: [
                { when: 'Batch orchestration', skill: 'sp:spur-dev', args: 'verifyall $ARGUMENTS' },
                {
                    when: 'Per-task verification (inner)',
                    skill: 'sp:code-verification',
                    args: 'verify <wbs> $SHARED_FLAGS',
                },
            ],
        },
    },
    {
        name: 'dev-wrap',
        title: 'Dev Wrap',
        description:
            'Wrap up a single completed task — learnings, metrics, doc-sync, optional feature transition and branch cleanup',
        argumentHint: '<wbs> [--auto] [--merge] [--dry-run]',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'AskUserQuestion'],
        target: {
            kind: 'workflow',
            workflow: 'wrapup-pipeline.yaml',
            invocation:
                'spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars \'{"tasks":"[\\"<wbs>\\"]","profile":"interactive|auto","merge":"true|false"}\' [--dry-run]',
        },
    },
    {
        name: 'dev-wrapall',
        title: 'Dev Wrapall',
        description:
            'Wrap up a batch of completed tasks — learnings, metrics, doc-sync, feature transition, optional branch cleanup',
        argumentHint: '[--since <iso-date>] [--feature <id>] [--status <s>] [--auto] [--merge] [--dry-run]',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'AskUserQuestion'],
        target: {
            kind: 'workflow',
            workflow: 'wrapup-pipeline.yaml',
            invocation:
                'spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars \'{"tasks":"<json-encoded-wbs-list>","feature":"<id|>","profile":"interactive|auto","merge":"true|false"}\' [--dry-run]',
        },
    },
    {
        name: 'rule-add',
        title: 'Rule Add',
        description: 'Author a validated, smoke-tested constraint rule',
        argumentHint: '"<description>" [--file <path>] [--preset <target>]',
        allowedTools: ['Bash', 'Read', 'Write', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:spur-cli', args: 'rule add $ARGUMENTS' }] },
    },
    {
        name: 'rule-refine',
        title: 'Rule Refine',
        description: 'Refine a constraint rule or preset, then re-verify it',
        argumentHint:
            '<rule-file-or-preset> [--intent "<goal>"] [--severity <sev>] [--scope <glob>] [--exempt <path>] [--disable <id>] [--override <id>] [--dry-run]',
        allowedTools: ['Bash', 'Read', 'Edit', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:spur-cli', args: 'rule refine $ARGUMENTS' }] },
    },
    {
        name: 'rule-scan',
        title: 'Rule Scan',
        description: 'Discover recurring anti-patterns worth codifying as rules',
        argumentHint: '[<path-or-glob>]',
        allowedTools: ['Bash', 'Read', 'Grep', 'Glob', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:spur-cli', args: 'rule scan $ARGUMENTS' }] },
    },
    {
        name: 'spur-init',
        title: 'Spur Init',
        description:
            "Initialize a new Spur project — scaffold config + docs, then customize for this project's stack and scope",
        argumentHint: '[--name <name>] [--minimal] [--force] [--skip-docs]',
        allowedTools: ['Bash', 'Read', 'Write', 'Skill'],
        target: {
            kind: 'composite',
            cli: 'spur init $ARGUMENTS',
            dispatches: [{ when: 'Customize (Phase 2)', skill: 'sp:doc-evolve', args: 'customize --project <name>' }],
        },
    },
    {
        name: 'workflow-add',
        title: 'Workflow Add',
        description: 'Author a validated, dry-run-verified workflow in the right execution mode',
        argumentHint: '"<description>" [--kind <state-machine|transition-flow>] [--file <path>]',
        allowedTools: ['Bash', 'Read', 'Write', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:spur-cli', args: 'workflow add $ARGUMENTS' }] },
    },
    {
        name: 'workflow-refine',
        title: 'Workflow Refine',
        description: 'Refine an existing workflow, then re-validate and re-dry-run it',
        argumentHint: '<workflow-file> [--intent "<goal>"] [--dry-run]',
        allowedTools: ['Bash', 'Read', 'Edit', 'Skill'],
        target: { kind: 'skill', dispatches: [{ skill: 'sp:spur-cli', args: 'workflow refine $ARGUMENTS' }] },
    },
];

/** Lookup by command name. */
export const COMMAND_BY_NAME: ReadonlyMap<string, CommandMeta> = new Map(COMMANDS.map((c) => [c.name, c]));
