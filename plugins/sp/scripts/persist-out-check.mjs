#!/usr/bin/env node
// @bun

// plugins/sp/scripts/persist-out-check.ts
import { spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, dirname, isAbsolute, join, relative } from "path";
var EVIDENCE_DIR = join(".spur", "memory", "evidence");
var RUN_DIR = join(".spur", "run");
var NAMED_CAP = 32;
var PREFIX_CAP = 64;
var EVIDENCE_CAP = 256;
function wbsOfTaskFile(path) {
  const m = /^(\d+)_/.exec(basename(path));
  return m?.[1] ?? null;
}
function listFilesUnder(root, rel, cap) {
  const dir = join(root, rel);
  if (!existsSync(dir))
    return [];
  const out = [];
  const walk = (cur) => {
    for (const entry of readdirSync(cur, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(cur, entry.name);
      if (entry.isDirectory()) {
        if (!walk(p))
          return false;
      } else {
        out.push(relative(root, p));
        if (out.length > cap)
          return false;
      }
    }
    return true;
  };
  return walk(dir) ? out : null;
}
function listObligations(wtRoot, wbsList, runIds) {
  const evidence = listFilesUnder(wtRoot, EVIDENCE_DIR, EVIDENCE_CAP);
  if (evidence === null)
    return null;
  const out = [...evidence];
  const prefixes = [...wbsList, ...runIds];
  for (const prefix of prefixes) {
    const dir = join(wtRoot, RUN_DIR);
    if (!existsSync(dir))
      continue;
    let entries;
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return null;
    }
    const owned = entries.filter((n) => n.startsWith(`${prefix}-`));
    if (owned.length > PREFIX_CAP)
      return null;
    out.push(...owned.map((n) => join(RUN_DIR, n)));
  }
  return [...new Set(out)].sort();
}
function compareTrees(wtRoot, invokeRoot, files, foreignDivergent = new Set) {
  const missing = [];
  const divergent = [];
  let ok = 0;
  for (const rel of files) {
    if (foreignDivergent.has(rel) || foreignDivergent.has(basename(rel))) {
      continue;
    }
    const wtPath = join(wtRoot, rel);
    const invPath = join(invokeRoot, rel);
    if (!existsSync(invPath)) {
      missing.push(rel);
      continue;
    }
    try {
      const same = readFileSync(wtPath).equals(readFileSync(invPath));
      if (same)
        ok++;
      else
        divergent.push(rel);
    } catch {
      divergent.push(rel);
    }
  }
  return { missing, divergent, ok };
}
function persistOutCheckUsage() {
  return "usage: persist-out-check --from <worktree> [--task-file <path>]\u2026 [--run-id <id>]\u2026 [--root <invoke-tree>] [--success-json <path>]";
}
function defaultInvokeRoot(cwd) {
  try {
    const run = spawnSync("git", ["-C", cwd, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
    const common = run.stdout.trim();
    if (run.status === 0 && common)
      return dirname(isAbsolute(common) ? common : join(cwd, common));
  } catch {}
  return cwd;
}
function main(argv, invokeRoot = defaultInvokeRoot(process.cwd())) {
  let wtRoot = "";
  let successJsonPath = "";
  const wbsList = [];
  const runIds = [];
  for (let i = 0;i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--spur-bin") {
      i++;
    } else if (arg === "--from") {
      wtRoot = argv[++i] ?? "";
    } else if (arg === "--root") {
      invokeRoot = argv[++i] ?? invokeRoot;
    } else if (arg === "--task-file") {
      const wbs = wbsOfTaskFile(argv[++i] ?? "");
      if (wbs)
        wbsList.push(wbs);
    } else if (arg === "--run-id") {
      const id = argv[++i] ?? "";
      if (id)
        runIds.push(id);
    } else if (arg === "--success-json") {
      successJsonPath = argv[++i] ?? "";
    } else {
      process.stderr.write(`${persistOutCheckUsage()}
`);
      return 2;
    }
  }
  if (!wtRoot || !existsSync(wtRoot) || !statSync(wtRoot).isDirectory()) {
    process.stderr.write(`${persistOutCheckUsage()}
persist-out-check: --from must be an existing worktree directory
`);
    return 2;
  }
  const foreignDivergent = new Set;
  const candidates = [
    successJsonPath,
    join(invokeRoot, ".spur", "run", "persist-out.json"),
    join(wtRoot, ".spur", "run", "persist-out.json")
  ].filter(Boolean);
  for (const cand of candidates) {
    if (existsSync(cand)) {
      try {
        const parsed = JSON.parse(readFileSync(cand, "utf8"));
        if (Array.isArray(parsed.evidenceSkipped)) {
          for (const item of parsed.evidenceSkipped) {
            if (item.reason === "foreign-divergent" && typeof item.name === "string") {
              foreignDivergent.add(item.name);
              foreignDivergent.add(join(EVIDENCE_DIR, item.name));
            }
          }
        }
        break;
      } catch {}
    }
  }
  const files = listObligations(wtRoot, wbsList, runIds);
  if (files === null) {
    process.stderr.write(`persist-out-check: BLOCKED \u2014 worktree evidence listing failed or exceeded caps (64/prefix, ${EVIDENCE_CAP} evidence files) \u2014 inspect by hand
`);
    return 1;
  }
  const { missing, divergent, ok } = compareTrees(wtRoot, invokeRoot, files, foreignDivergent);
  const findings = [
    ...missing.map((f) => `MISSING ${f}`),
    ...divergent.map((f) => `DIVERGENT ${f} \u2014 reconcile by hand (persist-out never overwrites)`)
  ];
  for (const line of findings.slice(0, NAMED_CAP))
    process.stdout.write(`${line}
`);
  if (findings.length > NAMED_CAP)
    process.stdout.write(`\u2026 +${findings.length - NAMED_CAP} more
`);
  if (findings.length === 0) {
    process.stdout.write(`persist-out-check: ok \u2014 ${ok} evidence file(s) persisted, nothing abandoned
`);
    return 0;
  }
  process.stderr.write(`persist-out-check: BLOCKED ${missing.length} missing, ${divergent.length} divergent \u2014 run inline-run-setup --persist-out --from <worktree> before worktree removal
`);
  return 1;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  wbsOfTaskFile,
  persistOutCheckUsage,
  main,
  listObligations,
  defaultInvokeRoot,
  compareTrees
};
