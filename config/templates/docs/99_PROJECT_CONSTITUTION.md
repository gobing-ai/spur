---
name: Project Constitution
doc: 99_PROJECT_CONSTITUTION
owns: PROCESS — how the key files are maintained
authority: authoritative-on-process
version: 1.0.0
created_at: 1970-01-01T00:00:00.000Z
updated_at: 1970-01-01T00:00:00.000Z
---

# Project Constitution — How to Organize the Project

> **This is a template.** Spur's own constitution at
> [docs/99_PROJECT_CONSTITUTION.md](https://github.com/gobing-ai/spur/blob/main/docs/99_PROJECT_CONSTITUTION.md)
> is the canonical version. Copy the full content there into this file for a real project, then
> localize the Lessons section (§8) and the tool-binding column (§3).

## 1. What this is & what this is not

This is the **constitution** for the project's key files: an accumulated, machine-maintained set
of rules and lessons for running the same file structure across different projects and
cooperating with multiple coding agents (Claude Code, Codex, Gemini CLI, pi, Antigravity,
OpenCode, OpenClaw, ...).

- One copy lives in every project at `docs/99_PROJECT_CONSTITUTION.md`.
- It is **byte-identical across projects** except the Lessons sections (§8) and the tool-binding
  column (§3). When it improves in one project, propagate to the others — forks are drift.
- It contains **zero project-specific facts** — no project command names, package names, feature
  states, or decisions. Project facts live in the numbered docs this file governs.

## 2. Authority model

| Axis | Question | Winner |
|------|----------|--------|
| **Content** | What is true about the project? | Lower number wins: `00_ADR` is binding on *decisions*; `01_PRD` is authoritative on *scope*; `02`–`05` are derived |
| **Process** | How are the key files maintained? | **This file** |

## 3. Doc map

| Doc | Owns the question | Authority |
|-----|-------------------|-----------|
| `00_ADR.md` | **WHY** — decisions + one-line reason | Authoritative (wins all) |
| `01_PRD.md` | **WHAT** — product vision, scope | Authoritative on scope |
| `02_ROADMAP.md` | **WHEN** — phases, sequencing | Derived |
| `03_ARCHITECTURE.md` | **HOW** — module boundaries, data flow | Derived |
| `04_DESIGN.md` | **SURFACE** — commands, flags, schemas | Derived |
| `05_FEATURES.md` | **STATUS** — feature decomposition + state | Derived |
| `99_PROJECT_CONSTITUTION.md` | **PROCESS** — how files are maintained | Authoritative on process |

## 4. Sync triggers

When a change touches one of these, the listed doc MUST be updated in the **same commit**:

| ID | Trigger | Doc(s) |
|----|---------|--------|
| T1 | New cross-cutting decision | `00` first, then `03` mechanism |
| T3 | Command/flag/config/schema/DTO added/changed | `04` + `AGENTS.md` |
| T4 | Feature ships or changes state | `05` row |
| T6 | Scope added / cut / deferred | `01` |

## 5. Lessons

| Date | Lesson |
|------|--------|
| 1970-01-01 | _(empty — add lessons as the project evolves)_ |
