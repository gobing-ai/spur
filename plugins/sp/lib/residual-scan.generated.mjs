// packages/app/src/services/residual-scan.ts
import { join } from "node:path";
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
function recordedVerdictPath(runDir, wbs, fs) {
  const evidence = join(runDir, "..", "memory", "evidence");
  const durable = join(evidence, `${wbs}-verdict.json`);
  for (const path of [join(runDir, ".."), join(evidence, ".."), evidence, durable]) {
    try {
      if (fs.lstatSync(path).isSymbolicLink())
        throw new Error(`residual-scan: symlink evidence path: ${path}`);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
  }
  return fs.existsSync(durable) ? durable : join(runDir, `${wbs}-verdict.json`);
}
export {
  scanResiduals,
  renderReport,
  recordedVerdictPath,
  parseReviewFindings,
  parseDiffMarkers,
  normalizeAnchor,
  makeItemId,
  locationOf,
  foldVerdict,
  findUncheckedBoxes,
  classify,
  blockingAnchors,
  ALLOW_PRAGMA
};
