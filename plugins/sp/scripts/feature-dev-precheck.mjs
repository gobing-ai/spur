#!/usr/bin/env node
// @bun

// plugins/sp/scripts/feature-dev-precheck.ts
import { spawnSync } from "child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
var BLOCKING_STATUSES = ["backlog", "wip", "testing", "blocked"];
var KNOWN_STATUSES = ["todo", "done", "cancelled", ...BLOCKING_STATUSES];
function identityRc(featureId, runId) {
  return featureId && runId ? 0 : 1;
}
function featureIdentityMatches(raw, featureId) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && parsed.id === featureId;
}
function rosterIsNonEmptyArray(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  return Array.isArray(parsed) && parsed.length > 0;
}
function rosterContractHolds(rows) {
  const seen = new Set;
  for (const row of rows) {
    if (row === null || typeof row !== "object")
      return false;
    if (typeof row.wbs !== "string" || row.wbs.length === 0)
      return false;
    if (seen.has(row.wbs))
      return false;
    seen.add(row.wbs);
    if (typeof row.status !== "string" || !KNOWN_STATUSES.includes(row.status)) {
      return false;
    }
  }
  return true;
}
function hasBlockingStatus(rows) {
  return rows.some((row) => typeof row.status === "string" && BLOCKING_STATUSES.includes(row.status));
}
function freezeTodoList(rows) {
  return rows.filter((row) => row.status === "todo" && typeof row.wbs === "string").map((row) => row.wbs).sort().join(",");
}
function spurCommand(spurBin) {
  const parts = (spurBin ?? "spur").trim().split(/\s+/).filter((p) => p.length > 0);
  return { cmd: parts[0] ?? "spur", prefix: parts.slice(1) };
}
function readFileSyncRaw(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
function runFeatureDevPrecheck(env, options = {}) {
  const cwd = options.cwd;
  const runDir = join(".spur", "run");
  mkdirSync(cwd ? join(cwd, runDir) : runDir, { recursive: true });
  const abs = (p) => cwd ? join(cwd, p) : p;
  const featureFile = join(runDir, `${env.__runId ?? ""}-feature-dev-feature.json`);
  const rosterFile = join(runDir, `${env.__runId ?? ""}-feature-dev-roster.json`);
  const tasksFile = join(runDir, `${env.__runId ?? ""}-feature-dev-tasks.txt`);
  const statusFile = join(runDir, `${env.__runId ?? ""}-feature-dev-precheck.status`);
  const featureId = env.featureId ?? "";
  rmSync(abs(statusFile), { force: true });
  const { cmd, prefix } = spurCommand(env.spurBin);
  const read = (args, target) => {
    const result = spawnSync(cmd, [...prefix, ...args], {
      cwd,
      encoding: "utf8",
      ...options.env ? { env: { ...process.env, ...options.env } } : {}
    });
    if (result.error !== undefined) {
      writeFileSync(abs(target), `spawn failed: ${result.error.message}
`);
      return 127;
    }
    writeFileSync(abs(target), `${result.stdout ?? ""}${result.stderr ?? ""}`);
    return result.status ?? 1;
  };
  const idRc = identityRc(featureId, env.__runId);
  const showRc = idRc === 0 ? read(["feature", "show", featureId, "--json"], featureFile) : 1;
  const listRc = idRc === 0 && showRc === 0 && featureIdentityMatches(readFileSyncRaw(abs(featureFile)), featureId) ? read(["task", "list", "--feature", featureId, "--json"], rosterFile) : 1;
  const fail = (message) => {
    process.stderr.write(`${message}
`);
    writeFileSync(abs(statusFile), `FAIL
`);
    return { status: "FAIL", featureFile, rosterFile, tasksFile, statusFile, tasks: "" };
  };
  if (idRc !== 0 || showRc !== 0 || listRc !== 0) {
    return fail(`feature-dev precheck: missing featureId/runId, unknown feature '${featureId}', or unreadable roster (rc ${idRc}/${showRc}/${listRc}) \u2014 supply an existing planned feature via /sp:dev-plan or /sp:dev-idea; nothing was auto-created or re-planned`);
  }
  const rosterRaw = readFileSyncRaw(abs(rosterFile));
  if (!rosterIsNonEmptyArray(rosterRaw)) {
    return fail(`feature-dev precheck: roster at ${rosterFile} is malformed, not an array, or empty \u2014 plan the feature first via /sp:dev-plan; refusing to replan or run an empty batch`);
  }
  const rows = JSON.parse(rosterRaw);
  if (!rosterContractHolds(rows)) {
    return fail(`feature-dev precheck: roster has empty/duplicate/mismatched WBS identities or unknown statuses at ${rosterFile} \u2014 repair the task corpus; refusing to batch a broken roster`);
  }
  if (hasBlockingStatus(rows)) {
    return fail("feature-dev precheck: linked task(s) are backlog/wip/testing/blocked \u2014 refine or resume them through their own task pipelines before batching; refusing to launch overlapping work");
  }
  const tasks = freezeTodoList(rows);
  writeFileSync(abs(tasksFile), tasks);
  writeFileSync(abs(statusFile), `PASS
`);
  return { status: "PASS", featureFile, rosterFile, tasksFile, statusFile, tasks };
}
var FEATURE_DEV_PRECHECK_USAGE = "usage: feature-dev-precheck.ts  (env: featureId, __runId, optional spurBin) \u2014 no subcommands";
function main(argv, env = process.env) {
  if (argv.length > 0) {
    process.stderr.write(`${FEATURE_DEV_PRECHECK_USAGE}
`);
    return 2;
  }
  runFeatureDevPrecheck(env);
  return 0;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  spurCommand,
  runFeatureDevPrecheck,
  rosterIsNonEmptyArray,
  rosterContractHolds,
  main,
  identityRc,
  hasBlockingStatus,
  freezeTodoList,
  featureIdentityMatches,
  KNOWN_STATUSES,
  FEATURE_DEV_PRECHECK_USAGE,
  BLOCKING_STATUSES
};
