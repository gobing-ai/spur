---
name: reverse-engineering
description: "Depth-driven codebase reverse engineering with orthogonal mode, focus, and output format controls. Use for unfamiliar codebases, architecture/design reconstruction, onboarding docs, technical debt assessment, and evidence-backed audit reports."
license: Apache-2.0
version: 1.1.0
created_at: 2026-03-28
updated_at: 2026-07-09
tags: [analysis-core, reverse-engineering, hld, audit, codebase-analysis, architecture, design]
metadata:
  author: cc-agents
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: analysis-core
  interactions:
    - pipeline
    - reviewer
  severity_levels:
    - critical
    - high
    - medium
  pipeline_steps:
    - orient
    - index
    - classify
    - trace
    - synthesize
    - audit
  openclaw:
    emoji: "🔍"
see_also:
  - sp:source-driven-development
---

# sp:reverse-engineering — Codebase Reverse Engineering

Analyze unfamiliar or under-documented codebases and reconstruct their current state with evidence. The skill separates three controls:

1. **Mode**: analysis depth.
2. **Focus**: analysis lens.
3. **Format**: output encoding.

Mode must not mix action verbs, subject areas, or serialization formats. For example, `json` is a format, not a mode; `data` is a focus, not a mode; `scan` is an internal action, not a user-facing depth.

## When to Use

**Use PROACTIVELY when:**

- User shares an unfamiliar codebase or repo URL.
- User asks what a project does, how it is structured, or how it runs.
- User requests HLD, architecture docs, system design docs, ER diagrams, sequence diagrams, or onboarding docs.
- User needs a technical debt, security, maintainability, performance, or architecture audit.
- User wants to understand current state before refactoring.

**Do NOT use for:**

- Implementing code changes. Use `sp:code-implementation`.
- Debugging a specific runtime failure. Use `sp:sys-debugging`.
- Writing tests. Use `sp:test-driven-development`.
- Quick structural code search. Use grep/glob tools directly.
- Creating indexed context files. This skill may read `.spur/context/` context, but it must not create or mutate it.

## Control Model

### Mode: Analysis Depth

| Mode | Complexity | Purpose | Required Outputs | Optional Outputs |
|---|---:|---|---|---|
| `briefing` | 1 | Fast executive reconnaissance for "what is this repo?" | purpose hypothesis, tech stack, repo archetype, entry points, key manifests, top 3 risks/unknowns | dependency highlights |
| `structure` | 2 | Static repository and component map | repository tree summary, module/component table, ownership/boundary notes, dependency map, entry point map | simple component diagram |
| `architecture` | 3 | Runtime and system architecture documentation | architecture pattern, system context diagram, runtime topology, major flows, cross-cutting concerns, integration map | deployment view, sequence diagrams for main flows |
| `design` | 4 | Detailed design reconstruction for implementation understanding | architecture summary, data model, API/command/interface contracts, domain model, important sequence diagrams, ER diagram when data evidence exists | class/UML-style diagram, failure modes |
| `full` | 5 | Comprehensive reverse-engineering package | all `design` outputs plus quality/security audit, modernization roadmap, open questions, evidence index, machine-readable summary | per-module deep dives |

### Focus: Analysis Lens

Focus changes emphasis, not depth.

| Focus | Effect |
|---|---|
| `all` | Balanced coverage for the selected mode. Default. |
| `stack` | Emphasize languages, frameworks, package managers, runtimes, build tooling, and deploy tooling. |
| `dependencies` | Emphasize internal and external dependency graph, integration points, and coupling. |
| `data` | Emphasize persistence, schemas, models, repositories, migrations, and ER diagram evidence. |
| `flows` | Emphasize request, command, job, event, or business process traces and sequence diagrams. |
| `api` | Emphasize HTTP routes, RPC surfaces, CLI commands, events, SDKs, and public contracts. |
| `security` | Emphasize auth, authorization, secrets, validation, injection risk, and exposure boundaries. |
| `quality` | Emphasize maintainability, complexity, dead code, duplication, testability, and refactoring seams. |
| `performance` | Emphasize hot paths, blocking I/O, caching, query patterns, and scalability risks. |

### Format: Output Encoding

| Format | Purpose |
|---|---|
| `markdown` | Human-readable report. Default. |
| `json` | Machine-readable summary for downstream skills or automation. |
| `both` | Markdown report plus JSON summary block or output file. |

## Mode Selection Algorithm

1. Parse explicit arguments if provided:
   - `--mode briefing|structure|architecture|design|full`
   - `--focus all|stack|dependencies|data|flows|api|security|quality|performance`
   - `--format markdown|json|both`
2. If mode is missing, infer it from user intent:
   - "what is this", "quick overview", "what stack" -> `briefing`
   - "repo structure", "module map", "component map" -> `structure`
   - "architecture", "HLD", "system design" -> `architecture`
   - "ER diagram", "data model", "sequence diagram", "API contract", "detailed design" -> `design`
   - "reverse engineer everything", "full audit", "complete docs" -> `full`
3. If focus is missing, infer it from user intent:
   - stack/runtime/tooling -> `stack`
   - dependencies/integrations/coupling -> `dependencies`
   - database/schema/model/repository -> `data`
   - workflow/request lifecycle/business process -> `flows`
   - routes/endpoints/commands/events/contracts -> `api`
   - security/auth/secrets/validation -> `security`
   - tech debt/maintainability/refactor -> `quality`
   - latency/scalability/caching/queries -> `performance`
   - otherwise -> `all`
4. If format is missing:
   - Use `json` only when the user explicitly asks for machine-readable output.
   - Use `both` when the user asks for a report and reusable structured data.
   - Otherwise use `markdown`.
5. If ambiguity remains, choose the lowest depth that can satisfy the request. Prefer `architecture` for generic "analyze this codebase".

## Analysis Workflow

Execute phases in order. Stop at the phase boundary required by the selected mode unless focus or evidence requires a deeper targeted read.

### Phase 1: Orient

1. Identify project root and target path.
2. Check whether `.spur/context/anatomy.md` exists.
3. Locate manifests and config files: `package.json`, `bun.lockb`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `requirements.txt`, `pom.xml`, `build.gradle`, Docker/Kubernetes files, CI files.
4. Identify likely language, framework, package manager, runtime, and deploy model.
5. Record uncertainty when inferred from naming or layout rather than manifest evidence.

### Phase 2: Index

1. If `.spur/context/anatomy.md` exists, use it to prioritize reads and reduce token usage.
2. Otherwise use file search to build a bounded map of source, config, tests, scripts, docs, migrations, and generated/vendor directories.
3. Exclude or de-prioritize generated, vendored, build output, dependency cache, lockfile-only, binary-heavy, and snapshot-heavy paths unless they are directly relevant.
4. For monorepos, identify packages/apps and either ask for scope or analyze each package at the requested depth if feasible.

### Phase 3: Classify

Classify the codebase as one or more archetypes:

- frontend SPA / SSR / static site
- backend API / worker / service
- fullstack app
- CLI tool
- library / framework
- plugin system
- infrastructure repo
- monorepo
- mixed or unclear

Include evidence for classification, such as manifest scripts, entry files, route definitions, command declarations, exports, Docker entrypoints, or package layout.

### Phase 4: Trace

Trace only as deeply as the selected mode requires:

- `briefing`: entry points and obvious high-level modules.
- `structure`: module boundaries, package graph, and dependency direction.
- `architecture`: runtime topology, integrations, main flows, cross-cutting concerns.
- `design`: data model, interfaces/contracts, sequence flows, domain model, failure modes.
- `full`: design-level tracing plus audit, roadmap, open questions, and evidence index.

### Phase 5: Synthesize

Generate the selected format. Every factual claim about stack, entry points, modules, data, flows, APIs, integrations, and risks must include evidence when source files are available.

### Phase 6: Audit

Run audit analysis when:

- mode is `full`
- focus is `security`, `quality`, `performance`, or `all` at `architecture` depth or deeper
- user explicitly requests audit, risk, technical debt, or review

Audit categories:

| Category | What to Find | Evidence Required |
|---|---|---|
| Security | hardcoded secrets, unsafe auth, missing authorization, injection risks, unsanitized external input, exposed endpoints | `file/path:line` |
| Correctness | broken control flow, invalid assumptions, race conditions, missing error handling, data loss paths | `file/path:line` |
| Performance | N+1 queries, blocking I/O, unbounded loops, missing caching, inefficient hot paths | `file/path:line` or measured metric |
| Maintainability | oversized modules, circular dependencies, dead code, duplication, fragile abstractions | `file/path:line` or file metrics |
| Architecture | tight coupling, unclear boundaries, leaky layers, missing abstractions, inconsistent module ownership | multiple file references |

## Output Contracts

### `briefing`

```markdown
# Codebase Briefing: [Project]

| Field | Value |
|---|---|
| Analysis Date | YYYY-MM-DD |
| Target | `path` |
| Mode / Focus / Format | `briefing` / `[focus]` / `markdown` |
| Confidence | High / Medium / Low |

## Purpose Hypothesis

[1-3 sentences with evidence]

## Tech Stack

| Layer | Technology | Evidence | Confidence |
|---|---|---|---|

## Entry Points

| Entry | Purpose | Evidence |
|---|---|---|

## Top Risks / Unknowns

| Risk | Why It Matters | Evidence / Gap |
|---|---|---|
```

### `structure`

Required sections:

- Briefing summary
- Repository map
- Module/component table
- Entry point map
- Dependency map
- Boundary notes
- Optional component diagram

### `architecture`

Required sections:

- Executive summary
- Architecture pattern
- System context diagram
- Runtime topology
- Component responsibilities
- Integration map
- Main flows
- Cross-cutting concerns
- Architecture risks

### `design`

Required sections:

- Architecture summary
- Domain model
- Data model and ER diagram when evidence exists
- API/command/event/interface contracts
- Sequence diagrams for important flows
- Class/module relationship diagram when source structure supports it
- Failure modes and operational assumptions

### `full`

Required sections:

- All `design` sections
- Security, correctness, performance, maintainability, and architecture audit
- Prioritized remediation roadmap
- Open questions and unknowns
- Evidence index
- Machine-readable summary if requested or useful for downstream skills

### JSON Summary Schema

Use this shape for `--format json` or `--format both`. Omit fields only when the evidence is unavailable and include an `unknowns` entry explaining why.

```json
{
  "target": "path",
  "analysisDate": "YYYY-MM-DD",
  "mode": "architecture",
  "focus": "all",
  "confidence": "high|medium|low",
  "stack": [],
  "entryPoints": [],
  "components": [],
  "dependencies": [],
  "dataModel": [],
  "interfaces": [],
  "flows": [],
  "risks": [],
  "unknowns": [],
  "evidence": []
}
```

## Evidence Rules

- Cite `file/path:line` for claims derived from source files.
- Cite manifest paths for stack and package manager claims.
- Cite multiple files for architectural boundary claims when possible.
- Mark inferred claims with `Confidence: Medium` or `Confidence: Low`.
- Never invent services, databases, tables, endpoints, actors, diagrams, or business flows that are not supported by evidence.
- If line numbers are unavailable from a tool, cite the file path and state that line numbers were not available.

## Diagram Rules

Use Mermaid only. Every diagram must be syntactically valid and must reflect evidence.

| Diagram | Mermaid Type | When to Use |
|---|---|---|
| System context / component topology | `flowchart LR` or `graph TD` | `structure`, `architecture`, `design`, `full` |
| Runtime or business flow | `sequenceDiagram` | `architecture`, `design`, `full`, or focus `flows` |
| Data model | `erDiagram` | focus `data`, `design`, `full` when schema/model evidence exists |
| Class/module relationship | `classDiagram` | `design` or `full` when source types/classes support it |

Fallback behavior:

- If data evidence is missing, write "No reliable ER diagram can be produced from available evidence."
- If a sequence cannot be traced end-to-end, diagram only the observed partial flow and mark missing links.
- If class-level structure is too dynamic or not class-based, use a component graph instead of forcing `classDiagram`.

## Indexed Context Integration

The indexed-context layer is optional and opportunistic.

1. If `.spur/context/anatomy.md` exists, read it before raw file reads to prioritize high-value files.
2. If `.spur/context/learnings.md` exists, use it only for project preferences and known context.
3. If `.spur/context/buglog.md` exists, use it only as supporting evidence for known bug history.
4. Do not create, update, or require `.spur/context/` files.
5. Verify final claims against source files whenever source files are available.
6. If `.spur/context/` is absent, proceed normally without warning unless the user explicitly requested indexed context.

## Edge Cases

| Scenario | Handling |
|---|---|
| Empty/minimal codebase | Return `briefing` with "insufficient evidence", list missing artifacts, suggest next files needed. |
| Monorepo | Identify packages/apps; ask for scope unless `--auto` or requested mode can safely summarize all packages. |
| No clear entry point | List candidates with confidence and evidence; do not choose one as definitive. |
| Binary-heavy repo | Focus on manifests, scripts, config, docs, and visible source. |
| Generated/vendor-heavy repo | Exclude generated/vendor paths from architecture conclusions unless directly relevant. |
| Framework convention over configuration | State inferred convention and cite framework-specific file patterns. |
| Multiple languages/stacks | Report each stack separately and identify integration boundaries. |
| Missing data/schema evidence | Skip ER diagram or mark as partial. |
| Huge codebase | Produce staged output: briefing first, then deeper sections by package or focus. |

## Severity Definitions

| Severity | Criteria | Examples |
|---|---|---|
| Critical | Security risk, data loss potential, exploitable vulnerability, blocking correctness bug | SQL injection, hardcoded credentials, destructive race condition |
| High | Significant reliability, performance, maintainability, or architecture risk | N+1 query in hot path, missing auth boundary, unbounded queue growth |
| Medium | Meaningful improvement with bounded blast radius | duplication, unclear ownership, weak typing at boundary |
| Low | Cosmetic or local maintainability issue | naming inconsistency, minor docs gap |

## Platform Notes

### Claude Code

- Use available Read/Glob/Grep/LSP tools for evidence.
- For large codebases, analyze orientation and audit concerns in parallel when platform delegation is available.
- Keep final claims evidence-backed; do not rely on memory alone.

### Codex / OpenClaw / OpenCode / Antigravity / Pi

- Prefer `rg` and `rg --files` for scanning.
- Use structural tools such as `ast-grep` when available for route, class, function, and import discovery.
- Do not advertise direct analyzer scripts unless such scripts exist in this skill directory.

## Additional Resources

- **Claim verification**: `sp:source-driven-development`
