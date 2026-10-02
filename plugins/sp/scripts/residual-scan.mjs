#!/usr/bin/env node
// @bun

// plugins/sp/scripts/residual-scan.ts
import { spawnSync } from "child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// plugins/sp/lib/env.ts
function getEnvVars() {
  return process.env;
}

// plugins/sp/lib/residual-scan.generated.mjs
import { createHash } from "node:crypto";
var MARKER_PATTERN = /TODO|FIXME|XXX|HACK/;
var PRIORITY_PATTERN = /^P[1-4]/;
var NONE_FINDING = /^(none( found)?|no (findings?|issues?)( found)?|—)\s*(\(.*\))?\.?$/i;
var DISPOSITION_HEADER = /^(Disposition|Action|Status|Resolution|Fixed)$/i;
var RESOLVED_DISPOSITION = /^(FIXED|RESOLVED|DONE)\b/i;
var DEFERRED_DISPOSITION = /^DEFER(RED)?\b/i;
var ANCHOR_PATTERN = /[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+/g;
var RANGE_ANCHOR = /([A-Za-z0-9_./-]+\.[A-Za-z]+):([0-9]+)-[0-9]+/g;
var EXCLUDED_PATHS = ["docs/tasks", "docs/features/", ".spur/"];
var ALLOW_PRAGMA = "residual-scan:allow";
function makeItemId(category, location, text) {
  const normalized = text.trim().replace(/\s+/g, " ");
  const hex = createHash("sha256").update(`${location}${normalized}`).digest("hex");
  return `${category}:${hex.slice(0, 8)}`;
}
function normalizeAnchor(location) {
  return location.replace(RANGE_ANCHOR, "$1:$2");
}
function locationOf(locationCell, finding) {
  const cell = locationCell.trim().replace(/`/g, "");
  if (cell.length > 0 && cell !== "—")
    return normalizeAnchor(cell);
  const backtick = finding.match(/`([^`]+)`/)?.[1];
  return backtick === undefined ? "" : normalizeAnchor(backtick);
}
function parseReviewFindings(taskContent) {
  const section = taskContent.split(/^### Review\b/m)[1];
  if (section === undefined)
    return [];
  const body = section.split(/^### /m)[0] ?? "";
  const out = [];
  const lines = body.split(`
`);
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || !line.trimStart().startsWith("|"))
      continue;
    const header = splitRow(line);
    const priorityCol = header.findIndex((h) => h.trim() === "Priority");
    if (priorityCol === -1) {
      while (i + 1 < lines.length && lines[i + 1]?.trimStart().startsWith("|"))
        i++;
      continue;
    }
    const findingCol = header.findIndex((h) => h.trim() === "Finding");
    const locationCol = header.findIndex((h) => h.trim() === "Location");
    const dispositionCol = header.findIndex((h) => DISPOSITION_HEADER.test(h.trim()));
    i++;
    const sep = lines[i];
    if (sep !== undefined && /^\s*\|[\s:|-]+\|\s*$/.test(sep))
      i++;
    while (i < lines.length) {
      const row = lines[i];
      if (row === undefined || !row.trimStart().startsWith("|"))
        break;
      const cells = splitRow(row);
      const priority = (cells[priorityCol] ?? "").trim();
      const finding = (cells[findingCol] ?? "").trim();
      const disposition = dispositionCol === -1 ? "" : (cells[dispositionCol] ?? "").trim();
      if (PRIORITY_PATTERN.test(priority) && !NONE_FINDING.test(finding) && finding.length > 0 && !RESOLVED_DISPOSITION.test(disposition)) {
        const location = locationOf(cells[locationCol] ?? "", finding);
        out.push(DEFERRED_DISPOSITION.test(disposition) ? { priority, location, text: finding, deferral: disposition } : { priority, location, text: finding });
      }
      i++;
    }
  }
  return out;
}
function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
function parseDiffMarkers(addedLines) {
  return addedLines.filter((l) => !EXCLUDED_PATHS.some((p) => l.file.startsWith(p))).filter((l) => !l.text.includes(ALLOW_PRAGMA)).filter((l) => MARKER_PATTERN.test(l.text)).map((l) => ({ location: `${l.file}:${l.line}`, text: l.text.trim() }));
}
function findUncheckedBoxes(taskContent) {
  const path = "task-file";
  return taskContent.split(`
`).map((text, idx) => ({ text: text.trim(), line: idx + 1 })).filter((l) => l.text.startsWith("- [ ]")).map((l) => ({ location: `${path}:${l.line}`, text: l.text }));
}
function classify(items, deferrals) {
  const deferred = new Map(deferrals.map((d) => [d.id, d.reason]));
  return items.map((item) => {
    const id = makeItemId(item.category, item.location, item.text);
    let klass;
    if (item.category === "review-finding")
      klass = item.priority?.startsWith("P4") ? "advisory" : "blocking";
    else if (item.category === "staging-residue")
      klass = "housekeeping";
    else
      klass = "blocking";
    if (klass === "blocking" && item.category !== "unchecked-box") {
      const p3Like = item.category === "diff-marker" || item.category === "review-finding" && (item.priority ?? "").startsWith("P3");
      const reason = deferred.get(id);
      if (p3Like && reason !== undefined && reason.trim().length > 0)
        klass = "deferrable";
    }
    return {
      id,
      category: item.category,
      class: klass,
      priority: item.priority,
      location: item.location,
      text: item.text
    };
  });
}
function scanResiduals(inputs) {
  const { wbs, base, taskContent, addedLines, stagingResidue, deferrals } = inputs;
  const reviewRows = parseReviewFindings(taskContent);
  const tableDeferrals = reviewRows.flatMap((r) => r.deferral === undefined ? [] : [{ id: makeItemId("review-finding", r.location, r.text), reason: r.deferral }]);
  const review = reviewRows.map((r) => ({
    category: "review-finding",
    priority: r.priority,
    location: r.location,
    text: r.text
  }));
  const markers = base === null ? [] : parseDiffMarkers(addedLines).map((m) => ({
    category: "diff-marker",
    location: m.location,
    text: m.text
  }));
  const boxes = findUncheckedBoxes(taskContent).map((b) => ({
    category: "unchecked-box",
    location: b.location,
    text: b.text
  }));
  const residue = stagingResidue.map((p) => ({
    category: "staging-residue",
    location: p,
    text: p
  }));
  const items = classify([...review, ...markers, ...boxes, ...residue], [...tableDeferrals, ...deferrals]);
  const counts = { blocking: 0, deferrable: 0, advisory: 0, housekeeping: 0 };
  for (const item of items)
    counts[item.class]++;
  return {
    wbs,
    base,
    scanned: {
      "review-finding": true,
      "diff-marker": base !== null,
      "unchecked-box": true,
      "staging-residue": true
    },
    items,
    counts
  };
}
function blockingAnchors(items) {
  const anchors = new Set;
  for (const item of items) {
    if (item.class !== "blocking")
      continue;
    for (const m of normalizeAnchor(item.location).matchAll(ANCHOR_PATTERN))
      anchors.add(m[0]);
  }
  return [...anchors];
}
function foldVerdict(verdict, scan, existingFindings, maxFindings = 20) {
  const blocking = scan.items.filter((i) => i.class === "blocking");
  const deferrable = scan.items.filter((i) => i.class === "deferrable");
  const evidence = `blocking=${blocking.length} deferrable=${deferrable.length} advisory=${scan.counts.advisory} housekeeping=${scan.counts.housekeeping}` + (blocking.length > 0 ? `; blocking ids: ${blocking.map((i) => i.id).join(", ")}` : "") + (deferrable.length > 0 ? `; deferrable ids: ${deferrable.map((i) => i.id).join(", ")}` : "");
  const checks = verdict.checks.filter((c) => c.name !== "residual-sweep");
  checks.push({ name: "residual-sweep", status: blocking.length > 0 ? "fail" : "pass", evidence });
  const merged = new Set([
    ...existingFindings.split(/\s+/).filter((a) => a.length > 0),
    ...blockingAnchors(scan.items)
  ]);
  const findings = [...merged].sort().slice(0, maxFindings).map((a) => `${a} `).join("");
  let verdictStatus = verdict.verdict === "PASS" ? "PASS" : "FAIL";
  if (verdict.verdict === "PARTIAL")
    verdictStatus = "PARTIAL";
  else if (verdict.verdict === "FAIL")
    verdictStatus = "FAIL";
  else if (blocking.length > 0)
    verdictStatus = "PARTIAL";
  return { verdict: verdictStatus, checks, findings };
}
function renderReport(wbs, items, attemptCount) {
  const lines = [
    `# Residual report — ${wbs}`,
    "",
    `Attempt: ${attemptCount}`,
    "",
    "| Category | Class | Location | Text |",
    "| --- | --- | --- | --- |"
  ];
  for (const item of items) {
    lines.push(`| ${item.category} | ${item.class} | ${item.location} | ${item.text.replace(/\|/g, "\\|")} |`);
  }
  return `${lines.join(`
`)}
`;
}

// plugins/sp/lib/spur-bin.ts
function spurCommand(spurBin) {
  const parts = (spurBin ?? "spur").trim().split(/\s+/).filter((p) => p.length > 0);
  return { cmd: parts[0] ?? "spur", prefix: parts.slice(1) };
}

// plugins/sp/scripts/residual-scan.ts
var RESIDUAL_SCAN_USAGE = "usage: residual-scan.ts <scan|fold|settle|report> <wbs> [--spur-bin <bin>] [--root <dir>] [--tmp-dir <dir>]";
function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (result.error !== undefined)
    return { status: result.status ?? 1, stdout: "" };
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}
function spur(env, spurBinFlag, args, cwd) {
  const { cmd, prefix } = spurCommand(spurBinFlag ?? env.spurBin);
  return run(cmd, [...prefix, ...args], cwd);
}
function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
function collectAddedLines(root, base) {
  const out = [];
  const diff = run("git", ["diff", "--unified=0", base], root);
  let file = "";
  let newLine = 0;
  for (const line of diff.stdout.split(`
`)) {
    if (line.startsWith("+++ b/"))
      file = line.slice(6);
    else if (line.startsWith("@@"))
      newLine = Number.parseInt((line.match(/\+[0-9]+/) ?? ["+0"])[0].slice(1), 10);
    else if (line.startsWith("+") && !line.startsWith("+++"))
      out.push({ file, line: newLine++, text: line.slice(1) });
  }
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"], root);
  for (const f of untracked.stdout.split(`
`)) {
    if (f.length === 0 || !isRegularFile(join(root, f)))
      continue;
    for (const [idx, text] of readFileSync(join(root, f), "utf8").split(`
`).entries())
      out.push({ file: f, line: idx + 1, text });
  }
  return out;
}
function listStagingResidue(tmpDir, wbs) {
  let names;
  try {
    names = readdirSync(tmpDir);
  } catch {
    return [];
  }
  return names.filter((n) => n.startsWith(`${wbs}-`) && isRegularFile(join(tmpDir, n))).map((n) => join(tmpDir, n));
}
function readDeferrals(runDir, wbs) {
  const path = join(runDir, `${wbs}-residual-deferrals.json`);
  if (!existsSync(path))
    return [];
  const isDeferral = (e) => typeof e === "object" && e !== null && typeof e.id === "string" && typeof e.reason === "string" && e.reason.trim().length > 0;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return (Array.isArray(parsed) ? parsed : []).filter(isDeferral);
  } catch {
    return [];
  }
}
function scanResiduals2(root, wbs, tmpDir, taskContent, _env) {
  const runDir = join(root, ".spur", "run");
  const basePath = join(runDir, `${wbs}-base.sha`);
  const base = existsSync(basePath) ? readFileSync(basePath, "utf8").trim() : null;
  const stagingResidue = listStagingResidue(tmpDir, wbs);
  const deferrals = readDeferrals(runDir, wbs);
  const addedLines = base === null ? [] : collectAddedLines(root, base);
  return scanResiduals({ wbs, base, taskContent, addedLines, stagingResidue, deferrals });
}
function parseArgs(argv) {
  let mode = "";
  let wbs = "";
  let spurBin;
  let root = process.cwd();
  let tmpDir = tmpdir();
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined)
      break;
    if (a === "--spur-bin")
      spurBin = argv[++i];
    else if (a === "--root")
      root = argv[++i] ?? root;
    else if (a === "--tmp-dir")
      tmpDir = argv[++i] ?? tmpDir;
    else if (a === "--help" || a === "-h")
      return null;
    else if (mode === "")
      mode = a;
    else if (wbs === "")
      wbs = a;
  }
  return mode === "" || wbs === "" ? null : { mode, wbs, spurBin, root, tmpDir };
}
function loadTask(env, spurBinFlag, wbs, root) {
  const res = spur(env, spurBinFlag, ["task", "show", wbs, "--json"], root);
  if (res.status !== 0)
    throw new Error(`task show ${wbs} failed`);
  const parsed = JSON.parse(res.stdout);
  const featureId = [parsed.feature_id, parsed.frontmatter?.feature_id].find((v) => typeof v === "string") ?? "";
  return { content: typeof parsed.content === "string" ? parsed.content : "", featureId };
}
function verdictPath(runDir, wbs) {
  const durable = join(runDir, "..", "memory", "evidence", `${wbs}-verdict.json`);
  for (const path of [
    join(runDir, ".."),
    join(runDir, "..", "memory"),
    join(runDir, "..", "memory", "evidence"),
    durable
  ]) {
    try {
      if (lstatSync(path).isSymbolicLink())
        throw new Error(`residual-scan: symlink evidence path: ${path}`);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
  }
  return existsSync(durable) ? durable : join(runDir, `${wbs}-verdict.json`);
}
function loadVerdict(runDir, wbs) {
  return JSON.parse(readFileSync(verdictPath(runDir, wbs), "utf8"));
}
function scanMode(opts, env, io) {
  const runDir = join(opts.root, ".spur", "run");
  mkdirSync(runDir, { recursive: true });
  const { content } = loadTask(env, opts.spurBin, opts.wbs, opts.root);
  const artifact = scanResiduals2(opts.root, opts.wbs, opts.tmpDir, content, env);
  writeFileSync(join(runDir, `${opts.wbs}-residuals.json`), `${JSON.stringify(artifact, null, 2)}
`);
  io.out(`residual-scan: ${opts.wbs} blocking=${artifact.counts.blocking} deferrable=${artifact.counts.deferrable} advisory=${artifact.counts.advisory} housekeeping=${artifact.counts.housekeeping}
`);
  return 0;
}
function foldMode(opts, _env, io) {
  const runDir = join(opts.root, ".spur", "run");
  const scan = JSON.parse(readFileSync(join(runDir, `${opts.wbs}-residuals.json`), "utf8"));
  const target = verdictPath(runDir, opts.wbs);
  const verdict = loadVerdict(runDir, opts.wbs);
  const findingsPath = join(runDir, `${opts.wbs}-test-gate.findings`);
  const fold = foldVerdict(verdict, scan, existsSync(findingsPath) ? readFileSync(findingsPath, "utf8") : "");
  const bytes = `${JSON.stringify({ ...verdict, verdict: fold.verdict, checks: fold.checks }, null, 2)}
`;
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: "wx" });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  const scratch = join(runDir, `${opts.wbs}-verdict.json`);
  if (target !== scratch)
    writeFileSync(scratch, bytes);
  writeFileSync(findingsPath, fold.findings);
  io.out(`residual-fold: ${opts.wbs} verdict=${fold.verdict} residual-sweep=${fold.checks.find((c) => c.name === "residual-sweep")?.status}
`);
  return 0;
}
function settleMode(opts, env, io) {
  const wbs = opts.wbs;
  const task = loadTask(env, opts.spurBin, wbs, opts.root);
  const runDir = join(opts.root, ".spur", "run");
  const scan = scanResiduals2(opts.root, wbs, opts.tmpDir, task.content, env);
  const residualsPath = join(runDir, `${wbs}-residuals.json`);
  let prior = {};
  if (existsSync(residualsPath))
    prior = JSON.parse(readFileSync(residualsPath, "utf8"));
  const deferred = scan.items.filter((i) => i.class === "deferrable");
  if (deferred.length > 0 && prior.followUp === undefined) {
    if (task.featureId === "") {
      io.err(`residual-settle: ${wbs} deferrals pending but feature_id unknown; re-run: residual-scan settle ${wbs}
`);
      return 0;
    }
    const args = ["task", "create", `Residuals from ${wbs}`, "--feature", task.featureId, "--skip-ready", "--json"];
    const created = spur(env, opts.spurBin, args, opts.root);
    let wbsNew = "";
    try {
      const parsed = JSON.parse(created.stdout);
      const data = typeof parsed.data === "object" && parsed.data !== null ? parsed.data : {};
      wbsNew = [parsed.wbs, data.wbs].find((v) => typeof v === "string") ?? "";
    } catch {
      wbsNew = "";
    }
    if (created.status !== 0 || wbsNew === "") {
      io.err(`residual-settle: task create failed or unreadable wbs; re-run: residual-scan settle ${wbs}
`);
      return 0;
    }
    const rows = deferred.map((i) => `- ${i.id} \u2014 ${i.location}: ${i.text}`);
    const head = `Source task: ${wbs} (feature ${task.featureId}) \u2014 deferred residuals filed by residual-scan settle.`;
    const bgFile = join(runDir, `${wbs}-residual-background.md`);
    writeFileSync(bgFile, `${[head, "", ...rows].join(`
`)}
`);
    const updArgs = ["task", "update", wbsNew, "--section", "Background", "--from-file", bgFile];
    if (spur(env, opts.spurBin, updArgs, opts.root).status !== 0) {
      io.err(`residual-settle: background write failed; re-run: residual-scan settle ${wbs}
`);
      return 0;
    }
    prior.followUp = wbsNew;
    io.out(`residual-settle: filed follow-up ${wbsNew} for ${deferred.length} deferred item(s)
`);
  }
  for (const path of listStagingResidue(opts.tmpDir, wbs)) {
    try {
      rmSync(path, { force: true });
    } catch {
      io.err(`residual-settle: could not remove ${path}; re-run: residual-scan settle ${wbs}
`);
      return 0;
    }
  }
  writeFileSync(residualsPath, `${JSON.stringify({ ...scan, ...prior }, null, 2)}
`);
  return 0;
}
function reportMode(opts, env, io) {
  const runDir = join(opts.root, ".spur", "run");
  const sweep = loadVerdict(runDir, opts.wbs).checks.find((c) => c.name === "residual-sweep");
  if (sweep === undefined || sweep.status !== "fail")
    return 0;
  const { content } = loadTask(env, opts.spurBin, opts.wbs, opts.root);
  const scan = scanResiduals2(opts.root, opts.wbs, opts.tmpDir, content, env);
  const blocking = scan.items.filter((i) => i.class === "blocking");
  const attemptFile = join(runDir, `${opts.wbs}-test-fix-attempt`);
  const attempts = existsSync(attemptFile) ? Number.parseInt(readFileSync(attemptFile, "utf8").trim() || "0", 10) : 0;
  writeFileSync(join(runDir, `${opts.wbs}-residual-report.md`), renderReport(opts.wbs, blocking, Number.isNaN(attempts) ? 0 : attempts));
  io.out(`Recovery: fix the items in .spur/run/${opts.wbs}-residual-report.md, then /sp:dev-run ${opts.wbs}
`);
  return 0;
}
function main(argv, env = getEnvVars(), options = {}) {
  const io = options.io ?? {
    out: (line) => process.stdout.write(line),
    err: (line) => process.stderr.write(line)
  };
  const cwd = options.cwd ?? process.cwd();
  const opts = parseArgs(argv);
  const modes = { scan: scanMode, fold: foldMode, settle: settleMode, report: reportMode };
  const modeFn = opts === null ? undefined : modes[opts.mode];
  if (opts === null || modeFn === undefined) {
    io.err(`${RESIDUAL_SCAN_USAGE}
`);
    return 2;
  }
  const resolved = { ...opts, root: opts.root.startsWith("/") ? opts.root : join(cwd, opts.root) };
  return modeFn(resolved, env, io);
}
process.exit(main(process.argv.slice(2)));
export {
  scanResiduals2 as scanResiduals,
  renderReport,
  parseReviewFindings,
  parseDiffMarkers,
  normalizeAnchor,
  makeItemId,
  main,
  locationOf,
  listStagingResidue,
  foldVerdict,
  findUncheckedBoxes,
  collectAddedLines,
  classify,
  blockingAnchors,
  RESIDUAL_SCAN_USAGE,
  ALLOW_PRAGMA
};
