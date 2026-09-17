#!/usr/bin/env node
// @bun

// plugins/sp/scripts/wrapup-steps.ts
import { spawnSync } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ../ts-libs/packages/utils/dist/env.js
function getEnvVars() {
  return process.env;
}

// plugins/sp/scripts/wrapup-steps.ts
function jqPick(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== false)
      return value;
  }
  return values[values.length - 1];
}
function jqText(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}
var WBS_PATTERN = /^[0-9]{4}$/;
function spurCommand(spurBin) {
  const parts = (spurBin ?? "spur").trim().split(/\s+/).filter((p) => p.length > 0);
  return { cmd: parts[0] ?? "spur", prefix: parts.slice(1) };
}
function spur(env, args, options = {}) {
  const { cmd, prefix } = spurCommand(env.spurBin);
  const result = spawnSync(cmd, [...prefix, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    ...options.stderr === "inherit" ? { stdio: ["ignore", "pipe", "inherit"] } : {}
  });
  if (result.error !== undefined)
    return { status: result.status ?? 1, stdout: "" };
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}
function taskStatusOf(taskJson) {
  let parsed;
  try {
    parsed = JSON.parse(taskJson);
  } catch {
    return { resolved: null, present: false };
  }
  if (parsed === null || typeof parsed !== "object")
    return { resolved: null, present: false };
  const frontmatter = parsed.frontmatter;
  const fmStatus = frontmatter !== null && typeof frontmatter === "object" ? frontmatter.status : undefined;
  const status = parsed.status;
  if (fmStatus === null || fmStatus === undefined) {
    return { resolved: status ?? null, present: status !== undefined && status !== null };
  }
  return { resolved: fmStatus, present: true };
}
function statusDisplay(taskJson) {
  const { resolved } = taskStatusOf(taskJson);
  if (resolved === null || resolved === undefined || resolved === false)
    return "unresolved";
  return jqText(resolved);
}
function resolveTasks(env, options = {}) {
  const cwd = options.cwd;
  const runId = env.__runId ?? "";
  if (runId.length === 0) {
    process.stderr.write(`task-resolve: __runId is empty \u2014 refusing the legacy fixed-path fallback
`);
    return { status: "FAIL", statusFile: "", tasksFile: "", exitCode: 1 };
  }
  mkdirSync(cwd ? join(cwd, ".spur", "run") : join(".spur", "run"), { recursive: true });
  const relTasksFile = join(".spur", "run", `${runId}-wrapup-tasks.json`);
  const relReasonFile = join(".spur", "run", `${runId}-route-reason.txt`);
  const relStatusFile = join(".spur", "run", `${runId}-wrapup-resolve.status`);
  const abs = (p) => cwd ? join(cwd, p) : p;
  const writeFail = (reason) => {
    writeFileSync(abs(relReasonFile), reason);
    writeFileSync(abs(relStatusFile), `FAIL
`);
    return { status: "FAIL", statusFile: relStatusFile, tasksFile: relTasksFile, exitCode: 0 };
  };
  let parsedTasks;
  try {
    parsedTasks = JSON.parse(env.tasks ?? "");
  } catch {
    parsedTasks = undefined;
  }
  const validArray = Array.isArray(parsedTasks) && parsedTasks.every((w) => typeof w === "string" && WBS_PATTERN.test(w));
  if (!validArray) {
    process.stderr.write(`task-resolve: tasks must be a JSON array of canonical four-digit WBS strings (whitespace is rejected, not trimmed)
`);
    return writeFail("failed:tasks is not a JSON array of canonical four-digit WBS strings");
  }
  const deduped = [];
  for (const wbs of parsedTasks) {
    if (!deduped.includes(wbs))
      deduped.push(wbs);
  }
  writeFileSync(abs(relTasksFile), `${JSON.stringify(deduped)}
`);
  let unresolved = false;
  for (const wbs of deduped) {
    const shown = spur(env, ["task", "show", wbs, "--json"], { cwd });
    const status = shown.status === 0 ? statusDisplay(shown.stdout) : "unresolved";
    if (status !== "done" && status !== "cancelled") {
      process.stderr.write(`task-resolve: task ${wbs} did not resolve to a completed status (status=${status})
`);
      unresolved = true;
    }
  }
  if (unresolved) {
    return writeFail(`failed:unresolved or non-completed task (see ${relTasksFile})`);
  }
  writeFileSync(abs(relStatusFile), `PASS
`);
  return { status: "PASS", statusFile: relStatusFile, tasksFile: relTasksFile, exitCode: 0 };
}
function runMetrics(env, options = {}) {
  const cwd = options.cwd;
  const runId = env.__runId ?? "";
  mkdirSync(cwd ? join(cwd, ".spur", "run") : join(".spur", "run"), { recursive: true });
  mkdirSync(cwd ? join(cwd, ".spur", "memory") : join(".spur", "memory"), { recursive: true });
  const relStatusFile = join(".spur", "run", `${runId}-wrapup-metrics.status`);
  const relTasksFile = join(".spur", "run", `${runId}-wrapup-tasks.json`);
  const relMetricsFile = join(".spur", "memory", "wrapup-metrics.jsonl");
  const abs = (p) => cwd ? join(cwd, p) : p;
  const fail = () => {
    writeFileSync(abs(relStatusFile), `FAIL
`);
    return { status: "FAIL", statusFile: relStatusFile };
  };
  let captured;
  try {
    captured = JSON.parse(readFileSync(abs(relTasksFile), "utf8"));
  } catch {
    captured = undefined;
  }
  const validCapture = Array.isArray(captured) && captured.every((w) => typeof w === "string" && WBS_PATTERN.test(w));
  if (!validCapture) {
    process.stderr.write(`metrics-record: run-scoped task capture missing, corrupted or non-canonical \u2014 refusing to record metrics
`);
    return fail();
  }
  let metricsRc = 0;
  for (const wbs of captured) {
    const shown = spur(env, ["task", "show", wbs, "--json"], { cwd });
    const lookup = shown.status === 0 ? taskStatusOf(shown.stdout) : { resolved: null, present: false };
    if (!lookup.present) {
      process.stderr.write(`metrics-record: task ${wbs} lookup failed or was malformed \u2014 recording FAIL instead of silently omitting its metrics row
`);
      metricsRc = 1;
      continue;
    }
    const parsed = JSON.parse(shown.stdout);
    const frontmatter = parsed.frontmatter !== null && typeof parsed.frontmatter === "object" ? parsed.frontmatter : {};
    const featureId = String(jqPick(frontmatter.feature_id, parsed.feature_id, ""));
    const status2 = String(jqPick(frontmatter.status, parsed.status, "unknown"));
    let verdict = "UNKNOWN";
    const verdictPath = join(".spur", "run", `${wbs}-verdict.json`);
    if (existsSync(abs(verdictPath))) {
      try {
        const raw = jqPick(JSON.parse(readFileSync(abs(verdictPath), "utf8")).verdict, "UNKNOWN");
        const text = raw === "UNKNOWN" ? "UNKNOWN" : jqText(raw);
        if (text.length > 0)
          verdict = text;
      } catch {}
    }
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const row = { wbs, feature_id: featureId, status: status2, verdict, timestamp };
    try {
      appendFileSync(abs(relMetricsFile), `${JSON.stringify(row)}
`);
    } catch {
      process.stderr.write(`metrics-record: metrics append failed for task ${wbs} \u2014 recording FAIL instead of claiming the row landed
`);
      metricsRc = 1;
    }
  }
  const status = metricsRc === 0 ? "PASS" : "FAIL";
  writeFileSync(abs(relStatusFile), `${status}
`);
  return { status, statusFile: relStatusFile };
}
function classifySync(syncOutput, syncRc, feature, observed) {
  if (syncRc !== 0) {
    return { reason: `sync exited nonzero (rc=${syncRc})`, applied: "unreadable", syncOk: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(syncOutput);
  } catch {
    parsed = undefined;
  }
  const obj = parsed !== null && typeof parsed === "object" ? parsed : undefined;
  const proposal = obj?.proposal !== null && typeof obj?.proposal === "object" ? obj.proposal : undefined;
  const shapeOk = obj !== undefined && proposal !== undefined && typeof proposal.featureId === "string" && typeof proposal.from === "string" && typeof proposal.to === "string" && typeof obj.applied === "boolean";
  if (!shapeOk) {
    return { reason: "malformed or unreadable sync result", applied: "unreadable", syncOk: false };
  }
  const applied = obj.applied === true ? "true" : "false";
  const pFrom = String(jqPick(proposal.from, ""));
  const pTo = String(jqPick(proposal.to, ""));
  if (String(jqPick(proposal.featureId, "")) !== feature) {
    return { reason: `sync proposal does not match feature ${feature}`, applied, syncOk: false };
  }
  if (proposal.gateBlocked === true) {
    return {
      reason: "sync proposal is gate-blocked \u2014 a blocked sync is not a no-change success",
      applied,
      syncOk: false
    };
  }
  if (proposal.requiresConfirm === true) {
    return { reason: "sync proposal requires operator confirmation", applied, syncOk: false };
  }
  if (applied === "true" && observed !== pTo) {
    return {
      reason: `applied sync did not land on the proposal target (observed=${observed}, to=${pTo})`,
      applied,
      syncOk: false
    };
  }
  if (applied === "false" && (pFrom !== pTo || observed !== pTo)) {
    return {
      reason: `sync applied nothing without a from==to observed no-op (from=${pFrom}, to=${pTo}, observed=${observed})`,
      applied,
      syncOk: false
    };
  }
  return { reason: "", applied, syncOk: true };
}
function runFeatureTransition(env, options = {}) {
  const cwd = options.cwd;
  const runId = env.__runId ?? "";
  const feature = env.feature ?? "";
  mkdirSync(cwd ? join(cwd, ".spur", "run") : join(".spur", "run"), { recursive: true });
  const relStatusFile = join(".spur", "run", `${runId}-wrapup-sync.status`);
  const abs = (p) => cwd ? join(cwd, p) : p;
  if (feature.length === 0) {
    process.stderr.write(`feature-transition: vars.feature is empty \u2014 refusing no-op feature sync (mis-invocation, not a blocked sync)
`);
    return { status: "FAIL", statusFile: relStatusFile, exitCode: 1 };
  }
  let syncOutput = "";
  let syncRc = 1;
  const boundedTs = join("plugins", "sp", "scripts", "feature-sync-bounded.ts");
  const boundedArgs = [feature, "--spur-bin", env.spurBin ?? "spur", "--json"];
  if (existsSync(cwd ? join(cwd, boundedTs) : boundedTs)) {
    const result = spawnSync("bun", [boundedTs, ...boundedArgs], { cwd, encoding: "utf8" });
    syncOutput = result.stdout ?? "";
    syncRc = result.status ?? 1;
    if (result.stderr !== null && result.stderr.length > 0)
      process.stderr.write(result.stderr);
  } else {
    const probe = spawnSync("superskill", ["script", "path", "sp", "feature-sync-bounded.mjs"], {
      cwd,
      encoding: "utf8"
    });
    const twin = probe.status === 0 ? (probe.stdout ?? "").trim() : "";
    if (twin.length > 0 && existsSync(twin)) {
      const result = spawnSync("node", [twin, ...boundedArgs], { cwd, encoding: "utf8" });
      syncOutput = result.stdout ?? "";
      syncRc = result.status ?? 1;
      if (result.stderr !== null && result.stderr.length > 0)
        process.stderr.write(result.stderr);
    } else {
      const result = spur(env, ["feature", "sync", feature, "--json"], { cwd, stderr: "inherit" });
      syncOutput = result.stdout;
      syncRc = result.status;
    }
  }
  process.stdout.write(`${syncOutput}
`);
  const shown = spur(env, ["feature", "show", feature, "--json"], { cwd });
  let observed = "";
  if (shown.status === 0) {
    try {
      const parsed = JSON.parse(shown.stdout);
      const frontmatter = parsed.frontmatter !== null && typeof parsed.frontmatter === "object" ? parsed.frontmatter : {};
      const picked = jqPick(parsed.status, frontmatter.status, "");
      observed = picked === "" ? "" : jqText(picked);
    } catch {
      observed = "";
    }
  }
  if (observed.length === 0)
    observed = "unreadable";
  const classified = classifySync(syncOutput, syncRc, feature, observed);
  const { reason, applied } = classified;
  const syncOk = classified.syncOk;
  let gate = "skipped";
  if (applied === "true" || syncRc !== 0) {
    process.stdout.write(`feature-transition: sync applied or failed after a possible partial transition for ${feature} \u2014 running feature gate: ${env.featureGateCmd ?? ""}
`);
    const gateResult = spawnSync("sh", ["-c", env.featureGateCmd ?? ""], { cwd, stdio: "inherit" });
    if ((gateResult.status ?? 1) === 0) {
      gate = "PASS";
      process.stdout.write(`feature-transition: feature gate PASS for feature ${feature}
`);
    } else {
      gate = "FAIL";
      process.stderr.write(`feature-transition: feature gate FAIL for feature ${feature} \u2014 inspect findings before reporting the transition complete
`);
    }
  } else {
    process.stdout.write(`feature-transition: sync did not apply a transition (rc=${syncRc}, applied=${applied}) \u2014 feature gate skipped
`);
  }
  let syncStatus;
  if (!syncOk || gate === "FAIL") {
    syncStatus = "FAIL";
    process.stderr.write(`feature-transition: required synchronization failed for ${feature} \u2014 ${reason}; gate=${gate}
`);
  } else if (applied === "false") {
    syncStatus = "PASS";
    process.stdout.write(`feature-transition: feature sync verified for ${feature} (from==to observed at ${observed}, gate=${gate}) \u2014 explicit no-change
`);
  } else {
    syncStatus = "PASS";
    process.stdout.write(`feature-transition: feature sync verified for ${feature} (applied, observed=${observed}, gate=${gate})
`);
  }
  writeFileSync(abs(relStatusFile), `${syncStatus}
`);
  return { status: syncStatus, statusFile: relStatusFile, exitCode: 0 };
}
var WRAPUP_STEPS_USAGE = "usage: wrapup-steps.ts <resolve|metrics|feature-transition>  (env: __runId, tasks, feature, featureGateCmd, spurBin)";
function main(argv, env = getEnvVars(), options = {}) {
  const sub = argv[0];
  if (sub === "resolve")
    return resolveTasks(env, options).exitCode;
  if (sub === "metrics") {
    runMetrics(env, options);
    return 0;
  }
  if (sub === "feature-transition")
    return runFeatureTransition(env, options).exitCode;
  process.stderr.write(`${WRAPUP_STEPS_USAGE}
`);
  return 2;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  taskStatusOf,
  spurCommand,
  runMetrics,
  runFeatureTransition,
  resolveTasks,
  main,
  jqPick,
  classifySync,
  WRAPUP_STEPS_USAGE,
  WBS_PATTERN
};
