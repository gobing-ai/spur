# E71 implementation readiness — 2026-09-30

All four tasks were refined inline at ready depth. Requirements and feature scenario links are retained; Design, Plan, Background, Q&A and References were updated through the task CLI. All remain todo. Production implementation, migration and deletion have not run.

| Task | Scope | Dependencies | Hours | Corrections | Status |
| --- | --- | --- | --- | --- | --- |
| 1024 | Audit run storage ownership and one-off cleanup | None | 4 | 1 | todo → todo |
| 1025 | Persist task and feature evidence outside run scratch | 1024 | 8 | 1 | todo → todo |
| 1026 | Retain run records sessions and artifacts outside scratch | 1025 | 12 | 1 | todo → todo |
| 1027 | Verify disposable scratch and reconcile cleanup safeguards | 1025, 1026 | 8 | 1 | todo → todo |

Dispatch order: **1024 → 1025 → 1026 → 1027**. Only 1024 is executable now. Later tasks have prepared specifications but must wait for verified upstream completion and integration. No agents were dispatched.

1024 produces the exhaustive ownership/cleanup inventory. 1025 publishes durable evidence and the shared migration seam. 1026 extends that seam for records, bytes, sessions and exports. 1027 closes the inventory and proves repeated completed-scratch disposal through real consumers.

Use one writer per isolated execution tree. Carry the current uncommitted E71 specs into its baseline; record the base SHA and recheck A9/I33 worktrees and overlapping source/bundle changes before dispatch. Shared-source work is sequential. Accepted design: [disposable run storage](../design/disposable-run-storage.md); planning record: [E71 brainstorm](../plans/2026-09-30-run-scratch-brainstorm.md).

All four `task check --as todo --json` results and `feature check E71 --json` pass. Task advisories only identify unfinished prerequisites; feature advisories identify unverified implementation scenarios. These are planning checks, not production verify PASS verdicts.

The evidence below freezes planning content using the existing computePlanningDigest function. Dependencies are recorded separately because that digest excludes dependency frontmatter. Re-audit changed sections or dependencies before delegation. This report supersedes the earlier idea-ready snapshots for E71; it does not repair or fabricate the earlier idea run trace.

## Ready checklist and planning digests

```json
{
  "featureId": "E71",
  "operation": "refineall",
  "depth": "ready",
  "verdict": "clean",
  "date": "2026-09-30",
  "frozenMembership": [
    "1024",
    "1025",
    "1026",
    "1027"
  ],
  "order": [
    "1024",
    "1025",
    "1026",
    "1027"
  ],
  "tasks": [
    {
      "wbs": "1024",
      "name": "Audit run storage ownership and one-off cleanup",
      "filePath": "/Users/robin/xprojects/spur-new/docs/tasks5/1024_audit-run-storage-ownership-and-one-off-cleanup.md",
      "result": "refined",
      "statusBefore": "todo",
      "statusAfter": "todo",
      "correctionsCount": 1,
      "planningDigest": "962d8357d23d7be9734c8474c68a5b572f2a98767b7d06c9c686b53f34ed9a8c",
      "dependencies": [],
      "failedChecklistIds": [],
      "checks": [
        {
          "id": "requirements",
          "pass": true,
          "evidence": "Requirements contain observable R-items; Design fixes non-goals, source ownership, budget and partial-result stop conditions."
        },
        {
          "id": "design",
          "pass": true,
          "evidence": "Exact audit output, row schema, source scan and coverage equality frozen; no new product API or production mutation. Inventory is the explicit handoff to 1025/1026/1027."
        },
        {
          "id": "plan",
          "pass": true,
          "evidence": "Ordered Plan begins with isolated-tree/current-baseline preparation and ends with named verification; Design supplies per-requirement checks and dependency outputs."
        },
        {
          "id": "ac",
          "pass": true,
          "evidence": "Task-local numbered ACs bind all requirements to matching E71 feature scenario titles; CLI structural/traceability check passes."
        },
        {
          "id": "decisions",
          "pass": true,
          "evidence": "Q&A closes storage policy, shared ownership and execution sequencing; 1024 owns discovery of additional concrete references before 1025 dispatch. Accepted ADR-131 and design linked."
        },
        {
          "id": "dependencies",
          "pass": true,
          "evidence": "No prerequisites. Audit outputs explicitly assigned to 1025/1026/1027."
        },
        {
          "id": "premises",
          "pass": true,
          "evidence": "Existing tracked coverage parser: packages/app/src/services/task-record.ts:307; remaining structured verdict dependency: packages/app/src/services/verified-outcome.ts:208; legacy log root: packages/app/src/services/workflow-service.ts:932. Regenerate lexical discovery; saved scratch receipts are optional."
        }
      ],
      "structuralCheck": [
        {
          "wbs": "1024",
          "status": "todo",
          "findings": [],
          "requiredSections": [
            "Background",
            "Acceptance Criteria",
            "Design",
            "Plan"
          ],
          "missingSections": [],
          "pass": true,
          "notes": [],
          "repairs": []
        }
      ]
    },
    {
      "wbs": "1025",
      "name": "Persist task and feature evidence outside run scratch",
      "filePath": "/Users/robin/xprojects/spur-new/docs/tasks5/1025_persist-task-and-feature-evidence-outside-run-scratch.md",
      "result": "refined",
      "statusBefore": "todo",
      "statusAfter": "todo",
      "correctionsCount": 1,
      "planningDigest": "f3699b17a831d5b3de4a8eb513ac9163066bdb84a62548db35358d93982c07dc",
      "dependencies": [
        "1024"
      ],
      "failedChecklistIds": [],
      "checks": [
        {
          "id": "requirements",
          "pass": true,
          "evidence": "Requirements contain observable R-items; Design fixes non-goals, source ownership, budget and partial-result stop conditions."
        },
        {
          "id": "design",
          "pass": true,
          "evidence": "Fixed roots, runStoragePaths, WorkflowAppService migration method, result outcomes/manifest, fail-closed copy/reference ordering, canonical evidence registration and F93 fallback frozen in Design."
        },
        {
          "id": "plan",
          "pass": true,
          "evidence": "Ordered Plan begins with isolated-tree/current-baseline preparation and ends with named verification; Design supplies per-requirement checks and dependency outputs."
        },
        {
          "id": "ac",
          "pass": true,
          "evidence": "Task-local numbered ACs bind all requirements to matching E71 feature scenario titles; CLI structural/traceability check passes."
        },
        {
          "id": "decisions",
          "pass": true,
          "evidence": "Q&A closes storage policy, shared ownership and execution sequencing; 1024 owns discovery of additional concrete references before 1025 dispatch. Accepted ADR-131 and design linked."
        },
        {
          "id": "dependencies",
          "pass": true,
          "evidence": "Dependencies 1024 match frontmatter and Design inputs. Spec ready; execution waits for completed upstream outputs."
        },
        {
          "id": "premises",
          "pass": true,
          "evidence": "Tracked parser reuse: packages/app/src/services/task-record.ts:307; structured analytics fields: packages/app/src/services/verified-outcome.ts:208; dual receipts: packages/app/src/workflow/feature-verification-receipt.ts:31; separate scratch confinement: packages/app/src/workflow/actions/run-path.ts:37. New storage module is planned, not an existing API."
        }
      ],
      "structuralCheck": [
        {
          "wbs": "1025",
          "status": "todo",
          "findings": [
            {
              "layer": "L4",
              "code": "L4.prerequisite-not-done",
              "severity": "warning",
              "section": "",
              "message": "Prerequisite 1024 is todo; task 1025 is not ready until it is done"
            }
          ],
          "requiredSections": [
            "Background",
            "Acceptance Criteria",
            "Design",
            "Plan"
          ],
          "missingSections": [],
          "pass": true,
          "notes": [],
          "repairs": []
        }
      ]
    },
    {
      "wbs": "1026",
      "name": "Retain run records sessions and artifacts outside scratch",
      "filePath": "/Users/robin/xprojects/spur-new/docs/tasks5/1026_retain-run-records-sessions-and-artifacts-outside-scratch.md",
      "result": "refined",
      "statusBefore": "todo",
      "statusAfter": "todo",
      "correctionsCount": 1,
      "planningDigest": "729b6d66da1e0bf28dc29b6e0a3148f2838b2a8eb90dd4085cc478e91c63da42",
      "dependencies": [
        "1025"
      ],
      "failedChecklistIds": [],
      "checks": [
        {
          "id": "requirements",
          "pass": true,
          "evidence": "Requirements contain observable R-items; Design fixes non-goals, source ownership, budget and partial-result stop conditions."
        },
        {
          "id": "design",
          "pass": true,
          "evidence": "Consumes 1025 seam unchanged; record/session/artifact destinations, optional missing references, atomic copy/DAO ordering and worktree export frozen in Design."
        },
        {
          "id": "plan",
          "pass": true,
          "evidence": "Ordered Plan begins with isolated-tree/current-baseline preparation and ends with named verification; Design supplies per-requirement checks and dependency outputs."
        },
        {
          "id": "ac",
          "pass": true,
          "evidence": "Task-local numbered ACs bind all requirements to matching E71 feature scenario titles; CLI structural/traceability check passes."
        },
        {
          "id": "decisions",
          "pass": true,
          "evidence": "Q&A closes storage policy, shared ownership and execution sequencing; 1024 owns discovery of additional concrete references before 1025 dispatch. Accepted ADR-131 and design linked."
        },
        {
          "id": "dependencies",
          "pass": true,
          "evidence": "Dependencies 1025 match frontmatter and Design inputs. Spec ready; execution waits for completed upstream outputs."
        },
        {
          "id": "premises",
          "pass": true,
          "evidence": "Optional missing registration already exists: packages/app/src/workflow/actions/run-artifact.ts:110; retained sink owner: packages/app/src/observability/workflow-run-log-sink.ts:1; record reader owner: packages/app/src/workflow/run-record.ts:1. Source-owned history and DB trace authority remain unchanged."
        }
      ],
      "structuralCheck": [
        {
          "wbs": "1026",
          "status": "todo",
          "findings": [
            {
              "layer": "L4",
              "code": "L4.prerequisite-not-done",
              "severity": "warning",
              "section": "",
              "message": "Prerequisite 1025 is todo; task 1026 is not ready until it is done"
            }
          ],
          "requiredSections": [
            "Background",
            "Acceptance Criteria",
            "Design",
            "Plan"
          ],
          "missingSections": [],
          "pass": true,
          "notes": [],
          "repairs": []
        }
      ]
    },
    {
      "wbs": "1027",
      "name": "Verify disposable scratch and reconcile cleanup safeguards",
      "filePath": "/Users/robin/xprojects/spur-new/docs/tasks5/1027_verify-disposable-scratch-and-reconcile-cleanup-safeguards.md",
      "result": "refined",
      "statusBefore": "todo",
      "statusAfter": "todo",
      "correctionsCount": 1,
      "planningDigest": "55603502a9ea352b45c1b6839483f56696cca1f43b0259fadd8d61828405235c",
      "dependencies": [
        "1025",
        "1026"
      ],
      "failedChecklistIds": [],
      "checks": [
        {
          "id": "requirements",
          "pass": true,
          "evidence": "Requirements contain observable R-items; Design fixes non-goals, source ownership, budget and partial-result stop conditions."
        },
        {
          "id": "design",
          "pass": true,
          "evidence": "Consumes both storage slices; keep/remove criteria for freshness cleanup, live-owner protection and real-consumer repeated scratch disposal frozen in Design."
        },
        {
          "id": "plan",
          "pass": true,
          "evidence": "Ordered Plan begins with isolated-tree/current-baseline preparation and ends with named verification; Design supplies per-requirement checks and dependency outputs."
        },
        {
          "id": "ac",
          "pass": true,
          "evidence": "Task-local numbered ACs bind all requirements to matching E71 feature scenario titles; CLI structural/traceability check passes."
        },
        {
          "id": "decisions",
          "pass": true,
          "evidence": "Q&A closes storage policy, shared ownership and execution sequencing; 1024 owns discovery of additional concrete references before 1025 dispatch. Accepted ADR-131 and design linked."
        },
        {
          "id": "dependencies",
          "pass": true,
          "evidence": "Dependencies 1025, 1026 match frontmatter and Design inputs. Spec ready; execution waits for completed upstream outputs."
        },
        {
          "id": "premises",
          "pass": true,
          "evidence": "Delete-before-invoke guard: packages/app/src/workflow/actions/agent-run.ts:324; physical confinement: packages/app/src/workflow/actions/run-path.ts:37; log retention and no pair-GC policy: packages/app/src/services/workflow-service.ts:931. Disposal tests must call real readers."
        }
      ],
      "structuralCheck": [
        {
          "wbs": "1027",
          "status": "todo",
          "findings": [
            {
              "layer": "L4",
              "code": "L4.prerequisite-not-done",
              "severity": "warning",
              "section": "",
              "message": "Prerequisite 1025 is todo; task 1027 is not ready until it is done"
            },
            {
              "layer": "L4",
              "code": "L4.prerequisite-not-done",
              "severity": "warning",
              "section": "",
              "message": "Prerequisite 1026 is todo; task 1027 is not ready until it is done"
            }
          ],
          "requiredSections": [
            "Background",
            "Acceptance Criteria",
            "Design",
            "Plan"
          ],
          "missingSections": [],
          "pass": true,
          "notes": [],
          "repairs": []
        }
      ]
    }
  ],
  "featureCheck": [
    {
      "id": "E71",
      "status": "backlog",
      "findings": [
        {
          "layer": "L4",
          "code": "L4.scenario-unverified",
          "severity": "warning",
          "section": "Acceptance Criteria",
          "message": "Feature scenario \"R1 — Every run storage dependency and cleanup site has a disposition\" is linked but unverified: covering task(s) 1024 have no PASS verdict with MET requirement"
        },
        {
          "layer": "L4",
          "code": "L4.scenario-unverified",
          "severity": "warning",
          "section": "Acceptance Criteria",
          "message": "Feature scenario \"R2 — Task and feature evidence remains valid without completed scratch\" is linked but unverified: covering task(s) 1025 have no PASS verdict with MET requirement"
        },
        {
          "layer": "L4",
          "code": "L4.scenario-unverified",
          "severity": "warning",
          "section": "Acceptance Criteria",
          "message": "Feature scenario \"R3 — Retained run inspection and artifact references survive scratch removal\" is linked but unverified: covering task(s) 1026 have no PASS verdict with MET requirement"
        },
        {
          "layer": "L4",
          "code": "L4.scenario-unverified",
          "severity": "warning",
          "section": "Acceptance Criteria",
          "message": "Feature scenario \"R4 — Session history and exported results remain available outside scratch\" is linked but unverified: covering task(s) 1026 have no PASS verdict with MET requirement"
        },
        {
          "layer": "L4",
          "code": "L4.scenario-unverified",
          "severity": "warning",
          "section": "Acceptance Criteria",
          "message": "Feature scenario \"R5 — Temporary handoffs retain freshness and confinement safeguards\" is linked but unverified: covering task(s) 1027 have no PASS verdict with MET requirement"
        },
        {
          "layer": "L4",
          "code": "L4.scenario-unverified",
          "severity": "warning",
          "section": "Acceptance Criteria",
          "message": "Feature scenario \"R6 — Existing lasting data is preserved before its scratch dependency is retired\" is linked but unverified: covering task(s) 1025, 1026 have no PASS verdict with MET requirement"
        },
        {
          "layer": "L4",
          "code": "L4.scenario-unverified",
          "severity": "warning",
          "section": "Acceptance Criteria",
          "message": "Feature scenario \"R7 — Completed scratch is disposable without per-workflow cleanup machinery\" is linked but unverified: covering task(s) 1027 have no PASS verdict with MET requirement"
        }
      ],
      "requiredSections": [],
      "missingSections": [],
      "pass": true,
      "notes": [],
      "repairs": []
    }
  ]
}
```
