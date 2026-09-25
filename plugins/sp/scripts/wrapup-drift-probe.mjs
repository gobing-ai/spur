#!/usr/bin/env node
// @bun

// plugins/sp/scripts/wrapup-drift-probe.ts
import { spawnSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// plugins/sp/lib/env.ts
function getEnvVars() {
  return process.env;
}

// plugins/sp/scripts/wrapup-drift-probe.ts
var WORKFLOWS_GLOB = `${join("config", "workflows")}/**`;
var DOC_OWNED_SURFACES = [
  "packages/contracts/**",
  "apps/cli/src/commands/**",
  "packages/config/src/**",
  "drizzle/*.sql",
  WORKFLOWS_GLOB,
  "plugins/sp/commands/**",
  "plugins/sp/skills/**",
  "plugins/sp/hooks/**",
  "package.json",
  "docs/00_ADR.md",
  "docs/03_ARCHITECTURE.md",
  "docs/04_DESIGN.md",
  "docs/design/**"
];
var KNOWN_TOP_LEVEL = new Set([
  "apps",
  "packages",
  "plugins",
  "config",
  "docs",
  "drizzle",
  "scripts",
  "vendors",
  "package.json",
  "bun.lock",
  "bunfig.toml"
]);
var CORPUS_PREFIXES = ["docs/tasks", "docs/features/"];
function solutionSectionOf(content) {
  const heading = /^#{2,4}\s+Solution\s*$/m.exec(content);
  if (!heading)
    return null;
  const rest = content.slice(heading.index + heading[0].length);
  const next = /^#{2,4}\s+\S/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}
var CHANGE_ENTRY = /`([^`\r\n]+):(\d+)(?:-\d+)?`/g;
function changedPathsOf(section) {
  if (section === null)
    return [];
  const paths = [];
  for (const match of section.matchAll(CHANGE_ENTRY)) {
    const path = match[1];
    if (/\s/.test(path))
      continue;
    if (!path.includes("/") && !path.includes("."))
      continue;
    paths.push(path);
  }
  return paths;
}
function surfaceRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**", "\x00").replaceAll("*", "[^/]*").replaceAll("\x00", ".*");
  return new RegExp(`^${escaped}$`);
}
var SURFACE_MATCHERS = DOC_OWNED_SURFACES.map((glob) => ({ glob, regex: surfaceRegex(glob) }));
function driftReasonForPath(path) {
  if (CORPUS_PREFIXES.some((prefix) => path.startsWith(prefix)))
    return null;
  if (path.includes("/") && !KNOWN_TOP_LEVEL.has(path.split("/")[0])) {
    return "new top-level workspace directory";
  }
  const match = SURFACE_MATCHERS.find((entry) => entry.regex.test(path));
  return match ? `matches doc-owned surface ${match.glob}` : null;
}
function defaultSpurRunner(env, cwd) {
  const parts = (env.spurBin ?? "spur").split(/\s+/).filter((part) => part.length > 0);
  return (args) => {
    const run = spawnSync(parts[0], [...parts.slice(1), ...args], {
      cwd,
      encoding: "utf8",
      env: getEnvVars()
    });
    return { status: run.status ?? 1, stdout: run.stdout ?? "" };
  };
}
function runDriftProbe(env, options = {}, spur = defaultSpurRunner(env, options.cwd)) {
  const cwd = options.cwd;
  const runId = env.__runId ?? "";
  if (runId.length === 0) {
    process.stderr.write(`wrapup-drift-probe: __runId is empty \u2014 refusing the legacy fixed-path fallback
`);
    return { clean: false, reasons: [], paths: [], probeFile: "", modeFile: "", exitCode: 1 };
  }
  const relProbeFile = join(".spur", "run", `${runId}-drift-probe.json`);
  const relModeFile = join(".spur", "run", `${runId}-mode.txt`);
  const relTasksFile = join(".spur", "run", `${runId}-wrapup-tasks.json`);
  const abs = (p) => cwd ? join(cwd, p) : p;
  mkdirSync(abs(join(".spur", "run")), { recursive: true });
  writeFileSync(abs(relModeFile), `
`);
  const finish = (clean, reasons2, paths) => {
    writeFileSync(abs(relProbeFile), `${JSON.stringify({ clean, reasons: reasons2, paths })}
`);
    writeFileSync(abs(relModeFile), clean ? `fast
` : `
`);
    return { clean, reasons: reasons2, paths, probeFile: relProbeFile, modeFile: relModeFile, exitCode: 0 };
  };
  let tasks;
  try {
    tasks = JSON.parse(readFileSync(abs(relTasksFile), "utf8"));
  } catch {
    tasks = undefined;
  }
  if (!Array.isArray(tasks) || !tasks.every((wbs) => typeof wbs === "string")) {
    process.stderr.write(`wrapup-drift-probe: normalized task capture is missing or corrupted \u2014 failing safe (dirty)
`);
    return finish(false, ["normalized task capture missing or corrupted"], []);
  }
  const reasons = [];
  const allPaths = new Set;
  for (const wbs of tasks) {
    const shown = spur(["task", "show", wbs, "--json"]);
    if (shown.status !== 0) {
      reasons.push(`${wbs}: task show failed (status=${shown.status})`);
      continue;
    }
    let content;
    try {
      content = JSON.parse(shown.stdout).content;
    } catch {
      content = undefined;
    }
    if (typeof content !== "string") {
      reasons.push(`${wbs}: task show output unparseable`);
      continue;
    }
    const changedPaths = changedPathsOf(solutionSectionOf(content));
    if (changedPaths.length === 0) {
      reasons.push(`${wbs}: Solution empty or unparseable`);
      continue;
    }
    for (const path of changedPaths) {
      if (CORPUS_PREFIXES.some((prefix) => path.startsWith(prefix)))
        continue;
      allPaths.add(path);
      const drift = driftReasonForPath(path);
      if (drift)
        reasons.push(`${wbs}: ${path} ${drift}`);
    }
  }
  return finish(reasons.length === 0, reasons, [...allPaths].sort());
}
var WRAPUP_DRIFT_PROBE_USAGE = "usage: wrapup-drift-probe  (env: __runId, spurBin)";
function main(argv, env = getEnvVars(), options = {}) {
  if (argv.length > 0) {
    process.stderr.write(`${WRAPUP_DRIFT_PROBE_USAGE}
`);
    return 2;
  }
  return runDriftProbe(env, options).exitCode;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  solutionSectionOf,
  runDriftProbe,
  main,
  driftReasonForPath,
  changedPathsOf,
  WRAPUP_DRIFT_PROBE_USAGE,
  DOC_OWNED_SURFACES
};
