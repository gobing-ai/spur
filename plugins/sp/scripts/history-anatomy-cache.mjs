#!/usr/bin/env node
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// plugins/sp/scripts/history-anatomy-cache.ts
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
var ELEVEN_SECTIONS = [
  "Scope and provenance",
  "Executive summary",
  "Baseline comparison",
  "Findings",
  "Recurrence ledger",
  "Telemetry gaps",
  "Remediation options",
  "Performance analysis",
  "Workflow and process improvements",
  "Positive patterns",
  "Evidence ledger"
];
var FINDING_FIELDS = [
  "key",
  "category",
  "impact",
  "trend",
  "observation",
  "inference",
  "confidence",
  "contradictions",
  "evidenceAnchor"
];
function canonicalize(value, key) {
  if (key === "generatedAt" || key === "validatedAt" || key === "baselineArtifactDigest")
    return null;
  if (Array.isArray(value)) {
    const raw = value.map((v) => JSON.stringify(canonicalize(v, "")));
    const isRanked = key === "byTool" || key === "bySession" || key === "topStepsByTokens" || key === "topStepsByDuration";
    return isRanked ? raw : [...raw].sort();
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = canonicalize(value[k], k);
    }
    return out;
  }
  return value;
}
function semanticArtifactDigest(artifactJson) {
  const material = JSON.stringify(canonicalize(artifactJson, "root"));
  return createHash("sha256").update(material).digest("hex");
}
function parseScalar(raw) {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"'))
    return t.slice(1, -1).replaceAll("\\\"", '"');
  if (t === "null")
    return null;
  return t;
}
function parseBlock(text) {
  const obj = {};
  const lines = text.split(`
`);
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*$/.test(line) || /^\s*#/.test(line) || /^-\s+/.test(line.trim()))
      continue;
    const indent = line.search(/\S/);
    const eq = line.indexOf(":");
    if (eq === -1)
      continue;
    const key = line.slice(0, eq).trim();
    const val = parseScalar(line.slice(eq + 1).trim());
    let consumed = 0;
    const next = lines[i + 1];
    if ((val === "" || val === undefined) && /^\s*-\s+/.test(next ?? "")) {
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j] ?? "")) {
        const entry = {};
        for (const part of (lines[j] ?? "").trim().replace(/^-\s+/, "").split(",")) {
          const e = part.indexOf(":");
          if (e === -1)
            continue;
          entry[part.slice(0, e).trim()] = parseScalar(part.slice(e + 1).trim());
        }
        items.push(entry);
        j++;
      }
      obj[key] = items;
      consumed = j - i - 1;
    } else if (val === "" || val === undefined) {
      const block = [];
      let j = i + 1;
      while (j < lines.length) {
        const nl = lines[j] ?? "";
        if (nl.trim() === "") {
          block.push("");
          j++;
          continue;
        }
        const nind = nl.search(/\S/);
        if (nind <= indent)
          break;
        block.push(nl);
        j++;
      }
      obj[key] = parseBlock(block.join(`
`));
      consumed = j - i - 1;
    } else {
      obj[key] = val;
    }
    i += consumed;
  }
  return obj;
}
function parseProvenance(reportMarkdown) {
  const match = reportMarkdown.match(/^---\n([\s\S]*?)\n---/);
  if (match === null)
    return null;
  try {
    const obj = parseBlock(match[1] ?? "");
    const identity = obj.identity;
    const coverage = obj.coverage;
    if (identity === undefined || !Array.isArray(coverage))
      return null;
    const bounds = identity.bounds;
    if (bounds === undefined || typeof bounds.since !== "string" || typeof bounds.until !== "string") {
      return null;
    }
    return {
      identity: {
        contractVersion: String(identity.contractVersion ?? ""),
        mode: "daily",
        date: String(identity.date ?? ""),
        timezone: String(identity.timezone ?? ""),
        bounds: { since: bounds.since, until: bounds.until },
        sources: Array.isArray(identity.sources) ? identity.sources.map((s) => String(s)) : []
      },
      windowState: obj.windowState === "closed" ? "closed" : "provisional",
      generatedAt: String(obj.generatedAt ?? ""),
      validatedAt: String(obj.validatedAt ?? ""),
      artifactDigest: String(obj.artifactDigest ?? ""),
      baselineArtifactDigest: obj.baselineArtifactDigest == null ? null : String(obj.baselineArtifactDigest),
      contractDigest: String(obj.contractDigest ?? ""),
      skillDigest: String(obj.skillDigest ?? ""),
      workflowDigest: String(obj.workflowDigest ?? ""),
      coverage: coverage.map((c) => ({
        source: String(c.source ?? ""),
        status: String(c.status ?? ""),
        lastImportedAt: c.lastImportedAt == null ? null : String(c.lastImportedAt)
      }))
    };
  } catch {
    return null;
  }
}
function decideCache(cached, current, opts) {
  if (opts.recompute)
    return { disposition: "forced-recompute", reasons: ["recompute"] };
  if (cached === null)
    return { disposition: "miss", reasons: ["no-cache"] };
  const reasons = [];
  const id = cached.identity;
  const cur = current.identity;
  if (id.contractVersion !== cur.contractVersion)
    reasons.push("identity:contractVersion");
  if (id.mode !== cur.mode)
    reasons.push("identity:mode");
  if (id.date !== cur.date)
    reasons.push("identity:date");
  if (id.timezone !== cur.timezone)
    reasons.push("identity:timezone");
  if (id.bounds.since !== cur.bounds.since || id.bounds.until !== cur.bounds.until)
    reasons.push("identity:bounds");
  if ([...id.sources].sort().join("\x00") !== [...cur.sources].sort().join("\x00"))
    reasons.push("identity:sources");
  if (cached.artifactDigest !== current.artifactDigest)
    reasons.push("data-changed");
  if (cached.contractDigest !== current.contractDigest)
    reasons.push("logic-changed:contract");
  if (cached.skillDigest !== current.skillDigest)
    reasons.push("logic-changed:skill");
  if (cached.workflowDigest !== current.workflowDigest)
    reasons.push("logic-changed:workflow");
  const currentSources = new Set(current.coverage.map((c) => c.source));
  if (cached.coverage.some((c) => !currentSources.has(c.source)))
    reasons.push("coverage-degraded");
  if (cached.windowState === "provisional" && opts.dayClosed)
    reasons.push("window-closed");
  return { disposition: reasons.length === 0 ? "hit" : "miss", reasons };
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function checkReportStructure(reportMarkdown) {
  const problems = [];
  if (/TODO|PLACEHOLDER|FIXME|^\|\s*\|/im.test(reportMarkdown))
    problems.push("placeholder-or-todo-present");
  let lastIdx = -1;
  for (const section of ELEVEN_SECTIONS) {
    const re = new RegExp(`^#{2,3}\\s+${escapeRe(section)}\\s*$`, "m");
    const m = reportMarkdown.match(re);
    if (m === null || (m.index ?? -1) <= lastIdx) {
      problems.push(`section-missing-or-out-of-order:${section}`);
    } else if (m.index !== undefined) {
      lastIdx = m.index;
    }
  }
  const findingRows = reportMarkdown.match(/^\|\s*(reliability|repetition|workflow|performance|coverage|telemetry|positive):[^|]+/gm);
  for (const row of findingRows ?? []) {
    for (const field of FINDING_FIELDS) {
      if (!row.toLowerCase().includes(field))
        problems.push(`finding-missing-field:${field}`);
    }
  }
  const ledgerIdx = reportMarkdown.search(/^#{2,3}\s+Evidence\s+ledger/im);
  if (ledgerIdx !== -1) {
    const ledgerSection = reportMarkdown.slice(ledgerIdx);
    const claimRows = ledgerSection.match(/^[|>]\s+.+$/gm) ?? [];
    for (const row of claimRows) {
      const hasAnchor = /`[^`]+:\d+`|`[^`]+\.(md|ts|json)`|[a-z][a-z0-9_-]*\/[a-z][a-z0-9_./-]*:[0-9]+/i.test(row);
      if (!hasAnchor)
        problems.push("evidence-claim-without-anchor");
      break;
    }
  }
  return { ok: problems.length === 0, problems };
}
function publishAtomically(candidatePath, targetPath) {
  const tmpPath = `${targetPath}.tmp`;
  try {
    writeFileSync(tmpPath, readFileSync(candidatePath));
    const fd = openSync(tmpPath, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {}
    throw err;
  }
}
function runCacheCli(argv) {
  const [cmd, a, b] = argv;
  switch (cmd) {
    case "digest": {
      if (a === undefined) {
        return { exitCode: 1, stdout: "", stderr: `usage: <script> digest <artifact.json>
` };
      }
      const digest = semanticArtifactDigest(JSON.parse(readFileSync(a, "utf8")));
      return { exitCode: 0, stdout: `${digest}
`, stderr: "" };
    }
    case "check": {
      if (a === undefined) {
        return { exitCode: 1, stdout: "", stderr: `usage: <script> check <report.md>
` };
      }
      const result = checkReportStructure(readFileSync(a, "utf8"));
      const stdout = `${result.ok ? "PASS" : "FAIL"}
${result.problems.map((p) => `- ${p}
`).join("")}`;
      return { exitCode: result.ok ? 0 : 1, stdout, stderr: "" };
    }
    case "publish": {
      if (a === undefined || b === undefined) {
        return { exitCode: 1, stdout: "", stderr: `usage: <script> publish <candidate.md> <target.md>
` };
      }
      publishAtomically(a, b);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    default:
      return { exitCode: 1, stdout: "", stderr: `valid commands: digest, check, publish
` };
  }
}
{
  const { exitCode, stdout, stderr } = runCacheCli(process.argv.slice(2));
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = exitCode;
}
export {
  semanticArtifactDigest,
  runCacheCli,
  publishAtomically,
  parseProvenance,
  decideCache,
  checkReportStructure
};
