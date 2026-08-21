/**
 * Shared CLI option declarations — single definition site for option flag strings and
 * descriptions that are declared by more than one command module (task 0618, R1/R2).
 *
 * Membership rule: a flag string that appears in ≥2 command modules earns a registry
 * entry. Same flag string with different semantics per module (homonyms, e.g. the nine
 * `--json` texts) get distinct entries — the split preserves each command's help text
 * byte-for-byte. Where two modules share a flag with identical text there is exactly one
 * entry; where every site's text differs (per-site prose like `--dry-run`), each
 * declaration still gets its own entry so re-declaring it inline trips the parity check.
 *
 * Call sites spread: `.option(...SHARED_OPTIONS.json)`. Parser/default/collect arguments
 * stay at the call site (they are command-specific), so the registry holds exactly
 * `[flags, description]` per entry.
 *
 * `as const` is load-bearing: @commander-js/extra-typings infers `opts.json` key types
 * from literal flag strings, and a widened `string` type would break that inference.
 *
 * `apps/cli/tests/shared-option-parity.test.ts` fails when a command module re-declares
 * a registry flag string with a non-registry description (R3), and when a registry entry
 * is consumed by fewer than two distinct modules (no dead entries).
 */

/** One shared option declaration: the literal `[flags, description]` pair. */
export type SharedOption = readonly [flags: string, description: string];

/** Registry of every option shared by two or more command modules, keyed by semantic use. */
export const SHARED_OPTIONS = {
    // ── cross-command exact pairs (identical text in every declaring module) ──
    json: ['--json', 'Output machine-readable JSON'] as const,
    jsonSupported: ['--json', 'Output machine-readable JSON where supported'] as const,
    section: ['--section <name>', 'Section name to replace'] as const,
    fromFile: ['--from-file <path>', 'File to read section body from (requires --section)'] as const,
    statusFilter: ['--status <s>', 'Filter by status'] as const,
    last: ['--last <n>', 'Limit results (default 20)'] as const,
    noSchema: ['--no-schema', 'Skip schema validation'] as const,
    since: ['--since <iso-date>', 'Filter runs started on or after this date'] as const,
    timeout: ['--timeout <ms>', 'Caller deadline in milliseconds'] as const,

    // ── same flag string, different semantics per module (split preserves help text) ──
    folderTasks: ['--folder <path>', 'Custom tasks folder'] as const,
    folderFeatures: ['--folder <path>', 'Custom features folder'] as const,
    agentIdMessage: ['--agent <id>', 'Agent id'] as const,
    agentIdWatch: ['--agent <id>', 'Agent id to watch'] as const,
    agentIdLegacyRecipient: ['--agent <id>', 'Agent spec id / message recipient (legacy — prefer --spec)'] as const,
    cwdServe: ['--cwd <path>', 'Working directory'] as const,
    cwdAgent: ['--cwd <path>', 'Working directory for agent execution'] as const,
    modeAgent: ['--mode <mode>', 'Agent output mode: text|json'] as const,
    modeHistory: ['--mode <mode>', 'full|incremental|force-file'] as const,
    nameAgent: ['--name <name>', 'Agent name'] as const,
    nameProjectDisplay: ['--name <name>', 'Display name for the project'] as const,
    nameProjectInit: ['--name <name>', 'Project name (default: current directory name)'] as const,
    pollWorkflow: ['--poll <ms>', 'Follow polling interval in milliseconds'] as const,
    pollAgent: ['--poll <ms>', 'Idle poll interval in milliseconds'] as const,
    portProjects: ['--port <n>', 'Explicit port to bind'] as const,
    portServe: ['--port <n>', 'Server port (env: PORT, default: 3000)'] as const,
    priorityFilter: ['--priority <p>', 'Filter by priority'] as const,
    prioritySet: ['--priority <p>', 'Set the priority frontmatter field (P0–P3)'] as const,
    runHistory: ['--run <runId>', 'Narrow to a single workflow run id'] as const,
    runAgentPin: ['--run <runId>', 'Pin a specific run id (default: spec latest run)'] as const,
    runIdTask: ['--run-id <id>', 'Explicit run_id (auto-generated when omitted)'] as const,
    runIdWorkflow: ['--run-id <id>', 'Persisted run id for workflow run'] as const,
    sourceLink: ['--source <source>', 'Link source identifier (e.g. next-auto)'] as const,
    sourceHistory: [
        '--source <source>',
        'pi|claude|codex|gemini|opencode|antigravity|openclaw|omp|grok|agy|all',
    ] as const,
    statusDoneFailed: ['--status <status>', 'Filter by status: done, failed'] as const,
    statusDoneFailedRunning: ['--status <status>', 'Filter by status: done, failed, running'] as const,
    untilAgent: ['--until <state>', 'Lifecycle state to wait for (repeatable OR)'] as const,
    untilMessage: ['--until <state>', 'Wait target for --wait: injected|invoke-exit'] as const,
    verboseWorkflow: ['--verbose', 'Include transitions and correlation diagnostics in human progress'] as const,
    verboseRule: ['--verbose', 'Stream per-rule progress to stderr'] as const,

    // ── single-module descriptions of shared flag strings ──
    // (These texts appear in only one module, but their flag string is shared, so an
    // inline re-declaration must still trip parity. No two sites share a text, so each
    // declaration gets its own entry — there is no canonical text to unify on.)
    jsonArtifact: ['--json', 'Emit the artifact as JSON instead of the human summary'] as const,
    jsonDaily: ['--json', 'Emit the daily result as JSON'] as const,
    jsonParsedArtifact: ['--json', 'Emit the parsed artifact as JSON instead of the human report'] as const,
    jsonProjectsArray: ['--json', 'Output JSON array of projects'] as const,
    jsonProjectsResponse: ['--json', 'Output JSON response'] as const,
    jsonMessageStream: ['--json', 'Output one JSON object per new message (machine-consumable)'] as const,
    jsonServePortUrl: ['--json', 'Output { port, url, pid } and exit'] as const,
    fromFileOutcomeRows: ['--from-file <path>', 'Path to JSON array of {wbs,outcome[,reason]} rows'] as const,
    asFeature0418: [
        '--as <status>',
        'Evaluate the one-active-goal rule as if the feature were in <status> (0418: lifecycle FSM guards pass the transition target)',
    ] as const,
    asTaskF92: [
        '--as <status>',
        'Evaluate the task AS if it were in <status> (F92 R2): the lifecycle guards pass the transition target so testing→done checks the done row. Validate against canonical task statuses. Omitted → current-status diagnostics.',
    ] as const,
    dryRunFeatureMap: ['--dry-run', 'Show the old→new ID map + affected tasks without writing'] as const,
    dryRunFeatureSync: ['--dry-run', 'Report proposed status sync transitions without applying'] as const,
    dryRunHistoryScan: ['--dry-run', 'Scan without persisting imported records'] as const,
    dryRunRuleFix: ['--dry-run', 'Preview fixes without writing (use with --fix-mode auto)'] as const,
    dryRunTaskReport: ['--dry-run', 'Produce the full report without writing files'] as const,
    dryRunWorkflowValidate: ['--dry-run', 'Validate and walk transitions without executing actions'] as const,
    dryRunWorkflowClean: ['--dry-run', 'List what would be cleaned without writing (applies to both scopes)'] as const,
    featureTrace: ['--feature <id>', 'Feature ID for traceability and Goal→Background derivation'] as const,
    featureFrontmatter: ['--feature <id>', 'Set the feature_id frontmatter field (traceability edge)'] as const,
    featureFilterEdge: ['--feature <id>', 'Filter by linked feature ID (feature_id edge)'] as const,
    featureTasksRewrite: [
        '--feature <id>',
        'Restrict the ## Tasks rewrite to one feature (INDEX.md still regenerated)',
    ] as const,
    fileHistoryJsonl: ['--file <path>', 'Import one JSONL file (single-source only)'] as const,
    fileRuleAdhoc: ['--file <path>', 'Ad-hoc rule file'] as const,
    fileRuleAdhocPath: ['--file <path>', 'Ad-hoc rule file path'] as const,
    fileTaskBatch: ['--file <path>', 'Path to the batch JSON file validated against task-batch.schema.json'] as const,
    fileTaskTest: ['--file <path>', 'Custom target test file path'] as const,
    forceAgentDelete: ['--force', 'Required for delete'] as const,
    forceFeatureReopen: ['--force', 'Force applying reopen proposals without confirmation'] as const,
    forceInitRecreate: ['--force', 'Recreate files that already exist'] as const,
    forceWorkflowClean: ['--force', 'Clean ALL non-terminal runs regardless of age (overrides --older-than)'] as const,
    strictFeature: ['--strict', 'Elevate warnings to failures'] as const,
    strictTaskAll: ['--strict', 'Elevate ALL warnings to failures'] as const,
    strictTaskPath: ['--strict', 'Match only the exact corpus path (no basename-WBS fallback)'] as const,
} as const satisfies Record<string, SharedOption>;

/** Key of a shared option registry entry (semantic name, not the flag string). */
export type SharedOptionKey = keyof typeof SHARED_OPTIONS;

/** Flag strings owned by the registry (any entry). */
export const SHARED_OPTION_FLAGS: ReadonlySet<string> = new Set(
    (Object.values(SHARED_OPTIONS) as SharedOption[]).map(([flags]) => flags),
);
