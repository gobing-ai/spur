#!/usr/bin/env node
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// plugins/sp/scripts/batch-preflight.ts
function quickReadiness(input) {
  const status = (input.status ?? "").toLowerCase();
  const operation = input.operation;
  if (operation !== "run" && operation !== "refine" && operation !== "verify") {
    return {
      action: "invalid",
      code: "IV",
      reason: `quick-readiness: unknown operation '${operation}' (${input.wbs})`
    };
  }
  if (input.filteredCount !== undefined) {
    if (input.filteredCount < 0) {
      return {
        action: "invalid",
        code: "IV",
        reason: `quick-readiness: invalid negative filtered count '${input.filteredCount}' (${input.wbs})`
      };
    }
    if (input.filteredCount === 0) {
      return {
        action: "skipped",
        code: "EMPTY",
        reason: `quick-readiness: empty status-filtered set — nothing to ${operation} (${input.wbs})`
      };
    }
  }
  if (status === "cancelled" || status === "done") {
    if (operation === "verify" && input.force === true) {
      return {
        action: "runnable",
        code: "FORCE",
        reason: `quick-readiness: verify --force re-verification of ${status} task ${input.wbs}`
      };
    }
    return {
      action: "skipped",
      code: status === "done" ? "DONE" : "CANCELLED",
      reason: `quick-readiness: already ${status} — no ${operation} hop (${input.wbs})`
    };
  }
  if (status === "blocked") {
    return {
      action: "blocked",
      code: "BLK",
      reason: `quick-readiness: blocked — human/handover first (${input.wbs})`
    };
  }
  if (operation === "run" && input.dependencies && input.dependencies.length > 0) {
    const unmet = input.dependencies.filter((d) => (input.depStatuses?.[d] ?? "missing").toLowerCase() !== "done");
    if (unmet.length > 0) {
      return {
        action: "blocked",
        code: "DEP",
        reason: `quick-readiness: unmet deps — ${unmet.join(", ")} (${input.wbs})`,
        unmetDeps: unmet
      };
    }
  }
  const required = input.requiredSections ?? [];
  const present = input.presentSections ?? [];
  const gaps = required.filter((s) => {
    const finding = input.sectionFindings?.[s];
    return !present.includes(s) || finding !== undefined && finding !== "";
  });
  if (operation === "refine") {
    if (status !== "backlog" && status !== "todo") {
      return {
        action: "skipped",
        code: "NONPLAN",
        reason: `quick-readiness: refine targets backlog/todo only, not '${status}' (${input.wbs})`
      };
    }
    return {
      action: "runnable",
      code: "OK",
      reason: `quick-readiness: refine ready for ${input.wbs} (${gaps.length} planning gap(s) to fill)`
    };
  }
  if (operation === "verify") {
    if (status !== "testing" && status !== "wip") {
      return {
        action: "invalid",
        code: "NOVERIFY",
        reason: `quick-readiness: verify needs testing/wip, not '${status}' (${input.wbs})`
      };
    }
    return {
      action: "runnable",
      code: "OK",
      reason: `quick-readiness: verify ready for ${input.wbs}`
    };
  }
  if (status !== "todo" && status !== "wip" && status !== "testing") {
    return {
      action: "invalid",
      code: "NORUN",
      reason: `quick-readiness: run needs todo/wip/testing, not '${status}' (${input.wbs})`
    };
  }
  if (gaps.length > 0) {
    return {
      action: "needs-refinement",
      code: "REFINE",
      reason: `quick-readiness: implementation sections incomplete (${input.wbs})`,
      gaps
    };
  }
  return {
    action: "runnable",
    code: "OK",
    reason: `quick-readiness: run ready for ${input.wbs}`
  };
}
function preflightTask(input) {
  const status = (input.status ?? "").toLowerCase();
  const deps = input.dependencies ?? [];
  const depStatuses = input.depStatuses ?? {};
  if (status === "cancelled") {
    return {
      action: "skip",
      code: "A9",
      reason: `dev-next: cancelled — nothing to advance (${input.wbs})`
    };
  }
  if (status === "done") {
    return {
      action: "skip",
      code: "A8",
      reason: `dev-next: already done — batch does not auto-wrap (${input.wbs})`
    };
  }
  if (status === "blocked") {
    return {
      action: "skip",
      code: "A7",
      reason: `dev-next: blocked — do not launch pipeline; human/handover first (${input.wbs})`
    };
  }
  if (status === "todo" || status === "backlog") {
    const unmet = deps.filter((d) => {
      const st = (depStatuses[d] ?? "missing").toLowerCase();
      return st !== "done";
    });
    if (unmet.length > 0) {
      return {
        action: "skip",
        code: "A2",
        reason: `dev-next: blocked by deps — unmet: ${unmet.join(", ")} (${input.wbs})`,
        unmetDeps: unmet
      };
    }
  }
  return { action: "run", code: "OK", reason: `preflight clear — launch task-pipeline for ${input.wbs}` };
}
function recoveryHint(status, wbs) {
  const st = (status ?? "").toLowerCase();
  switch (st) {
    case "backlog":
      return { code: "A1", command: `/sp:dev-refine ${wbs} --auto --next` };
    case "todo":
      return { code: "A3", command: `/sp:dev-run ${wbs} --auto --next` };
    case "wip":
      return { code: "A5", command: `/sp:dev-run ${wbs} --mode implement --auto --next` };
    case "testing":
      return { code: "A6", command: `/sp:dev-verify ${wbs} --auto --next` };
    case "blocked":
      return {
        code: "A7",
        command: `/sp:dev-handover "blocked task ${wbs} — see Notes/History"`
      };
    default:
      return null;
  }
}
function parsePreflightCliArgs(argv) {
  let status = null;
  let deps = [];
  const depStatuses = {};
  let wbs = "0000";
  let recovery = false;
  let help = false;
  let json = false;
  let operation = null;
  let force = false;
  let filteredCount = null;
  let requiredSections = [];
  let presentSections = [];
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h")
      help = true;
    else if (a === "--json")
      json = true;
    else if (a === "--recovery")
      recovery = true;
    else if (a === "--force")
      force = true;
    else if (a === "--operation") {
      const v = argv[++i] ?? "";
      operation = v === "run" || v === "refine" || v === "verify" ? v : null;
    } else if (a === "--filtered-count") {
      const v = Number(argv[++i]);
      filteredCount = Number.isFinite(v) ? v : null;
    } else if (a === "--required-sections") {
      const raw = argv[++i] ?? "";
      requiredSections = raw.length === 0 ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--present-sections") {
      const raw = argv[++i] ?? "";
      presentSections = raw.length === 0 ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--wbs")
      wbs = argv[++i] ?? wbs;
    else if (a === "--status")
      status = argv[++i] ?? null;
    else if (a === "--deps") {
      const raw = argv[++i] ?? "";
      deps = raw.length === 0 ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--dep-status") {
      const raw = argv[++i] ?? "";
      for (const part of raw.split(",")) {
        const [k, v] = part.split(":");
        if (k && v)
          depStatuses[k.trim()] = v.trim();
      }
    }
  }
  return {
    status,
    deps,
    depStatuses,
    wbs,
    recovery,
    help,
    json,
    operation,
    force,
    filteredCount,
    requiredSections,
    presentSections
  };
}
var PREFLIGHT_CLI_USAGE = `Usage:
  bun plugins/sp/scripts/batch-preflight.ts --wbs <wbs> --status <status> \\
    [--deps 0275,0276] [--dep-status 0275:done,0276:todo] [--recovery] [--json]
  bun plugins/sp/scripts/batch-preflight.ts --operation <run|refine|verify> --wbs <wbs> --status <status>     [--filtered-count <n>] [--required-sections A,B] [--present-sections A,B] [--force] [--json]

Exit: 0 = run (or recovery hint printed); 2 = skip; 1 = usage.`;
function runPreflightCli(argv) {
  const args = parsePreflightCliArgs(argv);
  if (args.help)
    return { exitCode: 0, stdout: "", stderr: PREFLIGHT_CLI_USAGE };
  if (!args.status)
    return { exitCode: 1, stdout: "", stderr: PREFLIGHT_CLI_USAGE };
  if (args.recovery) {
    const hint = recoveryHint(args.status, args.wbs);
    const body = args.json ? `${JSON.stringify({ recovery: hint }, null, 2)}
` : hint ? `${hint.command}
` : `no recovery hop
`;
    return { exitCode: 0, stdout: body, stderr: "" };
  }
  if (args.operation !== null) {
    const result2 = quickReadiness({
      wbs: args.wbs,
      status: args.status,
      operation: args.operation,
      dependencies: args.deps,
      depStatuses: args.depStatuses,
      ...args.filteredCount !== null ? { filteredCount: args.filteredCount } : {},
      ...args.requiredSections.length > 0 ? { requiredSections: args.requiredSections } : {},
      ...args.presentSections.length > 0 ? { presentSections: args.presentSections } : {},
      ...args.force ? { force: true } : {}
    });
    const runnable = result2.action === "runnable" || result2.action === "needs-refinement";
    if (args.json) {
      return { exitCode: runnable ? 0 : 2, stdout: `${JSON.stringify(result2, null, 2)}
`, stderr: "" };
    }
    return {
      exitCode: runnable ? 0 : 2,
      stdout: `${result2.action}${result2.code ? ` ${result2.code}` : ""}: ${result2.reason}
`,
      stderr: ""
    };
  }
  const result = preflightTask({
    wbs: args.wbs,
    status: args.status,
    dependencies: args.deps,
    depStatuses: args.depStatuses
  });
  if (args.json) {
    return {
      exitCode: result.action === "run" ? 0 : 2,
      stdout: `${JSON.stringify(result, null, 2)}
`,
      stderr: ""
    };
  }
  if (result.action === "run") {
    return { exitCode: 0, stdout: `run: ${result.reason ?? "ok"}
`, stderr: "" };
  }
  return {
    exitCode: 2,
    stdout: `skip ${result.code}: ${result.reason}
`,
    stderr: ""
  };
}
{
  const { exitCode, stdout, stderr } = runPreflightCli(process.argv.slice(2));
  if (stdout)
    process.stdout.write(stdout);
  if (stderr)
    process.stderr.write(`${stderr}
`);
  process.exit(exitCode);
}
export {
  runPreflightCli,
  recoveryHint,
  quickReadiness,
  preflightTask,
  parsePreflightCliArgs,
  PREFLIGHT_CLI_USAGE
};
