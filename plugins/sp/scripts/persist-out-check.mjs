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
function wbsOfTaskFile(path) {
  const m = /^(\d+)_/.exec(basename(path));
  return m?.[1] ?? null;
}
function walkFiles(dir, root) {
  if (!existsSync(dir))
    return [];
  const out = [];
  const walk = (cur) => {
    for (const e of readdirSync(cur, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(cur, e.name);
      if (e.isDirectory())
        walk(p);
      else if (e.isFile())
        out.push(relative(root, p));
    }
  };
  walk(dir);
  return out;
}
function collectOwned(rels, prefixes, counts, out) {
  for (const rel of rels) {
    const prefix = prefixes.find((p) => basename(rel).startsWith(`${p}-`));
    if (prefix === undefined)
      continue;
    const count = (counts.get(prefix) ?? 0) + 1;
    if (count > PREFIX_CAP)
      return false;
    counts.set(prefix, count);
    out.push(rel);
  }
  return true;
}
function listObligations(wtRoot, wbsList, runIds) {
  const prefixes = [...new Set([...wbsList, ...runIds].filter(Boolean))];
  if (prefixes.length === 0)
    return null;
  const evDir = join(wtRoot, EVIDENCE_DIR);
  const runDir = join(wtRoot, RUN_DIR);
  const evFiles = walkFiles(evDir, wtRoot);
  const runFiles = existsSync(runDir) ? readdirSync(runDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(RUN_DIR, e.name)).sort() : [];
  const files = [];
  const counts = new Map;
  if (!collectOwned(evFiles, prefixes, counts, files))
    return null;
  if (!collectOwned(runFiles, prefixes, counts, files))
    return null;
  const unowned = evFiles.length - files.filter((f) => f.startsWith(EVIDENCE_DIR)).length;
  return { files: [...new Set(files)].sort(), unowned };
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
  if (wbsList.length === 0 && runIds.length === 0) {
    process.stderr.write(`${persistOutCheckUsage()}
persist-out-check: at least one --task-file or --run-id prefix required
`);
    return 2;
  }
  if (!wtRoot || !existsSync(wtRoot) || !statSync(wtRoot).isDirectory()) {
    process.stderr.write(`${persistOutCheckUsage()}
persist-out-check: --from must be an existing worktree directory
`);
    return 2;
  }
  const foreignDivergent = new Set;
  const skips = [];
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
        if (Array.isArray(parsed.skipped)) {
          for (const item of parsed.skipped) {
            if (typeof item.id === "string" && typeof item.reason === "string") {
              skips.push({ id: item.id, reason: item.reason });
            }
          }
        }
        break;
      } catch {}
    }
  }
  const obligations = listObligations(wtRoot, wbsList, runIds);
  if (obligations === null) {
    process.stderr.write(`persist-out-check: BLOCKED \u2014 worktree evidence listing failed or exceeded caps (${PREFIX_CAP}/prefix) \u2014 inspect by hand
`);
    return 1;
  }
  const { files, unowned } = obligations;
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
    for (const skip of skips) {
      process.stdout.write(`SKIP ${skip.id}: ${skip.reason}
`);
    }
    const abandonedMsg = skips.length > 0 ? `${skips.length} skipped` : "nothing abandoned";
    process.stdout.write(`persist-out-check: ok \u2014 ${ok} evidence file(s) persisted, unowned: ${unowned}, ${abandonedMsg}
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
