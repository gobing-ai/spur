#!/usr/bin/env node
// @bun

// plugins/sp/scripts/commit-guard.ts
import { spawnSync } from "child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
var COMMIT_GUARD_USAGE = "usage: commit-guard start --run <id> | stage --run <id> [--base <sha>] -- <paths\u2026> | check --run <id>";
function isBookkeeping(path) {
  return path === ".spur" || path.startsWith(".spur/");
}
function at(options, rel) {
  return options.cwd ? join(options.cwd, rel) : rel;
}
function artifactPath(run) {
  return join(".spur", "run", `${run}-tree-start.json`);
}
function gitOf(options) {
  if (options.git)
    return options.git;
  return (args) => {
    const run = spawnSync("git", args, { cwd: options.cwd, encoding: "utf8" });
    return { status: run.status ?? 1, stdout: run.stdout ?? "" };
  };
}
function hashPath(path, git) {
  const run = git(["hash-object", "--", path]);
  return run.status === 0 ? run.stdout.trim() : null;
}
function parsePorcelainZ(stdout) {
  const tokens = stdout.split("\x00");
  const paths = [];
  for (let i = 0;i < tokens.length; i++) {
    const entry = tokens[i] ?? "";
    if (entry.length < 4)
      continue;
    const path = entry.slice(3);
    if (!isBookkeeping(path))
      paths.push(path);
    if (/[RC]/.test(entry.slice(0, 2)))
      i++;
  }
  return paths;
}
function conflictMarkerLine(content) {
  let opener = false;
  for (const line of content.split(`
`)) {
    if (/^<{7}( |$)/.test(line))
      opener = true;
    else if (/^={7}(\s|$)/.test(line) && opener)
      return true;
    else if (/^>{7}( |$)/.test(line))
      return true;
  }
  return opener;
}
function changedSinceBase(base, git) {
  const tracked = git(["diff", "--name-only", base]);
  const others = git(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (tracked.status !== 0 || others.status !== 0)
    return new Set;
  const clean = (out, sep) => out.split(sep).map((p) => p.trim()).filter((p) => p.length > 0 && !isBookkeeping(p));
  return new Set([...clean(tracked.stdout, `
`), ...clean(others.stdout, "\x00")]);
}
function readTreeStart(run, options) {
  try {
    const parsed = JSON.parse(readFileSync(at(options, artifactPath(run)), "utf8"));
    if (typeof parsed.head === "string" && Array.isArray(parsed.dirty))
      return parsed;
  } catch {}
  return null;
}
function runContext(run, options) {
  const git = gitOf(options);
  const start = readTreeStart(run, options);
  if (!start)
    return null;
  let base = options.base ?? "";
  if (!base) {
    try {
      const anchored = readFileSync(at(options, join(".spur", "run", `${run}-base.sha`)), "utf8").trim();
      if (/^[0-9a-f]{7,40}$/i.test(anchored))
        base = anchored;
    } catch {}
  }
  if (!base)
    base = start.head.length > 0 ? start.head : "HEAD";
  const written = changedSinceBase(base, git);
  for (const entry of start.dirty)
    if (hashPath(entry.path, git) === entry.sha)
      written.delete(entry.path);
  return { git, base, start, written };
}
function missingStart(run) {
  process.stderr.write(`commit-guard: no ${artifactPath(run)} \u2014 run \`commit-guard start --run ${run}\` first
`);
  return 1;
}
function runStart(run, options = {}) {
  const git = gitOf(options);
  const head = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain=v1", "-z"]);
  if (head.status !== 0 || status.status !== 0) {
    process.stderr.write(`commit-guard: git probe failed (rev-parse HEAD / status) \u2014 is this a work tree?
`);
    return 1;
  }
  const snapshot = {
    head: head.stdout.trim(),
    dirty: parsePorcelainZ(status.stdout).map((path) => ({ path, sha: hashPath(path, git) }))
  };
  const abs = at(options, artifactPath(run));
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(`${abs}.tmp`, `${JSON.stringify(snapshot, null, 2)}
`);
  renameSync(`${abs}.tmp`, abs);
  return 0;
}
function conflictingTarget(paths, options, git) {
  const unmerged = new Set(git(["diff", "--name-only", "--diff-filter=U"]).stdout.split(`
`).map((p) => p.trim()));
  for (const path of paths) {
    if (unmerged.has(path))
      return `${path} (unmerged)`;
    try {
      if (conflictMarkerLine(readFileSync(at(options, path), "utf8")))
        return `${path} (conflict markers)`;
    } catch {}
  }
  return null;
}
function runStage(run, paths, options = {}) {
  if (paths.length === 0) {
    process.stderr.write(`${COMMIT_GUARD_USAGE}
`);
    return { staged: [], foreign: [], exitCode: 1 };
  }
  const context = runContext(run, options);
  if (!context)
    return { staged: [], foreign: [], exitCode: missingStart(run) };
  const conflict = conflictingTarget(paths, options, context.git);
  if (conflict) {
    process.stderr.write(`commit-guard: refusing to stage ${conflict}; nothing staged
`);
    return { staged: [], foreign: [], exitCode: 3 };
  }
  const dirtyAtStart = new Set(context.start.dirty.map((entry) => entry.path));
  const staged = paths.filter((path) => context.written.has(path));
  const refused = paths.filter((path) => !context.written.has(path));
  for (const path of refused) {
    const why = dirtyAtStart.has(path) ? "foreign \u2014 dirty at start, untouched by this run" : "unchanged since base";
    process.stderr.write(`commit-guard: refused ${path} (${why})
`);
  }
  if (staged.length > 0 && context.git(["add", "--", ...staged]).status !== 0) {
    process.stderr.write(`commit-guard: git add failed \u2014 nothing staged
`);
    return { staged: [], foreign: [], exitCode: 1 };
  }
  const foreign = refused.filter((path) => dirtyAtStart.has(path));
  process.stdout.write(`${JSON.stringify({ staged, foreign })}
`);
  return { staged, foreign, exitCode: refused.length > 0 ? 2 : 0 };
}
function runCheck(run, options = {}) {
  const context = runContext(run, options);
  if (!context)
    return missingStart(run);
  const foreign = [...changedSinceBase(context.base, context.git)].filter((path) => !context.written.has(path)).sort();
  process.stdout.write(`${JSON.stringify({ foreign })}
`);
  return 0;
}
function takeFlag(args, name) {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  const missing = value === undefined || value.startsWith("--");
  if (index !== -1)
    args.splice(index, missing ? 1 : 2);
  return missing ? undefined : value;
}
function main(argv, options = {}) {
  const args = [...argv];
  takeFlag(args, "--spur-bin");
  const sub = args.shift();
  const run = takeFlag(args, "--run");
  const base = takeFlag(args, "--base");
  const usage = () => {
    process.stderr.write(`${COMMIT_GUARD_USAGE}
`);
    return 1;
  };
  if (!run)
    return usage();
  if (sub === "start")
    return args.length === 0 ? runStart(run, options) : usage();
  if (sub === "check")
    return args.length === 0 ? runCheck(run, { ...options, base }) : usage();
  if (sub === "stage")
    return runStage(run, args.filter((arg) => arg !== "--"), { ...options, base }).exitCode;
  return usage();
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  runStart,
  runStage,
  runCheck,
  parsePorcelainZ,
  main,
  conflictMarkerLine,
  COMMIT_GUARD_USAGE
};
