# BDD Ecosystem Research for rd3:tasks — June 10, 2026

**Context:** `rd3:tasks` currently has a free-form `## Requirements` section. The design goal is to embed structured, machine-verifiable acceptance criteria (BDD scenarios) directly in task markdown files, validate them with `tasks check`, and trace them back to feature tree nodes. This research surveys the TypeScript BDD ecosystem for libraries, formats, and architectural patterns to reference.

**Existing asset:** `rd3:bdd-workflow` already implements a hand-rolled Gherkin parser/validator (`plugins/rd3/skills/bdd-workflow/scripts/validate-feature.ts`, 543 lines) with step-to-checker mapping and LLM-interpreted scenario execution via `rd3:verification-chain`.

---

## 1. TypeScript BDD Test Libraries

### `@cucumber/cucumber` (v13.0.0)
- **npm:** `@cucumber/cucumber`, 304 dependents, published 8 days ago
- **Status:** Actively maintained. Changelog shows v12.6.0 (Jan 2026), v13.0.0 (Jun 2026). TS config file support added in v12.4.0.
- **Format:** Standard `.feature` files. Step definitions use `Given/When/Then` from `@cucumber/cucumber` with regex or Cucumber Expressions. Runs via its own runner — NOT Jest/Bun.
- **Parser chain:** `@cucumber/gherkin` (scanner/tokenizer) → `@cucumber/gherkin-utils` (AST walker/filter) → `@cucumber/cucumber-expressions` (step matching).
- **Relevance:** HIGH. The canonical BDD framework in JS/TS. Modular architecture means we can use only the parser layer without adopting the runner. The `@cucumber/gherkin` package at v39.1.0 is the official Gherkin parser — 156 dependents, mature, handles all edge cases (73+ languages, `Rule` keyword, etc.).

### `playwright-bdd` (v9.0.0)
- **npm:** `playwright-bdd`, 10 dependents, published 6 days ago
- **Status:** Very actively maintained. Converts `.feature` files into native Playwright test files, runs via `npx playwright test`.
- **Relevance:** LOW. Tightly coupled to Playwright browser testing — not relevant for CLI/file-system verification.

### `jest-cucumber` (v4.5.0)
- **npm:** `jest-cucumber`, 45 dependents, last published 2 years ago
- **Relevance:** LOW. Jest-coupled, stale. Not a parser we'd want to vendor.

---

## 2. BDD Gherkin Parsers (Standalone)

### `@cucumber/gherkin` (v39.1.0)
- **npm:** `@cucumber/gherkin`, 156 dependents, ~2M+ weekly downloads
- **Architecture:** Scanner (line-by-line tokenizer, language-aware) → Parser (GherkinDocument AST). AST includes `Feature → [Background?, Scenario[], Rule[]]`, each with `Step[]` and `Examples[]` nodes.
- **API:**
  ```typescript
  import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
  const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
  const gherkinDocument = parser.parse('Feature: ...\n Scenario: ...');
  ```
- **Relevance:** VERY HIGH. The official, well-maintained parser. However, two considerations: (a) nontrivial dependency chain; (b) our hand-rolled parser already works with 100% test coverage and is tailored to our needs (we only need a Gherkin subset). **Recommendation:** Keep the hand-rolled parser but align AST types with `@cucumber/gherkin` for compatibility.

### `@cucumber/gherkin-utils` (v11.0.0)
- **npm:** `@cucumber/gherkin-utils`, 24 dependents, ~500K weekly
- **Architecture:** `GherkinDocumentWalker` — walks and filters the AST. Can query by tag, transform, or collect scenarios.
- **Relevance:** MEDIUM. Useful for scenario querying/transformation. Not needed for basic validation.

### `gherkin-ast` / `gherkin-parse` / `gherking` ecosystem
- Low adoption, stale, or over-architected plugin pipelines.
- **Relevance:** LOW.

---

## 3. Markdown-Based BDD Tools

### Gauge (`gauge.org`, `gauge-ts` v0.3.6)
- **npm:** `gauge-ts`, ~500 weekly downloads
- **Format:** Specifications in Markdown (`.spec` or `.md`). Scenarios use `## Scenario:` headings, steps use `*` bullet items. Data tables are Markdown tables. **Closest match to our goal.**
- **Syntax:**
  ```markdown
  # Search the Internet
  ## Successful search
  * Goto Google's home page
  * Search for "gauge"
  * The page title should contain "gauge"
  ```
- **Drawback:** No Given/When/Then semantics — steps are imperative bullets. Our `bdd-workflow` relies on `Given → file-exists checker`, `When → CLI checker`, `Then → content-match checker`. Gauge's format would lose this mapping.
- **Relevance:** HIGH as a reference design — proves markdown-native BDD is viable. The Feature File Design Spec (`2026-06-10-rd3-tasks-operator-feedback.md` §Feature File Design Spec) already fills this gap: Gherkin in fenced code blocks within feature `.md` files. Gauge's markdown-first philosophy is adopted; its format is not.

### Concordion (Java), Serenity/JS (`@serenity-js/core`), SpecFlow (.NET)
- Wrong ecosystem or over-architected.
- **Relevance:** LOW.

### Key finding
**There is a gap in the TypeScript ecosystem for a markdown-native Gherkin specification format.** Embedding Gherkin code blocks directly in task markdown files fills this gap — our approach is novel but well-grounded.

---

## 4. AI Agent Skills/Tools for BDD

### Existing: `rd3:bdd-workflow`
Already implemented: Gherkin parser, step-to-checker mapping, LLM-interpreted execution, execution report schema. This is the starting point we are extending.

### Adjacent skills in this project
- `rd3:functional-review` — requirements traceability assessment
- `rd3:feature-tree` — feature decomposition, relevant for tracing scenarios to feature nodes
- `@gobing-ai/ts-dual-workflow-engine` — workflow guards replace `rd3:verification-chain` checker concepts (see `2026-06-10-rd3-tasks-operator-feedback.md` Migration Scope: "Already replaced")

### Broader ecosystem
No BDD-specific Claude Code skills or MCP tools found. While broader structured-spec-for-agents patterns exist (referenced in `2026-06-10-rd3-tasks-review-brainstorm.md` §3), this project is pioneering BDD-integrated task management for AI coding agents specifically.

---

## 5. Acceptance Criteria Formats — Comparative Analysis

| Format | Machine-Parsable | Given/When/Then | Overhead | Best For |
|---|---|---|---|---|
| **Gherkin** (`.feature`) | Yes (mature parser) | Yes | Medium | Behavior-rich features |
| **Checklist** (`- [ ]`) | Yes (simple regex) | No | Low | Simple tasks, meta-tasks |
| **Table-driven** | Yes (markdown tables) | No (data-oriented) | Medium | Parametrized verification |
| **User-story** ("As a...") | Low (free text) | No | Low | Human-readable context |

### Recommendation: two-tier format
- **Gherkin mode** (for spec tasks): Full `Feature/Scenario/Given-When-Then` blocks in fenced ` ```gherkin ` code blocks, mapped to checkers via `bdd-workflow` step-to-checker mapping.
- **Checklist mode** (for sub-tasks and meta-tasks): `- [ ] <verifiable statement>` lines. `tasks check` validates syntax; `bdd-workflow` assigns a default checker.

---

## 6. Recommended npm Packages

| Package | Version | Downloads/wk | Status | Our Use |
|---|---|---|---|---|
| `@cucumber/gherkin` | 39.1.0 | ~2M+ | Active | Type reference + optional heavy validator |
| `cucumber-tag-expressions` | latest | ~500K+ | Active | `tasks check --tags "@smoke and not @wip"` |
| — | — | — | — | **Do NOT adopt: `@cucumber/cucumber`** (too heavy, we have `verification-chain`) |
| — | — | — | — | **Do NOT adopt: `playwright-bdd`** (browser-only) |
| — | — | — | — | **Do NOT adopt: `jest-cucumber`** (stale, Jest-only) |

---

## 7. Recommendations for rd3:tasks

### 7.1 Embedding format: Markdown fenced Gherkin blocks

Add an `## Acceptance Criteria` section to the spec task template with Gherkin in fenced code blocks:

```markdown
## {{ WBS }}. {{ FEATURE_NAME }}

### Acceptance Criteria

\`\`\`gherkin
Feature: User Authentication

  Scenario: Successful login with valid credentials
    Given the user database is seeded
    And the API server is running
    When I send a POST request to "/auth/login" with valid credentials
    Then the response status should be 200
    And the response should contain a JWT token
\`\`\`
```

Keeps the task file as a single markdown document (no separate `.feature` files), leverages the existing `validate-feature.ts` parser, and `tasks check` extracts + validates the Gherkin block.

### 7.2 Adopt `@cucumber/gherkin` AST types for interoperability

Do NOT replace the hand-rolled parser wholesale (it's tested, purpose-built, dependency-free). Instead, add a type compatibility layer so our `ParsedFeature`/`ParsedScenario` types align with `@cucumber/gherkin`'s AST. This allows optionally using `@cucumber/gherkin` as an alternate validator for full Gherkin compliance.

### 7.3 Traceability: link tasks to features

**Single edge:** `feature-id` in task frontmatter → validated against `docs/features/FT-*.md` files (see Feature File Design Spec). Enforced by `tasks check`:
1. If `feature-id` is present, it must reference an existing feature file
2. If the referenced feature's `## Acceptance Criteria` contains Gherkin scenarios, verify the task covers at least one
3. Warning if the feature is `done` or `blocked` (task may be orphaned)

**`@trace()` tags are optional.** For most tasks, `feature-id` is sufficient — the feature's AC is the authority, and the task's AC section covers a subset. `@trace(FT-001)` tags on individual Gherkin scenarios are useful only for multi-feature tasks (rare) where scenarios come from different features.

### 7.4 Two-tier acceptance criteria

| Task type | AC format | Checker mapping | When to use |
|---|---|---|---|
| Sub-task | Checklist (`- [ ]`) | Default: `cli` or `content-match` | Simple implementation units |
| Spec task | Gherkin (` ```gherkin `) | `bdd-workflow` step-to-checker | Behavior-rich features |
| Meta-task | Free-form (no enforced format) | Manual review | Reviews, audits, architecture |

### 7.5 Integration with the Section-Status-Matrix

The `## Acceptance Criteria` section is **required at WIP status** for spec tasks. `tasks check` validates:
- Presence: section exists
- Syntax: Gherkin block parses cleanly (or checklist items are well-formed)
- Traceability: every scenario references a valid feature tree node (if feature tree exists)
- Coverage: at least one scenario per requirement (if `## Requirements` uses numbered items)

---

## 8. What We Already Have vs. What We Need

| Capability | Already Have (`rd3:bdd-workflow`) | Need to Add |
|---|---|---|
| Gherkin parser | Hand-rolled, 100% cover, purpose-built | Type alignment with `@cucumber/gherkin` AST |
| Step-to-checker mapping | Given/When/Then → checkers | Embed in Section-Status-Matrix config |
| Scenario execution | Via workflow guards (`@gobing-ai/ts-dual-workflow-engine`) | Auto-trigger from status transitions (P3) |
| Execution report | JSON schema | Embed in task `## Review` section (for spec tasks) or `## Verification` (for sub-tasks) |
| Feature traceability | — | `feature-id` frontmatter → `docs/features/FT-*.md` (resolved 2026-06-10) |
| Markdown embedding | — | `## Acceptance Criteria` with fenced Gherkin blocks |
| Checklist AC format | — | `- [ ]` line parser in `tasks check` |

---

## 9. Post-Design-Decision: Feature Folder simplifies traceability

The Feature File Design Spec (`2026-06-10-rd3-tasks-operator-feedback.md`) resolved the traceability design. Section 7.3 above reflects the final simplified model: a single `feature-id` edge from task to feature file. This section documents the pre-decision analysis for reference — the original recommendation of two-tier linking (`feature-id` + `@trace()` tags) was replaced once features became standalone markdown files. See the operator feedback document for the feature file format and CLI contract.

---

*Companion documents: `2026-06-10-rd3-tasks-review-brainstorm.md` (initial review), `2026-06-10-rd3-tasks-operator-feedback.md` (operator feedback & evaluation).*
