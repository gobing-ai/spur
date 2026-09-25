#!/usr/bin/env node
// @bun

// plugins/sp/scripts/task-diffstat.ts
import { spawnSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// plugins/sp/lib/env.ts
function getEnvVars() {
  return process.env;
}

// plugins/sp/scripts/task-diffstat.ts
var SENSITIVE_PREFIXES = ["drizzle/", "packages/config/", ".github/", "plugins/sp/hooks/"];
var SENSITIVE_GLOBS = ["apps/server/src/**/auth*", "**/*secret*", "**/*.sql"];
function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**/", "\x00").replaceAll("**", "\x01").replaceAll("*", "[^/]*").replaceAll("\x00", "(?:.*/)?").replaceAll("\x01", ".*");
  return new RegExp(`^${escaped}$`);
}
var SENSITIVE_MATCHERS = [
  ...SENSITIVE_PREFIXES.map((prefix) => ({
    label: prefix,
    test: (path) => path.startsWith(prefix)
  })),
  ...SENSITIVE_GLOBS.map((glob) => {
    const regex = globToRegex(glob);
    return { label: glob, test: (path) => regex.test(path) };
  })
];
function sensitiveReasonForPath(path) {
  const match = SENSITIVE_MATCHERS.find((entry) => entry.test(path));
  return match ? `matches sensitive pattern ${match.label}` : null;
}
function defaultGitRunner(cwd) {
  return (args) => {
    const run = spawnSync("git", args, { cwd, encoding: "utf8" });
    return { status: run.status ?? 1, stdout: run.stdout ?? "" };
  };
}
function countNewlines(path, cwd) {
  let content;
  try {
    content = readFileSync(cwd ? join(cwd, path) : path, "utf8");
  } catch {
    return 0;
  }
  let lines = 0;
  for (const ch of content)
    if (ch === `
`)
      lines += 1;
  return lines;
}
function expandDiffPath(raw) {
  const arrow = raw.indexOf(" => ");
  if (arrow === -1)
    return [raw];
  const open = raw.indexOf("{");
  const close = raw.lastIndexOf("}");
  if (open !== -1 && close > open && open < arrow && arrow < close) {
    const inner = raw.slice(open + 1, close);
    const innerArrow = inner.indexOf(" => ");
    if (innerArrow !== -1) {
      const head = raw.slice(0, open);
      const tail = raw.slice(close + 1);
      return [head + inner.slice(0, innerArrow) + tail, head + inner.slice(innerArrow + 4) + tail];
    }
  }
  return [raw.slice(0, arrow), raw.slice(arrow + 4)];
}
function runDiffstat(env, options = {}, git = defaultGitRunner(options.cwd)) {
  const cwd = options.cwd;
  const wbs = env.wbs ?? "";
  if (wbs.length === 0) {
    process.stderr.write(`task-diffstat: wbs is empty \u2014 refusing to guess the run artifact path
`);
    return { files: 0, insertions: 0, deletions: 0, paths: [], sensitive: true, resultFile: "", exitCode: 1 };
  }
  const relRun = join(".spur", "run");
  const relResult = join(relRun, `${wbs}-diffstat.json`);
  const abs = (p) => cwd ? join(cwd, p) : p;
  mkdirSync(abs(relRun), { recursive: true });
  const failSafe = (reason) => {
    process.stderr.write(`task-diffstat: ${reason} \u2014 failing safe (sensitive)
`);
    const row2 = { files: 0, insertions: 0, deletions: 0, paths: [], sensitive: true };
    writeFileSync(abs(relResult), `${JSON.stringify(row2)}
`);
    return { ...row2, resultFile: relResult, exitCode: 0 };
  };
  let base = "";
  try {
    base = readFileSync(abs(join(relRun, `${wbs}-base.sha`)), "utf8").trim();
  } catch {}
  if (!/^[0-9a-f]{7,40}$/i.test(base))
    return failSafe("run base .spur/run/<wbs>-base.sha missing or malformed");
  const numstat = git(["diff", "--numstat", base]);
  if (numstat.status !== 0)
    return failSafe(`git diff --numstat failed (status=${numstat.status})`);
  const paths = new Set;
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.stdout.split(`
`)) {
    const row2 = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!row2)
      continue;
    for (const p of expandDiffPath(row2[3] ?? ""))
      paths.add(p);
    if (row2[1] !== "-")
      insertions += Number(row2[1]);
    if (row2[2] !== "-")
      deletions += Number(row2[2]);
  }
  const others = git(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (others.status !== 0)
    return failSafe(`git ls-files failed (status=${others.status})`);
  for (const path of others.stdout.split("\x00")) {
    if (path.length === 0 || path === ".spur" || path.startsWith(".spur/"))
      continue;
    paths.add(path);
    insertions += countNewlines(path, cwd);
  }
  const all = [...paths].filter((p) => p.length > 0).sort();
  const sensitive = all.some((p) => sensitiveReasonForPath(p) !== null);
  const row = { files: all.length, insertions, deletions, paths: all, sensitive };
  writeFileSync(abs(relResult), `${JSON.stringify(row)}
`);
  return { ...row, resultFile: relResult, exitCode: 0 };
}
var TASK_DIFFSTAT_USAGE = "usage: task-diffstat  (env: wbs)";
function main(argv, env = getEnvVars(), options = {}) {
  for (let i = 0;i < argv.length; i++) {
    if (argv[i] === "--spur-bin") {
      i++;
      continue;
    }
    process.stderr.write(`${TASK_DIFFSTAT_USAGE}
`);
    return 2;
  }
  return runDiffstat(env, options).exitCode;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  sensitiveReasonForPath,
  runDiffstat,
  main,
  expandDiffPath,
  TASK_DIFFSTAT_USAGE,
  SENSITIVE_PREFIXES,
  SENSITIVE_GLOBS
};
