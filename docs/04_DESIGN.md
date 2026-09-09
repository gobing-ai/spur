---
doc: 04_DESIGN
owns: SURFACE — index of non-UI CLI, API, config, schema and boundary contracts
authority: derived
version: 1.73.0
derived_from: [03_ARCHITECTURE, codebase]
owner: Robin Min
updated_at: 2026-09-09
read_before: changing a command, flag, env var, or schema
edit_rules: 99 §6.5
sync: [T3, T9]
---

# 04 Design — Spur

Non-UI contract index. Detailed signatures, schemas and boundary behavior live in the linked
satellites. Feature state and execution evidence belong in their tool-owned records.

## UI/UX boundary & DESIGN.md

Root [DESIGN.md](../DESIGN.md) owns visual and interaction design;
[03 Architecture](03_ARCHITECTURE.md) owns system mechanisms.

## 0. Design satellites (`docs/design/`)

| Area | Reference |
| --- | --- |
| CLI grammar, initialization, agents, teams and rules | [cli-contracts](design/cli-contracts.md) |
| History CLI and refresh contracts | [history-cli-contracts](design/history-cli-contracts.md) |
| Feature sync and agent command contracts | [planning-command-contracts](design/planning-command-contracts.md) |
| Configuration and asset contracts | [configuration-contracts](design/configuration-contracts.md) |
| Data and output contracts | [data-output-contracts](design/data-output-contracts.md) |
| Server bootstrap and scheduler contracts | [server-contracts](design/server-contracts.md) |
| Planning records and lifecycle contracts | [planning-record-contracts](design/planning-record-contracts.md) |
| Planning workflow and operation contracts | [planning-workflow-contracts](design/planning-workflow-contracts.md) |
| Observability and HTTP read contracts | [observability-contracts](design/observability-contracts.md) |
| Essential workflow checks and observable execution | [essential-workflow-checks.md](design/essential-workflow-checks.md) |
| Executor availability | [executor-availability.md](design/executor-availability.md) |
| rd3 Migration — System Design | [rd3-migration-design.md](design/rd3-migration-design.md) |
| Server-Side Adjustment — Design | [server-side-adjustment-design.md](design/server-side-adjustment-design.md) |
| Server-Side Adjustment — Finalized Feature List | [server-side-adjustment-feature-finalized.md](design/server-side-adjustment-feature-finalized.md) |
| Spur Team Mode — Design Document | [spur-team-mode-design.md](design/spur-team-mode-design.md) |
| Workflow run observability | [workflow-observability.md](design/workflow-observability.md) |
| Workflow composition contract | [workflow-composition-contract.md](design/workflow-composition-contract.md) |
| Workflow shell ownership surface (feature D6, task 0608; amended by 0625) | [workflow-shell-ownership.md](design/workflow-shell-ownership.md) |
| Design — `/sp:dev-plan` design-doc generation (design by default / `--skip-design`) | [dev-plan-design-doc-generation.md](design/dev-plan-design-doc-generation.md) |
| Design — `--agent` on critical dev-* commands + `sp:dogfood-testing` extraction | [dev-agent-flag-and-dogfood-skill.md](design/dev-agent-flag-and-dogfood-skill.md) |
| Historical inline-host contract — superseded by ADR-087 | [agent-inline-host-session.md](design/agent-inline-host-session.md) |
| Design — Dev-command argument contract | [dev-command-argument-contract.md](design/dev-command-argument-contract.md) |
| End-to-end workflow proposal | [e2e-workflow-for-system-development.md](design/e2e-workflow-for-system-development.md) |
| Design — Portable `AGENTS.md` harness contract | [portable-agents-harness-contract.md](design/portable-agents-harness-contract.md) |
| Feature-tree status affordance — design | [feature-tree-status-affordance.md](design/feature-tree-status-affordance.md) |
| Feature action-progress design | [feature-action-progress-transparency.md](design/feature-action-progress-transparency.md) |
| Feature check `--strict`: AC satisfaction (tasks 0340, 0410, 0561, 0672) | [feature-check-strict-ac-satisfaction.md](design/feature-check-strict-ac-satisfaction.md) |
| Lifecycle Projection Integrity (task 0625) | [lifecycle-projection-integrity.md](design/lifecycle-projection-integrity.md) |
| History Data Processing Architecture — Ingestion, Materialization, and Query Plane | [history-data-processing.md](design/history-data-processing.md) |
| Tool Call Arguments Extraction, Ingestion Diagnostics, and Field Provenance Standard Procedure | [history-importer-arguments-provenance.md](design/history-importer-arguments-provenance.md) |
| History Refresh Process Isolation and Single-Flight Execution | [history-refresh-process-isolation.md](design/history-refresh-process-isolation.md) |
| History Incremental Materialization — Refresh Watermark, Bucket-Scoped Rollups, and Precomputed Serving | [history-incremental-materialization.md](design/history-incremental-materialization.md) |
| Project switcher — system design (feature K1) | [project-switcher.md](design/project-switcher.md) |
| Inbox Board module — durable message plane | [inbox-board-module.md](design/inbox-board-module.md) |
| Workflow run log (all-in-one per-run log) | [workflow-run-log.md](design/workflow-run-log.md) |
| Brainstorm: Workflow observability, traceability, live output, and steering for `spur workflow run` | [brainstorm-workflow-observability-steering.md](design/brainstorm-workflow-observability-steering.md) |
| Cross-process workflow steering control channel | [workflow-steering-control-channel.md](design/workflow-steering-control-channel.md) |
| Spur Board UI Layout Optimization & Global Orchestrator Agent Interface — Design | [board-ui-layout-and-global-agent-bar.md](design/board-ui-layout-and-global-agent-bar.md) |
| Workspace Board module — team-scoped composition | [workspace-design.md](design/workspace-design.md) |
| Plugin-Surface Parity Harness — design | [plugin-surface-parity.md](design/plugin-surface-parity.md) |
| Actionable observability context | [actionable-observability-context.md](design/actionable-observability-context.md) |
| System Events human table projection | [system-events-human-table.md](design/system-events-human-table.md) |
| Inter-agent control plane | [inter-agent-control-plane.md](design/inter-agent-control-plane.md) |
| Historical spine cost/drift measurement — analysis only | [dev-spine-cost-and-drift.md](design/dev-spine-cost-and-drift.md) |
| Event tracking — System Event 5W1H SSOT | [event-tracking.md](design/event-tracking.md) |
| Run-record proposal — implementation deferred | [run-record-contract.md](design/run-record-contract.md) |
| Board module-boundary recommendations | [board-module-boundaries.md](design/board-module-boundaries.md) |
| History Board module — Conversation Analytics & Agent Forensic Plane | [history-board-module.md](design/history-board-module.md) |
| Design Satellite: History Board Tool Using Tab | [history-board-tool-using-tab.md](design/history-board-tool-using-tab.md) |
| Observability Board module — Frontend Enhancement & Tab Consolidation | [observability-frontend-enhancement.md](design/observability-frontend-enhancement.md) |
| Observability Board Module Refactor: Summary Tab, 4h Default, Truthful Jobs Table, and Schedule Tracing | [observability-module-refactor.md](design/observability-module-refactor.md) |
| Harness surface governance | [harness-surface-governance.md](design/harness-surface-governance.md) |
| Features Board layout design | [features-board-layout-refactor.md](design/features-board-layout-refactor.md) |
| Universal config loading | [universal-config-loading.md](design/universal-config-loading.md) |
| Agent doctor as the routing inspection surface | [agent-doctor-inspection-surface.md](design/agent-doctor-inspection-surface.md) |
| Tasks Module — History-Shell Parity (F72) | [tasks-module-shell-parity.md](design/tasks-module-shell-parity.md) |
| History anatomy: daily cache, ad-hoc diagnosis, and bounded migration | [history-anatomy.md](design/history-anatomy.md) |
| Environment-improvement lens | [environment-improvement-lens.md](design/environment-improvement-lens.md) |
| Active session review | [session-review.md](design/session-review.md) |
| Execution deadlines and renewable job ownership | [execution-deadlines.md](design/execution-deadlines.md) |
| System-event ingestion and presentation | [observabilities-module-polish.md](design/observabilities-module-polish.md) |
| Task creation and readiness | [task-creation-readiness.md](design/task-creation-readiness.md) |
| Historical forensics measurement (2026-08-17; evidence, not a current contract) | [sqlite-forensics-token-time-per-step.md](design/sqlite-forensics-token-time-per-step.md) |

Existing section headings below forward to their detailed owners so historical references remain valid.

## 1. CLI Surface

See [contract detail](design/cli-contracts.md#1-cli-surface).

### 1.0 CLI grammar

See [contract detail](design/cli-contracts.md#10-cli-grammar).

### 1.0.1 Shared option registry (0618)

See [contract detail](design/cli-contracts.md#101-shared-option-registry-0618).

### 1.1 Committed product commands

See [contract detail](design/cli-contracts.md#11-committed-product-commands).

#### `spur init [--name <name>] [--force] [--minimal] [--json]`

See [contract detail](design/cli-contracts.md#spur-init---name-name---force---minimal---json).

#### `spur builder bump-ver <package-id|--all> <version> [--push]` · `spur builder drop-tags <package-id|--all> <version> [--remote]`

See [contract detail](design/cli-contracts.md#spur-builder-bump-ver-package-id--all-version---push--spur-builder-drop-tags-package-id--all-version---remote).

#### `spur agent run <prompt> [--agent <name>] [--spec <id>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--drain] [--json]`

See [contract detail](design/cli-contracts.md#spur-agent-run-prompt---agent-name---spec-id---continue---model-name---mode-mode---cwd-path---drain---json).

#### `spur agent list [--json] [--specs]`

See [contract detail](design/cli-contracts.md#spur-agent-list---json---specs).

#### `spur agent doctor [agent] [--json] [--probe-health] [--force-refresh]`

See [contract detail](design/cli-contracts.md#spur-agent-doctor-agent---json---probe-health---force-refresh).

#### `spur agent create <id> --type <agent-type> [--json] [flags]` · `spur agent edit <id>` · `spur agent delete <id> [--force]`

See [contract detail](design/cli-contracts.md#spur-agent-create-id---type-agent-type---json-flags--spur-agent-edit-id--spur-agent-delete-id---force).

#### `spur agent wait [<specId>] [--role <name>] [--run <runId>] [--until <state>...] [--timeout <ms>] [--json]` · `spur message send (--to <id>|--role <name>) <body> [--from <id>] [--wait] [--until injected|invoke-exit] [--timeout <ms>] [--json]`

See [contract detail](design/cli-contracts.md#spur-agent-wait-specid---role-name---run-runid---until-state---timeout-ms---json--spur-message-send---to-id--role-name-body---from-id---wait---until-injectedinvoke-exit---timeout-ms---json).

#### `spur message send --to <id> <body> [--from <id>] [--wait] [--until injected|invoke-exit] [--timeout <ms>] [--json]` · `spur message inbox --agent <id> [--json]` · `spur message reply <msg-id> <body> [--json]` · `spur message watch --agent <id> [--interval <ms>] [--json]`

See [contract detail](design/cli-contracts.md#spur-message-send---to-id-body---from-id---wait---until-injectedinvoke-exit---timeout-ms---json--spur-message-inbox---agent-id---json--spur-message-reply-msg-id-body---json--spur-message-watch---agent-id---interval-ms---json).

#### `spur team assign <task-id> <agent-id>` · `spur team status [--json] [--by-team] [--server <url>]` · `spur team up <team> [--check] [--server <url>] [--json]` · `spur team down <team> [--purge] [--server <url>] [--json]` · `spur team start <agent-id> [--server <url>] [--json]` · `spur team stop <agent-id> [--server <url>] [--json]`

See [contract detail](design/cli-contracts.md#spur-team-assign-task-id-agent-id--spur-team-status---json---by-team---server-url--spur-team-up-team---check---server-url---json--spur-team-down-team---purge---server-url---json--spur-team-start-agent-id---server-url---json--spur-team-stop-agent-id---server-url---json).

#### `spur rule run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <severity>] [--stop-on-first [<severity>]] [--fix-mode <mode>] [--dry-run] [--verbose] [--json]`

See [contract detail](design/cli-contracts.md#spur-rule-run---preset-name---file-path---rule-id---fail-on-severity---stop-on-first-severity---fix-mode-mode---dry-run---verbose---json).

#### `spur rule validate [--file <path>|--preset <name>|<path>] [--kind <type>] [--no-schema] [--json]` · `spur rule list [--preset <name>] [--json]` · `spur rule trace [run-id] [--preset <name>] [--status <s>] [--since <date>] [--last <n>] [--json]`

See [contract detail](design/cli-contracts.md#spur-rule-validate---file-path--preset-namepath---kind-type---no-schema---json--spur-rule-list---preset-name---json--spur-rule-trace-run-id---preset-name---status-s---since-date---last-n---json).

#### `spur workflow show <workflow.yaml> [--format <mermaid|todo>] [--json]` · `spur workflow validate <workflow.yaml> [--json] [--no-schema]` · `spur workflow run <workflow.yaml> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan] [--detail <minimal|invocation|full>] [--quiet|--silent|--verbose] [--trace-file] [--steer] [--no-log] [--json]` · `spur workflow continue [run-id] [--yes] [--answer <yes|no|cancel>] [--json]` · `spur workflow cancel <run-id> [--json]` · `spur workflow list [--json]` · `spur workflow trace [run-id] [--workflow <name>] [--status <s>] [--since <date>] [--last <n>] [--follow] [--poll <ms>] [--output] [--json]` · `spur workflow clean [--older-than <minutes>] [--force] [--logs] [--dry-run] [--json]`

See [contract detail](design/cli-contracts.md#spur-workflow-show-workflowyaml---format-mermaidtodo---json--spur-workflow-validate-workflowyaml---json---no-schema--spur-workflow-run-workflowyaml---run-id-id---vars-json---dry-run---async---no-plan---detail-minimalinvocationfull---quiet--silent--verbose---trace-file---steer---no-log---json--spur-workflow-continue-run-id---yes---answer-yesnocancel---json--spur-workflow-cancel-run-id---json--spur-workflow-list---json--spur-workflow-trace-run-id---workflow-name---status-s---since-date---last-n---follow---poll-ms---output---json--spur-workflow-clean---older-than-minutes---force---logs---dry-run---json).

#### `spur history import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--dry-run] [--source-timeout <ms|none>] [--json]`

See [contract detail](design/history-cli-contracts.md#spur-history-import---source-source---file-path--root-path---mode-mode---dry-run---source-timeout-msnone---json).

##### Assistant-step duration provenance — `duration_source` (task 0702 R2, T3)

See [contract detail](design/history-cli-contracts.md#assistant-step-duration-provenance--duration_source-task-0702-r2-t3).

#### `spur history daily [--since <iso>] [--until <iso>] [--root <path>] [--source-timeout <ms|none>] [--mode <name>] [--json]`

See [contract detail](design/history-cli-contracts.md#spur-history-daily---since-iso---until-iso---root-path---source-timeout-msnone---mode-name---json).

#### `spur history analyze [--since <iso>] [--until <iso>] [--source <s|all>] [--session <id>] [--run <runId>] [--task <wbs>] [--top <n>] [--out <path>] [--json]`

See [contract detail](design/history-cli-contracts.md#spur-history-analyze---since-iso---until-iso---source-sall---session-id---run-runid---task-wbs---top-n---out-path---json).

#### `spur history reset --yes [--json]`

See [contract detail](design/history-cli-contracts.md#spur-history-reset---yes---json).

#### `spur history report [path] [--mode <name>] [--task <wbs>] [--top <n>] [--json]`

See [contract detail](design/history-cli-contracts.md#spur-history-report-path---mode-name---task-wbs---top-n---json).

#### History nightly loop — scheduling surface and observability (task 0471)

See [contract detail](design/history-cli-contracts.md#history-nightly-loop--scheduling-surface-and-observability-task-0471).

#### History completion-triggered refresh — coalesced enqueue on work completion (task 0549)

See [contract detail](design/history-cli-contracts.md#history-completion-triggered-refresh--coalesced-enqueue-on-work-completion-task-0549).

#### `spur feature sync [id] [--all] [--dry-run] [--force] [--folder <path>] [--json]`

See [contract detail](design/planning-command-contracts.md#spur-feature-sync-id---all---dry-run---force---folder-path---json).

#### `spur task scaffold-tests <wbs> [--file <path>] [--folder <path>] [--json]`

See [contract detail](design/planning-command-contracts.md#spur-task-scaffold-tests-wbs---file-path---folder-path---json).

### 1.2 Supporting utilities

See [contract detail](design/planning-command-contracts.md#12-supporting-utilities).

### 1.3 Agent command surface — commands as SSOT (feature H5 (was O), ADR-032)

See [contract detail](design/planning-command-contracts.md#13-agent-command-surface--commands-as-ssot-feature-h5-was-o-adr-032).

#### 1.3.1 `/sp:dev-find-conflict` — authority-aware conflict audit (feature H11, task 0486)

See [contract detail](design/planning-command-contracts.md#131-spdev-find-conflict--authority-aware-conflict-audit-feature-h11-task-0486).

#### 1.3.2 `/sp:dev-find-next` — feature frontier prioritizer (feature H12, tasks 0497, 0498)

See [contract detail](design/planning-command-contracts.md#132-spdev-find-next--feature-frontier-prioritizer-feature-h12-tasks-0497-0498).

## 2. Configuration

See [contract detail](design/configuration-contracts.md#2-configuration).

### 2.1 Project config — `.spur/config.yaml` (ADR-017)

See [contract detail](design/configuration-contracts.md#21-project-config--spurconfigyaml-adr-017).

### 2.2 App config — `@gobing-ai/spur-config` (Zod)

See [contract detail](design/configuration-contracts.md#22-app-config--gobing-aispur-config-zod).

### 2.3 Default config assets — repo-root `./config` (ADR-015)

See [contract detail](design/configuration-contracts.md#23-default-config-assets--repo-root-config-adr-015).

### 2.4 Config loader — single facade in `@gobing-ai/spur-config` (ADR-027)

See [contract detail](design/configuration-contracts.md#24-config-loader--single-facade-in-gobing-aispur-config-adr-027).

### 2.5 Transition-shim manifest & gate (task 0541, feature B2)

See [contract detail](design/configuration-contracts.md#25-transition-shim-manifest--gate-task-0541-feature-b2).

### 2.6 Plugin-script contract manifest & gate (task 0600, ADR-065)

See [contract detail](design/configuration-contracts.md#26-plugin-script-contract-manifest--gate-task-0600-adr-065).

## 3. Data Shapes

See [contract detail](design/data-output-contracts.md#3-data-shapes).

### 3.1 Tables (composed package-owned schema, ADR-007)

See [contract detail](design/data-output-contracts.md#31-tables-composed-package-owned-schema-adr-007).

### 3.2 SourceDefinition (history import)

See [contract detail](design/data-output-contracts.md#32-sourcedefinition-history-import).

### 3.3 Analytics records

See [contract detail](design/data-output-contracts.md#33-analytics-records).

## 4. Output Conventions

See [contract detail](design/data-output-contracts.md#4-output-conventions).

### 4.1 CLI `--json` shape inventory (F95 / task 0693, swept 2026-08-27 @ emit set below)

See [contract detail](design/data-output-contracts.md#41-cli---json-shape-inventory-f95--task-0693-swept-2026-08-27--emit-set-below).

### 4.2 Citation convention — prefer `path:symbol` over `path:line` (task 0694, F94)

See [contract detail](design/data-output-contracts.md#42-citation-convention--prefer-pathsymbol-over-pathline-task-0694-f94).

## 5. Server/Web Surface (current slice)

See [contract detail](design/server-contracts.md#5-serverweb-surface-current-slice).

### 5.1 Bootstrap (ADR-019, ADR-036)

See [contract detail](design/server-contracts.md#51-bootstrap-adr-019-adr-036).

### 5.2 Scheduler surface — `bootstrap.scheduler` (task 0734)

See [contract detail](design/server-contracts.md#52-scheduler-surface--bootstrapscheduler-task-0734).

## 6. Plugin System (Removed — ADR-012 amended 2026-06-09)

See [contract detail](design/server-contracts.md#6-plugin-system-removed--adr-012-amended-2026-06-09).

### 6.1 Current state

See [contract detail](design/server-contracts.md#61-current-state).

### 6.2 Deferred (not permanently rejected)

See [contract detail](design/server-contracts.md#62-deferred-not-permanently-rejected).

## 7. Planning Layer Surface (reserved — ADR-020; filled by Roadmap §1.5 Stage D)

See [contract detail](design/planning-record-contracts.md#7-planning-layer-surface-reserved--adr-020-filled-by-roadmap-15-stage-d).

### 7.1 `spur task` commands

See [contract detail](design/planning-record-contracts.md#71-spur-task-commands).

### 7.2 `spur feature` commands

See [contract detail](design/planning-record-contracts.md#72-spur-feature-commands).

### 7.3 Frontmatter schemas

See [contract detail](design/planning-record-contracts.md#73-frontmatter-schemas).

### 7.3.1 Task frontmatter — `taskFrontmatterSchema`

See [contract detail](design/planning-record-contracts.md#731-task-frontmatter--taskfrontmatterschema).

### 7.3.2 Feature frontmatter — `featureFrontmatterSchema`

See [contract detail](design/planning-record-contracts.md#732-feature-frontmatter--featurefrontmatterschema).

### 7.3.3 Canonical status vocabularies

See [contract detail](design/planning-record-contracts.md#733-canonical-status-vocabularies).

### 7.4 Section-Status-Matrix + planning event catalog

See [contract detail](design/planning-record-contracts.md#74-section-status-matrix--planning-event-catalog).

### 7.5 Lifecycle workflow definitions

See [contract detail](design/planning-workflow-contracts.md#75-lifecycle-workflow-definitions).

#### Agent capability attestation

See [contract detail](design/planning-workflow-contracts.md#agent-capability-attestation).

### 7.6 Task DTOs (oRPC contract)

See [contract detail](design/planning-workflow-contracts.md#76-task-dtos-orpc-contract).

### 7.7 Workflow action primitives for anti-hallucination (ADR-024)

See [contract detail](design/planning-workflow-contracts.md#77-workflow-action-primitives-for-anti-hallucination-adr-024).

### 7.8 `sp:dev-*` command operations

See [contract detail](design/planning-workflow-contracts.md#78-spdev--command-operations).

### 7.8a Process inventory (Observability → Processes)

See [contract detail](design/observability-contracts.md#78a-process-inventory-observability--processes).

### 7.8b Tool-use ledger (Observability → Tool Using)

See [contract detail](design/observability-contracts.md#78b-tool-use-ledger-observability--tool-using).

### 7.8c Observability Summary aggregations

See [contract detail](design/observability-contracts.md#78c-observability-summary-aggregations).

### 7.9 System Event catalog

See [contract detail](design/observability-contracts.md#79-system-event-catalog).

### 7.10 System event correlation columns (task 0369)

See [contract detail](design/observability-contracts.md#710-system-event-correlation-columns-task-0369).

## Workflow run-store read API (0373)

See [contract detail](design/observability-contracts.md#workflow-run-store-read-api-0373).

## Team + Message HTTP Routes (0256)

See [contract detail](design/observability-contracts.md#team--message-http-routes-0256).

### Team routes (`apps/server/src/modules/team/index.ts`)

See [contract detail](design/observability-contracts.md#team-routes-appsserversrcmodulesteamindexts).

### Message routes (`apps/server/src/modules/messages/index.ts`)

See [contract detail](design/observability-contracts.md#message-routes-appsserversrcmodulesmessagesindexts).
