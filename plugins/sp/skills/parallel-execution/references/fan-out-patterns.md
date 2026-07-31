---
name: fan-out-patterns
description: "Catalog of proven fan-out shapes with per-pattern token-cost estimates, when-to-use decision tables, and anti-patterns."
see_also:
  - parallel-execution
  - result-synthesis
---

# Fan-Out Patterns

Four proven patterns for parallel subagent execution. Each pattern has a distinct work shape, cost profile, and result expectation. **Match the work shape to the pattern** — don't force a pattern onto mismatched work.

## Pattern catalog

### 1. N-way Investigation

**Use when:** One question, N independent search angles. Each subagent searches a different dimension — by file, by pattern, by subsystem, by time range. The angles are blind to each other by design (multi-modal sweep).

**Token cost:** ~N × 3k tokens per subagent + ~2k synthesis.

**Decision criteria:**

- Single question with multiple search strategies
- No dependency between search angles
- Results must be deduped (different angles may find the same thing)

**Example:** "Find all hardcoded secrets in this codebase" → subagent 1 scans by regex, subagent 2 scans by entropy, subagent 3 scans config files, subagent 4 scans CI/CD.

**Anti-pattern:** Using N-way investigation when one angle would find everything. If `rg "API_KEY"` covers 90%, don't fan out 4 ways to find the last 10% — the marginal gain doesn't justify the cost.

### 2. Competency-Lens Review

**Use when:** One artifact (PR, diff, design doc), N review dimensions. Each subagent reviews through a single lens (correctness, security, performance, maintainability, usability). This is the pattern behind adversarial verification.

**Token cost:** ~N × 5k tokens per subagent + ~3k synthesis.

**Decision criteria:**

- Single artifact with multiple quality dimensions
- Dimensions are independent (security findings don't depend on perf findings)
- Synthesis must surface conflicts (e.g., perf improvement that weakens security)

**Example:** Code review of a PR → correctness lens, security lens, efficiency lens, maintainability lens. Each subagent produces per-lens findings; synthesis merges into a unified P1–P4 table.

**Anti-pattern:** Using competency-lens review when a single reviewer would catch everything. For a 20-line change, one thorough review beats 3 shallow ones.

### 3. Independent-Task Batch

**Use when:** M tasks with zero dependency edges between them. Each task runs through its pipeline independently. This is the `sp:super-planner` parallel mode.

**Token cost:** ~M × 8k tokens per task + ~3k batch synthesis.

**Decision criteria:**

- Multiple tasks from the same batch
- Topo-sort confirms zero dependency edges between the selected subset
- No file-overlap conflicts (different tasks touch different files)
- Token budget supports M parallel runs

**Example:** Feature A1 decomposes into 5 tasks. Topo-sort shows tasks 2, 3, and 4 have no dependencies on each other → fan out 3-way. Tasks 1 and 5 are sequential (5 depends on 1).

**Anti-pattern:** Fanning out tasks that touch the same files. Two tasks both editing `src/auth/login.ts` WILL produce a merge conflict. Serialize or assign to one subagent.

### 4. Adversarial Verification Panel

**Use when:** One claim needs N independent skeptics. Each subagent tries to REFUTE the claim. A claim survives if ≥2/3 affirm. This is the highest-confidence verification pattern.

**Token cost:** ~N × 4k tokens per subagent + ~2k synthesis.

**Decision criteria:**

- Single factual or testable claim
- Subagents are prompted to REFUTE (adversarial stance)
- Vote threshold: ≥ majority must affirm for the claim to survive
- Use odd N (3, 5) to avoid ties

**Example:** "This refactoring preserves all existing behavior" → 3 subagents independently try to find counterexamples. 2/3 find none → claim survives. 1/3 finds a break → claim is refuted, finding logged.

**Anti-pattern:** Using adversarial panel for subjective questions. "Is this code readable?" has no objective refutation criteria — use competency-lens review instead.

## When-to-use decision table

| Work shape | Pattern | N recommended |
| ------------ | --------- | --------------- |
| One question, multiple search angles | N-way investigation | 3–5 |
| One artifact, multiple quality dimensions | Competency-lens review | 3–4 |
| M independent tasks | Independent-task batch | 2–8 (budget-limited) |
| One claim, need high confidence | Adversarial panel | 3–5 (odd) |
| Sequential dependency chain | **Do not fan out** | — |
| Single file touched by multiple tasks | **Do not fan out** | — |
| Token budget < 20k remaining | **Do not fan out** | — |

## Token-budget guard

Before fanning out N subagents, check:

```
remaining_budget >= (N × per_subagent_estimate) + synthesis_estimate
```

If not: reduce N, or serialize. A fan-out that exhausts the budget mid-run leaves partial results that are worse than sequential. The driver is responsible for this check — the skill provides the estimates; the orchestrator applies them.
