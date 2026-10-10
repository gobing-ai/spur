#!/usr/bin/env node
// @bun

// plugins/sp/scripts/task-diffstat.ts
import { spawnSync } from "child_process";
import { fstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
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
  return new RegExp(`^${escaped}$`, "s");
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
function addCounts(add, del) {
  for (const count of [add, del])
    if (count !== "-" && !/^\d+$/.test(count))
      return null;
  const [a, d] = [add === "-" ? 0 : Number(add), del === "-" ? 0 : Number(del)];
  return Number.isSafeInteger(a) && Number.isSafeInteger(d) ? [a, d] : null;
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
    writeArtifact(abs(relResult), row2);
    return { ...row2, resultFile: relResult, exitCode: 0 };
  };
  let stdoutIsArtifact = false;
  try {
    const [out, art] = [fstatSync(1), statSync(abs(relResult))];
    stdoutIsArtifact = out.dev === art.dev && out.ino === art.ino;
  } catch {}
  let base = "";
  try {
    base = readFileSync(abs(join(relRun, `${wbs}-base.sha`)), "utf8").trim();
  } catch {}
  if (!/^[0-9a-f]{7,40}$/i.test(base))
    return failSafe("run base .spur/run/<wbs>-base.sha missing or malformed");
  const numstat = git(["diff", "--numstat", "-z", base]);
  if (numstat.status !== 0)
    return failSafe(`git diff --numstat failed (status=${numstat.status})`);
  if (numstat.stdout.length > 0 && !numstat.stdout.endsWith("\x00"))
    return failSafe("git diff --numstat -z output is not NUL-terminated (malformed framing)");
  const paths = new Set;
  let insertions = 0;
  let deletions = 0;
  const records = numstat.stdout.split("\x00").slice(0, -1);
  for (let i = 0;i < records.length; i++) {
    const header = records[i] ?? "";
    const first = header.indexOf("\t");
    const second = header.indexOf("\t", first + 1);
    if (first < 1 || second < first + 2)
      return failSafe("git diff --numstat -z record is missing counts or path");
    const counts = addCounts(header.slice(0, first), header.slice(first + 1, second));
    if (counts === null)
      return failSafe("git diff --numstat -z record has a malformed count");
    insertions += counts[0];
    deletions += counts[1];
    const path = header.slice(second + 1);
    if (path !== "") {
      paths.add(path);
      continue;
    }
    const oldPath = records[++i];
    const newPath = records[++i];
    if (!oldPath || !newPath)
      return failSafe("git diff --numstat -z rename record has incomplete paths");
    paths.add(oldPath);
    paths.add(newPath);
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
  writeArtifact(abs(relResult), row);
  if (stdoutIsArtifact)
    process.stderr.write(`task-diffstat: stdout redirected onto the artifact \u2014 kept; redirect stdout elsewhere
`);
  return { ...row, resultFile: relResult, exitCode: stdoutIsArtifact ? 1 : 0 };
}
function writeArtifact(absPath, row) {
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(row)}
`);
  renameSync(tmp, absPath);
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
  TASK_DIFFSTAT_USAGE,
  SENSITIVE_PREFIXES,
  SENSITIVE_GLOBS
};
