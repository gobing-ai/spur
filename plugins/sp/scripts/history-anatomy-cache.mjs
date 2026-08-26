#!/usr/bin/env node
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// plugins/sp/scripts/history-anatomy-cache.ts
import { createHash as createHash2 } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

// plugins/sp/lib/artifact-digest.generated.mjs
import { createHash } from "node:crypto";
var ARTIFACT_ARRAY_CLASSIFICATION = {
  byTool: "ranked",
  bySession: "ranked",
  topStepsByTokens: "ranked",
  topStepsByDuration: "ranked",
  topSteps: "ranked",
  bottlenecks: "ranked",
  coverage: "set",
  daily: "set",
  loops: "set",
  warnings: "set",
  pairings: "set",
  ladderSnapshot: "set",
  stepSupport: "set",
  phases: "set",
  tools: "set",
  skills: "set",
  sources: "set",
  models: "set"
};
var RANKED_ARTIFACT_KEYS = new Set(Object.entries(ARTIFACT_ARRAY_CLASSIFICATION).filter(([, kind]) => kind === "ranked").map(([key]) => key));
function canonicalize(value, key) {
  if (key === "generatedAt" || key === "validatedAt" || key === "baselineArtifactDigest")
    return null;
  if (Array.isArray(value)) {
    const raw = value.map((v) => JSON.stringify(canonicalize(v, "")));
    return RANKED_ARTIFACT_KEYS.has(key) ? raw : [...raw].sort();
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

// plugins/sp/scripts/history-anatomy-cache.ts
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
function readSourceName(s) {
  if (s !== null && typeof s === "object")
    return String(s.source ?? "");
  return String(s);
}
var DISPOSITIONS = ["hit", "miss", "forced-recompute"];
function optionalString(v) {
  return v == null || v === "" ? undefined : String(v);
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
        mode: identity.mode === "ad-hoc" ? "ad-hoc" : "daily",
        date: String(identity.date ?? ""),
        timezone: String(identity.timezone ?? ""),
        bounds: { since: bounds.since, until: bounds.until },
        sources: Array.isArray(identity.sources) ? identity.sources.map(readSourceName) : []
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
      })),
      runId: optionalString(obj.runId),
      currentArtifactPath: optionalString(obj.currentArtifactPath),
      baselineArtifactPath: obj.baselineArtifactPath == null ? null : String(obj.baselineArtifactPath),
      spurVersion: optionalString(obj.spurVersion),
      schemaVersion: obj.schemaVersion == null ? undefined : Number(obj.schemaVersion),
      executor: optionalString(obj.executor),
      model: optionalString(obj.model),
      cacheDisposition: DISPOSITIONS.includes(obj.cacheDisposition) ? obj.cacheDisposition : undefined
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
    const sep = ledgerSection.match(/^\|[\s:|-]+\|[ \t]*$/m);
    const body = sep?.index === undefined ? ledgerSection : ledgerSection.slice(sep.index + sep[0].length);
    const claimRows = body.match(/^[|>]\s+\S.*$/gm) ?? [];
    for (const row of claimRows) {
      const hasAnchor = /`[^`]+:\d+`|`[^`]+\.(md|ts|json)`|[a-z][a-z0-9_-]*\/[a-z][a-z0-9_./-]*:[0-9]+/i.test(row);
      if (!hasAnchor) {
        problems.push("evidence-claim-without-anchor");
        break;
      }
    }
  }
  return { ok: problems.length === 0, problems };
}
var NOT_AVAILABLE = "not available";
function logicDigest(path) {
  if (path === undefined || path === "" || !existsSync(path))
    return NOT_AVAILABLE;
  try {
    const h = createHash2("sha256");
    if (statSync(path).isDirectory()) {
      const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : /\.(md|ya?ml)$/.test(e.name) ? [join(dir, e.name)] : []).sort();
      for (const f of walk(path)) {
        h.update(f.slice(path.length));
        h.update(readFileSync(f));
      }
    } else {
      h.update(readFileSync(path));
    }
    return h.digest("hex");
  } catch {
    return NOT_AVAILABLE;
  }
}
function importedSnapshotAsOf(coverage) {
  const stamps = coverage.map((c) => c.lastImportedAt).filter((v) => typeof v === "string" && v !== "");
  if (stamps.length === 0 || stamps.length !== coverage.length)
    return NOT_AVAILABLE;
  return [...stamps].sort()[0] ?? NOT_AVAILABLE;
}
function localDay(tz, at = new Date) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, dateStyle: "short" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
function resolvePaths(opts) {
  const pluginRoot = opts.helper.replace(/\/scripts\/[^/]+$/, "");
  const skill = `${pluginRoot}/skills/history-anatomy`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const date = opts.date !== undefined && opts.date !== "" ? opts.date : localDay(tz, opts.now ?? new Date);
  const target = opts.output !== undefined && opts.output !== "" ? opts.output : `${opts.reportDir}/${date}-history-anatomy.md`;
  return `HA_HELPER=${opts.helper}
HA_SKILL=${skill}
HA_TARGET=${target}
HA_DATE=${date}
`;
}
function buildProvenance(opts) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(opts.artifact, "utf8"));
  } catch (err) {
    throw new Error(`could not parse fresh analyze artifact at ${opts.artifact}: ${err.message}`);
  }
  const coverage = (raw.coverage ?? []).map((c) => ({
    source: String(c.source ?? ""),
    status: String(c.status ?? ""),
    lastImportedAt: c.lastImportedAt == null ? null : String(c.lastImportedAt)
  }));
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const now = opts.now ?? new Date;
  const date = opts.date !== undefined && opts.date !== "" ? opts.date : localDay(tz, now);
  const windowState = opts.mode === "ad-hoc" || date < localDay(tz, now) ? "closed" : "provisional";
  const nowIso = now.toISOString();
  return {
    identity: {
      contractVersion: opts.contractVersion ?? "1",
      mode: opts.mode,
      date,
      timezone: tz,
      bounds: { since: String(raw.selector?.since ?? ""), until: String(raw.selector?.until ?? "") },
      sources: coverage.map((c) => c.source).sort()
    },
    windowState,
    generatedAt: nowIso,
    validatedAt: nowIso,
    artifactDigest: semanticArtifactDigest(raw),
    baselineArtifactDigest: (() => {
      if (!(opts.baseline !== undefined && existsSync(opts.baseline)))
        return null;
      try {
        return semanticArtifactDigest(JSON.parse(readFileSync(opts.baseline, "utf8")));
      } catch (err) {
        throw new Error(`could not parse baseline artifact at ${opts.baseline}: ${err.message}`);
      }
    })(),
    contractDigest: logicDigest(opts.contractFile),
    skillDigest: logicDigest(opts.skillDir),
    workflowDigest: logicDigest(opts.workflowFile),
    coverage,
    runId: opts.runId,
    currentArtifactPath: opts.artifact,
    baselineArtifactPath: opts.baseline ?? null,
    spurVersion: opts.spurVersion ?? NOT_AVAILABLE,
    schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : undefined,
    executor: opts.executor ?? NOT_AVAILABLE,
    model: opts.model ?? NOT_AVAILABLE
  };
}
function probe(opts) {
  const current = buildProvenance(opts);
  const cachedText = existsSync(opts.target) ? readFileSync(opts.target, "utf8") : null;
  const cached = cachedText === null ? null : parseProvenance(cachedText);
  const decision = opts.mode === "ad-hoc" ? { disposition: "miss", reasons: ["ad-hoc-never-cached"] } : decideCache(cached, current, {
    recompute: opts.recompute,
    dayClosed: current.windowState === "closed"
  });
  current.cacheDisposition = decision.disposition;
  return { decision, current };
}
var YAML_KEYS = [
  "windowState",
  "generatedAt",
  "validatedAt",
  "artifactDigest",
  "baselineArtifactDigest",
  "contractDigest",
  "skillDigest",
  "workflowDigest",
  "runId",
  "currentArtifactPath",
  "baselineArtifactPath",
  "spurVersion",
  "schemaVersion",
  "executor",
  "model",
  "cacheDisposition"
];
function yamlScalar(v) {
  if (v === null || v === undefined)
    return "null";
  if (typeof v === "number" || typeof v === "boolean")
    return String(v);
  return `"${String(v).replaceAll('"', "\\\"")}"`;
}
function renderProvenanceFrontmatter(p) {
  const lines = [
    "---",
    "identity:",
    `  contractVersion: ${yamlScalar(p.identity.contractVersion)}`,
    `  mode: ${p.identity.mode}`,
    `  date: ${yamlScalar(p.identity.date)}`,
    `  timezone: ${p.identity.timezone}`,
    "  bounds:",
    `    since: ${p.identity.bounds.since}`,
    `    until: ${p.identity.bounds.until}`,
    "  sources:"
  ];
  for (const s of p.identity.sources)
    lines.push(`    - source: ${s}`);
  for (const k of YAML_KEYS) {
    if (p[k] === undefined)
      continue;
    lines.push(`${k}: ${yamlScalar(p[k])}`);
  }
  lines.push("coverage:");
  for (const c of p.coverage) {
    lines.push(`  - source: ${c.source}, status: ${c.status}, lastImportedAt: ${c.lastImportedAt ?? "null"}`);
  }
  lines.push("---");
  return lines.join(`
`);
}
function bannerLine(p) {
  return `> imported snapshot as of ${importedSnapshotAsOf(p.coverage)} · window ${p.windowState} · cache ${p.cacheDisposition ?? NOT_AVAILABLE}`;
}
function stripHeader(md) {
  const body = md.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\n+/, "");
  return body.replace(/^> imported snapshot as of [^\n]*\n+/, "");
}
function stampReport(candidateMarkdown, p) {
  return `${renderProvenanceFrontmatter(p)}

${bannerLine(p)}

${stripHeader(candidateMarkdown).replace(/^\n+/, "")}`;
}
function refreshReport(publishedMarkdown, validatedAt, disposition) {
  const cached = parseProvenance(publishedMarkdown);
  if (cached === null)
    return publishedMarkdown;
  const refreshed = { ...cached, validatedAt, cacheDisposition: disposition };
  return stampReport(publishedMarkdown, refreshed);
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
var VALID_COMMANDS = "digest, check, paths, probe, stamp, refresh, publish";
var PROBE_USAGE = "<script> probe --artifact <a.json> --target <report.md> [--baseline <b.json>] [--mode daily|ad-hoc] " + "[--date <YYYY-MM-DD>] [--recompute true] [--out <prov.json>] [--skill-dir <d>] [--contract <f>] [--workflow <f>]";
function parseFlags(args) {
  const out = {};
  for (let i = 0;i < args.length; i++) {
    const a = args[i] ?? "";
    if (!a.startsWith("--"))
      continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
function runCacheCli(argv) {
  const [cmd, a, b] = argv;
  switch (cmd) {
    case "digest": {
      if (a === undefined) {
        return { exitCode: 1, stdout: "", stderr: `usage: <script> digest <artifact.json>
` };
      }
      let artifact;
      try {
        artifact = JSON.parse(readFileSync(a, "utf8"));
      } catch {
        return { exitCode: 1, stdout: "", stderr: `could not parse artifact at ${a}
` };
      }
      const digest = semanticArtifactDigest(artifact);
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
    case "paths": {
      const f = parseFlags(argv.slice(1));
      if (f.helper === undefined || f.out === undefined) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `usage: <script> paths --helper <p> --out <env> [--report-dir <d>] [--date <d>] [--output <p>]
`
        };
      }
      writeFileSync(f.out, resolvePaths({
        helper: f.helper,
        reportDir: f["report-dir"] ?? "docs/report",
        date: f.date,
        output: f.output
      }));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    case "probe": {
      const f = parseFlags(argv.slice(1));
      if (f.artifact === undefined || f.target === undefined) {
        return { exitCode: 1, stdout: "", stderr: `usage: ${PROBE_USAGE}
` };
      }
      let result;
      try {
        result = probe({
          artifact: f.artifact,
          target: f.target,
          baseline: f.baseline,
          mode: f.mode === "ad-hoc" ? "ad-hoc" : "daily",
          date: f.date,
          recompute: f.recompute === "true",
          executor: f.executor,
          model: f.model,
          skillDir: f["skill-dir"],
          contractFile: f.contract,
          workflowFile: f.workflow,
          contractVersion: f["contract-version"],
          runId: f["run-id"],
          spurVersion: f["spur-version"]
        });
      } catch {
        return { exitCode: 1, stdout: "", stderr: `could not read artifact at ${f.artifact}
` };
      }
      if (f.out !== undefined)
        writeFileSync(f.out, `${JSON.stringify(result.current, null, 2)}
`);
      const reasons = result.decision.reasons.map((r) => `- ${r}
`).join("");
      return { exitCode: 0, stdout: `${result.decision.disposition}
${reasons}`, stderr: "" };
    }
    case "stamp": {
      const f = parseFlags(argv.slice(1));
      if (f.candidate === undefined || f.provenance === undefined || f.out === undefined) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `usage: <script> stamp --candidate <c.md> --provenance <p.json> --out <o.md>
`
        };
      }
      try {
        const p = JSON.parse(readFileSync(f.provenance, "utf8"));
        writeFileSync(f.out, `${stampReport(readFileSync(f.candidate, "utf8"), p)}
`);
      } catch {
        return { exitCode: 1, stdout: "", stderr: `stamp: could not read candidate or provenance
` };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    case "refresh": {
      const f = parseFlags(argv.slice(1));
      if (f.report === undefined || f.out === undefined) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `usage: <script> refresh --report <published.md> --out <o.md> [--disposition hit]
`
        };
      }
      try {
        const disposition = f.disposition ?? "hit";
        const refreshed = refreshReport(readFileSync(f.report, "utf8"), f["validated-at"] ?? new Date().toISOString(), disposition);
        writeFileSync(f.out, refreshed.endsWith(`
`) ? refreshed : `${refreshed}
`);
      } catch {
        return { exitCode: 1, stdout: "", stderr: `refresh: could not read report at ${f.report}
` };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    default:
      return { exitCode: 1, stdout: "", stderr: `valid commands: ${VALID_COMMANDS}
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
  stampReport,
  semanticArtifactDigest,
  runCacheCli,
  resolvePaths,
  renderProvenanceFrontmatter,
  refreshReport,
  publishAtomically,
  probe,
  parseProvenance,
  logicDigest,
  importedSnapshotAsOf,
  decideCache,
  checkReportStructure,
  buildProvenance,
  bannerLine
};
