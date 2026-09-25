#!/usr/bin/env node
// @bun

// plugins/sp/scripts/residual-scan.ts
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// plugins/sp/lib/env.ts
function getEnvVars() {
  return process.env;
}

// plugins/sp/scripts/residual-scan.ts
var RESIDUAL_SCAN_USAGE = "usage: residual-scan.ts <scan|fold|settle|report> <wbs> [--spur-bin <bin>] [--root <dir>] [--tmp-dir <dir>]";
var MARKER_PATTERN = /TODO|FIXME|XXX|HACK/;
var PRIORITY_PATTERN = /^P[1-4]/;
var NONE_FINDING = /^(none|\u2014)$/i;
var ANCHOR_PATTERN = /[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+/g;
var RANGE_ANCHOR = /([A-Za-z0-9_./-]+\.[A-Za-z]+):([0-9]+)-[0-9]+/g;
var EXCLUDED_PATHS = ["docs/tasks", "docs/features/", ".spur/"];
var ALLOW_PRAGMA = "residual-scan:allow";
function spurCommand(spurBin) {
  const parts = (spurBin ?? "spur").trim().split(/\s+/).filter((p) => p.length > 0);
  return { cmd: parts[0] ?? "spur", prefix: parts.slice(1) };
}
function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (result.error !== undefined)
    return { status: result.status ?? 1, stdout: "" };
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}
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
  if (cell.length > 0 && cell !== "\u2014")
    return normalizeAnchor(cell);
  const backtick = finding.match(/`([^`]+)`/);
  return backtick === null ? "" : normalizeAnchor(backtick[1]);
}
function parseReviewFindings(taskContent) {
  const section = taskContent.split(/^### Review\b/m)[1];
  if (section === undefined)
    return [];
  const body = section.split(/^### /m)[0];
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
      if (PRIORITY_PATTERN.test(priority) && !NONE_FINDING.test(finding) && finding.length > 0) {
        out.push({ priority, location: locationOf(cells[locationCol] ?? "", finding), text: finding });
      }
      i++;
    }
  }
  return out;
}
function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
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
    else if (line.startsWith("@@")) {
      const m = line.match(/\+[0-9]+/);
      newLine = m === null ? newLine : Number.parseInt(m[0].slice(1), 10);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      out.push({ file, line: newLine, text: line.slice(1) });
      newLine++;
    }
  }
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"], root);
  for (const f of untracked.stdout.split(`
`)) {
    if (f.length === 0)
      continue;
    try {
      if (!statSync(join(root, f)).isFile())
        continue;
    } catch {
      continue;
    }
    const content = readFileSync(join(root, f), "utf8").split(`
`);
    content.forEach((text, idx) => {
      out.push({ file: f, line: idx + 1, text });
    });
  }
  return out;
}
function parseDiffMarkers(addedLines) {
  return addedLines.filter((l) => !EXCLUDED_PATHS.some((p) => l.file.startsWith(p))).filter((l) => !l.text.includes(ALLOW_PRAGMA)).filter((l) => MARKER_PATTERN.test(l.text)).map((l) => ({ location: `${l.file}:${l.line}`, text: l.text.trim() }));
}
function findUncheckedBoxes(taskContent) {
  const path = "task-file";
  return taskContent.split(`
`).map((text, idx) => ({ text: text.trim(), line: idx + 1 })).filter((l) => l.text.startsWith("- [ ]")).map((l) => ({ location: `${path}:${l.line}`, text: l.text }));
}
function listStagingResidue(tmpDir, wbs) {
  let names;
  try {
    names = readdirSync(tmpDir);
  } catch {
    return [];
  }
  return names.filter((n) => n.startsWith(`${wbs}-`)).filter((n) => {
    try {
      return statSync(join(tmpDir, n)).isFile();
    } catch {
      return false;
    }
  }).map((n) => join(tmpDir, n));
}
function readDeferrals(runDir, wbs) {
  const path = join(runDir, `${wbs}-residual-deferrals.json`);
  if (!existsSync(path))
    return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed))
      return [];
    return parsed.filter((e) => typeof e === "object" && e !== null && typeof e.id === "string" && typeof e.reason === "string" && e.reason.trim().length > 0);
  } catch {
    return [];
  }
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
function scanResiduals(root, wbs, tmpDir, taskContent, _env) {
  const runDir = join(root, ".spur", "run");
  const basePath = join(runDir, `${wbs}-base.sha`);
  const base = existsSync(basePath) ? readFileSync(basePath, "utf8").trim() : null;
  const review = parseReviewFindings(taskContent).map((r) => ({
    category: "review-finding",
    priority: r.priority,
    location: r.location,
    text: r.text
  }));
  const markers = base === null ? [] : parseDiffMarkers(collectAddedLines(root, base)).map((m) => ({
    category: "diff-marker",
    location: m.location,
    text: m.text
  }));
  const boxes = findUncheckedBoxes(taskContent).map((b) => ({
    category: "unchecked-box",
    location: b.location,
    text: b.text
  }));
  const residue = listStagingResidue(tmpDir, wbs).map((p) => ({
    category: "staging-residue",
    location: p,
    text: p
  }));
  const items = classify([...review, ...markers, ...boxes, ...residue], readDeferrals(runDir, wbs));
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
    `# Residual report \u2014 ${wbs}`,
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
  if (mode === "" || wbs === "")
    return null;
  return { mode, wbs, spurBin, root, tmpDir };
}
function spur(env, spurBinFlag, args, cwd) {
  return run(spurCommand(spurBinFlag ?? env.spurBin).cmd, [...spurCommand(spurBinFlag ?? env.spurBin).prefix, ...args], cwd);
}
function loadTask(env, spurBinFlag, wbs, root) {
  const res = spur(env, spurBinFlag, ["task", "show", wbs, "--json"], root);
  if (res.status !== 0)
    throw new Error(`task show ${wbs} failed`);
  const parsed = JSON.parse(res.stdout);
  const content = typeof parsed.content === "string" ? parsed.content : "";
  const fm = parsed.frontmatter;
  const featureId = typeof parsed.feature_id === "string" ? parsed.feature_id : fm !== null && typeof fm === "object" && typeof fm.feature_id === "string" ? fm.feature_id : "";
  return { content, featureId };
}
function loadVerdict(runDir, wbs) {
  return JSON.parse(readFileSync(join(runDir, `${wbs}-verdict.json`), "utf8"));
}
function scanMode(opts, env, io) {
  const task = loadTask(env, opts.spurBin, opts.wbs, opts.root);
  const runDir = join(opts.root, ".spur", "run");
  mkdirSync(runDir, { recursive: true });
  const artifact = scanResiduals(opts.root, opts.wbs, opts.tmpDir, task.content, env);
  writeFileSync(join(runDir, `${opts.wbs}-residuals.json`), `${JSON.stringify(artifact, null, 2)}
`);
  io.out(`residual-scan: ${opts.wbs} blocking=${artifact.counts.blocking} deferrable=${artifact.counts.deferrable} advisory=${artifact.counts.advisory} housekeeping=${artifact.counts.housekeeping}
`);
  return 0;
}
function foldMode(opts, _env, io) {
  const runDir = join(opts.root, ".spur", "run");
  const scan = JSON.parse(readFileSync(join(runDir, `${opts.wbs}-residuals.json`), "utf8"));
  const verdictPath = join(runDir, `${opts.wbs}-verdict.json`);
  const verdict = loadVerdict(runDir, opts.wbs);
  const findingsPath = join(runDir, `${opts.wbs}-test-gate.findings`);
  const existing = existsSync(findingsPath) ? readFileSync(findingsPath, "utf8") : "";
  const folded = foldVerdict(verdict, scan, existing);
  writeFileSync(verdictPath, `${JSON.stringify({ ...verdict, verdict: folded.verdict, checks: folded.checks }, null, 2)}
`);
  writeFileSync(findingsPath, folded.findings);
  io.out(`residual-fold: ${opts.wbs} verdict=${folded.verdict} residual-sweep=${folded.checks.find((c) => c.name === "residual-sweep")?.status}
`);
  return 0;
}
function settleMode(opts, env, io) {
  const task = loadTask(env, opts.spurBin, opts.wbs, opts.root);
  const runDir = join(opts.root, ".spur", "run");
  const scan = scanResiduals(opts.root, opts.wbs, opts.tmpDir, task.content, env);
  const residualsPath = join(runDir, `${opts.wbs}-residuals.json`);
  const deferred = scan.items.filter((i) => i.class === "deferrable");
  const prior = existsSync(residualsPath) ? JSON.parse(readFileSync(residualsPath, "utf8")) : {};
  if (deferred.length > 0 && prior.followUp === undefined) {
    if (task.featureId === "") {
      io.err(`residual-settle: ${opts.wbs} deferrals pending but feature_id unknown; re-run: residual-scan settle ${opts.wbs}
`);
      return 0;
    }
    const created = spur(env, opts.spurBin, ["task", "create", `Residuals from ${opts.wbs}`, "--feature", task.featureId, "--skip-ready", "--json"], opts.root);
    if (created.status !== 0) {
      io.err(`residual-settle: task create failed; re-run: residual-scan settle ${opts.wbs}
`);
      return 0;
    }
    let wbsNew = "";
    try {
      const parsed = JSON.parse(created.stdout);
      const pick = (o) => typeof o.wbs === "string" ? o.wbs : "";
      wbsNew = pick(parsed) || (parsed.data !== null && typeof parsed.data === "object" ? pick(parsed.data) : "");
    } catch {
      wbsNew = "";
    }
    if (wbsNew === "") {
      io.err(`residual-settle: could not read created task wbs; re-run: residual-scan settle ${opts.wbs}
`);
      return 0;
    }
    const bg = [
      `Source task: ${opts.wbs} (feature ${task.featureId}) \u2014 deferred residuals filed by residual-scan settle.`,
      "",
      ...deferred.map((i) => `- ${i.id} \u2014 ${i.location}: ${i.text}`)
    ].join(`
`);
    const bgFile = join(runDir, `${opts.wbs}-residual-background.md`);
    writeFileSync(bgFile, `${bg}
`);
    const upd = spur(env, opts.spurBin, ["task", "update", wbsNew, "--section", "Background", "--from-file", bgFile], opts.root);
    if (upd.status !== 0) {
      io.err(`residual-settle: background write failed; re-run: residual-scan settle ${opts.wbs}
`);
      return 0;
    }
    prior.followUp = wbsNew;
    io.out(`residual-settle: filed follow-up ${wbsNew} for ${deferred.length} deferred item(s)
`);
  }
  for (const path of listStagingResidue(opts.tmpDir, opts.wbs)) {
    try {
      rmSync(path, { force: true });
    } catch {
      io.err(`residual-settle: could not remove ${path}; re-run: residual-scan settle ${opts.wbs}
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
  const verdict = loadVerdict(runDir, opts.wbs);
  const sweep = verdict.checks.find((c) => c.name === "residual-sweep");
  if (sweep === undefined || sweep.status !== "fail")
    return 0;
  const task = loadTask(env, opts.spurBin, opts.wbs, opts.root);
  const scan = scanResiduals(opts.root, opts.wbs, opts.tmpDir, task.content, env);
  const blocking = scan.items.filter((i) => i.class === "blocking");
  const attemptFile = join(runDir, `${opts.wbs}-test-fix-attempt`);
  const attempts = existsSync(attemptFile) ? Number.parseInt(readFileSync(attemptFile, "utf8").trim() || "0", 10) : 0;
  const reportPath = join(runDir, `${opts.wbs}-residual-report.md`);
  writeFileSync(reportPath, renderReport(opts.wbs, blocking, Number.isNaN(attempts) ? 0 : attempts));
  io.out(`Recovery: fix the items in .spur/run/${opts.wbs}-residual-report.md, then /sp:dev-run ${opts.wbs}
`);
  return 0;
}
function main(argv, env = getEnvVars(), options = {}) {
  const io = options.io ?? {
    out: (line) => process.stdout.write(line),
    err: (line) => process.stderr.write(line)
  };
  const opts = parseArgs(argv);
  if (opts === null) {
    io.err(`${RESIDUAL_SCAN_USAGE}
`);
    return 2;
  }
  const cwd = options.cwd ?? process.cwd();
  const resolved = { ...opts, root: opts.root.startsWith("/") ? opts.root : join(cwd, opts.root) };
  if (resolved.mode === "scan")
    return scanMode(resolved, env, io);
  if (resolved.mode === "fold")
    return foldMode(resolved, env, io);
  if (resolved.mode === "settle")
    return settleMode(resolved, env, io);
  if (resolved.mode === "report")
    return reportMode(resolved, env, io);
  io.err(`${RESIDUAL_SCAN_USAGE}
`);
  return 2;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  spurCommand,
  scanResiduals,
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
